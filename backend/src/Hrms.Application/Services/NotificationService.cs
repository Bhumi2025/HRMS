using Hrms.Application.Abstractions.Persistence;
using Hrms.Application.Abstractions.Security;
using Hrms.Application.Abstractions.Services;
using Hrms.Application.Common;
using Hrms.Application.DTOs;
using Hrms.Domain.Entities;

namespace Hrms.Application.Services;

public sealed class NotificationService : INotificationService
{
    private readonly IUnitOfWork _uow;
    private readonly ICurrentUser _currentUser;

    public NotificationService(IUnitOfWork uow, ICurrentUser currentUser)
    {
        _uow = uow;
        _currentUser = currentUser;
    }

    public async Task<IReadOnlyList<NotificationDto>> ListAsync(CancellationToken ct = default)
    {
        var userId = _currentUser.UserId;
        var employeeId = _currentUser.EmployeeId;
        var userEmail = _currentUser.Email;
        var isEmployee = string.Equals(_currentUser.Role, "Employee", StringComparison.OrdinalIgnoreCase);

        if (!userId.HasValue)
        {
            if (employeeId.HasValue)
            {
                var empUser = await _uow.Users.FirstOrDefaultAsync(_uow.Users.Query().Where(x => x.EmployeeId == employeeId.Value), ct);
                userId = empUser?.Id;
            }
            else if (!string.IsNullOrEmpty(userEmail))
            {
                var empUser = await _uow.Users.FirstOrDefaultAsync(_uow.Users.Query().Where(x => x.Email == userEmail), ct);
                userId = empUser?.Id;
            }
        }

        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        var notifQuery = _uow.Notifications.Query();
        if (isEmployee)
        {
            notifQuery = notifQuery.Where(n => n.UserId == null || (userId.HasValue && n.UserId == userId) || n.Title.Contains("Payslip") || n.Title.Contains("Payroll"));
        }
        else
        {
            notifQuery = notifQuery.Where(n => n.UserId == null || n.UserId == userId || n.Title.StartsWith("HR Note"));
        }

        var items = await _uow.Notifications.ToListAsync(
            notifQuery
                .OrderByDescending(n => n.CreatedAtUtc)
                .Take(100),
            ct);

        // Check if today or this month's employee birthdays are recorded as notifications
        var employees = await _uow.Employees.ListAsync(ct);
        var newBirthdayNotifs = new List<Notification>();

        foreach (var emp in employees.Where(e => e.Status == Hrms.Domain.Enums.EmploymentStatus.Active && e.DateOfBirth.HasValue))
        {
            var dob = emp.DateOfBirth!.Value;
            if (dob.Month == today.Month)
            {
                var isToday = dob.Day == today.Day;
                var title = isToday ? "Birthday Today 🎂" : "Upcoming Birthday 🎂";
                var empName = $"{emp.FirstName} {emp.LastName}".Trim();

                // Check if already notified
                var alreadyExists = items.Any(n => n.Title == title && n.Message.Contains(empName));
                if (!alreadyExists)
                {
                    newBirthdayNotifs.Add(new Notification
                    {
                        IconKey = "party",
                        Title = title,
                        Message = $"{empName} celebrates their birthday {(isToday ? "today" : $"on {new DateTime(today.Year, dob.Month, dob.Day):MMM d}")}! 🎉",
                        TimeLabel = isToday ? "Today" : "This Month",
                        IsRead = false,
                        CreatedAtUtc = DateTime.UtcNow,
                    });
                }
            }
        }

        if (newBirthdayNotifs.Count > 0)
        {
            await _uow.Notifications.AddRangeAsync(newBirthdayNotifs, ct);
            await _uow.SaveChangesAsync(ct);
            items = await _uow.Notifications.ToListAsync(
                notifQuery
                    .OrderByDescending(n => n.CreatedAtUtc)
                    .Take(100),
                ct);
        }

        // Check recent payslips and ensure payslip notifications exist for employees
        var recentPayslips = await _uow.Payslips.ToListAsync(
            _uow.Payslips.Query().OrderByDescending(p => p.Year).ThenByDescending(p => p.Month).Take(25),
            ct);

        var newPayslipNotifs = new List<Notification>();
        foreach (var p in recentPayslips)
        {
            var emp = employees.FirstOrDefault(e => e.Id == p.EmployeeId);
            if (emp == null) continue;
            var empName = $"{emp.FirstName} {emp.LastName}".Trim();
            var monthName = new DateTime(p.Year, p.Month, 1).ToString("MMMM yyyy");

            var alreadyExists = items.Any(n =>
                (n.Title == "Payslip Dispatched" || n.Title.Contains("Payslip")) &&
                n.Message.Contains(monthName) &&
                (n.Message.Contains(empName) || (!string.IsNullOrEmpty(emp.EmployeeCode) && n.Message.Contains(emp.EmployeeCode))));

            if (!alreadyExists)
            {
                var empUser = await _uow.Users.FirstOrDefaultAsync(_uow.Users.Query().Where(u => u.EmployeeId == emp.Id), ct);
                if (empUser == null && !string.IsNullOrWhiteSpace(emp.Email))
                {
                    empUser = await _uow.Users.FirstOrDefaultAsync(_uow.Users.Query().Where(u => u.Email == emp.Email), ct);
                }

                newPayslipNotifs.Add(new Notification
                {
                    UserId = empUser?.Id,
                    IconKey = "card",
                    Title = "Payslip Dispatched",
                    Message = $"Your payslip for {monthName} has been dispatched to {empName}. Net Pay: ₹{p.NetPay:N2}.",
                    TimeLabel = "Recent",
                    IsRead = false,
                    CreatedAtUtc = p.CreatedAtUtc != default ? p.CreatedAtUtc : DateTime.UtcNow,
                });
            }
        }

        if (newPayslipNotifs.Count > 0)
        {
            await _uow.Notifications.AddRangeAsync(newPayslipNotifs, ct);
            await _uow.SaveChangesAsync(ct);
            items = await _uow.Notifications.ToListAsync(
                notifQuery
                    .OrderByDescending(n => n.CreatedAtUtc)
                    .Take(100),
                ct);
        }

        if (items.Count == 0)
        {
            var generated = new List<Notification>();

            // 1. Pending or recent leaves
            var leaves = await _uow.LeaveRequests.ToListAsync(
                _uow.LeaveRequests.Query().OrderByDescending(l => l.SubmittedAtUtc).Take(5), ct);
            foreach (var leave in leaves)
            {
                var emp = employees.FirstOrDefault(e => e.Id == leave.EmployeeId);
                var empName = emp != null ? $"{emp.FirstName} {emp.LastName}".Trim() : "Employee";
                generated.Add(new Notification
                {
                    IconKey = leave.Status == Hrms.Domain.Enums.LeaveStatus.Pending ? "calendar" : (leave.Status == Hrms.Domain.Enums.LeaveStatus.Approved ? "check" : "x"),
                    Title = leave.Status == Hrms.Domain.Enums.LeaveStatus.Pending ? "Leave Request Pending" : $"Leave {leave.Status}",
                    Message = $"{empName} requested {leave.Days} day(s) of leave ({leave.FromDate:MMM d} - {leave.ToDate:MMM d}). Reason: {leave.Reason ?? "Standard Leave"}",
                    TimeLabel = leave.Status == Hrms.Domain.Enums.LeaveStatus.Pending ? "Pending" : "Recent",
                    IsRead = false,
                    CreatedAtUtc = leave.SubmittedAtUtc,
                });
            }

            // 2. Pending or recent approvals
            var approvals = await _uow.Approvals.ToListAsync(
                _uow.Approvals.Query().OrderByDescending(a => a.SubmittedAtUtc).Take(5), ct);
            foreach (var approval in approvals)
            {
                var emp = employees.FirstOrDefault(e => e.Id == approval.EmployeeId);
                var empName = emp != null ? $"{emp.FirstName} {emp.LastName}".Trim() : "Employee";
                generated.Add(new Notification
                {
                    IconKey = "documents",
                    Title = approval.Status == Hrms.Domain.Enums.ApprovalStatus.Pending ? "Approval Request Pending" : $"Approval {approval.Status}",
                    Message = $"{empName} · {approval.Title}: {approval.Details}",
                    TimeLabel = approval.Status == Hrms.Domain.Enums.ApprovalStatus.Pending ? "Pending" : "Recent",
                    IsRead = false,
                    CreatedAtUtc = approval.SubmittedAtUtc,
                });
            }

            // 3. Announcements
            var announcements = await _uow.Announcements.ToListAsync(
                _uow.Announcements.Query().Where(a => a.IsActive).OrderByDescending(a => a.PublishedAtUtc).Take(3), ct);
            foreach (var a in announcements)
            {
                generated.Add(new Notification
                {
                    IconKey = "bell",
                    Title = a.Title,
                    Message = a.Message,
                    TimeLabel = "HR Update",
                    IsRead = false,
                    CreatedAtUtc = a.PublishedAtUtc,
                });
            }

            // 4. Attendance alert
            generated.Add(new Notification
            {
                IconKey = "clock",
                Title = "Attendance Alert",
                Message = "Daily attendance check-in window closed. 1 employee recorded absent today.",
                TimeLabel = "Today",
                IsRead = false,
                CreatedAtUtc = DateTime.UtcNow.AddMinutes(-30),
            });

            if (generated.Count > 0)
            {
                await _uow.Notifications.AddRangeAsync(generated, ct);
                await _uow.SaveChangesAsync(ct);
                items = await _uow.Notifications.ToListAsync(
                    _uow.Notifications.Query()
                        .Where(n => n.UserId == null || n.UserId == userId)
                        .OrderByDescending(n => n.CreatedAtUtc)
                        .Take(100),
                    ct);
            }
        }

        if (isEmployee)
        {
            var currentEmp = _currentUser.EmployeeId.HasValue
                ? employees.FirstOrDefault(e => e.Id == _currentUser.EmployeeId.Value)
                : employees.FirstOrDefault(e => !string.IsNullOrEmpty(_currentUser.Email) && string.Equals(e.Email, _currentUser.Email, StringComparison.OrdinalIgnoreCase));
            var myName = currentEmp != null ? $"{currentEmp.FirstName} {currentEmp.LastName}".Trim() : null;

            items = items.Where(n =>
            {
                var title = n.Title ?? string.Empty;
                var msg = n.Message ?? string.Empty;
                var icon = n.IconKey ?? string.Empty;

                // 0. If notification is specifically targeted to this employee user, ALWAYS include it!
                if (n.UserId.HasValue && userId.HasValue && n.UserId == userId.Value) return true;

                // 1. Announcements (Notice, Policy, Company Update, Bell)
                var isAnnouncement = icon is "bell" or "announcement" or "policy" or "notice"
                    || title.Contains("Announcement", StringComparison.OrdinalIgnoreCase)
                    || title.Contains("Notice", StringComparison.OrdinalIgnoreCase)
                    || title.Contains("Policy", StringComparison.OrdinalIgnoreCase)
                    || title.Contains("Closure", StringComparison.OrdinalIgnoreCase)
                    || title.Contains("Holiday", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(n.TimeLabel, "HR Update", StringComparison.OrdinalIgnoreCase);
                if (isAnnouncement) return true;

                // 2. Leave Approval Updates for this employee only
                var isLeaveOrApproval = title.Contains("Leave", StringComparison.OrdinalIgnoreCase)
                    || title.Contains("Approval", StringComparison.OrdinalIgnoreCase);
                if (isLeaveOrApproval)
                {
                    // Ignore "New Leave Request" or "New Approval Request" or "Pending" review items for the employee who applied (these are for HR / Managers)
                    if (title.StartsWith("New Leave", StringComparison.OrdinalIgnoreCase) || title.StartsWith("New Approval", StringComparison.OrdinalIgnoreCase) || title.Contains("Pending", StringComparison.OrdinalIgnoreCase))
                    {
                        return false;
                    }

                    // Must be targeted to current user or explicitly mention this employee and not another
                    if (n.UserId.HasValue && n.UserId == userId) return true;
                    if (!string.IsNullOrEmpty(myName) && msg.Contains(myName, StringComparison.OrdinalIgnoreCase)) return true;
                    // Generic update without naming other employees
                    if (!employees.Any(e => !string.IsNullOrEmpty(e.FirstName) && msg.Contains(e.FirstName, StringComparison.OrdinalIgnoreCase) && (myName == null || !string.Equals(e.FirstName, currentEmp?.FirstName, StringComparison.OrdinalIgnoreCase))))
                    {
                        return title.Contains("Approved", StringComparison.OrdinalIgnoreCase) || title.Contains("Rejected", StringComparison.OrdinalIgnoreCase);
                    }
                    return false;
                }

                // 3. Attendance Reminders & Notes of this employee only
                var isAttendance = title.Contains("Attendance", StringComparison.OrdinalIgnoreCase)
                    || title.Contains("Clock In", StringComparison.OrdinalIgnoreCase)
                    || title.Contains("Clock Out", StringComparison.OrdinalIgnoreCase)
                    || title.Contains("Punch", StringComparison.OrdinalIgnoreCase)
                    || title.Contains("Note", StringComparison.OrdinalIgnoreCase)
                    || msg.Contains("late", StringComparison.OrdinalIgnoreCase)
                    || msg.Contains("note", StringComparison.OrdinalIgnoreCase);
                if (isAttendance)
                {
                    if (n.UserId.HasValue && n.UserId == userId) return true;
                    if (!string.IsNullOrEmpty(myName) && (msg.Contains(myName, StringComparison.OrdinalIgnoreCase) || title.Contains(myName, StringComparison.OrdinalIgnoreCase))) return true;
                    if (currentEmp != null && (msg.Contains(currentEmp.EmployeeCode, StringComparison.OrdinalIgnoreCase) || title.Contains(currentEmp.EmployeeCode, StringComparison.OrdinalIgnoreCase))) return true;

                    var isGenericAbsent = msg.Contains("recorded absent", StringComparison.OrdinalIgnoreCase) || msg.Contains("window closed", StringComparison.OrdinalIgnoreCase);
                    if (!isGenericAbsent && (title.Contains("Reminder", StringComparison.OrdinalIgnoreCase) || title.Contains("Note", StringComparison.OrdinalIgnoreCase)))
                    {
                        return true;
                    }
                    return false;
                }

                // 4. Payroll / Payslip notifications for this employee
                var isPayroll = icon is "card" or "payroll" or "receipt"
                    || title.Contains("Payroll", StringComparison.OrdinalIgnoreCase)
                    || title.Contains("Payslip", StringComparison.OrdinalIgnoreCase)
                    || title.Contains("Salary", StringComparison.OrdinalIgnoreCase)
                    || msg.Contains("payslip", StringComparison.OrdinalIgnoreCase)
                    || msg.Contains("salary", StringComparison.OrdinalIgnoreCase);
                if (isPayroll)
                {
                    if (n.UserId.HasValue && userId.HasValue && n.UserId == userId.Value) return true;
                    if (!string.IsNullOrEmpty(myName) && (msg.Contains(myName, StringComparison.OrdinalIgnoreCase) || title.Contains(myName, StringComparison.OrdinalIgnoreCase))) return true;
                    if (currentEmp != null && (msg.Contains(currentEmp.EmployeeCode, StringComparison.OrdinalIgnoreCase) || title.Contains(currentEmp.EmployeeCode, StringComparison.OrdinalIgnoreCase))) return true;
                    // Generic payslip notification intended for the current employee
                    return !employees.Any(e => !string.IsNullOrEmpty(e.FirstName) && msg.Contains(e.FirstName, StringComparison.OrdinalIgnoreCase) && (myName == null || !string.Equals(e.FirstName, currentEmp?.FirstName, StringComparison.OrdinalIgnoreCase)));
                }

                // Strictly filter out all other unrelated notifications (other employees' birthdays, absent alerts, admin requests)
                return false;
            }).ToList();
        }

        return items
            .Select(n =>
            {
                var dynamicTimeLabel = FormatTimeAgo(n.CreatedAtUtc);
                return new NotificationDto(n.Id, n.IconKey, n.Title, n.Message, dynamicTimeLabel, n.IsRead, n.UserId, n.CreatedAtUtc);
            })
            .ToList();
    }

    private static string FormatTimeAgo(DateTime createdAtUtc)
    {
        var elapsed = DateTime.UtcNow - createdAtUtc;
        if (elapsed.TotalSeconds < 0 || elapsed.TotalSeconds < 45)
            return "Just now";
        if (elapsed.TotalMinutes < 60)
        {
            var mins = Math.Max(1, (int)elapsed.TotalMinutes);
            return $"{mins}m ago";
        }
        if (elapsed.TotalHours < 24)
        {
            var hours = Math.Max(1, (int)elapsed.TotalHours);
            return $"{hours}h ago";
        }
        if (elapsed.TotalDays < 7)
        {
            var days = Math.Max(1, (int)elapsed.TotalDays);
            return $"{days}d ago";
        }
        if (elapsed.TotalDays < 30)
        {
            var weeks = Math.Max(1, (int)(elapsed.TotalDays / 7));
            return $"{weeks}w ago";
        }
        if (elapsed.TotalDays < 365)
        {
            var months = Math.Max(1, (int)(elapsed.TotalDays / 30));
            return $"{months}mo ago";
        }
        return createdAtUtc.ToString("MMM d, yyyy");
    }

    public async Task MarkReadAsync(Guid id, CancellationToken ct = default)
    {
        var notification = await _uow.Notifications.GetByIdAsync(id, ct)
                           ?? throw NotFoundException.For("Notification", id);

        notification.IsRead = true;
        _uow.Notifications.Update(notification);
        await _uow.SaveChangesAsync(ct);
    }

    public async Task MarkAllReadAsync(CancellationToken ct = default)
    {
        var userId = _currentUser.UserId;
        var unread = await _uow.Notifications.ToListAsync(
            _uow.Notifications.Query()
                .Where(n => !n.IsRead && (n.UserId == null || n.UserId == userId)),
            ct);

        foreach (var item in unread)
        {
            item.IsRead = true;
            _uow.Notifications.Update(item);
        }

        await _uow.SaveChangesAsync(ct);
    }

    public async Task ClearAllAsync(CancellationToken ct = default)
    {
        var userId = _currentUser.UserId;
        var items = await _uow.Notifications.ToListAsync(
            _uow.Notifications.Query()
                .Where(n => n.UserId == null || n.UserId == userId),
            ct);

        _uow.Notifications.RemoveRange(items);
        await _uow.SaveChangesAsync(ct);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var item = await _uow.Notifications.GetByIdAsync(id, ct);
        if (item != null)
        {
            _uow.Notifications.Remove(item);
            await _uow.SaveChangesAsync(ct);
        }
    }

    public async Task ToggleReadAsync(Guid id, CancellationToken ct = default)
    {
        var notification = await _uow.Notifications.GetByIdAsync(id, ct)
                           ?? throw NotFoundException.For("Notification", id);

        notification.IsRead = !notification.IsRead;
        _uow.Notifications.Update(notification);
        await _uow.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<NotificationPreferenceDto>> GetPreferencesAsync(CancellationToken ct = default)
    {
        var userId = _currentUser.UserId;
        if (userId is null)
        {
            return Array.Empty<NotificationPreferenceDto>();
        }

        var existing = await _uow.NotificationPreferences.ToListAsync(
            _uow.NotificationPreferences.Query()
                .Where(p => p.UserId == userId)
                .OrderBy(p => p.CreatedAtUtc),
            ct);

        if (existing.Count == 0)
        {
            var defaults = DefaultPreferences()
                .Select(d => new NotificationPreference
                {
                    UserId = userId.Value,
                    Key = d.Key,
                    Name = d.Name,
                    Description = d.Description,
                    Enabled = d.Enabled,
                })
                .ToList();

            await _uow.NotificationPreferences.AddRangeAsync(defaults, ct);
            await _uow.SaveChangesAsync(ct);
            existing = defaults;
        }

        return existing.Select(ToPreferenceDto).ToList();
    }

    public async Task<NotificationPreferenceDto> UpdatePreferenceAsync(
        string id,
        bool enabled,
        CancellationToken ct = default)
    {
        if (!Guid.TryParse(id, out var preferenceId))
        {
            throw new ValidationException("The notification preference id is invalid.");
        }

        var preference = await _uow.NotificationPreferences.GetByIdAsync(preferenceId, ct)
                         ?? throw NotFoundException.For("Notification preference", id);

        preference.Enabled = enabled;
        _uow.NotificationPreferences.Update(preference);
        await _uow.SaveChangesAsync(ct);

        return ToPreferenceDto(preference);
    }

    private static NotificationPreferenceDto ToPreferenceDto(NotificationPreference p) =>
        new(p.Id.ToString(), p.Key, p.Name, p.Description, p.Enabled);

    private static IEnumerable<(string Key, string Name, string Description, bool Enabled)> DefaultPreferences() =>
        new[]
        {
            ("leave", "Leave Approval Updates", "Get notified when your leave is approved or rejected", true),
            ("payroll", "Payroll Notifications", "Notify when salary is credited", true),
            ("attendance", "Attendance Reminders", "Daily check-in/out reminders", false),
            ("announcements", "Announcements", "Company news and HR updates", true),
            ("tasks", "Task Assignments", "When new tasks are assigned to you", true),
            ("performance", "Performance Reviews", "Review cycle reminders", false),
        };
}
