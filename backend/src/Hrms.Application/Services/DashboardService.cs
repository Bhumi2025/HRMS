using Hrms.Application.Abstractions.Persistence;
using Hrms.Application.Abstractions.Services;
using Hrms.Application.Common;
using Hrms.Application.DTOs;
using Hrms.Domain.Entities;
using Hrms.Domain.Enums;

namespace Hrms.Application.Services;

public sealed class DashboardService : IDashboardService
{
    private readonly IUnitOfWork _uow;

    public DashboardService(IUnitOfWork uow)
    {
        _uow = uow;
    }

    public async Task<DashboardStatsDto> GetStatsAsync(CancellationToken ct = default)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        var totalEmployees = await _uow.Employees.CountAsync(ct);
        var departments = await _uow.Departments.CountAsync(ct);

        var attendance = await LoadDayStatusesAsync(today, ct);

        // On weekends (or before any punches) fall back to the most recent working
        // day that actually has attendance so the KPI is meaningful.
        if (!attendance.Any(status => status != AttendanceStatus.Weekend))
        {
            var latestWorkingDay = await _uow.Attendance.FirstOrDefaultAsync(
                _uow.Attendance.Query()
                    .Where(r => r.Status != AttendanceStatus.Weekend)
                    .OrderByDescending(r => r.Date)
                    .Select(r => (DateOnly?)r.Date),
                ct);

            if (latestWorkingDay is { } date)
            {
                attendance = await LoadDayStatusesAsync(date, ct);
            }
        }

        var present = attendance.Count(status => status is AttendanceStatus.Present or AttendanceStatus.Late
            or AttendanceStatus.Remote or AttendanceStatus.LeftEarly);
        var attendanceRate = attendance.Count == 0
            ? 0m
            : Math.Round((decimal)present / attendance.Count * 100, 1);

        var pendingApprovals =
            await _uow.Approvals.CountQueryAsync(_uow.Approvals.Query().Where(a => a.Status == ApprovalStatus.Pending && a.Type != ApprovalType.Leave), ct) +
            await _uow.LeaveRequests.CountQueryAsync(_uow.LeaveRequests.Query().Where(l => l.Status == LeaveStatus.Pending), ct) +
            await _uow.Regularizations.CountQueryAsync(_uow.Regularizations.Query().Where(r => r.Status == ApprovalStatus.Pending), ct);

        var monthlyPayroll = await _uow.PayrollRuns.FirstOrDefaultAsync(
            _uow.PayrollRuns.Query()
                .OrderByDescending(r => r.Year)
                .ThenByDescending(r => r.Month)
                .Select(r => (decimal?)r.TotalNet),
            ct) ?? 0m;

        var onLeaveToday = await _uow.LeaveRequests.CountQueryAsync(
            _uow.LeaveRequests.Query().Where(l => l.Status == LeaveStatus.Approved && l.FromDate <= today && l.ToDate >= today),
            ct);

        var newJoiners = await _uow.Employees.CountQueryAsync(
            _uow.Employees.Query().Where(e => e.JoinDate.Year == today.Year && e.JoinDate.Month == today.Month),
            ct);

        var resignations = await _uow.Employees.CountQueryAsync(
            _uow.Employees.Query().Where(e => e.Status == EmploymentStatus.Offboarding),
            ct);

