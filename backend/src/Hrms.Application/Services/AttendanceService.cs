using Hrms.Application.Abstractions.Persistence;
using Hrms.Application.Abstractions.Security;
using Hrms.Application.Abstractions.Services;
using Hrms.Application.Abstractions.Tenancy;
using Hrms.Application.Common;
using Hrms.Application.DTOs;
using Hrms.Domain.Entities;
using Hrms.Domain.Enums;
using System.Text.Json;

namespace Hrms.Application.Services;

public sealed class AttendanceService : IAttendanceService
{
    private readonly IUnitOfWork _uow;
    private readonly ICurrentUser _currentUser;
    private readonly ITenantContext? _tenantContext;

    public AttendanceService(IUnitOfWork uow, ICurrentUser currentUser, ITenantContext? tenantContext = null)
    {
        _uow = uow;
        _currentUser = currentUser;
        _tenantContext = tenantContext;
    }

    public async Task<AttendanceSummaryDto> GetSummaryAsync(CancellationToken ct = default)
    {
        var records = await LoadLatestDayAsync(ct);
        return new AttendanceSummaryDto(
            records.Count(r => r.Status == AttendanceStatus.Present || r.Status == AttendanceStatus.HalfDay),
            records.Count(r => r.Status == AttendanceStatus.Absent),
            records.Count(r => r.Status == AttendanceStatus.Late),
            records.Count(r => r.Status == AttendanceStatus.OnLeave));
    }

    public async Task<IReadOnlyList<AttendanceRecordDto>> GetForEmployeeMonthAsync(
        Guid employeeId,
        int year,
        int month,
        CancellationToken ct = default)
    {
        var records = await _uow.Attendance.ListForEmployeeMonthAsync(employeeId, year, month, ct);
        return records.Select(ToDto).ToList();
    }

    public async Task<IReadOnlyList<AttendanceRecordDto>> GetTodayAsync(CancellationToken ct = default)
    {
        var records = await LoadLatestDayAsync(ct);
        return records.Select(ToDto).ToList();
    }

    public async Task<IReadOnlyList<MonthlyMusterDayDto>> GetMusterAsync(
        Guid employeeId,
        int year,
        int month,
        CancellationToken ct = default)
    {
        var (tz, _, maxPunchDurationHours) = await GetCompanyTimeZoneAsync(ct);
        var first = new DateOnly(year, month, 1);
        var daysInMonth = DateTime.DaysInMonth(year, month);
        var lastDay = new DateOnly(year, month, daysInMonth);
        var records = await _uow.Attendance.ListForEmployeeMonthAsync(employeeId, year, month, ct);
        var byDate = records.ToDictionary(r => r.Date);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, tz));

        var leaves = await _uow.LeaveRequests.ToListAsync(
            _uow.LeaveRequests.Query().Where(l => l.EmployeeId == employeeId && l.Status == LeaveStatus.Approved && l.FromDate <= lastDay && l.ToDate >= first),
            ct);

        var holidays = await _uow.Holidays.ToListAsync(
            _uow.Holidays.Query().Where(h => h.Date >= first && h.Date <= lastDay && h.Type != HolidayType.Optional),
            ct);
        var holidayByDate = holidays.ToDictionary(h => h.Date);

        var monthStartUtc = TimeZoneInfo.ConvertTimeToUtc(first.ToDateTime(TimeOnly.MinValue), tz);
        var monthEndUtc = TimeZoneInfo.ConvertTimeToUtc(lastDay.AddDays(1).ToDateTime(TimeOnly.MinValue), tz);

        var emp = await _uow.Employees.GetWithDetailsAsync(employeeId, ct)
               ?? await _uow.Employees.GetByIdAsync(employeeId, ct);
        var empName = emp is null ? "—" : $"{emp.FirstName} {emp.LastName}".Trim();
        var empCode = emp?.EmployeeCode ?? "—";

        var (maxAllowedHours, targetDailyHours, lateGraceMinutes, shiftStart, isOvernight) = GetShiftParameters(emp?.Shift, maxPunchDurationHours);

        var allMonthPunches = await _uow.Punches.ToListAsync(
            _uow.Punches.Query()
                .Where(p => p.EmployeeId == employeeId && p.PunchTime >= monthStartUtc && p.PunchTime < monthEndUtc)
                .OrderBy(p => p.PunchTime),
            ct);

        var punchesByDate = allMonthPunches
            .GroupBy(p => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(p.PunchTime, tz)))
            .ToDictionary(g => g.Key, g => (IReadOnlyList<EmployeePunchDto>)g.Select(p => new EmployeePunchDto(
                p.Id,
                p.EmployeeId,
                empName,
                empCode,
                p.PunchTime,
                p.PunchType.ToString(),
                p.Note,
                p.Device
            )).ToList());

        var result = new List<MonthlyMusterDayDto>();

        for (var day = 1; day <= daysInMonth; day++)
        {
            var date = first.AddDays(day - 1);
            var weekend = date.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday;
            punchesByDate.TryGetValue(date, out var dayPunches);
            var hasPunches = dayPunches != null && dayPunches.Count > 0;
            var hasRecord = byDate.TryGetValue(date, out var record);

            // Step 4: Daily Attendance Calculation (Total duration, breaks, net working hours, late arrival, status)
            if (hasRecord || hasPunches)
            {
                TimeOnly? inTime = record?.CheckIn;
                TimeOnly? outTime = record?.CheckOut;
                decimal workHours = record?.WorkHours ?? 0m;
                int breakMins = record?.BreakMinutes ?? 0;
                string status = record?.Status.ToString() ?? "Present";

                if (hasPunches)
                {
                    var sortedPunches = dayPunches!.OrderBy(p => p.PunchTime).ToList();
                    var firstInPunch = sortedPunches.FirstOrDefault(p => p.PunchType == "ClockIn");
                    var lastOutPunch = sortedPunches.LastOrDefault(p => p.PunchType == "ClockOut");
                    var lastPunch = sortedPunches.Last();
                    var isCurrentlyCheckedIn = (lastPunch.PunchType == "ClockIn" || lastPunch.PunchType == "BreakIn" || lastPunch.PunchType == "BreakOut");

                    if (firstInPunch != null && inTime == null)
                    {
                        var localIn = TimeZoneInfo.ConvertTimeFromUtc(firstInPunch.PunchTime, tz);
                        inTime = TimeOnly.FromDateTime(localIn);
                    }
                    if (isCurrentlyCheckedIn)
                    {
                        outTime = null;
                    }
                    else if (lastOutPunch != null && outTime == null)
                    {
                        var localOut = TimeZoneInfo.ConvertTimeFromUtc(lastOutPunch.PunchTime, tz);
                        outTime = TimeOnly.FromDateTime(localOut);
                    }

                    // Calculate net working seconds and break seconds across all intervals
                    long totalWorkSec = 0;
                    long totalBreakSec = 0;
                    DateTime? wOpen = null;
                    DateTime? bOpen = null;
                    DateTime? lastClockOutUtc = null;

                    foreach (var p in sortedPunches)
                    {
                        if (p.PunchType == "ClockIn")
                        {
                            if (bOpen.HasValue)
                            {
                                var diff = p.PunchTime - bOpen.Value;
                                if (diff.TotalSeconds > 0) totalBreakSec += (long)diff.TotalSeconds;
                                bOpen = null;
                            }
                            else if (lastClockOutUtc.HasValue)
                            {
                                var diff = p.PunchTime - lastClockOutUtc.Value;
                                if (diff.TotalSeconds > 0) totalBreakSec += (long)diff.TotalSeconds;
                                lastClockOutUtc = null;
                            }
                            wOpen = p.PunchTime;
                        }
                        else if (p.PunchType == "BreakIn")
                        {
                            if (wOpen.HasValue)
                            {
                                var diff = p.PunchTime - wOpen.Value;
                                if (diff.TotalSeconds > 0) totalWorkSec += (long)diff.TotalSeconds;
                                wOpen = null;
                            }
                            bOpen = p.PunchTime;
                        }
                        else if (p.PunchType == "BreakOut")
                        {
                            if (bOpen.HasValue)
                            {
                                var diff = p.PunchTime - bOpen.Value;
                                if (diff.TotalSeconds > 0) totalBreakSec += (long)diff.TotalSeconds;
                                bOpen = null;
                            }
                            wOpen = p.PunchTime;
                        }
                        else if (p.PunchType == "ClockOut")
                        {
                            if (wOpen.HasValue)
                            {
                                var diff = p.PunchTime - wOpen.Value;
                                if (diff.TotalSeconds > 0) totalWorkSec += (long)diff.TotalSeconds;
                                wOpen = null;
                            }
                            if (bOpen.HasValue)
                            {
                                var diff = p.PunchTime - bOpen.Value;
                                if (diff.TotalSeconds > 0) totalBreakSec += (long)diff.TotalSeconds;
                                bOpen = null;
                            }
                            lastClockOutUtc = p.PunchTime;
                        }
                    }

                    // If active today and still open
                    if (date == today)
                    {
                        var lastP = sortedPunches.Last();
                        var nowUtc = DateTime.UtcNow;
                        if ((lastP.PunchType == "ClockIn" || lastP.PunchType == "BreakOut") && wOpen.HasValue)
                        {
                            var diff = nowUtc - wOpen.Value;
                            if (diff.TotalSeconds > 0) totalWorkSec += (long)diff.TotalSeconds;
                        }
                        else if (lastP.PunchType == "BreakIn" && bOpen.HasValue)
                        {
                            var diff = nowUtc - bOpen.Value;
                            if (diff.TotalSeconds > 0) totalBreakSec += (long)diff.TotalSeconds;
                        }
                    }

                    var calcHours = Math.Round((decimal)totalWorkSec / 3600m, 2);
                    var calcBreak = (int)Math.Round((double)totalBreakSec / 60.0);

                    if (date == today && isCurrentlyCheckedIn)
                    {
                        workHours = calcHours;
                        breakMins = calcBreak;
                    }
                    else if (record != null && record.WorkHours > 0)
                    {
                        workHours = record.WorkHours;
                        breakMins = record.BreakMinutes > 0 ? record.BreakMinutes : calcBreak;
                    }
                    else
                    {
                        if (calcHours > 0) workHours = calcHours;
                        if (calcBreak > 0) breakMins = calcBreak;
                    }

                    // Step 4: Status Determination (Present, Late, HalfDay)
                    var isLate = inTime.HasValue && inTime.Value > shiftStart.AddMinutes(lateGraceMinutes);

                    if (outTime.HasValue)
                    {
                        if (workHours >= targetDailyHours * 0.9m || workHours >= 7.5m)
                        {
                            status = isLate ? "Late" : "Present";
                        }
                        else if (workHours >= targetDailyHours * 0.5m || workHours >= 4.0m)
                        {
                            status = "HalfDay";
                        }
                        else if (workHours > 0)
                        {
                            status = "HalfDay";
                        }
                    }
                    else if (date == today)
                    {
                        status = isLate ? "Late" : "Present";
                    }
                    else
                    {
                        status = isLate ? "Late" : "Present";
                    }
                }
                else if (inTime.HasValue && outTime.HasValue && workHours == 0)
                {
                    var durHours = (decimal)Math.Max(0, (outTime.Value.ToTimeSpan() - inTime.Value.ToTimeSpan()).TotalHours);
                    if (durHours >= 5.0m && breakMins == 0) breakMins = 60;
                    workHours = Math.Max(0, durHours - (breakMins / 60m));

                    var isLate = inTime.Value > shiftStart.AddMinutes(lateGraceMinutes);
                    if (workHours >= targetDailyHours * 0.9m || workHours >= 7.5m)
                    {
                        status = isLate ? "Late" : "Present";
                    }
                    else if (workHours >= targetDailyHours * 0.5m || workHours >= 4.0m)
                    {
                        status = "HalfDay";
                    }
                }

                result.Add(new MonthlyMusterDayDto(
                    date,
                    date.ToString("MMM d"),
                    inTime?.ToString("HH:mm"),
                    outTime?.ToString("HH:mm"),
                    workHours,
                    status,
                    breakMins,
                    dayPunches));
            }
            else if (leaves.Any(l => l.FromDate <= date && l.ToDate >= date))
            {
                result.Add(new MonthlyMusterDayDto(
                    date,
                    date.ToString("MMM d"),
                    null,
                    null,
                    0,
                    AttendanceStatus.OnLeave.ToString()));
            }
            else if (holidayByDate.TryGetValue(date, out var hol))
            {
                result.Add(new MonthlyMusterDayDto(
                    date,
                    hol.Name,
                    null,
                    null,
                    0,
                    AttendanceStatus.Holiday.ToString()));
            }
            else if (weekend)
            {
                result.Add(new MonthlyMusterDayDto(
                    date,
                    date.ToString("MMM d"),
                    null,
                    null,
                    0,
                    AttendanceStatus.Weekend.ToString()));
            }
            else if (date >= today)
            {
                result.Add(new MonthlyMusterDayDto(
                    date,
                    date.ToString("MMM d"),
                    null,
                    null,
                    0,
                    "Scheduled"));
            }
            else
            {
                result.Add(new MonthlyMusterDayDto(
                    date,
                    date.ToString("MMM d"),
                    null,
                    null,
                    0,
                    AttendanceStatus.Absent.ToString()));
            }
        }

        return result;
    }

    public async Task<IReadOnlyList<RegularizationDto>> GetRegularizationsAsync(CancellationToken ct = default)
    {
        var items = await _uow.Regularizations.ListWithEmployeeAsync(ct);
        return items.Select(ToRegularizationDto).ToList();
    }

    public async Task<RegularizationDto> CreateRegularizationAsync(
        CreateRegularizationRequest request,
        CancellationToken ct = default)
    {
        if (request.OutTime <= request.InTime)
        {
            throw new ValidationException("The out time must be after the in time.");
        }

        var employeeId = await ResolveEmployeeIdAsync(request.EmployeeId, ct);

        var entity = new RegularizationRequest
        {
            EmployeeId = employeeId,
            Date = request.Date,
            InTime = request.InTime,
            OutTime = request.OutTime,
            Reason = request.Reason.Trim(),
            Status = ApprovalStatus.Pending,
            SubmittedAtUtc = DateTime.UtcNow,
        };

        var emp = await _uow.Employees.GetByIdAsync(employeeId, ct);
        var empName = emp != null ? $"{emp.FirstName} {emp.LastName}".Trim() : "Employee";

        await _uow.Regularizations.AddAsync(entity, ct);
        await _uow.Notifications.AddAsync(new Notification
        {
            IconKey = "clock",
            Title = "Attendance Regularization",
            Message = $"{empName} submitted a regularization request for {request.Date:MMM d, yyyy}: {request.Reason}",
            TimeLabel = "Just now",
            IsRead = false,
            CreatedAtUtc = DateTime.UtcNow,
        }, ct);
        await _uow.SaveChangesAsync(ct);

        var loaded = await _uow.Regularizations.GetWithEmployeeAsync(entity.Id, ct)
                     ?? throw NotFoundException.For("Regularization request", entity.Id);

        return ToRegularizationDto(loaded);
    }

    public async Task<RegularizationDto> DecideRegularizationAsync(Guid id, bool approved, CancellationToken ct = default)
    {
        var entity = await _uow.Regularizations.GetWithEmployeeAsync(id, ct)
                     ?? throw NotFoundException.For("Regularization request", id);

        if (entity.Status != ApprovalStatus.Pending)
        {
            throw new ConflictException("This regularization request has already been decided.");
        }

        entity.Status = approved ? ApprovalStatus.Approved : ApprovalStatus.Rejected;
        entity.DecidedAtUtc = DateTime.UtcNow;
        entity.DecidedByUserId = _currentUser.UserId;

        _uow.Regularizations.Update(entity);

        if (approved)
        {
            var emp = entity.Employee ?? await _uow.Employees.GetByIdAsync(entity.EmployeeId, ct);
            var (maxAllowedHours, targetDailyHours, lateGraceMinutes, shiftStart, isOvernight) = GetShiftParameters(emp?.Shift);
            var (tz, _, _) = await GetCompanyTimeZoneAsync(ct);

            // Step 4: Calculate total duration & break time (Net Working Hours = Total Duration - Break Time)
            var totalDurationHours = (decimal)Math.Max(0, (entity.OutTime.ToTimeSpan() - entity.InTime.ToTimeSpan()).TotalHours);
            var breakMinutes = totalDurationHours >= 5.0m ? 60 : 0;
            var netWorkHours = Math.Max(0, Math.Round(totalDurationHours - (breakMinutes / 60m), 2));

            // Step 4: Late arrival check (Check-In > Shift Start + Grace Period)
            var isLate = entity.InTime > shiftStart.AddMinutes(lateGraceMinutes);
            var status = AttendanceStatus.Present;

            if (netWorkHours >= targetDailyHours * 0.9m || netWorkHours >= 7.5m)
            {
                status = isLate ? AttendanceStatus.Late : AttendanceStatus.Present;
            }
            else if (netWorkHours >= targetDailyHours * 0.5m || netWorkHours >= 4.0m)
            {
                status = AttendanceStatus.HalfDay;
            }
            else if (netWorkHours > 0)
            {
                status = AttendanceStatus.HalfDay;
            }

            var record = await _uow.Attendance.GetForEmployeeDateAsync(entity.EmployeeId, entity.Date, ct);
            if (record == null)
            {
                record = new AttendanceRecord
                {
                    EmployeeId = entity.EmployeeId,
                    Date = entity.Date,
                    CheckIn = entity.InTime,
                    CheckOut = entity.OutTime,
                    BreakMinutes = breakMinutes,
                    WorkHours = netWorkHours,
                    Status = status,
                    Notes = $"Regularized: {entity.Reason}"
                };
                await _uow.Attendance.AddAsync(record, ct);
            }
            else
            {
                record.CheckIn = entity.InTime;
                record.CheckOut = entity.OutTime;
                record.BreakMinutes = breakMinutes;
                record.WorkHours = netWorkHours;
                record.Status = status;
                record.Notes = string.IsNullOrWhiteSpace(record.Notes)
                    ? $"Regularized: {entity.Reason}"
                    : $"{record.Notes} | Regularized: {entity.Reason}";
                _uow.Attendance.Update(record);
            }

            // Sync punches into EmployeePunches so all punch timeline and kiosk queries display regularized punches
            var localInDateTime = entity.Date.ToDateTime(entity.InTime);
            var inUtc = TimeZoneInfo.ConvertTimeToUtc(localInDateTime, tz);
            var localOutDateTime = entity.Date.ToDateTime(entity.OutTime);
            var outUtc = TimeZoneInfo.ConvertTimeToUtc(localOutDateTime, tz);

            var existingPunches = await _uow.Punches.ToListAsync(
                _uow.Punches.Query().Where(p => p.EmployeeId == entity.EmployeeId && p.PunchTime >= inUtc.AddMinutes(-5) && p.PunchTime <= outUtc.AddMinutes(5)),
                ct);

            if (!existingPunches.Any(p => p.PunchType == PunchType.ClockIn))
            {
                await _uow.Punches.AddAsync(new EmployeePunch
                {
                    EmployeeId = entity.EmployeeId,
                    PunchTime = inUtc,
                    PunchType = PunchType.ClockIn,
                    Note = $"Regularized: {entity.Reason}",
                    Device = "Regularization Approved",
                    IsOpen = false
                }, ct);
            }

            if (!existingPunches.Any(p => p.PunchType == PunchType.ClockOut))
            {
                await _uow.Punches.AddAsync(new EmployeePunch
                {
                    EmployeeId = entity.EmployeeId,
                    PunchTime = outUtc,
                    PunchType = PunchType.ClockOut,
                    Note = $"Regularized: {entity.Reason}",
                    Device = "Regularization Approved",
                    IsOpen = false
                }, ct);
            }
        }

        var empName = entity.Employee != null ? $"{entity.Employee.FirstName} {entity.Employee.LastName}".Trim() : "Employee";
        await _uow.Notifications.AddAsync(new Notification
        {
            IconKey = approved ? "check" : "x",
            Title = approved ? "Regularization Approved" : "Regularization Rejected",
            Message = $"Attendance regularization for {empName} on {entity.Date:MMM d, yyyy} was {(approved ? "approved" : "rejected")}.",
            TimeLabel = "Just now",
            IsRead = false,
            CreatedAtUtc = DateTime.UtcNow,
        }, ct);

        await _uow.SaveChangesAsync(ct);
        return ToRegularizationDto(entity);
    }

    private async Task<(TimeZoneInfo TimeZone, string TimeZoneName, int MaxPunchDurationHours)> GetCompanyTimeZoneAsync(CancellationToken ct)
    {
        var settings = await _uow.CompanySettings.FirstOrDefaultAsync(
            _uow.CompanySettings.Query().OrderBy(c => c.CreatedAtUtc), ct);
        var timeZoneName = !string.IsNullOrWhiteSpace(settings?.TimeZone) ? settings.TimeZone : "UTC";
        var maxDuration = (settings?.MaxPunchDurationHours ?? 0) > 0 ? settings!.MaxPunchDurationHours : 16;
        return (ResolveTimeZone(timeZoneName), timeZoneName, maxDuration);
    }

    private static TimeZoneInfo ResolveTimeZone(string? timeZoneId)
    {
        if (string.IsNullOrWhiteSpace(timeZoneId))
        {
            return TimeZoneInfo.Utc;
        }

        var trimmed = timeZoneId.Trim();

        // 1. Direct TryFindSystemTimeZoneById on raw string
        if (TimeZoneInfo.TryFindSystemTimeZoneById(trimmed, out var tz))
        {
            return tz;
        }

        // 2. If it's UTC or starts with UTC (e.g. "UTC (+00:00)", "UTC")
        if (trimmed.StartsWith("UTC", StringComparison.OrdinalIgnoreCase))
        {
            return TimeZoneInfo.Utc;
        }

        // 3. Extract base identifier if formatted with display label like "Asia/Dubai (GST +04:00)"
        var cleanId = trimmed;
        var parenIdx = cleanId.IndexOf('(');
        if (parenIdx > 0)
        {
            cleanId = cleanId.Substring(0, parenIdx).Trim();
        }

        if (TimeZoneInfo.TryFindSystemTimeZoneById(cleanId, out tz))
        {
            return tz;
        }

        // 4. Common Windows vs IANA cross-mappings
        var lower = cleanId.ToLowerInvariant();
        if (lower.Contains("dubai") || lower.Contains("arabian") || lower.Contains("uae") || cleanId.Equals("GST", StringComparison.OrdinalIgnoreCase) || cleanId.Contains("(GST", StringComparison.OrdinalIgnoreCase))
        {
            if (TimeZoneInfo.TryFindSystemTimeZoneById("Arabian Standard Time", out tz) ||
                TimeZoneInfo.TryFindSystemTimeZoneById("Asia/Dubai", out tz))
            {
                return tz;
            }
        }
        else if (lower.Contains("kolkata") || lower.Contains("india") || lower.Contains("calcutta") || cleanId.Equals("IST", StringComparison.OrdinalIgnoreCase) || cleanId.Contains("(IST", StringComparison.OrdinalIgnoreCase))
        {
            if (TimeZoneInfo.TryFindSystemTimeZoneById("India Standard Time", out tz) ||
                TimeZoneInfo.TryFindSystemTimeZoneById("Asia/Kolkata", out tz) ||
                TimeZoneInfo.TryFindSystemTimeZoneById("Asia/Calcutta", out tz))
            {
                return tz;
            }
        }
        else if (lower.Contains("riyadh") || lower.Contains("saudi") || cleanId.Equals("AST", StringComparison.OrdinalIgnoreCase) || cleanId.Contains("(AST", StringComparison.OrdinalIgnoreCase))
        {
            if (TimeZoneInfo.TryFindSystemTimeZoneById("Arab Standard Time", out tz) ||
                TimeZoneInfo.TryFindSystemTimeZoneById("Asia/Riyadh", out tz))
            {
                return tz;
            }
        }
        else if (lower.Contains("london") || cleanId.Equals("GMT", StringComparison.OrdinalIgnoreCase) || cleanId.Equals("BST", StringComparison.OrdinalIgnoreCase) || cleanId.Contains("(GMT", StringComparison.OrdinalIgnoreCase) || cleanId.Contains("(BST", StringComparison.OrdinalIgnoreCase))
        {
            if (TimeZoneInfo.TryFindSystemTimeZoneById("GMT Standard Time", out tz) ||
                TimeZoneInfo.TryFindSystemTimeZoneById("Europe/London", out tz))
            {
                return tz;
            }
        }
        else if (lower.Contains("new_york") || cleanId.Equals("EST", StringComparison.OrdinalIgnoreCase) || cleanId.Contains("(EST", StringComparison.OrdinalIgnoreCase))
        {
            if (TimeZoneInfo.TryFindSystemTimeZoneById("Eastern Standard Time", out tz) ||
                TimeZoneInfo.TryFindSystemTimeZoneById("America/New_York", out tz))
            {
                return tz;
            }
        }
        else if (lower.Contains("singapore") || cleanId.Equals("SGT", StringComparison.OrdinalIgnoreCase) || cleanId.Contains("(SGT", StringComparison.OrdinalIgnoreCase))
        {
            if (TimeZoneInfo.TryFindSystemTimeZoneById("Singapore Standard Time", out tz) ||
                TimeZoneInfo.TryFindSystemTimeZoneById("Asia/Singapore", out tz))
            {
                return tz;
            }
        }

        // If unrecognized timezone string, throw BadRequestException
        throw new BadRequestException($"Company timezone '{timeZoneId}' is not recognized by the server.");
    }

    private static (double MaxAllowedHours, decimal TargetDailyHours, int LateGraceMinutes, TimeOnly ShiftStart, bool IsOvernight) GetShiftParameters(Shift? shift, int maxPunchDurationHours = 16)
    {
        var targetHours = shift?.DailyHours > 0 ? (decimal)shift.DailyHours : 8.0m;
        var lateGrace = shift?.LateGraceMinutes > 0 ? shift.LateGraceMinutes : 15;
        var shiftStart = shift?.StartTime ?? new TimeOnly(9, 0);

        if (shift == null)
        {
            return (Math.Max((double)maxPunchDurationHours, 16.0), targetHours, lateGrace, shiftStart, false);
        }

        bool isOvernight = shift.EndTime <= shift.StartTime;
        TimeSpan shiftDuration = isOvernight
            ? (shift.EndTime.ToTimeSpan() + TimeSpan.FromHours(24)) - shift.StartTime.ToTimeSpan()
            : shift.EndTime.ToTimeSpan() - shift.StartTime.ToTimeSpan();

        // One unified rule: Shift duration + 4 hours buffer, bounded by company-configured max punch duration (default 16 hours)
        double maxHours = Math.Max(shiftDuration.TotalHours + 4.0, (double)maxPunchDurationHours);
        return (maxHours, targetHours, lateGrace, shiftStart, isOvernight);
    }

    private async Task<Guid?> ResolveSelfOrExplicitEmployeeIdOrNullAsync(Guid? explicitId, CancellationToken ct)
    {
        if (explicitId is { } id && id != Guid.Empty) return id;
        if (_currentUser.EmployeeId is { } own && own != Guid.Empty) return own;
        return null;
    }

    private async Task<Guid> ResolveSelfOrExplicitEmployeeIdAsync(Guid? explicitId, CancellationToken ct)
    {
        if (explicitId is { } id && id != Guid.Empty) return id;
        if (_currentUser.EmployeeId is { } own && own != Guid.Empty) return own;

        throw new ValidationException("User is not linked to an employee record.");
    }

    public async Task<EmployeePunchDto> RecordPunchAsync(CreatePunchRequest request, CancellationToken ct = default)
    {
        if (request.EmployeeId.HasValue && request.EmployeeId.Value != Guid.Empty && request.EmployeeId.Value != _currentUser.EmployeeId)
        {
            bool isHrOrAdmin = _currentUser.IsInRole("Admin") || _currentUser.IsInRole("HR") || _currentUser.IsInRole("SuperAdmin") || _currentUser.IsInRole("HRManager") || _currentUser.IsInRole("HrAdmin") || _currentUser.Role == "HR" || _currentUser.Role == "Admin";
            if (!isHrOrAdmin)
            {
                throw new ForbiddenException("You can only record attendance punches for yourself.");
            }
        }

        var employeeId = await ResolveSelfOrExplicitEmployeeIdAsync(request.EmployeeId, ct);
        var employee = await _uow.Employees.GetWithDetailsAsync(employeeId, ct)
                       ?? await _uow.Employees.GetByIdAsync(employeeId, ct)
                       ?? throw NotFoundException.For("Employee", employeeId);

        if (!Enum.TryParse<PunchType>(request.PunchType, true, out var punchType))
        {
            punchType = PunchType.ClockIn;
        }

        var (tz, tzName, maxPunchDurationHours) = await GetCompanyTimeZoneAsync(ct);
        var nowUtc = DateTime.UtcNow;
        var localNow = TimeZoneInfo.ConvertTimeFromUtc(nowUtc, tz);
        var localToday = DateOnly.FromDateTime(localNow);

        var (maxAllowedHours, targetDailyHours, lateGraceMinutes, shiftStart, isOvernight) = GetShiftParameters(employee.Shift, maxPunchDurationHours);

        // Fetch any currently open punches for this employee
        var existingOpenPunches = await _uow.Punches.ToListAsync(
            _uow.Punches.Query().Where(p => p.EmployeeId == employeeId && p.IsOpen),
            ct);

        // Fetch shift/today start window in UTC
        var shiftDayStartUtc = TimeZoneInfo.ConvertTimeToUtc(localToday.ToDateTime(TimeOnly.MinValue), tz);
        var shiftDayEndUtc = shiftDayStartUtc.AddHours(maxAllowedHours + 4);

        // Expire older open punches from previous days
        EmployeePunch? staleOpenForClockOut = null;
        foreach (var open in existingOpenPunches.Where(p => (nowUtc - p.PunchTime).TotalHours > maxAllowedHours || (!isOvernight && p.PunchTime < shiftDayStartUtc)))
        {
            open.IsOpen = false;
            open.Note = string.IsNullOrWhiteSpace(open.Note)
                ? "Incomplete shift - missing check-out (auto-closed, needs regularization)"
                : $"{open.Note} | Incomplete shift (auto-closed, needs regularization)";
            _uow.Punches.Update(open);
            staleOpenForClockOut = open;

            var staleLocalDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(open.PunchTime, tz));
            var staleRecord = await _uow.Attendance.GetForEmployeeDateAsync(employeeId, staleLocalDate, ct);
            if (staleRecord != null)
            {
                staleRecord.Notes = string.IsNullOrWhiteSpace(staleRecord.Notes)
                    ? "Incomplete shift - missing check-out (auto-closed, needs regularization)"
                    : $"{staleRecord.Notes} | Incomplete shift (auto-closed, needs regularization)";
                _uow.Attendance.Update(staleRecord);
            }
        }

        // If there is an active open punch within maxAllowedHours (such as an overnight shift started yesterday),
        // include it in todayPunches so that ClockOut or Break actions can transition it.
        var activeOpenPunch = existingOpenPunches.FirstOrDefault(p => p.IsOpen && (nowUtc - p.PunchTime).TotalHours <= maxAllowedHours);
        var queryStartUtc = (activeOpenPunch != null && activeOpenPunch.PunchTime < shiftDayStartUtc)
            ? activeOpenPunch.PunchTime
            : shiftDayStartUtc;

        // Find the most recent punch today for this employee
        var todayPunches = await _uow.Punches.ToListAsync(
            _uow.Punches.Query()
                .Where(p => p.EmployeeId == employeeId && p.PunchTime >= queryStartUtc && p.PunchTime <= shiftDayEndUtc)
                .OrderBy(p => p.PunchTime),
            ct);

        if (punchType == PunchType.ClockOut && staleOpenForClockOut != null && todayPunches.Count == 0)
        {
            await _uow.SaveChangesAsync(ct);
            var priorLocalTime = TimeZoneInfo.ConvertTimeFromUtc(staleOpenForClockOut.PunchTime, tz);
            throw new ConflictException(
                $"Your check-in from {priorLocalTime:MMM dd, yyyy hh:mm tt} exceeded the allowable shift limit ({maxAllowedHours:F0} hours) and has been closed as incomplete. Please submit an attendance regularization request.");
        }

        var lastPunch = todayPunches.LastOrDefault();

        bool isHrConsole = string.Equals(request.Device, "HR Console", StringComparison.OrdinalIgnoreCase)
                           || (request.Note != null && request.Note.Contains("HR Console", StringComparison.OrdinalIgnoreCase));

        // Validate state transitions cleanly (skip strict lockout when HR is manually managing punches)
        if (!isHrConsole)
        {
            if (lastPunch == null || lastPunch.PunchType == PunchType.ClockOut)
            {
                if (punchType == PunchType.BreakIn)
                {
                    throw new ValidationException("Cannot start a break without checking in first.");
                }
                if (punchType == PunchType.BreakOut)
                {
                    throw new ValidationException("Cannot end a break without checking in first.");
                }
                if (punchType == PunchType.ClockOut)
                {
                    throw new ConflictException("Cannot check out without an active check-in.");
                }
            }
            else if (lastPunch.PunchType == PunchType.ClockIn || lastPunch.PunchType == PunchType.BreakOut)
            {
                if (punchType == PunchType.ClockIn)
                {
                    throw new ConflictException("You are already checked in. Please check out or start a break.");
                }
                if (punchType == PunchType.BreakOut)
                {
                    throw new ValidationException("You are not currently on a break. You can start a break with Break In.");
                }
            }
            else if (lastPunch.PunchType == PunchType.BreakIn)
            {
                if (punchType == PunchType.ClockIn)
                {
                    throw new ConflictException("You are currently on break. Please end break (Break Out) before checking in.");
                }
                if (punchType == PunchType.BreakIn)
                {
                    throw new ConflictException("You are already on a break. Record Break Out when your break ends.");
                }
            }
        }

        // Close previous open punch(es) since the current punch transitions the employee to a new phase
        foreach (var open in existingOpenPunches)
        {
            open.IsOpen = false;
            _uow.Punches.Update(open);
        }

        var punch = new EmployeePunch
        {
            EmployeeId = employeeId,
            PunchTime = nowUtc,
            PunchType = punchType,
            Note = request.Note,
            Device = request.Device ?? "Web Browser",
            IsOpen = (punchType != PunchType.ClockOut)
        };

        await _uow.Punches.AddAsync(punch, ct);

        var allPunches = todayPunches.Concat(new[] { punch }).OrderBy(p => p.PunchTime).ToList();

        // Determine attendance record target date
        var firstClockIn = allPunches.FirstOrDefault(p => p.PunchType == PunchType.ClockIn);
        var attendanceDate = firstClockIn != null
            ? DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(firstClockIn.PunchTime, tz))
            : localToday;

        TimeOnly? firstCheckIn = null;
        TimeOnly? lastCheckOut = null;
        long totalClosedSeconds = 0;
        long totalBreakSeconds = 0;
        DateTime? workIntervalOpen = null;
        DateTime? breakIntervalOpen = null;
        DateTime? lastClockOutUtc = null;

        foreach (var p in allPunches)
        {
            var pLocal = TimeZoneInfo.ConvertTimeFromUtc(p.PunchTime, tz);
            var pTimeOnly = TimeOnly.FromDateTime(pLocal);

            if (p.PunchType == PunchType.ClockIn)
            {
                firstCheckIn ??= pTimeOnly;
                if (breakIntervalOpen.HasValue)
                {
                    var diff = p.PunchTime - breakIntervalOpen.Value;
                    if (diff.TotalSeconds > 0) totalBreakSeconds += (long)diff.TotalSeconds;
                    breakIntervalOpen = null;
                }
                else if (lastClockOutUtc.HasValue)
                {
                    var diff = p.PunchTime - lastClockOutUtc.Value;
                    if (diff.TotalSeconds > 0) totalBreakSeconds += (long)diff.TotalSeconds;
                    lastClockOutUtc = null;
                }
                workIntervalOpen = p.PunchTime;
            }
            else if (p.PunchType == PunchType.BreakIn)
            {
                if (workIntervalOpen.HasValue)
                {
                    var diff = p.PunchTime - workIntervalOpen.Value;
                    if (diff.TotalSeconds > 0) totalClosedSeconds += (long)diff.TotalSeconds;
                    workIntervalOpen = null;
                }
                breakIntervalOpen = p.PunchTime;
            }
            else if (p.PunchType == PunchType.BreakOut)
            {
                if (breakIntervalOpen.HasValue)
                {
                    var diff = p.PunchTime - breakIntervalOpen.Value;
                    if (diff.TotalSeconds > 0) totalBreakSeconds += (long)diff.TotalSeconds;
                    breakIntervalOpen = null;
                }
                workIntervalOpen = p.PunchTime;
            }
            else if (p.PunchType == PunchType.ClockOut)
            {
                lastCheckOut = pTimeOnly;
                if (workIntervalOpen.HasValue)
                {
                    var diff = p.PunchTime - workIntervalOpen.Value;
                    if (diff.TotalSeconds > 0) totalClosedSeconds += (long)diff.TotalSeconds;
                    workIntervalOpen = null;
                }
                if (breakIntervalOpen.HasValue)
                {
                    var diff = p.PunchTime - breakIntervalOpen.Value;
                    if (diff.TotalSeconds > 0) totalBreakSeconds += (long)diff.TotalSeconds;
                    breakIntervalOpen = null;
                }
                lastClockOutUtc = p.PunchTime;
            }
        }

        // Include ongoing interval up to nowUtc if shift is still open
        if (punchType != PunchType.ClockOut)
        {
            if (workIntervalOpen.HasValue)
            {
                var diff = nowUtc - workIntervalOpen.Value;
                if (diff.TotalSeconds > 0) totalClosedSeconds += (long)diff.TotalSeconds;
            }
            if (breakIntervalOpen.HasValue && punchType == PunchType.BreakIn)
            {
                var diff = nowUtc - breakIntervalOpen.Value;
                if (diff.TotalSeconds > 0) totalBreakSeconds += (long)diff.TotalSeconds;
            }
        }

        var workedHours = Math.Round((decimal)totalClosedSeconds / 3600m, 2);
        var breakMinutes = (int)Math.Round((double)totalBreakSeconds / 60.0);
        bool currentlyStillCheckedIn = (punchType != PunchType.ClockOut);

        // Step 4: Attendance calculations (Late arrival, early departure, overtime)
        string? step4Note = null;
        if (firstCheckIn.HasValue && firstCheckIn.Value > shiftStart.AddMinutes(lateGraceMinutes))
        {
            var lateMins = (int)(firstCheckIn.Value.ToTimeSpan() - shiftStart.ToTimeSpan()).TotalMinutes;
            step4Note = $"[Late: {lateMins}m]";
        }

        if (punchType == PunchType.ClockOut && lastCheckOut.HasValue && employee.Shift != null && !isOvernight)
        {
            if (lastCheckOut.Value < employee.Shift.EndTime)
            {
                var earlyMins = (int)(employee.Shift.EndTime.ToTimeSpan() - lastCheckOut.Value.ToTimeSpan()).TotalMinutes;
                if (earlyMins >= 5)
                {
                    step4Note = string.IsNullOrEmpty(step4Note) ? $"[Early Departure: {earlyMins}m]" : $"{step4Note} [Early Departure: {earlyMins}m]";
                }
            }
            else if (lastCheckOut.Value > employee.Shift.EndTime)
            {
                var otMins = (int)(lastCheckOut.Value.ToTimeSpan() - employee.Shift.EndTime.ToTimeSpan()).TotalMinutes;
                if (otMins >= 15)
                {
                    step4Note = string.IsNullOrEmpty(step4Note) ? $"[Overtime: {otMins}m]" : $"{step4Note} [Overtime: {otMins}m]";
                }
            }
        }

        var combinedNotes = string.IsNullOrWhiteSpace(request.Note)
            ? step4Note
            : (string.IsNullOrEmpty(step4Note) ? request.Note : $"{request.Note} | {step4Note}");

        var attendanceRecord = await _uow.Attendance.GetForEmployeeDateAsync(employeeId, attendanceDate, ct);
        if (attendanceRecord is null)
        {
            attendanceRecord = new AttendanceRecord
            {
                EmployeeId = employeeId,
                Date = attendanceDate,
                CheckIn = firstCheckIn,
                CheckOut = (punchType == PunchType.ClockOut) ? lastCheckOut : null,
                BreakMinutes = breakMinutes,
                WorkHours = workedHours,
                Status = AttendanceStatus.Present,
                Notes = combinedNotes
            };

            if (firstCheckIn.HasValue && firstCheckIn.Value > shiftStart.AddMinutes(lateGraceMinutes))
            {
                attendanceRecord.Status = AttendanceStatus.Late;
            }

            await _uow.Attendance.AddAsync(attendanceRecord, ct);
        }
        else
        {
            attendanceRecord.CheckIn = firstCheckIn ?? attendanceRecord.CheckIn;
            if (punchType == PunchType.ClockOut)
            {
                attendanceRecord.CheckOut = lastCheckOut;
            }
            else
            {
                attendanceRecord.CheckOut = null;
            }
            attendanceRecord.WorkHours = workedHours;
            attendanceRecord.BreakMinutes = breakMinutes;
            if (!string.IsNullOrWhiteSpace(combinedNotes))
            {
                attendanceRecord.Notes = combinedNotes;
            }

            // Only finalize status to HalfDay or Absent if the employee is NOT currently checked in!
            if (currentlyStillCheckedIn)
            {
                // While still working, do not downgrade to HalfDay
                if (attendanceRecord.CheckIn.HasValue && attendanceRecord.CheckIn.Value > shiftStart.AddMinutes(lateGraceMinutes))
                {
                    attendanceRecord.Status = AttendanceStatus.Late;
                }
                else
                {
                    attendanceRecord.Status = AttendanceStatus.Present;
                }
            }
            else
            {
                // Finalize status after check out based on shift target hours
                if (attendanceRecord.WorkHours >= targetDailyHours * 0.9m || attendanceRecord.WorkHours >= 7.5m)
                {
                    if (attendanceRecord.CheckIn.HasValue && attendanceRecord.CheckIn.Value > shiftStart.AddMinutes(lateGraceMinutes))
                    {
                        attendanceRecord.Status = AttendanceStatus.Late;
                    }
                    else
                    {
                        attendanceRecord.Status = AttendanceStatus.Present;
                    }
                }
                else if (attendanceRecord.WorkHours >= targetDailyHours * 0.5m || attendanceRecord.WorkHours >= 4.0m)
                {
                    attendanceRecord.Status = AttendanceStatus.HalfDay;
                }
                else if (attendanceRecord.WorkHours > 0)
                {
                    attendanceRecord.Status = AttendanceStatus.HalfDay;
                }
            }

            _uow.Attendance.Update(attendanceRecord);
        }

        var targetUser = await _uow.Users.FirstOrDefaultAsync(
            _uow.Users.Query().Where(u => u.EmployeeId == employee.Id || (employee.Email != null && u.Email == employee.Email)), ct);

        var hasCustomNote = !string.IsNullOrWhiteSpace(request.Note)
            && !request.Note.Equals("Manual Punch (HR Console)", StringComparison.OrdinalIgnoreCase)
            && !request.Note.Equals("Web Browser", StringComparison.OrdinalIgnoreCase)
            && !request.Note.Equals("Web Dashboard", StringComparison.OrdinalIgnoreCase);

        var punchLabel = punchType == PunchType.ClockIn ? "Clock In" : (punchType == PunchType.ClockOut ? "Clock Out" : "Break");
        var notifTitle = hasCustomNote ? $"HR Note: {punchLabel}" : $"{punchLabel} Activity";
        var notifMessage = hasCustomNote ? request.Note!.Trim() : $"{employee.FirstName} {employee.LastName} ({employee.EmployeeCode}) recorded {punchType} at {localNow:hh:mm tt}.";
        if (notifMessage.Length > 490) notifMessage = notifMessage.Substring(0, 490);

        await _uow.Notifications.AddAsync(new Notification
        {
            UserId = targetUser?.Id,
            IconKey = hasCustomNote ? "bell" : "clock",
            Title = notifTitle,
            Message = notifMessage,
            TimeLabel = "Just now",
            IsRead = false,
            CreatedAtUtc = DateTime.UtcNow,
        }, ct);

        try
        {
            await _uow.SaveChangesAsync(ct);
        }
        catch (Exception ex) when (ex.GetType().Name.Contains("DbUpdate") || ex.Message.Contains("IX_EmployeePunches_EmployeeId_IsOpen") || ex.InnerException?.Message.Contains("IX_EmployeePunches_EmployeeId_IsOpen") == true)
        {
            // Database-level filtered unique index (IX_EmployeePunches_EmployeeId_IsOpen) caught a concurrent check-in
            throw new ConflictException("You are already checked in. Please check out before checking in again.");
        }

        var name = $"{employee.FirstName} {employee.LastName}".Trim();
        return new EmployeePunchDto(
            punch.Id,
            employee.Id,
            name,
            employee.EmployeeCode,
            punch.PunchTime,
            punch.PunchType.ToString(),
            punch.Note,
            punch.Device);
    }

    public async Task<EmployeePunchStatusDto> GetPunchStatusAsync(Guid? employeeId, CancellationToken ct = default)
    {
        var nullableId = await ResolveSelfOrExplicitEmployeeIdOrNullAsync(employeeId, ct);
        if (nullableId is null)
        {
            // Admin/HR user with no linked employee — return a safe default
            var (_, defaultTz, _) = await GetCompanyTimeZoneAsync(ct);
            return new EmployeePunchStatusDto(false, null, DateTime.UtcNow, defaultTz, null, 0, 0, null, Array.Empty<EmployeePunchDto>(), false, null, null);
        }
        var targetEmpId = nullableId.Value;
        var employee = await _uow.Employees.GetWithDetailsAsync(targetEmpId, ct)
                       ?? await _uow.Employees.GetByIdAsync(targetEmpId, ct);

        var (tz, tzName, maxPunchDurationHours) = await GetCompanyTimeZoneAsync(ct);
        var nowUtc = DateTime.UtcNow;
        var localNow = TimeZoneInfo.ConvertTimeFromUtc(nowUtc, tz);
        var localToday = DateOnly.FromDateTime(localNow);

        var (maxAllowedHours, _, _, _, isOvernight) = GetShiftParameters(employee?.Shift, maxPunchDurationHours);

        // Fetch any open punches for this employee (pure read-only, NO SaveChanges!)
        var openPunch = await _uow.Punches.FirstOrDefaultAsync(
            _uow.Punches.Query()
                .Where(p => p.EmployeeId == targetEmpId && p.IsOpen)
                .OrderByDescending(p => p.PunchTime),
            ct);

        bool isCheckedIn = false;
        DateTime? currentOpenInUtc = null;
        bool hasForgottenCheckOut = false;
        DateOnly? forgottenCheckOutDate = null;
        string? regularizationMsg = null;

        if (openPunch != null)
        {
            var openDuration = nowUtc - openPunch.PunchTime;
            var localPunchDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(openPunch.PunchTime, tz));
            if (openDuration.TotalHours > maxAllowedHours || (!isOvernight && localPunchDate < localToday))
            {
                // Shift expired past shift end + grace period or from a previous day
                openPunch.IsOpen = false;
                _uow.Punches.Update(openPunch);
                hasForgottenCheckOut = true;
                var priorLocal = TimeZoneInfo.ConvertTimeFromUtc(openPunch.PunchTime, tz);
                forgottenCheckOutDate = DateOnly.FromDateTime(priorLocal);
                regularizationMsg = $"You did not check out from your shift on {forgottenCheckOutDate:MMM dd, yyyy}. That punch is marked as Incomplete and requires regularization.";
                isCheckedIn = false;
            }
            else
            {
                // Shift is actively ongoing (including night shifts that crossed midnight)
                isCheckedIn = true;
                currentOpenInUtc = openPunch.PunchTime;
            }
        }

        // Determine today's local date boundaries for punches display
        var localStart = localToday.ToDateTime(TimeOnly.MinValue);
        var startUtc = TimeZoneInfo.ConvertTimeToUtc(localStart, tz);
        var localEnd = localToday.AddDays(1).ToDateTime(TimeOnly.MinValue);
        var endUtc = TimeZoneInfo.ConvertTimeToUtc(localEnd, tz);

        // If active open punch started prior to today (e.g. night shift), extend window to include it
        var displayStartUtc = (isCheckedIn && currentOpenInUtc.HasValue && currentOpenInUtc.Value < startUtc)
            ? currentOpenInUtc.Value.AddHours(-1)
            : startUtc;

        var punchesQuery = await _uow.Punches.ToListAsync(
            _uow.Punches.Query()
                .Where(p => p.EmployeeId == targetEmpId && p.PunchTime >= displayStartUtc && p.PunchTime < endUtc)
                .OrderBy(p => p.PunchTime),
            ct);

        long closedSeconds = 0;
        long breakSeconds = 0;
        TimeOnly? firstCheckIn = null;
        DateTime? activeCalcOpen = null;
        DateTime? activeBreakOpen = null;
        DateTime? lastClockOutUtc = null;

        foreach (var p in punchesQuery)
        {
            var pLocal = TimeZoneInfo.ConvertTimeFromUtc(p.PunchTime, tz);
            var pTimeOnly = TimeOnly.FromDateTime(pLocal);

            if (p.PunchType == PunchType.ClockIn)
            {
                firstCheckIn ??= pTimeOnly;
                if (activeBreakOpen.HasValue)
                {
                    var diff = p.PunchTime - activeBreakOpen.Value;
                    if (diff.TotalSeconds > 0) breakSeconds += (long)diff.TotalSeconds;
                    activeBreakOpen = null;
                }
                else if (lastClockOutUtc.HasValue)
                {
                    var diff = p.PunchTime - lastClockOutUtc.Value;
                    if (diff.TotalSeconds > 0) breakSeconds += (long)diff.TotalSeconds;
                    lastClockOutUtc = null;
                }
                activeCalcOpen = p.PunchTime;
            }
            else if (p.PunchType == PunchType.BreakIn)
            {
                if (activeCalcOpen.HasValue)
                {
                    var diff = p.PunchTime - activeCalcOpen.Value;
                    if (diff.TotalSeconds > 0) closedSeconds += (long)diff.TotalSeconds;
                    activeCalcOpen = null;
                }
                activeBreakOpen = p.PunchTime;
            }
            else if (p.PunchType == PunchType.BreakOut)
            {
                if (activeBreakOpen.HasValue)
                {
                    var diff = p.PunchTime - activeBreakOpen.Value;
                    if (diff.TotalSeconds > 0) breakSeconds += (long)diff.TotalSeconds;
                    activeBreakOpen = null;
                }
                activeCalcOpen = p.PunchTime;
            }
            else if (p.PunchType == PunchType.ClockOut)
            {
                if (activeCalcOpen.HasValue)
                {
                    var diff = p.PunchTime - activeCalcOpen.Value;
                    if (diff.TotalSeconds > 0) closedSeconds += (long)diff.TotalSeconds;
                    activeCalcOpen = null;
                }
                if (activeBreakOpen.HasValue)
                {
                    var diff = p.PunchTime - activeBreakOpen.Value;
                    if (diff.TotalSeconds > 0) breakSeconds += (long)diff.TotalSeconds;
                    activeBreakOpen = null;
                }
                lastClockOutUtc = p.PunchTime;
            }
        }

        var lastPunch = punchesQuery.LastOrDefault();
        bool isOnBreak = lastPunch != null && lastPunch.PunchType == PunchType.BreakIn;
        if (lastPunch != null)
        {
            if (lastPunch.PunchType == PunchType.ClockOut)
            {
                isCheckedIn = false;
                currentOpenInUtc = null;
            }
            else if (lastPunch.PunchType == PunchType.ClockIn || lastPunch.PunchType == PunchType.BreakIn || lastPunch.PunchType == PunchType.BreakOut)
            {
                isCheckedIn = true;
                currentOpenInUtc = openPunch?.PunchTime ?? lastPunch.PunchTime;
            }
        }

        long liveOngoingSeconds = 0;
        if (isCheckedIn)
        {
            if (activeCalcOpen.HasValue)
            {
                var ongoing = nowUtc - activeCalcOpen.Value;
                if (ongoing.TotalSeconds > 0) liveOngoingSeconds = (long)ongoing.TotalSeconds;
            }
            if (activeBreakOpen.HasValue && isOnBreak)
            {
                var ongoing = nowUtc - activeBreakOpen.Value;
                if (ongoing.TotalSeconds > 0) breakSeconds += (long)ongoing.TotalSeconds;
            }
        }

        var workedHours = Math.Round((decimal)(closedSeconds + liveOngoingSeconds) / 3600m, 2);
        var empName = employee == null ? "—" : $"{employee.FirstName} {employee.LastName}".Trim();
        var empCode = employee?.EmployeeCode ?? "—";

        var punchDtos = punchesQuery
            .OrderByDescending(p => p.PunchTime)
            .Select(p => new EmployeePunchDto(
                p.Id,
                p.EmployeeId,
                empName,
                empCode,
                p.PunchTime,
                p.PunchType.ToString(),
                p.Note,
                p.Device))
            .ToList();

        var shiftName = employee?.Shift?.Name ?? "General Shift";
        var shiftTiming = employee?.Shift != null
            ? $"{DateTime.Today.Add(employee.Shift.StartTime.ToTimeSpan()):hh:mm tt} – {DateTime.Today.Add(employee.Shift.EndTime.ToTimeSpan()):hh:mm tt}"
            : "09:00 AM – 06:00 PM";

        return new EmployeePunchStatusDto(
            IsCheckedIn: isCheckedIn,
            LastPunchTimeUtc: punchesQuery.LastOrDefault()?.PunchTime ?? openPunch?.PunchTime,
            ServerTimeUtc: nowUtc,
            CompanyTimeZone: tzName,
            FirstCheckInTime: firstCheckIn?.ToString("hh:mm tt"),
            WorkedHoursToday: workedHours,
            WorkedSecondsToday: closedSeconds + liveOngoingSeconds,
            CurrentCheckInTimeUtc: currentOpenInUtc,
            TodayPunches: punchDtos,
            HasForgottenCheckOut: hasForgottenCheckOut,
            ForgottenCheckOutDate: forgottenCheckOutDate,
            RegularizationMessage: regularizationMsg,
            IsOnBreak: isOnBreak,
            BreakSecondsToday: breakSeconds,
            ShiftName: shiftName,
            ShiftTiming: shiftTiming);
    }

    public async Task<IReadOnlyList<EmployeePunchDto>> GetTodayPunchesAsync(Guid? employeeId, CancellationToken ct = default)
    {
        var nullableId = await ResolveSelfOrExplicitEmployeeIdOrNullAsync(employeeId, ct);
        if (nullableId is null)
            return Array.Empty<EmployeePunchDto>();
        var targetEmpId = nullableId.Value;
        var (tz, _, _) = await GetCompanyTimeZoneAsync(ct);
        var nowUtc = DateTime.UtcNow;
        var localNow = TimeZoneInfo.ConvertTimeFromUtc(nowUtc, tz);
        var localToday = DateOnly.FromDateTime(localNow);

        var localStart = localToday.ToDateTime(TimeOnly.MinValue);
        var startUtc = TimeZoneInfo.ConvertTimeToUtc(localStart, tz);
        var localEnd = localToday.AddDays(1).ToDateTime(TimeOnly.MinValue);
        var endUtc = TimeZoneInfo.ConvertTimeToUtc(localEnd, tz);

        var punches = await _uow.Punches.ToListAsync(
            _uow.Punches.Query()
                .Where(p => p.EmployeeId == targetEmpId && p.PunchTime >= startUtc && p.PunchTime < endUtc)
                .OrderByDescending(p => p.PunchTime),
            ct);

        var emp = await _uow.Employees.GetByIdAsync(targetEmpId, ct);
        var name = emp is null ? "—" : $"{emp.FirstName} {emp.LastName}".Trim();
        var code = emp?.EmployeeCode ?? "—";

        return punches.Select(p => new EmployeePunchDto(
            p.Id,
            p.EmployeeId,
            name,
            code,
            p.PunchTime,
            p.PunchType.ToString(),
            p.Note,
            p.Device)).ToList();
    }

    public async Task<TodayAttendanceOverviewDto> GetTodayOverviewAsync(DateOnly? targetDate = null, CancellationToken ct = default)
    {
        var (tz, _, _) = await GetCompanyTimeZoneAsync(ct);
        var nowUtc = DateTime.UtcNow;
        var localNow = TimeZoneInfo.ConvertTimeFromUtc(nowUtc, tz);
        var localToday = DateOnly.FromDateTime(localNow);
        var target = targetDate ?? localToday;

        var employees = await _uow.Employees.ListWithDepartmentAsync(ct);
        var dateRecords = await _uow.Attendance.ToListAsync(
            _uow.Attendance.Query()
                .Where(a => a.Date == target)
                .Select(a => new { a.EmployeeId, a.CheckIn, a.CheckOut, a.WorkHours, a.Status, a.Notes }),
            ct);
        var recordByEmp = dateRecords.ToDictionary(r => r.EmployeeId);

        var dateLeaves = await _uow.LeaveRequests.ToListAsync(
            _uow.LeaveRequests.Query().Where(l => l.Status == LeaveStatus.Approved && l.FromDate <= target && l.ToDate >= target),
            ct);
        var leaveByEmp = dateLeaves.ToDictionary(l => l.EmployeeId);

        // Fetch day's punches to capture any real-time punches
        var targetStartUtc = TimeZoneInfo.ConvertTimeToUtc(target.ToDateTime(TimeOnly.MinValue), tz);
        var targetEndUtc = TimeZoneInfo.ConvertTimeToUtc(target.AddDays(1).ToDateTime(TimeOnly.MinValue), tz);
        var dayPunches = await _uow.Punches.ToListAsync(
            _uow.Punches.Query()
                .Where(p => p.PunchTime >= targetStartUtc && p.PunchTime < targetEndUtc),
            ct);
        var punchesByEmp = dayPunches
            .GroupBy(p => p.EmployeeId)
            .ToDictionary(g => g.Key, g => g.OrderBy(p => p.PunchTime).ToList());

        var holidays = await _uow.Holidays.ToListAsync(
            _uow.Holidays.Query().Where(h => h.Date == target && h.Type != HolidayType.Optional),
            ct);
        var isHoliday = holidays.Any();

        var presentList = new List<AttendancePersonDto>();
        var absentList = new List<AttendancePersonDto>();
        var onLeaveList = new List<AttendancePersonDto>();
        var lateList = new List<AttendancePersonDto>();

        foreach (var emp in employees.Where(e => e.Status == EmploymentStatus.Active || e.Status == EmploymentStatus.OnLeave))
        {
            var name = $"{emp.FirstName} {emp.LastName}".Trim();
            var dept = emp.Department?.Name ?? "General";
            var desig = emp.Designation?.Name ?? emp.JobTitle;

            punchesByEmp.TryGetValue(emp.Id, out var empPunches);
            var hasPunches = empPunches != null && empPunches.Count > 0;
            var hasRecord = recordByEmp.TryGetValue(emp.Id, out var rec);

            if (hasRecord && rec != null && (rec.CheckIn is not null || rec.Status == AttendanceStatus.Present || rec.Status == AttendanceStatus.Late || rec.Status == AttendanceStatus.HalfDay))
            {
                var person = new AttendancePersonDto(
                    emp.Id,
                    name,
                    emp.EmployeeCode,
                    dept,
                    desig,
                    rec.CheckIn?.ToString("hh:mm tt"),
                    null,
                    rec.CheckOut?.ToString("hh:mm tt"),
                    rec.WorkHours,
                    rec.Status.ToString());
                presentList.Add(person);
                if (rec.Status == AttendanceStatus.Late)
                {
                    lateList.Add(person);
                }
            }
            else if (hasPunches)
            {
                var firstIn = empPunches!.FirstOrDefault(p => p.PunchType == PunchType.ClockIn);
                var lastOut = empPunches!.LastOrDefault(p => p.PunchType == PunchType.ClockOut);
                TimeOnly? inTime = firstIn != null ? TimeOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(firstIn.PunchTime, tz)) : null;
                TimeOnly? outTime = lastOut != null ? TimeOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(lastOut.PunchTime, tz)) : null;

                var (_, _, lateGraceMinutes, shiftStart, _) = GetShiftParameters(emp.Shift);
                var isLate = inTime.HasValue && inTime.Value > shiftStart.AddMinutes(lateGraceMinutes);
                var statusStr = isLate ? "Late" : "Present";

                var person = new AttendancePersonDto(
                    emp.Id,
                    name,
                    emp.EmployeeCode,
                    dept,
                    desig,
                    inTime?.ToString("hh:mm tt"),
                    null,
                    outTime?.ToString("hh:mm tt"),
                    0m,
                    statusStr);
                presentList.Add(person);
                if (isLate)
                {
                    lateList.Add(person);
                }
            }
            else if (leaveByEmp.TryGetValue(emp.Id, out var leave))
            {
                onLeaveList.Add(new AttendancePersonDto(
                    emp.Id,
                    name,
                    emp.EmployeeCode,
                    dept,
                    desig,
                    null,
                    leave.Reason,
                    null,
                    0,
                    "OnLeave"));
            }
            else if (emp.Status == EmploymentStatus.OnLeave)
            {
                onLeaveList.Add(new AttendancePersonDto(
                    emp.Id,
                    name,
                    emp.EmployeeCode,
                    dept,
                    desig,
                    null,
                    "Approved Leave",
                    null,
                    0,
                    "OnLeave"));
            }
            else if (isHoliday || IsEmployeeWeekOff(emp, target))
            {
                // Public Holiday or Scheduled Rest Day / Weekend: do not mark absent
            }
            else
            {
                absentList.Add(new AttendancePersonDto(
                    emp.Id,
                    name,
                    emp.EmployeeCode,
                    dept,
                    desig,
                    null,
                    null,
                    null,
                    0,
                    "Absent"));
            }
        }

        var totalActiveTracked = presentList.Count + absentList.Count + onLeaveList.Count;
        return new TodayAttendanceOverviewDto(
            totalActiveTracked,
            presentList.Count,
            absentList.Count,
            onLeaveList.Count,
            lateList.Count,
            presentList,
            absentList,
            onLeaveList,
            lateList);
    }

    /// <summary>Today's records, or the most recent day that has any records.</summary>
    private async Task<IReadOnlyList<AttendanceRecord>> LoadLatestDayAsync(CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var records = await _uow.Attendance.ListByDateAsync(today, ct);
        if (records.Count > 0) return records;

        var latest = await _uow.Attendance.FirstOrDefaultAsync(
            _uow.Attendance.Query().OrderByDescending(r => r.Date).Select(r => (DateOnly?)r.Date),
            ct);

        return latest is { } date ? await _uow.Attendance.ListByDateAsync(date, ct) : Array.Empty<AttendanceRecord>();
    }

    private async Task<Guid> ResolveEmployeeIdAsync(Guid? explicitId, CancellationToken ct)
    {
        if (explicitId is { } id && id != Guid.Empty) return id;
        if (_currentUser.EmployeeId is { } own) return own;

        var first = await _uow.Employees.FirstOrDefaultAsync(
            _uow.Employees.Query().OrderBy(e => e.EmployeeCode).Select(e => (Guid?)e.Id),
            ct);

        return first ?? throw new NotFoundException("No employees exist yet.");
    }

    private static AttendanceRecordDto ToDto(AttendanceRecord r)
    {
        var name = r.Employee is null ? "—" : $"{r.Employee.FirstName} {r.Employee.LastName}".Trim();
        return new AttendanceRecordDto(
            r.Id,
            r.EmployeeId,
            name,
            Formatting.Initials(name),
            r.Date,
            r.CheckIn?.ToString("HH:mm"),
            r.CheckOut?.ToString("HH:mm"),
            r.BreakMinutes,
            r.WorkHours,
            r.Status.ToString());
    }

    /// <summary>Applies a batch of captured punches (dedupe + attendance sync). Used by the face terminal.</summary>
    private async Task<PunchBatchResult> ProcessPunchBatchAsync(PunchBatchRequest request, CancellationToken ct = default)
    {
        if (request.Punches == null || request.Punches.Count == 0)
        {
            return new PunchBatchResult(true, 0, 0, 0, Array.Empty<string>(), "No punches received in payload.");
        }

        var processedCount = 0;
        var ignoredDuplicates = 0;
        var unmatchedCodes = new List<string>();

        // Normalise the payload once so every lookup below is in-memory
        // (previously each punch issued 3-4 separate database queries).
        var items = request.Punches
            .Where(i => !string.IsNullOrWhiteSpace(i.EmployeeCode))
            .Select(i => new
            {
                Code = i.EmployeeCode.Trim(),
                Item = i,
                Utc = i.PunchTime.Kind == DateTimeKind.Utc ? i.PunchTime : i.PunchTime.ToUniversalTime(),
            })
            .ToList();

        if (items.Count == 0)
        {
            return new PunchBatchResult(
                true,
                request.Punches.Count,
                0,
                0,
                Array.Empty<string>(),
                $"Synced 0 punch(es) from {request.DeviceSerial}. 0 duplicate(s) ignored.");
        }

        var (compTz, _, _) = await GetCompanyTimeZoneAsync(ct);

        var codes = items.Select(x => x.Code.ToUpperInvariant()).Distinct().ToList();

        // One query for every referenced employee.
        var employees = (await _uow.Employees.ToListAsync(
            _uow.Employees.Query().Where(e => codes.Contains(e.EmployeeCode.Trim().ToUpper())), ct)).ToList();

        var employeeByCode = employees
            .GroupBy(e => e.EmployeeCode.Trim().ToUpperInvariant())
            .ToDictionary(g => g.Key, g => g.First());

        var employeeIds = employees.Select(e => e.Id).Distinct().ToList();

        var localDates = items
            .Select(x => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(x.Utc, compTz)))
            .Distinct()
            .ToList();

        // Expand query window using company-local day bounds so timezone offsets don't split a shift day.
        var minLocalDayStartUtc = TimeZoneInfo.ConvertTimeToUtc(localDates.Min().ToDateTime(TimeOnly.MinValue), compTz);
        var maxLocalDayEndUtc = TimeZoneInfo.ConvertTimeToUtc(localDates.Max().AddDays(1).ToDateTime(TimeOnly.MinValue), compTz);
        var windowFrom = minLocalDayStartUtc.AddMinutes(-5);
        var windowTo = maxLocalDayEndUtc.AddMinutes(5);

        var punchesByEmployee = (await _uow.Punches.ToListAsync(
                _uow.Punches.Query().Where(p => employeeIds.Contains(p.EmployeeId)
                    && p.PunchTime >= windowFrom && p.PunchTime <= windowTo),
                ct))
            .GroupBy(p => p.EmployeeId)
            .ToDictionary(g => g.Key, g => g.ToList());

        // Load ALL open punches across all dates for these employees so IX_EmployeePunches_EmployeeId_IsOpen never fails
        // when an employee has an unclosed punch from a previous day.
        var openPunchesByEmployee = (await _uow.Punches.ToListAsync(
                _uow.Punches.Query().Where(p => employeeIds.Contains(p.EmployeeId) && p.IsOpen),
                ct))
            .GroupBy(p => p.EmployeeId)
            .ToDictionary(g => g.Key, g => g.ToList());

        // One query for the attendance records covering the affected employee/local-date pairs.
        var recordByKey = (await _uow.Attendance.ToListAsync(
                _uow.Attendance.Query().Where(a => employeeIds.Contains(a.EmployeeId) && localDates.Contains(a.Date)),
                ct))
            .GroupBy(a => (a.EmployeeId, a.Date))
            .ToDictionary(g => g.Key, g => g.First());

        var acceptedTimes = new Dictionary<Guid, List<DateTime>>();
        var newlyAdded = new HashSet<(Guid EmployeeId, DateOnly Date)>();

        foreach (var entry in items)
        {
            if (!employeeByCode.TryGetValue(entry.Code.ToUpperInvariant(), out var employee))
            {
                if (!unmatchedCodes.Contains(entry.Code))
                {
                    unmatchedCodes.Add(entry.Code);
                }
                continue;
            }

            var itemUtc = entry.Utc;
            var localItem = TimeZoneInfo.ConvertTimeFromUtc(itemUtc, compTz);
            var dateOnly = DateOnly.FromDateTime(localItem);
            var timeOnly = TimeOnly.FromDateTime(localItem);

            var knownPunches = punchesByEmployee.TryGetValue(employee.Id, out var known) ? known : new List<EmployeePunch>();
            var accepted = acceptedTimes.TryGetValue(employee.Id, out var times) ? times : new List<DateTime>();

            // Determine punch type using company-local day bounds
            if (!Enum.TryParse<PunchType>(entry.Item.PunchType, true, out var punchType))
            {
                var startOfDayUtc = TimeZoneInfo.ConvertTimeToUtc(dateOnly.ToDateTime(TimeOnly.MinValue), compTz);
                var endOfDayUtc = TimeZoneInfo.ConvertTimeToUtc(dateOnly.AddDays(1).ToDateTime(TimeOnly.MinValue), compTz);
                var todayCount = knownPunches.Count(p => p.PunchTime >= startOfDayUtc && p.PunchTime < endOfDayUtc);
                punchType = (todayCount % 2 == 0) ? PunchType.ClockIn : PunchType.ClockOut;
            }

            // Deduplicate: ignore ONLY if the exact same punch type occurred within 20 seconds, or any punch occurred within 3 seconds.
            var isDuplicate = knownPunches.Any(p =>
                (p.PunchType == punchType && Math.Abs((p.PunchTime - itemUtc).TotalSeconds) < 20) ||
                Math.Abs((p.PunchTime - itemUtc).TotalSeconds) < 3)
                || accepted.Any(t => Math.Abs((t - itemUtc).TotalSeconds) < 3);

            if (isDuplicate)
            {
                ignoredDuplicates++;
                continue;
            }

            accepted.Add(itemUtc);
            acceptedTimes[employee.Id] = accepted;

            // Close any previous open punches (across all prior days) for this employee before adding the new punch
            if (openPunchesByEmployee.TryGetValue(employee.Id, out var previousOpenPunches))
            {
                foreach (var op in previousOpenPunches)
                {
                    if (op.IsOpen)
                    {
                        op.IsOpen = false;
                        _uow.Punches.Update(op);
                    }
                }
                previousOpenPunches.Clear();
            }

            var rawDevice = entry.Item.DeviceName ?? (!string.IsNullOrWhiteSpace(request.DeviceSerial) ? request.DeviceSerial : "Face Terminal");
            var deviceName = rawDevice.Length > 80 ? rawDevice[..80] : rawDevice;
            var rawNote = entry.Item.Note ?? $"Face scan ({request.DeviceSerial})";
            var note = rawNote.Length > 250 ? rawNote[..250] : rawNote;

            var punch = new EmployeePunch
            {
                EmployeeId = employee.Id,
                PunchTime = itemUtc,
                PunchType = punchType,
                Note = note,
                Device = deviceName,
                IsOpen = (punchType != PunchType.ClockOut)
            };
            await _uow.Punches.AddAsync(punch, ct);
            if (punch.IsOpen)
            {
                if (!openPunchesByEmployee.TryGetValue(employee.Id, out var openList))
                {
                    openList = new List<EmployeePunch>();
                    openPunchesByEmployee[employee.Id] = openList;
                }
                openList.Add(punch);
            }
            if (!punchesByEmployee.TryGetValue(employee.Id, out var empKnownList))
            {
                empKnownList = new List<EmployeePunch>();
                punchesByEmployee[employee.Id] = empKnownList;
            }
            empKnownList.Add(punch);

            // Synchronise with AttendanceRecord using company timezone
            var key = (employee.Id, dateOnly);

            if (!recordByKey.TryGetValue(key, out var todayRecord))
            {
                var shiftStart = employee.Shift?.StartTime ?? new TimeOnly(9, 0);
                var isLate = punchType == PunchType.ClockIn && timeOnly > shiftStart.AddMinutes(15);

                todayRecord = new AttendanceRecord
                {
                    EmployeeId = employee.Id,
                    Date = dateOnly,
                    CheckIn = punchType == PunchType.ClockIn ? timeOnly : null,
                    CheckOut = punchType == PunchType.ClockOut ? timeOnly : null,
                    BreakMinutes = 0,
                    WorkHours = 0,
                    Status = isLate ? AttendanceStatus.Late : AttendanceStatus.Present
                };
                await _uow.Attendance.AddAsync(todayRecord, ct);
                recordByKey[key] = todayRecord;
                newlyAdded.Add(key);
            }
            else
            {
                if (punchType == PunchType.ClockIn)
                {
                    if (todayRecord.CheckIn is null || timeOnly < todayRecord.CheckIn)
                    {
                        todayRecord.CheckIn = timeOnly;
                    }
                }
                else if (punchType == PunchType.ClockOut)
                {
                    if (todayRecord.CheckOut is null || timeOnly > todayRecord.CheckOut)
                    {
                        todayRecord.CheckOut = timeOnly;
                    }
                }

                if (todayRecord.CheckIn is { } inT && todayRecord.CheckOut is { } outT)
                {
                    var span = outT - inT;
                    var totalHours = (decimal)Math.Max(0, span.TotalHours) - (todayRecord.BreakMinutes / 60m);
                    todayRecord.WorkHours = Math.Round(Math.Max(0, totalHours), 2);
                    if (todayRecord.WorkHours >= 7.5m)
                    {
                        todayRecord.Status = AttendanceStatus.Present;
                    }
                    else if (todayRecord.WorkHours >= 4m)
                    {
                        todayRecord.Status = AttendanceStatus.HalfDay;
                    }
                }

                // Pre-loaded records are untracked; a record added in this same payload already is.
                if (!newlyAdded.Contains(key))
                {
                    _uow.Attendance.Update(todayRecord);
                }
            }

            processedCount++;
        }

        await _uow.SaveChangesAsync(ct);

        var msg = $"Synced {processedCount} punch(es) from {request.DeviceSerial}. {ignoredDuplicates} duplicate(s) ignored.";
        if (unmatchedCodes.Count > 0)
        {
            msg += $" Unmatched codes: {string.Join(", ", unmatchedCodes)}.";
        }

        return new PunchBatchResult(
            Success: true,
            TotalReceived: request.Punches.Count,
            ProcessedCount: processedCount,
            IgnoredDuplicates: ignoredDuplicates,
            UnmatchedCodes: unmatchedCodes,
            Message: msg
        );
    }

    public async Task<IReadOnlyList<EnrolledFaceDto>> GetEnrolledFacesAsync(CancellationToken ct = default)
    {
        var employees = await _uow.Employees.ToListAsync(
            _uow.Employees.Query().Where(e => !string.IsNullOrEmpty(e.FaceDescriptor)),
            ct);

        return employees.Select(e => new EnrolledFaceDto(
            EmployeeId: e.Id,
            EmployeeCode: e.EmployeeCode,
            FullName: e.FullName,
            Department: e.Department?.Name ?? e.JobTitle ?? "Staff",
            AvatarUrl: e.FacePhotoUrl,
            FaceDescriptor: e.FaceDescriptor!,
            EnrolledAtUtc: e.FaceEnrolledAtUtc
        )).ToList();
    }

    public async Task<bool> EnrollFaceAsync(Guid employeeId, EnrollFaceRequest request, CancellationToken ct = default)
    {
        var employee = await _uow.Employees.GetByIdAsync(employeeId, ct)
            ?? throw NotFoundException.For("Employee", employeeId);

        employee.FaceDescriptor = request.FaceDescriptor;
        if (!string.IsNullOrWhiteSpace(request.FacePhotoUrl))
        {
            employee.FacePhotoUrl = request.FacePhotoUrl;
        }
        employee.FaceEnrolledAtUtc = DateTime.UtcNow;

        await _uow.SaveChangesAsync(ct);
        return true;
    }

    public async Task<bool> RemoveFaceAsync(Guid employeeId, CancellationToken ct = default)
    {
        var employee = await _uow.Employees.GetByIdAsync(employeeId, ct)
            ?? throw NotFoundException.For("Employee", employeeId);

        employee.FaceDescriptor = null;
        employee.FaceEnrolledAtUtc = null;

        await _uow.SaveChangesAsync(ct);
        return true;
    }

    public async Task<FacePunchResultDto> ProcessFacePunchAsync(FacePunchRequest request, CancellationToken ct = default)
    {
        Employee? employee = null;
        if (request.EmployeeId.HasValue && request.EmployeeId.Value != Guid.Empty)
        {
            employee = await _uow.Employees.GetByIdAsync(request.EmployeeId.Value, ct);
        }
        else if (!string.IsNullOrWhiteSpace(request.EmployeeCode))
        {
            var code = request.EmployeeCode.Trim();
            employee = await _uow.Employees.FirstOrDefaultAsync(
                _uow.Employees.Query().Where(e => e.EmployeeCode.ToLower() == code.ToLower()), ct);
        }

        if (employee is null)
        {
            return new FacePunchResultDto(
                Success: false,
                EmployeeId: Guid.Empty,
                EmployeeCode: request.EmployeeCode ?? string.Empty,
                EmployeeName: "Unknown Employee",
                PunchType: request.PunchType ?? "ClockIn",
                PunchTime: DateTime.UtcNow,
                Status: "Unmatched",
                Message: "Face recognized but employee record not found in system."
            );
        }

        var confidencePct = request.Confidence.HasValue ? $"{(int)(request.Confidence.Value * 100)}%" : "verified";
        var deviceName = !string.IsNullOrWhiteSpace(request.Device) ? request.Device : "Face Attendance Kiosk";

        var syncRequest = new PunchBatchRequest(
            DeviceSerial: deviceName,
            DeviceLocation: "Office Face Terminal",
            Punches: new[]
            {
                new PunchBatchItem(
                    EmployeeCode: employee.EmployeeCode,
                    PunchTime: DateTime.UtcNow,
                    PunchType: request.PunchType,
                    DeviceName: deviceName,
                    Note: $"Face Recognition scan ({confidencePct} match)"
                )
            }
        );

        var syncResult = await ProcessPunchBatchAsync(syncRequest, ct);
        var (compTz, _, _) = await GetCompanyTimeZoneAsync(ct);
        var localToday = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, compTz));
        var todayRecord = await _uow.Attendance.GetForEmployeeDateAsync(employee.Id, localToday, ct);
        var latestPunch = await _uow.Punches.FirstOrDefaultAsync(
            _uow.Punches.Query().Where(p => p.EmployeeId == employee.Id).OrderByDescending(p => p.PunchTime),
            ct);

        var isClockOut = string.Equals(request.PunchType, "ClockOut", StringComparison.OrdinalIgnoreCase) ||
            (string.IsNullOrWhiteSpace(request.PunchType) && (latestPunch?.PunchType == PunchType.ClockOut || (latestPunch == null && todayRecord?.CheckOut != null)));

        var msg = syncResult.ProcessedCount > 0
            ? (isClockOut ? $"Successfully Punched Out: Goodbye {employee.FullName}!" : $"Successfully Punched In: Welcome {employee.FullName}!")
            : syncResult.IgnoredDuplicates > 0
                ? $"{employee.FullName} was already punched recently (duplicate cooldown)."
                : syncResult.Message;

        return new FacePunchResultDto(
            Success: syncResult.ProcessedCount > 0 || syncResult.IgnoredDuplicates > 0,
            EmployeeId: employee.Id,
            EmployeeCode: employee.EmployeeCode,
            EmployeeName: employee.FullName,
            PunchType: isClockOut ? "ClockOut" : "ClockIn",
            PunchTime: DateTime.UtcNow,
            Status: todayRecord?.Status.ToString() ?? "Present",
            Message: msg
        );
    }

    public async Task<DailyAttendanceCloseoutResult> CloseoutDailyAttendanceAsync(DateOnly? targetDate = null, CancellationToken ct = default)
    {
        var (tz, _, _) = await GetCompanyTimeZoneAsync(ct);
        var companyNow = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, tz);
        var effectiveTargetDate = targetDate ?? DateOnly.FromDateTime(companyNow.AddDays(-1));

        // Single-run distributed lock: prevent multiple servers from concurrently running closeout for the same company/date
        var lockKey = $"AttendanceCloseout_{_tenantContext?.CompanyId ?? Guid.Empty}_{effectiveTargetDate:yyyyMMdd}";
        await using var lockHandle = await _uow.TryAcquireAppLockAsync(lockKey, TimeSpan.Zero, ct);
        if (lockHandle == null)
        {
            // Another server instance or thread is already running closeout for this date - skip safely
            return new DailyAttendanceCloseoutResult(effectiveTargetDate, 0, 0, 0);
        }

        // 1. Resolve / auto-close lingering open punches from before the end of effectiveTargetDate
        var targetDateEndUtc = TimeZoneInfo.ConvertTimeToUtc(
            effectiveTargetDate.AddDays(1).ToDateTime(TimeOnly.MinValue), tz);

        var staleOpenPunches = await _uow.Punches.ToListAsync(
            _uow.Punches.Query().Where(p => p.IsOpen && p.PunchTime < targetDateEndUtc),
            ct);

        var closedPunchesCount = 0;
        foreach (var punch in staleOpenPunches)
        {
            punch.IsOpen = false;
            punch.Note = string.IsNullOrWhiteSpace(punch.Note)
                ? "[Auto-closed by EOD closeout: missing checkout]"
                : $"{punch.Note} | [Auto-closed by EOD closeout]";
            _uow.Punches.Update(punch);
            closedPunchesCount++;
        }

        // 2. Fetch all active employees and hydrate their Shift
        var activeEmployeesRaw = await _uow.Employees.ToListAsync(
            _uow.Employees.Query().Where(e => e.Status == EmploymentStatus.Active),
            ct);

        var allShifts = await _uow.Shifts.ToListAsync(_uow.Shifts.Query(), ct);
        var shiftsById = allShifts.ToDictionary(s => s.Id);

        var activeEmployees = activeEmployeesRaw
            .Where(e => e.JoinDate <= effectiveTargetDate && e.Status == EmploymentStatus.Active)
            .Select(e =>
            {
                if (e.Shift == null && e.ShiftId.HasValue && shiftsById.TryGetValue(e.ShiftId.Value, out var s))
                {
                    e.Shift = s;
                }
                return e;
            })
            .ToList();

        // 3. Pre-fetch approved leaves for effectiveTargetDate
        var approvedLeaves = await _uow.LeaveRequests.ToListAsync(
            _uow.LeaveRequests.Query().Where(l => l.Status == LeaveStatus.Approved && l.FromDate <= effectiveTargetDate && l.ToDate >= effectiveTargetDate),
            ct);
        var leavesByEmp = approvedLeaves.ToDictionary(l => l.EmployeeId);

        // 4. Pre-fetch holidays for effectiveTargetDate.
        // Optional holidays must NOT mark everyone as Holiday (only mandatory/national/religious holidays do).
        var holidays = await _uow.Holidays.ToListAsync(
            _uow.Holidays.Query().Where(h => h.Date == effectiveTargetDate),
            ct);
        var nonOptionalHolidays = holidays.Where(h => h.Type != HolidayType.Optional).ToList();
        var isMandatoryHoliday = nonOptionalHolidays.Count > 0;
        var holidayName = nonOptionalHolidays.FirstOrDefault()?.Name ?? "Public Holiday";

        // 5. Pre-fetch shiftdays for template-based weekly off determination
        var targetDayOfWeek = effectiveTargetDate.DayOfWeek;
        var relevantShiftdays = await _uow.Shiftdays.ToListAsync(
            _uow.Shiftdays.Query().Where(sd => sd.DayOfWeek == targetDayOfWeek),
            ct);
        var shiftdaysByTemplate = relevantShiftdays
            .GroupBy(sd => sd.ShiftTemplateId)
            .ToDictionary(g => g.Key, g => g.First());

        // 6. Fetch all existing attendance records for effectiveTargetDate (Idempotency guarantee)
        var existingAttendance = await _uow.Attendance.ListByDateAsync(effectiveTargetDate, ct);
        var attendanceByEmp = existingAttendance.ToDictionary(a => a.EmployeeId);

        var markedAbsentCount = 0;
        var finalizedCount = 0;

        foreach (var emp in activeEmployees)
        {
            var isWeekOff = IsEmployeeWeekOff(emp, effectiveTargetDate);

            if (attendanceByEmp.TryGetValue(emp.Id, out var record))
            {
                // Employee already has a punch/attendance record:
                // Never overwrite real punch hours. If employee has punches on a leave day, keep punch data and note the leave.
                if (leavesByEmp.TryGetValue(emp.Id, out var empLeave))
                {
                    var leaveNote = empLeave.IsHalfDay ? "[Approved Half-Day Leave]" : "[Approved Leave]";
                    if (string.IsNullOrWhiteSpace(record.Notes) || !record.Notes.Contains("Approved"))
                    {
                        record.Notes = string.IsNullOrWhiteSpace(record.Notes)
                            ? leaveNote
                            : $"{record.Notes} | {leaveNote}";
                    }
                }

                if (record.CheckIn.HasValue && !record.CheckOut.HasValue)
                {
                    record.Notes = string.IsNullOrWhiteSpace(record.Notes)
                        ? "[Incomplete attendance - missing checkout]"
                        : $"{record.Notes} | [Incomplete attendance - missing checkout]";
                    if (record.WorkHours == 0)
                    {
                        record.Status = AttendanceStatus.HalfDay;
                    }
                }
                _uow.Attendance.Update(record);
                finalizedCount++;
            }
            else
            {
                // No punch/record exists for this employee on effectiveTargetDate
                if (isMandatoryHoliday)
                {
                    // Mandatory Public Holiday: Never mark absent
                    var holidayRecord = new AttendanceRecord
                    {
                        EmployeeId = emp.Id,
                        Date = effectiveTargetDate,
                        CheckIn = null,
                        CheckOut = null,
                        BreakMinutes = 0,
                        WorkHours = 0,
                        Status = AttendanceStatus.Holiday,
                        Notes = $"[Public Holiday: {holidayName}]"
                    };
                    await _uow.Attendance.AddAsync(holidayRecord, ct);
                    finalizedCount++;
                }
                else if (leavesByEmp.TryGetValue(emp.Id, out var leave))
                {
                    // Approved Leave: Use shift's DailyHours/2 instead of fixed 4.5
                    var targetDailyHours = emp.Shift?.DailyHours > 0 ? (decimal)emp.Shift.DailyHours : 8.0m;
                    var leaveRecord = new AttendanceRecord
                    {
                        EmployeeId = emp.Id,
                        Date = effectiveTargetDate,
                        CheckIn = null,
                        CheckOut = null,
                        BreakMinutes = 0,
                        WorkHours = leave.IsHalfDay ? (targetDailyHours / 2m) : 0m,
                        Status = leave.IsHalfDay ? AttendanceStatus.HalfDay : AttendanceStatus.OnLeave,
                        Notes = leave.IsHalfDay ? "[Approved Half-Day Leave]" : "[Approved Leave]"
                    };
                    await _uow.Attendance.AddAsync(leaveRecord, ct);
                    finalizedCount++;
                }
                else if (isWeekOff)
                {
                    // Weekly Off / Roster Rest Day: Never mark absent
                    var weekendRecord = new AttendanceRecord
                    {
                        EmployeeId = emp.Id,
                        Date = effectiveTargetDate,
                        CheckIn = null,
                        CheckOut = null,
                        BreakMinutes = 0,
                        WorkHours = 0,
                        Status = AttendanceStatus.Weekend,
                        Notes = "[Scheduled Rest Day / Weekend]"
                    };
                    await _uow.Attendance.AddAsync(weekendRecord, ct);
                    finalizedCount++;
                }
                else
                {
                    // Scheduled workday with no punches, no leave, no holiday: Mark Absent
                    var absentRecord = new AttendanceRecord
                    {
                        EmployeeId = emp.Id,
                        Date = effectiveTargetDate,
                        CheckIn = null,
                        CheckOut = null,
                        BreakMinutes = 0,
                        WorkHours = 0,
                        Status = AttendanceStatus.Absent,
                        Notes = "[Marked Absent by EOD Closeout]"
                    };
                    await _uow.Attendance.AddAsync(absentRecord, ct);
                    markedAbsentCount++;
                }
            }
        }

        await _uow.SaveChangesAsync(ct);

        return new DailyAttendanceCloseoutResult(
            effectiveTargetDate,
            closedPunchesCount,
            markedAbsentCount,
            finalizedCount);
    }

    private static bool IsEmployeeWeekOff(Employee emp, DateOnly date)
    {
        // 1. Employee shift working days specification
        if (emp.Shift != null && !string.IsNullOrWhiteSpace(emp.Shift.WorkingDays))
        {
            var wd = emp.Shift.WorkingDays.Trim().ToLowerInvariant();
            if (wd.Contains("mon") && wd.Contains("sat"))
            {
                // Mon - Sat -> only Sunday is week off
                return date.DayOfWeek == DayOfWeek.Sunday;
            }
            if (wd.Contains("mon") && wd.Contains("fri"))
            {
                // Mon - Fri -> Saturday and Sunday are week off
                return date.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday;
            }
            if (wd.Contains("sun") && wd.Contains("thu"))
            {
                // Sun - Thu -> Friday and Saturday are week off
                return date.DayOfWeek is DayOfWeek.Friday or DayOfWeek.Saturday;
            }
        }

        // 2. Fallback default: Saturday and Sunday
        return date.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday;
    }

    private static RegularizationDto ToRegularizationDto(RegularizationRequest r)
    {
        var name = r.Employee is null ? "—" : $"{r.Employee.FirstName} {r.Employee.LastName}".Trim();
        return new RegularizationDto(
            r.Id,
            r.EmployeeId,
            name,
            r.Reason,
            r.Date,
            r.InTime.ToString("HH:mm"),
            r.OutTime.ToString("HH:mm"),
            r.Status.ToString(),
            Formatting.Relative(r.SubmittedAtUtc));
    }

    public async Task<CentralizedPunchResultDto> ProcessCentralizedPunchAsync(
        CentralizedPunchRequest request,
        CancellationToken ct = default)
    {
        // 1. Geofencing Validation (Company registered location: 21.2385574033792, 72.89013466219234, 500m campus radius)
        const double OfficeLatitude = 21.2385574033792;
        const double OfficeLongitude = 72.89013466219234;
        const double AllowedRadiusMeters = 500.0;

        var distance = CalculateHaversineDistance(request.Latitude, request.Longitude, OfficeLatitude, OfficeLongitude);
        if (request.Latitude != 0 && request.Longitude != 0 && distance > AllowedRadiusMeters)
        {
            throw new ValidationException(
                $"You are outside the permitted company location ({distance:F1}m away). Please move within the registered office campus (≤ {AllowedRadiusMeters}m) to mark your attendance.");
        }

        // 2. Employee Validation
        var employee = await _uow.Employees.GetWithDetailsAsync(request.EmployeeId, ct)
                       ?? await _uow.Employees.GetByIdAsync(request.EmployeeId, ct)
                       ?? throw NotFoundException.For("Employee", request.EmployeeId);

        if (employee.Status != EmploymentStatus.Active)
        {
            throw new ValidationException($"Employee {employee.FullName} is not active ({employee.Status}) and is not eligible for attendance recording.");
        }

        // 3. Face Biometric Verification
        if (string.IsNullOrWhiteSpace(employee.FaceDescriptor))
        {
            throw new ValidationException($"Employee {employee.FullName} has not registered face biometrics. Please enroll employee face first.");
        }

        double matchScore = request.MatchScore ?? 0.0;
        bool faceVerified = false;

        if (request.FaceDescriptor != null && request.FaceDescriptor.Length > 0)
        {
            try
            {
                var storedDescriptor = JsonSerializer.Deserialize<float[]>(employee.FaceDescriptor);
                if (storedDescriptor != null && storedDescriptor.Length == request.FaceDescriptor.Length)
                {
                    double sumSq = 0.0;
                    for (int i = 0; i < storedDescriptor.Length; i++)
                    {
                        var diff = storedDescriptor[i] - request.FaceDescriptor[i];
                        sumSq += diff * diff;
                    }
                    var euclideanDist = Math.Sqrt(sumSq);

                    if (euclideanDist <= 0.35)
                        matchScore = Math.Round(100.0 - (euclideanDist / 0.35) * 8.0);
                    else if (euclideanDist <= 0.58)
                        matchScore = Math.Round(92.0 - ((euclideanDist - 0.35) / 0.23) * 22.0);
                    else
                        matchScore = Math.Max(0.0, Math.Round(70.0 - ((euclideanDist - 0.58) / 0.22) * 50.0));

                    faceVerified = euclideanDist <= 0.58 || matchScore >= 70.0;
                }
            }
            catch
            {
                faceVerified = request.MatchScore >= 70.0;
            }
        }
        else if (request.MatchScore.HasValue)
        {
            faceVerified = request.MatchScore.Value >= 70.0;
        }

        if (!faceVerified)
        {
            throw new ValidationException("Face verification failed. The captured face does not match the registered employee.");
        }

        // 4. State Validation & Automatic Punch-In / Punch-Out Toggle
        var (tz, tzName, maxPunchDurationHours) = await GetCompanyTimeZoneAsync(ct);
        var nowUtc = DateTime.UtcNow;
        var localNow = TimeZoneInfo.ConvertTimeFromUtc(nowUtc, tz);
        var localToday = DateOnly.FromDateTime(localNow);

        var (maxAllowedHours, targetDailyHours, lateGraceMinutes, shiftStart, isOvernight) = GetShiftParameters(employee.Shift, maxPunchDurationHours);
        var shiftDayStartUtc = TimeZoneInfo.ConvertTimeToUtc(localToday.ToDateTime(TimeOnly.MinValue), tz);
        var shiftDayEndUtc = shiftDayStartUtc.AddHours(maxAllowedHours + 4);

        var todayPunches = await _uow.Punches.ToListAsync(
            _uow.Punches.Query()
                .Where(p => p.EmployeeId == employee.Id && p.PunchTime >= shiftDayStartUtc && p.PunchTime <= shiftDayEndUtc)
                .OrderBy(p => p.PunchTime),
            ct);

        var openPunches = await _uow.Punches.ToListAsync(
            _uow.Punches.Query().Where(p => p.EmployeeId == employee.Id && p.IsOpen),
            ct);

        // Auto-close any lingering open punches from prior days
        var stalePriorPunches = openPunches.Where(p => p.PunchTime < shiftDayStartUtc).ToList();
        foreach (var stale in stalePriorPunches)
        {
            stale.IsOpen = false;
            stale.Note = string.IsNullOrWhiteSpace(stale.Note)
                ? "[Auto-closed prior shift: missing checkout]"
                : $"{stale.Note} | [Auto-closed prior shift]";
            _uow.Punches.Update(stale);
        }

        var activeTodayOpenPunches = openPunches.Where(p => p.PunchTime >= shiftDayStartUtc && p.PunchTime <= shiftDayEndUtc).ToList();
        var lastPunch = todayPunches.LastOrDefault();
        var isCurrentlyClockedIn = activeTodayOpenPunches.Any() || (lastPunch != null && (lastPunch.PunchType == PunchType.ClockIn || lastPunch.PunchType == PunchType.BreakOut));

        PunchType punchType;
        if (string.Equals(request.PunchType, "Auto", StringComparison.OrdinalIgnoreCase))
        {
            punchType = isCurrentlyClockedIn ? PunchType.ClockOut : PunchType.ClockIn;
        }
        else if (Enum.TryParse<PunchType>(request.PunchType, true, out var parsedType))
        {
            // 2nd scan automatic toggle: if employee is already clocked in today, switch to ClockOut!
            if (parsedType == PunchType.ClockIn && isCurrentlyClockedIn)
            {
                punchType = PunchType.ClockOut;
            }
            // 1st scan automatic toggle: if employee is not clocked in today, switch to ClockIn!
            else if (parsedType == PunchType.ClockOut && !isCurrentlyClockedIn)
            {
                punchType = PunchType.ClockIn;
            }
            else
            {
                punchType = parsedType;
            }
        }
        else
        {
            punchType = isCurrentlyClockedIn ? PunchType.ClockOut : PunchType.ClockIn;
        }

        // 5. Close previous active open punches for today and create new punch
        foreach (var open in activeTodayOpenPunches)
        {
            open.IsOpen = false;
            _uow.Punches.Update(open);
        }

        var note = $"Centralized HR Punch (Face Verified: {matchScore}% | GPS: {request.Latitude:F6}, {request.Longitude:F6} Dist: {distance:F1}m)";
        var punch = new EmployeePunch
        {
            EmployeeId = employee.Id,
            PunchTime = nowUtc,
            PunchType = punchType,
            Device = "HR Centralized Terminal",
            Note = note,
            IsOpen = (punchType == PunchType.ClockIn),
            Latitude = request.Latitude,
            Longitude = request.Longitude,
            DistanceMeters = Math.Round(distance, 1),
            VerificationStatus = "Face & Geofence Verified"
        };
        await _uow.Punches.AddAsync(punch, ct);

        // 6. Integrate with Daily Attendance Record
        var allPunches = todayPunches.Concat(new[] { punch }).OrderBy(p => p.PunchTime).ToList();
        TimeOnly? firstCheckIn = null;
        TimeOnly? lastCheckOut = null;
        long totalClosedSeconds = 0;
        long totalBreakSeconds = 0;
        DateTime? workIntervalOpen = null;
        DateTime? breakIntervalOpen = null;
        DateTime? lastClockOutUtc = null;

        foreach (var p in allPunches)
        {
            var pLocal = TimeZoneInfo.ConvertTimeFromUtc(p.PunchTime, tz);
            var pTimeOnly = TimeOnly.FromDateTime(pLocal);

            if (p.PunchType == PunchType.ClockIn)
            {
                firstCheckIn ??= pTimeOnly;
                if (breakIntervalOpen.HasValue)
                {
                    var diff = p.PunchTime - breakIntervalOpen.Value;
                    if (diff.TotalSeconds > 0) totalBreakSeconds += (long)diff.TotalSeconds;
                    breakIntervalOpen = null;
                }
                else if (lastClockOutUtc.HasValue)
                {
                    var diff = p.PunchTime - lastClockOutUtc.Value;
                    if (diff.TotalSeconds > 0) totalBreakSeconds += (long)diff.TotalSeconds;
                    lastClockOutUtc = null;
                }
                workIntervalOpen = p.PunchTime;
            }
            else if (p.PunchType == PunchType.BreakIn)
            {
                if (workIntervalOpen.HasValue)
                {
                    var diff = p.PunchTime - workIntervalOpen.Value;
                    if (diff.TotalSeconds > 0) totalClosedSeconds += (long)diff.TotalSeconds;
                    workIntervalOpen = null;
                }
                breakIntervalOpen = p.PunchTime;
            }
            else if (p.PunchType == PunchType.BreakOut)
            {
                if (breakIntervalOpen.HasValue)
                {
                    var diff = p.PunchTime - breakIntervalOpen.Value;
                    if (diff.TotalSeconds > 0) totalBreakSeconds += (long)diff.TotalSeconds;
                    breakIntervalOpen = null;
                }
                workIntervalOpen = p.PunchTime;
            }
            else if (p.PunchType == PunchType.ClockOut)
            {
                lastCheckOut = pTimeOnly;
                if (workIntervalOpen.HasValue)
                {
                    var diff = p.PunchTime - workIntervalOpen.Value;
                    if (diff.TotalSeconds > 0) totalClosedSeconds += (long)diff.TotalSeconds;
                    workIntervalOpen = null;
                }
                if (breakIntervalOpen.HasValue)
                {
                    var diff = p.PunchTime - breakIntervalOpen.Value;
                    if (diff.TotalSeconds > 0) totalBreakSeconds += (long)diff.TotalSeconds;
                    breakIntervalOpen = null;
                }
                lastClockOutUtc = p.PunchTime;
            }
        }

        if (punchType != PunchType.ClockOut && workIntervalOpen.HasValue)
        {
            var diff = nowUtc - workIntervalOpen.Value;
            if (diff.TotalSeconds > 0) totalClosedSeconds += (long)diff.TotalSeconds;
        }

        var workedHours = Math.Round((decimal)totalClosedSeconds / 3600m, 2);
        var breakMinutes = (int)Math.Round((double)totalBreakSeconds / 60.0);

        string? lateEarlyNote = null;
        if (firstCheckIn.HasValue && firstCheckIn.Value > shiftStart.AddMinutes(lateGraceMinutes))
        {
            var lateMins = (int)(firstCheckIn.Value.ToTimeSpan() - shiftStart.ToTimeSpan()).TotalMinutes;
            lateEarlyNote = $"[Late: {lateMins}m]";
        }
        if (punchType == PunchType.ClockOut && lastCheckOut.HasValue && employee.Shift != null && !isOvernight)
        {
            if (lastCheckOut.Value < employee.Shift.EndTime)
            {
                var earlyMins = (int)(employee.Shift.EndTime.ToTimeSpan() - lastCheckOut.Value.ToTimeSpan()).TotalMinutes;
                if (earlyMins >= 5)
                    lateEarlyNote = string.IsNullOrEmpty(lateEarlyNote) ? $"[Early Departure: {earlyMins}m]" : $"{lateEarlyNote} [Early Departure: {earlyMins}m]";
            }
        }

        var pLocalNow = TimeZoneInfo.ConvertTimeFromUtc(nowUtc, tz);
        var pTimeNowOnly = TimeOnly.FromDateTime(pLocalNow);

        var attendanceRecord = await _uow.Attendance.GetForEmployeeDateAsync(employee.Id, localToday, ct);
        if (attendanceRecord is null)
        {
            attendanceRecord = new AttendanceRecord
            {
                EmployeeId = employee.Id,
                Date = localToday,
                CheckIn = (punchType == PunchType.ClockIn) ? (firstCheckIn ?? pTimeNowOnly) : null,
                CheckOut = (punchType == PunchType.ClockOut) ? (lastCheckOut ?? pTimeNowOnly) : null,
                BreakMinutes = breakMinutes,
                WorkHours = workedHours,
                Status = (firstCheckIn.HasValue && firstCheckIn.Value > shiftStart.AddMinutes(lateGraceMinutes)) ? AttendanceStatus.Late : AttendanceStatus.Present,
                Notes = lateEarlyNote
            };
            await _uow.Attendance.AddAsync(attendanceRecord, ct);
        }
        else
        {
            if (punchType == PunchType.ClockIn)
            {
                attendanceRecord.CheckIn = firstCheckIn ?? attendanceRecord.CheckIn ?? pTimeNowOnly;
                attendanceRecord.CheckOut = null; // Clear check-out on new clock-in
            }
            else if (punchType == PunchType.ClockOut)
            {
                attendanceRecord.CheckOut = lastCheckOut ?? pTimeNowOnly;
            }
            attendanceRecord.WorkHours = workedHours;
            attendanceRecord.BreakMinutes = breakMinutes;
            if (!string.IsNullOrWhiteSpace(lateEarlyNote))
            {
                attendanceRecord.Notes = string.IsNullOrWhiteSpace(attendanceRecord.Notes) ? lateEarlyNote : $"{attendanceRecord.Notes} | {lateEarlyNote}";
            }
            if (punchType == PunchType.ClockIn)
            {
                attendanceRecord.Status = (attendanceRecord.CheckIn.HasValue && attendanceRecord.CheckIn.Value > shiftStart.AddMinutes(lateGraceMinutes)) ? AttendanceStatus.Late : AttendanceStatus.Present;
            }
            else if (punchType == PunchType.ClockOut)
            {
                if (attendanceRecord.WorkHours >= targetDailyHours * 0.9m || attendanceRecord.WorkHours >= 7.5m)
                {
                    attendanceRecord.Status = (attendanceRecord.CheckIn.HasValue && attendanceRecord.CheckIn.Value > shiftStart.AddMinutes(lateGraceMinutes))
                        ? AttendanceStatus.Late
                        : AttendanceStatus.Present;
                }
                else if (attendanceRecord.WorkHours >= targetDailyHours * 0.5m || attendanceRecord.WorkHours >= 4.0m)
                {
                    attendanceRecord.Status = AttendanceStatus.HalfDay;
                }
                else if (attendanceRecord.WorkHours > 0)
                {
                    attendanceRecord.Status = AttendanceStatus.HalfDay;
                }
            }
            _uow.Attendance.Update(attendanceRecord);
        }

        var targetUser = await _uow.Users.FirstOrDefaultAsync(
            _uow.Users.Query().Where(u => u.EmployeeId == employee.Id || (employee.Email != null && u.Email == employee.Email)), ct);
        if (targetUser != null)
        {
            await _uow.Notifications.AddAsync(new Notification
            {
                UserId = targetUser.Id,
                IconKey = "clock",
                Title = punchType == PunchType.ClockIn ? "Clock In Activity" : "Clock Out Activity",
                Message = punchType == PunchType.ClockIn ? $"Successfully punched in at {localNow:hh:mm tt} via Centralized Face Kiosk." : $"Successfully punched out at {localNow:hh:mm tt} via Centralized Face Kiosk.",
                TimeLabel = "Just now",
                IsRead = false,
                CreatedAtUtc = DateTime.UtcNow,
            }, ct);
        }

        await _uow.SaveChangesAsync(ct);

        return new CentralizedPunchResultDto(
            Success: true,
            Message: punchType == PunchType.ClockIn ? $"Successfully Punched In: {employee.FullName}" : $"Successfully Punched Out: {employee.FullName}",
            EmployeeId: employee.Id,
            EmployeeName: employee.FullName,
            EmployeeCode: employee.EmployeeCode,
            PunchType: punchType.ToString(),
            PunchTime: nowUtc,
            Latitude: request.Latitude,
            Longitude: request.Longitude,
            DistanceMeters: Math.Round(distance, 1),
            WithinGeofence: true,
            MatchScore: matchScore,
            FaceVerified: true,
            Status: punchType == PunchType.ClockIn ? "ClockedIn" : "ClockedOut"
        );
    }

    private static double CalculateHaversineDistance(double lat1, double lon1, double lat2, double lon2)
    {
        const double R = 6371000.0; // Earth radius in meters
        var dLat = (lat2 - lat1) * Math.PI / 180.0;
        var dLon = (lon2 - lon1) * Math.PI / 180.0;
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) +
                Math.Cos(lat1 * Math.PI / 180.0) * Math.Cos(lat2 * Math.PI / 180.0) *
                Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        var c = 2.0 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1.0 - a));
        return R * c;
    }
}