        return new DashboardStatsDto(
            totalEmployees,
            attendanceRate,
            pendingApprovals,
            monthlyPayroll,
            departments,
            newJoiners,
            onLeaveToday,
            resignations);
    }

    public async Task<EmployeeDashboardDto> GetMyDashboardAsync(Guid employeeId, CancellationToken ct = default)
    {
        var employee = await _uow.Employees.GetWithDepartmentAsync(employeeId, ct)
                       ?? throw NotFoundException.For("Employee", employeeId);

        if (employee.Status is EmploymentStatus.Offboarding or EmploymentStatus.Terminated or EmploymentStatus.Resigned)
        {
            throw new ForbiddenException("Your account has been deactivated. Please contact HR.");
        }

        var isOffboarded = await _uow.OffboardingRecords.AnyAsync(
            _uow.OffboardingRecords.Query().Where(o => o.EmployeeId == employeeId && (o.Status == OffboardingStatus.Completed || o.AccessRevoked)),
            ct);
        if (isOffboarded)
        {
            throw new ForbiddenException("Your account has been deactivated. Please contact HR.");
        }

        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        // Only the columns this screen needs — the previous call eager-loaded six
        // navigation properties (one query each with split queries) and joined the
        // employee onto every attendance row.
        var monthStart = new DateOnly(today.Year, today.Month, 1);
        var monthEnd = monthStart.AddMonths(1);
        var weekStart = today.AddDays(-6);
        var queryStart = monthStart < weekStart ? monthStart : weekStart;
        var monthRecords = await _uow.Attendance.ToListAsync(
            _uow.Attendance.Query()
                .Where(r => r.EmployeeId == employeeId && r.Date >= queryStart && r.Date < monthEnd)
                .Select(r => new { r.Date, r.CheckIn, r.WorkHours, r.Status }),
            ct);

        var summary = new AttendanceSummaryDto(
            monthRecords.Count(r => r.Date >= monthStart && (r.Status is AttendanceStatus.Present or AttendanceStatus.Late
                or AttendanceStatus.Remote or AttendanceStatus.LeftEarly or AttendanceStatus.HalfDay)),
            monthRecords.Count(r => r.Date >= monthStart && r.Status == AttendanceStatus.Absent),
            monthRecords.Count(r => r.Date >= monthStart && r.Status == AttendanceStatus.Late),
            monthRecords.Count(r => r.Date >= monthStart && r.Status == AttendanceStatus.OnLeave));

        var todayRecord = monthRecords.FirstOrDefault(r => r.Date == today);
        var checkInLabel = todayRecord?.CheckIn is { } checkIn
            ? checkIn.ToString("hh:mm tt")
            : "Not checked in";

        // If today's attendance record has 0 work hours, try to compute live from today's punches
        var todayHours = todayRecord?.WorkHours ?? 0m;
        if (todayHours == 0m)
        {
            var todayPunches = await _uow.Punches.ToListAsync(
                _uow.Punches.Query()
                    .Where(p => p.EmployeeId == employeeId && p.PunchTime >= today.ToDateTime(TimeOnly.MinValue))
                    .OrderBy(p => p.PunchTime),
                ct);
            if (todayPunches.Any())
            {
                var firstIn = todayPunches.FirstOrDefault(p => p.PunchType == PunchType.ClockIn);
                if (firstIn != null)
                {
                    var elapsed = (DateTime.UtcNow - firstIn.PunchTime).TotalHours;
                    if (elapsed > 0 && elapsed < 24)
                    {
                        todayHours = Math.Round((decimal)elapsed, 2);
                    }
                }
            }
        }

        var weekRecords = monthRecords.Where(r => r.Date >= weekStart).ToList();
        var workingHours = weekRecords.Where(r => r.Date != today).Sum(r => r.WorkHours) + todayHours;

        var trend = new List<AttendanceTrendPointDto>();
        for (var i = 6; i >= 0; i--)
        {
            var date = today.AddDays(-i);
            var record = monthRecords.FirstOrDefault(r => r.Date == date);
            var isPresent = record is { Status: AttendanceStatus.Present or AttendanceStatus.Remote or AttendanceStatus.LeftEarly or AttendanceStatus.HalfDay };
            var isLate = record is { Status: AttendanceStatus.Late };
            var isAbsent = record is { Status: AttendanceStatus.Absent };
            var dayHours = date == today ? todayHours : (record?.WorkHours ?? 0m);
            trend.Add(new AttendanceTrendPointDto(
                date.DayOfWeek.ToString()[..3],
                isPresent ? 1 : 0,
                isAbsent ? 1 : 0,
                isLate ? 1 : 0,
                Date: date.ToString("yyyy-MM-dd"),
                WorkHours: Math.Round(dayHours, 2)));
        }

        // Leave balances
        var types = await _uow.LeaveTypes.ToListAsync(
            _uow.LeaveTypes.Query().Where(t => t.IsActive).OrderBy(t => t.Name), ct);
        var ownLeaves = await _uow.LeaveRequests.ListForEmployeeAsync(employeeId, ct);

        var balances = types.Select(type =>
        {
            var used = ownLeaves
                .Where(l => l.LeaveTypeId == type.Id && l.Status == LeaveStatus.Approved && l.FromDate.Year == today.Year)
                .Sum(l => l.Days);

            return new LeaveBalanceDto(type.Name, Math.Max(0, type.MaxDaysPerYear - used), type.MaxDaysPerYear, used, type.Color);
        }).ToList();

        var recentLeaves = ownLeaves.Take(5).Select(l => new RecentLeaveDto(
            l.Id,
            $"{employee.FirstName} {employee.LastName}".Trim(),
            l.LeaveType?.Name ?? "—",
            $"{Formatting.ShortDate(l.FromDate)} - {Formatting.ShortDate(l.ToDate)}",
            l.Status.ToString())).ToList();

        var announcements = await _uow.Announcements.ToListAsync(
            _uow.Announcements.Query().Where(a => a.IsActive).OrderByDescending(a => a.PublishedAtUtc).Take(5), ct);

        var holidays = await _uow.Holidays.ToListAsync(
            _uow.Holidays.Query().Where(h => h.Date >= today).OrderBy(h => h.Date).Take(5), ct);

        var activity = new List<ActivityDto>();

        if (todayRecord?.CheckIn is { } checkInTime)
        {
            activity.Add(new ActivityDto(
                employee.Id,
                $"{employee.FirstName} {employee.LastName}".Trim(),
                employee.EmployeeCode,
                employee.Department?.Name ?? "—",
                "Checked in",
                $"{checkInTime:hh:mm tt} · Today",
                todayRecord.Status.ToString()));
        }

        activity.AddRange(recentLeaves.Select(l => new ActivityDto(
            employee.Id,
            $"{employee.FirstName} {employee.LastName}".Trim(),
            employee.EmployeeCode,
            employee.Department?.Name ?? "—",
            $"{l.LeaveType} leave · {l.DateLabel}",
            "Recent",
            l.Status)));

        return new EmployeeDashboardDto(
            employee.Id,
            $"{employee.FirstName} {employee.LastName}".Trim(),
            Formatting.Initials($"{employee.FirstName} {employee.LastName}"),
            employee.JobTitle,
            employee.Department?.Name ?? "—",
            todayRecord?.Status.ToString() ?? employee.Status.ToString(),
            today.ToString("dddd, MMMM d, yyyy", System.Globalization.CultureInfo.InvariantCulture),
            checkInLabel,
            summary,
            balances,
            recentLeaves,
            announcements.Select(a => new AnnouncementDto(
                a.Id, a.Title, a.Message, a.Tag, a.Severity.ToString(),
                a.PublishedAtUtc, Formatting.Relative(a.PublishedAtUtc), a.IsActive)).ToList(),
            holidays.Select(h => new HolidayDto(
                h.Id, h.Name, h.Date, h.Date.DayOfWeek.ToString(), h.Type.ToString())).ToList(),
            activity.Take(6).ToList(),
            trend,
            workingHours);
    }

    public async Task<IReadOnlyList<DepartmentHeadcountDto>> GetDepartmentHeadcountAsync(CancellationToken ct = default)
    {
        return await _uow.Departments.ToListAsync(
            _uow.Departments.Query()
                .OrderByDescending(d => d.Employees.Count)
                .Select(d => new DepartmentHeadcountDto(d.Name, d.Employees.Count)),
            ct);
    }

    public Task<IReadOnlyList<AttendanceTrendPointDto>> GetAttendanceTrendAsync(CancellationToken ct = default) =>
        GetAttendanceTrendAsync(null, null, null, ct);

    public Task<IReadOnlyList<AttendanceTrendPointDto>> GetAttendanceTrendAsync(int? year, int? month, CancellationToken ct = default) =>
        GetAttendanceTrendAsync(year, month, null, ct);

    private async Task<TimeZoneInfo> GetCompanyTimeZoneAsync(CancellationToken ct)
    {
        var settings = await _uow.CompanySettings.FirstOrDefaultAsync(
            _uow.CompanySettings.Query().OrderBy(c => c.CreatedAtUtc), ct);
        var timeZoneName = !string.IsNullOrWhiteSpace(settings?.TimeZone) ? settings.TimeZone : "Asia/Kolkata";
        return ResolveTimeZone(timeZoneName);
    }

    private static TimeZoneInfo ResolveTimeZone(string? timeZoneId)
    {
        if (string.IsNullOrWhiteSpace(timeZoneId))
        {
            return TimeZoneInfo.FindSystemTimeZoneById("India Standard Time");
        }

        var trimmed = timeZoneId.Trim();
        if (TimeZoneInfo.TryFindSystemTimeZoneById(trimmed, out var tz))
        {
            return tz;
        }

        if (trimmed.StartsWith("UTC", StringComparison.OrdinalIgnoreCase))
        {
            return TimeZoneInfo.Utc;
        }

        var cleanId = trimmed;
        var parenIdx = cleanId.IndexOf('(');
        if (parenIdx > 0)
        {
            cleanId = cleanId[..parenIdx].Trim();
            if (TimeZoneInfo.TryFindSystemTimeZoneById(cleanId, out var tzParen))
            {
                return tzParen;
            }
        }

        var lower = cleanId.ToLowerInvariant();
        if (lower.Contains("kolkata") || lower.Contains("calcutta") || lower.Contains("india") || lower.Contains("ist"))
        {
            return TimeZoneInfo.FindSystemTimeZoneById("India Standard Time");
        }
        if (lower.Contains("dubai") || lower.Contains("gst"))
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Arabian Standard Time");
        }

        return TimeZoneInfo.Utc;
    }

    public async Task<IReadOnlyList<HrEmployeeSummaryDto>> GetHrTeamAsync(CancellationToken ct = default)
    {
        var employees = await _uow.Employees.ListWithDepartmentAsync(ct);
        return employees
            .Where(e => (e.Department != null && e.Department.Name.Contains("Human Resources", StringComparison.OrdinalIgnoreCase))
                     || (e.JobTitle != null && e.JobTitle.Contains("HR", StringComparison.OrdinalIgnoreCase)))
            .OrderBy(e => e.EmployeeCode)
            .Select(e => new HrEmployeeSummaryDto(
                e.Id,
                e.EmployeeCode,
                e.FirstName,
                e.LastName,
                e.Email,
                e.JobTitle ?? e.Designation?.Name ?? "HR Executive"))
            .ToList();
    }

    public async Task<IReadOnlyList<AttendanceTrendPointDto>> GetAttendanceTrendAsync(int? year, int? month, Guid? employeeId, CancellationToken ct = default)
    {
        var tz = await GetCompanyTimeZoneAsync(ct);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, tz));
        var targetYear = year.HasValue && year.Value >= 2020 && year.Value <= 2035 ? year.Value : today.Year;
        var targetMonth = month.HasValue && month.Value >= 1 && month.Value <= 12 ? month.Value : today.Month;

        var monthStart = new DateOnly(targetYear, targetMonth, 1);
        var monthEnd = new DateOnly(targetYear, targetMonth, DateTime.DaysInMonth(targetYear, targetMonth));
        var prevMonthStart = monthStart.AddMonths(-1);
        var prevMonthDays = DateTime.DaysInMonth(prevMonthStart.Year, prevMonthStart.Month);

        var queryFrom = prevMonthStart;

        // If employeeId is not supplied, default to the primary HR employee
        if (!employeeId.HasValue || employeeId.Value == Guid.Empty)
        {
            var hrList = await GetHrTeamAsync(ct);
            if (hrList.Count > 0)
            {
                employeeId = hrList[0].Id;
            }
        }

        // Aggregate per day for this specific HR employee (or company-wide if no HR found)
        var records = await _uow.Attendance.ToListAsync(
            _uow.Attendance.Query()
                .Where(r => (employeeId.HasValue ? r.EmployeeId == employeeId.Value : true) && r.Date >= queryFrom && r.Date <= monthEnd),
            ct);
        var byDate = records.GroupBy(r => r.Date).ToDictionary(g => g.Key, g => g.First());

        var result = new List<AttendanceTrendPointDto>();
        var totalDays = DateTime.DaysInMonth(targetYear, targetMonth);

        // Requirement: Show only past dates and today (present date)
        var maxDay = totalDays;
        if (targetYear == today.Year && targetMonth == today.Month)
        {
            maxDay = today.Day;
        }
        else if (targetYear > today.Year || (targetYear == today.Year && targetMonth > today.Month))
        {
            maxDay = 0;
        }

        var todayStartUtc = TimeZoneInfo.ConvertTimeToUtc(today.ToDateTime(TimeOnly.MinValue), tz);
        var todayEndUtc = todayStartUtc.AddDays(1);
        var punchesToday = await _uow.Punches.ToListAsync(
            _uow.Punches.Query()
                .Where(p => (employeeId.HasValue ? p.EmployeeId == employeeId.Value : true) && p.PunchTime >= todayStartUtc && p.PunchTime < todayEndUtc)
                .OrderBy(p => p.PunchTime),
            ct);

        for (var day = 1; day <= maxDay; day++)
        {
            var date = new DateOnly(targetYear, targetMonth, day);
            var isWeekend = date.DayOfWeek == DayOfWeek.Saturday || date.DayOfWeek == DayOfWeek.Sunday;

            byDate.TryGetValue(date, out var rec);

            int weekNumber = Math.Min(4, ((day - 1) / 7) + 1);

            int curPresent = 0;
            int curAbsent = 0;
            int curLate = 0;

            decimal beforeBreak = 0;
            decimal breakHrs = 0;
            decimal afterBreak = 0;
            decimal missing = 0;

            if (date == today)
            {
                // Dynamic punch tracking for present day for this HR employee
                if (punchesToday.Count > 0)
                {
                    var sorted = punchesToday.OrderBy(p => p.PunchTime).ToList();
                    var last = sorted.Last();
                    bool isClockedIn = (last.PunchType == PunchType.ClockIn || last.PunchType == PunchType.BreakOut);
                    bool isOnBreak = (last.PunchType == PunchType.BreakIn);

                    long totalWorkSec = 0;
                    long totalBreakSec = 0;
                    DateTime? wOpen = null;
                    DateTime? bOpen = null;

                    foreach (var p in sorted)
                    {
                        if (p.PunchType == PunchType.ClockIn)
                        {
                            wOpen = p.PunchTime;
                            bOpen = null;
                        }
                        else if (p.PunchType == PunchType.BreakIn)
                        {
                            if (wOpen.HasValue)
                            {
                                var diff = p.PunchTime - wOpen.Value;
                                if (diff.TotalSeconds > 0) totalWorkSec += (long)diff.TotalSeconds;
                                wOpen = null;
                            }
                            bOpen = p.PunchTime;
                        }
                        else if (p.PunchType == PunchType.BreakOut)
                        {
                            if (bOpen.HasValue)
                            {
                                var diff = p.PunchTime - bOpen.Value;
                                if (diff.TotalSeconds > 0) totalBreakSec += (long)diff.TotalSeconds;
                                bOpen = null;
                            }
                            wOpen = p.PunchTime;
                        }
                        else if (p.PunchType == PunchType.ClockOut)
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
                        }
                    }

                    var nowUtc = DateTime.UtcNow;
                    if (isClockedIn && wOpen.HasValue)
                    {
                        var diff = nowUtc - wOpen.Value;
                        if (diff.TotalSeconds > 0) totalWorkSec += (long)diff.TotalSeconds;
                    }
                    else if (isOnBreak && bOpen.HasValue)
                    {
                        var diff = nowUtc - bOpen.Value;
                        if (diff.TotalSeconds > 0) totalBreakSec += (long)diff.TotalSeconds;
                    }

                    var wH = Math.Round((decimal)totalWorkSec / 3600m, 1);
                    var bH = Math.Round((decimal)totalBreakSec / 3600m, 1);

                    if (bH > 0)
                    {
                        beforeBreak = Math.Min(4.0m, Math.Max(0.5m, wH * 0.5m));
                        breakHrs = Math.Max(0.5m, bH);
                        afterBreak = Math.Max(0m, wH - beforeBreak);
                    }
                    else
                    {
                        beforeBreak = Math.Max(0.5m, wH);
                        breakHrs = 0;
                        afterBreak = 0;
                    }

                    if (isClockedIn || isOnBreak)
                    {
                        missing = 0m;
                    }
                    else
                    {
                        decimal tot = beforeBreak + breakHrs + afterBreak;
                        missing = Math.Max(0m, 8.5m - tot);
                    }

                    curPresent = 1;
                    var firstIn = sorted.FirstOrDefault(p => p.PunchType == PunchType.ClockIn);
                    if (firstIn != null)
                    {
                        var firstInLocal = TimeZoneInfo.ConvertTimeFromUtc(firstIn.PunchTime, tz);
                        if (firstInLocal.TimeOfDay > new TimeSpan(9, 30, 0))
                        {
                            curLate = 1;
                        }
                    }
                }
                else if (rec != null && (rec.Status == AttendanceStatus.Present || rec.Status == AttendanceStatus.Late))
                {
                    curPresent = 1;
                    curLate = rec.Status == AttendanceStatus.Late ? 1 : 0;
                    beforeBreak = 1.0m;
                    breakHrs = 0m;
                    afterBreak = 0m;
                    missing = 0m;
                }
            }
            else if (date < today && !isWeekend)
            {
                if (rec != null)
                {
                    if (rec.Status == AttendanceStatus.Holiday)
                    {
                        beforeBreak = 0m;
                        breakHrs = 0m;
                        afterBreak = 0m;
                        missing = 0m;
                    }
                    else if (rec.Status == AttendanceStatus.Present || rec.Status == AttendanceStatus.Late)
                    {
                        curPresent = 1;
                        curLate = rec.Status == AttendanceStatus.Late ? 1 : 0;
                        decimal wH = rec.WorkHours > 0 ? rec.WorkHours : 8.0m;
                        decimal bH = rec.BreakMinutes > 0 ? Math.Round((decimal)rec.BreakMinutes / 60m, 1) : 1.0m;

                        beforeBreak = Math.Min(4.0m, Math.Round(wH * 0.5m, 1));
                        breakHrs = bH;
                        afterBreak = Math.Max(0m, wH - beforeBreak);
                        missing = Math.Max(0m, 8.5m - (beforeBreak + breakHrs + afterBreak));
                    }
                    else if (rec.Status == AttendanceStatus.HalfDay)
                    {
                        curPresent = 1;
                        beforeBreak = 4.0m;
                        breakHrs = 0.5m;
                        afterBreak = 0m;
                        missing = 4.0m;
                    }
                    else if (rec.Status == AttendanceStatus.Absent)
                    {
                        curAbsent = 1;
                        missing = 1.0m;
                    }
                    else if (rec.Status == AttendanceStatus.OnLeave)
                    {
                        missing = 0m;
                    }
                }
                else
                {
                    curAbsent = 1;
                    missing = 1.0m;
                }
            }

            result.Add(new AttendanceTrendPointDto(
                date.DayOfWeek.ToString()[..3],
                curPresent,
                curAbsent,
                curLate,
                date.ToString("yyyy-MM-dd"),
                weekNumber,
                curPresent,
                curAbsent,
                curLate,
                beforeBreak,
                breakHrs,
                afterBreak,
                missing));
        }

        return result;
    }

    /// <summary>Just the attendance statuses for a day — no employee join, no ordering.</summary>
    private async Task<IReadOnlyList<AttendanceStatus>> LoadDayStatusesAsync(DateOnly date, CancellationToken ct) =>
        await _uow.Attendance.ToListAsync(
            _uow.Attendance.Query().Where(r => r.Date == date).Select(r => r.Status),
            ct);

    public async Task<IReadOnlyList<ActivityDto>> GetRecentActivityAsync(int take, CancellationToken ct = default)
    {
        var count = Math.Clamp(take, 1, 50);

        var leaveItems = await _uow.LeaveRequests.SearchAsync(null, null, 1, count, ct);
        var employeeItems = await _uow.Employees.SearchAsync(null, null, null, 1, count, ct);

        var fromLeaves = leaveItems.Items.Select(l => (
            When: l.SubmittedAtUtc,
            Dto: new ActivityDto(
                l.EmployeeId,
                l.Employee is null ? "—" : $"{l.Employee.FirstName} {l.Employee.LastName}".Trim(),
                l.Employee?.EmployeeCode ?? "—",
                l.Employee?.Department?.Name ?? "—",
                "Leave Applied",
                Formatting.ShortDate(l.SubmittedAtUtc),
                l.Status.ToString())));

        var fromEmployees = employeeItems.Items.Select(e => (
            When: e.CreatedAtUtc,
            Dto: new ActivityDto(
                e.Id,
                $"{e.FirstName} {e.LastName}".Trim(),
                e.EmployeeCode,
                e.Department?.Name ?? "—",
                "Joined",
                Formatting.ShortDate(e.JoinDate),
                e.Status.ToString())));

        return fromLeaves
            .Concat(fromEmployees)
            .OrderByDescending(x => x.When)
            .Take(count)
            .Select(x => x.Dto)
            .ToList();
    }

    public async Task<IReadOnlyList<ExpoAlertDto>> GetDocumentAlertsAsync(int take, CancellationToken ct = default)
    {
        var count = Math.Clamp(take, 1, 50);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var cutoff = today.AddDays(60);

        // Filter, sort and page in SQL — previously the whole documents table was loaded.
        var rows = await _uow.Documents.ToListAsync(
            _uow.Documents.Query()
                .Where(d => d.ExpiryDate != null && d.ExpiryDate <= cutoff)
                .OrderBy(d => d.ExpiryDate)
                .ThenBy(d => d.Id)
                .Take(count)
                .Select(d => new
                {
                    d.Name,
                    ExpiryDate = d.ExpiryDate!.Value,
                    EmployeeName = d.Employee != null ? d.Employee.FirstName + " " + d.Employee.LastName : null,
                }),
            ct);

        return rows.Select(d =>
        {
            var daysLeft = d.ExpiryDate.DayNumber - today.DayNumber;
            var status = daysLeft < 0 ? DocumentStatus.Expired
                : daysLeft <= 30 ? DocumentStatus.Critical
                : DocumentStatus.Warning;

            return new ExpoAlertDto(
                d.EmployeeName is null ? "—" : d.EmployeeName.Trim(),
                d.Name,
                Formatting.FullDate(d.ExpiryDate),
                daysLeft,
                status.ToString());
        }).ToList();
    }

    public async Task<IReadOnlyList<PendingApprovalDto>> GetPendingApprovalsAsync(int take, CancellationToken ct = default)
    {
        var count = Math.Clamp(take, 1, 50);

        // Fetch non-leave pending approvals
        var pendingApprovals = await _uow.Approvals.ToListAsync(
            _uow.Approvals.Query()
                .Where(a => a.Status == ApprovalStatus.Pending && a.Type != ApprovalType.Leave)
                .OrderByDescending(a => a.SubmittedAtUtc)
                .Take(count)
                .Select(a => new
                {
                    a.Id,
                    a.Title,
                    a.Details,
                    Priority = a.Priority.ToString(),
                    EmployeeName = a.Employee != null ? a.Employee.FirstName + " " + a.Employee.LastName : null,
                    a.SubmittedAtUtc,
                }),
            ct);

        // Fetch real pending leave requests
        var (pendingLeaves, _) = await _uow.LeaveRequests.SearchAsync(null, LeaveStatus.Pending, 1, count, ct);

        // Fetch real pending regularization requests
        var pendingRegs = await _uow.Regularizations.ToListAsync(
            _uow.Regularizations.Query()
                .Where(r => r.Status == ApprovalStatus.Pending)
                .OrderByDescending(r => r.SubmittedAtUtc)
                .Take(count)
                .Select(r => new
                {
                    r.Id,
                    r.Date,
                    r.InTime,
                    r.OutTime,
                    r.Reason,
                    EmployeeName = r.Employee != null ? r.Employee.FirstName + " " + r.Employee.LastName : null,
                    r.SubmittedAtUtc,
                }),
            ct);

        var list = new List<(DateTime submitted, PendingApprovalDto dto)>();
        list.AddRange(pendingApprovals.Select(a => (
            a.SubmittedAtUtc,
            new PendingApprovalDto(
                a.Id,
                a.EmployeeName is null ? "—" : a.EmployeeName.Trim(),
                a.Title,
                a.Details,
                a.Priority))));

        list.AddRange(pendingLeaves.Select(l => (
            l.SubmittedAtUtc,
            new PendingApprovalDto(
                l.Id,
                l.Employee != null ? $"{l.Employee.FirstName} {l.Employee.LastName}".Trim() : "—",
                l.LeaveType?.Name ?? "Leave Request",
                $"{l.Days} day(s) · {l.FromDate:dd/MM} - {l.ToDate:dd/MM}",
                "Medium"))));

        list.AddRange(pendingRegs.Select(r => (
            r.SubmittedAtUtc,
            new PendingApprovalDto(
                r.Id,
                r.EmployeeName is null ? "—" : r.EmployeeName.Trim(),
                "Attendance Regularization",
                $"{r.Date:dd/MM} ({r.InTime:hh\\:mm} - {r.OutTime:hh\\:mm}) · {r.Reason}",
                "Medium"))));

        return list.OrderByDescending(x => x.submitted).Select(x => x.dto).Take(count).ToList();
    }

    public async Task<IReadOnlyList<RecentLeaveDto>> GetRecentLeavesAsync(int take, CancellationToken ct = default)
    {
        var count = Math.Clamp(take, 1, 50);
        var items = await _uow.LeaveRequests.SearchAsync(null, null, 1, count, ct);

        return items.Items.Select(l => new RecentLeaveDto(
            l.Id,
            l.Employee is null ? "—" : $"{l.Employee.FirstName} {l.Employee.LastName}".Trim(),
            l.LeaveType?.Name ?? "—",
            $"{Formatting.ShortDate(l.FromDate)} - {Formatting.ShortDate(l.ToDate)}",
            l.Status.ToString())).ToList();
    }

    public async Task<DashboardTemplateDataDto> GetTemplateDataAsync(Guid? employeeId, CancellationToken ct = default)
    {
        var tz = await GetCompanyTimeZoneAsync(ct);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, tz));
        var todayStartUtc = TimeZoneInfo.ConvertTimeToUtc(today.ToDateTime(TimeOnly.MinValue), tz);
        var todayEndUtc = todayStartUtc.AddDays(1);

        // Resolve target employee if provided, or pick first
        Guid targetEmpId;
        if (employeeId.HasValue && employeeId.Value != Guid.Empty)
        {
            targetEmpId = employeeId.Value;
        }
        else
        {
            var first = await _uow.Employees.FirstOrDefaultAsync(
                _uow.Employees.Query().OrderBy(e => e.EmployeeCode).Select(e => (Guid?)e.Id), ct);
            targetEmpId = first ?? Guid.Empty;
        }

        // 1. Employees & Today Attendance
        var employees = await _uow.Employees.ListWithDepartmentAsync(ct);
        var todayRecords = await _uow.Attendance.ToListAsync(
            _uow.Attendance.Query()
                .Where(a => a.Date == today)
                .Select(a => new { a.EmployeeId, a.CheckIn, a.Status, a.WorkHours }),
            ct);
        var recordByEmp = todayRecords.ToDictionary(r => r.EmployeeId);

        var todayLeaves = await _uow.LeaveRequests.ToListAsync(
            _uow.LeaveRequests.Query().Where(l => l.Status == LeaveStatus.Approved && l.FromDate <= today && l.ToDate >= today),
            ct);
        var leaveByEmp = todayLeaves.ToDictionary(l => l.EmployeeId);

        var allPunchesToday = await _uow.Punches.ToListAsync(
            _uow.Punches.Query()
                .Where(p => p.PunchTime >= todayStartUtc && p.PunchTime < todayEndUtc)
                .OrderBy(p => p.PunchTime),
            ct);
        var punchesByEmp = allPunchesToday.GroupBy(p => p.EmployeeId).ToDictionary(g => g.Key, g => g.ToList());

        var presentList = new List<AttendancePersonDto>();
        var absentList = new List<AttendancePersonDto>();
        var onLeaveList = new List<AttendancePersonDto>();
        var lateList = new List<AttendancePersonDto>();

        foreach (var emp in employees.Where(e => e.Status == EmploymentStatus.Active))
        {
            var name = $"{emp.FirstName} {emp.LastName}".Trim();
            var dept = emp.Department?.Name ?? "General";
            var desig = emp.Designation?.Name ?? emp.JobTitle;

            recordByEmp.TryGetValue(emp.Id, out var rec);
            punchesByEmp.TryGetValue(emp.Id, out var empPunches);

            var hasCheckIn = (rec != null && rec.CheckIn.HasValue) || (empPunches != null && empPunches.Any(p => p.PunchType == PunchType.ClockIn));

            if (hasCheckIn)
            {
                string? timeStr = null;
                if (rec?.CheckIn.HasValue == true)
                {
                    timeStr = rec.CheckIn.Value.ToString("hh:mm tt");
                }
                else if (empPunches != null)
                {
                    var firstIn = empPunches.FirstOrDefault(p => p.PunchType == PunchType.ClockIn);
                    if (firstIn != null)
                    {
                        var localIn = TimeZoneInfo.ConvertTimeFromUtc(firstIn.PunchTime, tz);
                        timeStr = localIn.ToString("hh:mm tt");
                    }
                }

                var person = new AttendancePersonDto(emp.Id, name, emp.EmployeeCode, dept, desig, timeStr ?? "10:00 AM", null);
                presentList.Add(person);

                var isLate = (rec != null && rec.Status == AttendanceStatus.Late);
                if (!isLate && empPunches != null)
                {
                    var firstIn = empPunches.FirstOrDefault(p => p.PunchType == PunchType.ClockIn);
                    if (firstIn != null)
                    {
                        var localIn = TimeZoneInfo.ConvertTimeFromUtc(firstIn.PunchTime, tz);
                        if (localIn.TimeOfDay > new TimeSpan(9, 15, 0))
                        {
                            isLate = true;
                        }
                    }
                }
                if (isLate)
                {
                    lateList.Add(person);
                }
            }
            else if (leaveByEmp.TryGetValue(emp.Id, out var leave))
            {
                onLeaveList.Add(new AttendancePersonDto(emp.Id, name, emp.EmployeeCode, dept, desig, null, leave.Reason));
            }
            else
            {
                absentList.Add(new AttendancePersonDto(emp.Id, name, emp.EmployeeCode, dept, desig, null, null));
            }
        }

        var todayOverview = new TodayAttendanceOverviewDto(
            employees.Count,
            presentList.Count,
            absentList.Count,
            onLeaveList.Count,
            lateList.Count,
            presentList,
            absentList,
            onLeaveList,
            lateList);

        // 2. Notices
        var announcements = await _uow.Announcements.ToListAsync(
            _uow.Announcements.Query().Where(a => a.IsActive).OrderByDescending(a => a.PublishedAtUtc).Take(8), ct);
        var notices = announcements.Select(a => new NoticeBoardDto(
            a.Id, a.Title, a.Message, a.Tag, a.Severity.ToString(), null, null, a.PublishedAtUtc)).ToList();

        // 3. Celebrations (Birthdays, Anniversaries, New Joinees)
        var celebrations = new List<CelebrationDto>();
        foreach (var emp in employees.Where(e => e.Status == EmploymentStatus.Active))
        {
            var name = $"{emp.FirstName} {emp.LastName}".Trim();
            var dept = emp.Department?.Name ?? "General";

            if (emp.DateOfBirth is { } dob && dob.Month == today.Month)
            {
                var isToday = dob.Day == today.Day;
                var label = isToday ? "Birthday Today! 🎂" : $"Birthday on {new DateTime(today.Year, dob.Month, dob.Day):MMM d}";
                celebrations.Add(new CelebrationDto(emp.Id, name, emp.EmployeeCode, dept, "Birthday", label, null));
            }

            if (emp.JoinDate.Month == today.Month && emp.JoinDate.Year < today.Year)
            {
                var yrs = today.Year - emp.JoinDate.Year;
                celebrations.Add(new CelebrationDto(emp.Id, name, emp.EmployeeCode, dept, "WorkAnniversary", $"{yrs} Year{(yrs > 1 ? "s" : "")} on {new DateTime(today.Year, emp.JoinDate.Month, emp.JoinDate.Day):MMM d}", null));
            }

            if (emp.JoinDate >= today.AddDays(-30) && emp.JoinDate <= today)
            {
                celebrations.Add(new CelebrationDto(emp.Id, name, emp.EmployeeCode, dept, "NewJoinee", $"Joined {emp.JoinDate:MMM d, yyyy}", null));
            }
        }

        // 4. Upcoming Holidays
        var holidays = await _uow.Holidays.ToListAsync(
            _uow.Holidays.Query().Where(h => h.Date >= today).OrderBy(h => h.Date).Take(6), ct);
        var holidayDtos = holidays.Select(h => new HolidayDto(h.Id, h.Name, h.Date, h.Date.DayOfWeek.ToString(), h.Type.ToString())).ToList();

        // 5. Tasks - prioritize active/pending tasks
        var tasksQuery = _uow.Tasks.Query();
        var hasEmpTasks = targetEmpId != Guid.Empty && await _uow.Tasks.AnyAsync(_uow.Tasks.Query().Where(t => t.EmployeeId == targetEmpId), ct);
        if (hasEmpTasks)
        {
            tasksQuery = tasksQuery.Where(t => t.EmployeeId == targetEmpId);
        }
        var tasks = await _uow.Tasks.ToListAsync(
            tasksQuery
                .OrderBy(t => t.Status == TaskItemStatus.Completed ? 1 : 0)
                .ThenBy(t => t.DueDate)
                .Take(6), ct);
        var taskDtos = tasks.Select(t => new TaskDto(
            t.Id, t.EmployeeId, "You", t.Title, t.Description, t.DueDate, Formatting.ShortDate(t.DueDate), t.Status.ToString(), t.Priority.ToString(), t.AssignedBy)).ToList();

        // 6. Pending Approvals
        var pendingApprovals = await GetPendingApprovalsAsync(6, ct);

        // 7. Attendance Graph for HR Team
        var hrTeam = await GetHrTeamAsync(ct);
        Guid? selectedHrId = null;
        if (hrTeam.Count > 0)
        {
            var matched = hrTeam.FirstOrDefault(h => h.Id == targetEmpId);
            selectedHrId = matched != null ? matched.Id : hrTeam[0].Id;
        }
        var attendanceGraph = await GetAttendanceTrendAsync(today.Year, today.Month, selectedHrId, ct);

        // 8. Today's punches
        var todayPunches = await _uow.Punches.ToListAsync(
            _uow.Punches.Query()
                .Where(p => targetEmpId != Guid.Empty && p.EmployeeId == targetEmpId && p.PunchTime >= todayStartUtc && p.PunchTime < todayEndUtc)
                .OrderByDescending(p => p.PunchTime),
            ct);
        var punchDtos = todayPunches.Select(p => new EmployeePunchDto(
            p.Id, p.EmployeeId, "You", "", p.PunchTime, p.PunchType.ToString(), p.Note, p.Device)).ToList();

        // 9. Leave balances
        var leaveBalances = new List<LeaveBalanceDto>();
        if (targetEmpId != Guid.Empty)
        {
            var types = await _uow.LeaveTypes.ToListAsync(_uow.LeaveTypes.Query().Where(t => t.IsActive).OrderBy(t => t.Name), ct);
            var ownLeaves = await _uow.LeaveRequests.ListForEmployeeAsync(targetEmpId, ct);
            leaveBalances = types.Select(type =>
            {
                var used = ownLeaves.Where(l => l.LeaveTypeId == type.Id && l.Status == LeaveStatus.Approved && l.FromDate.Year == today.Year).Sum(l => l.Days);
                return new LeaveBalanceDto(type.Name, Math.Max(0, type.MaxDaysPerYear - used), type.MaxDaysPerYear, used, type.Color);
            }).ToList();
        }

        return new DashboardTemplateDataDto(
            todayOverview,
            notices,
            celebrations,
            holidayDtos,
            taskDtos,
            pendingApprovals,
            attendanceGraph,
            punchDtos,
            leaveBalances,
            hrTeam);
    }
}
