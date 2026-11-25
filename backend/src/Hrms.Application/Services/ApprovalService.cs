using Hrms.Application.Abstractions.Persistence;
using Hrms.Application.Abstractions.Security;
using Hrms.Application.Abstractions.Services;
using Hrms.Application.Common;
using Hrms.Application.DTOs;
using Hrms.Domain.Entities;
using Hrms.Domain.Enums;

namespace Hrms.Application.Services;

public sealed class ApprovalService : IApprovalService
{
    private readonly IUnitOfWork _uow;
    private readonly ICurrentUser _currentUser;
    private readonly IAttendanceService _attendance;

    public ApprovalService(IUnitOfWork uow, ICurrentUser currentUser, IAttendanceService attendance)
    {
        _uow = uow;
        _currentUser = currentUser;
        _attendance = attendance;
    }

    public async Task<ApprovalSummaryDto> GetSummaryAsync(CancellationToken ct = default)
    {
        var nonLeavePending = await _uow.Approvals.ToListAsync(
            _uow.Approvals.Query().Where(a => a.Status == ApprovalStatus.Pending && a.Type != ApprovalType.Leave),
            ct);
        var pendingLeaves = await _uow.LeaveRequests.CountQueryAsync(
            _uow.LeaveRequests.Query().Where(l => l.Status == LeaveStatus.Pending),
            ct);
        var regularizations = await _uow.Regularizations.ToListAsync(
            _uow.Regularizations.Query().Where(r => r.Status == ApprovalStatus.Pending),
            ct);

        return new ApprovalSummaryDto(
            nonLeavePending.Count + pendingLeaves + regularizations.Count,
            pendingLeaves,
            nonLeavePending.Count(a => a.Type == ApprovalType.Overtime),
            regularizations.Count);
    }

    public async Task<IReadOnlyList<ApprovalDto>> ListAsync(
        ApprovalStatus? status,
        ApprovalType? type,
        CancellationToken ct = default)
    {
        var result = new List<ApprovalDto>();

        if (type == ApprovalType.Leave)
        {
            var leaveStatus = status switch
            {
                ApprovalStatus.Pending => LeaveStatus.Pending,
                ApprovalStatus.Approved => LeaveStatus.Approved,
                ApprovalStatus.Rejected => LeaveStatus.Rejected,
                _ => (LeaveStatus?)null
            };

            var (leaves, _) = await _uow.LeaveRequests.SearchAsync(null, leaveStatus, 1, 100, ct);
            return leaves.Select(ToDto).ToList();
        }

        if (type == ApprovalType.Regularization)
        {
            var regQuery = _uow.Regularizations.Query();
            if (status.HasValue) regQuery = regQuery.Where(r => r.Status == status.Value);
            var regList = await _uow.Regularizations.ToListAsync(regQuery.OrderByDescending(r => r.SubmittedAtUtc), ct);
            return regList.Select(ToDto).ToList();
        }

        if (type != null)
        {
            var items = await _uow.Approvals.ListWithEmployeeAsync(status, type, ct);
            return items.Where(a => a.Type != ApprovalType.Leave).Select(ToDto).ToList();
        }

        // type is null -> all approvals (combine non-leave Approvals + LeaveRequests + Regularizations)
        var approvalItems = await _uow.Approvals.ListWithEmployeeAsync(status, null, ct);
        result.AddRange(approvalItems.Where(a => a.Type != ApprovalType.Leave && a.Type != ApprovalType.Regularization).Select(ToDto));

        var mappedLeaveStatus = status switch
        {
            ApprovalStatus.Pending => LeaveStatus.Pending,
            ApprovalStatus.Approved => LeaveStatus.Approved,
            ApprovalStatus.Rejected => LeaveStatus.Rejected,
            _ => (LeaveStatus?)null
        };
        var (allLeaves, _) = await _uow.LeaveRequests.SearchAsync(null, mappedLeaveStatus, 1, 100, ct);
        result.AddRange(allLeaves.Select(ToDto));

        var allRegQuery = _uow.Regularizations.Query();
        if (status.HasValue) allRegQuery = allRegQuery.Where(r => r.Status == status.Value);
        var allRegs = await _uow.Regularizations.ToListAsync(allRegQuery.OrderByDescending(r => r.SubmittedAtUtc), ct);
        result.AddRange(allRegs.Select(ToDto));

        return result.OrderByDescending(x => x.SubmittedAtUtc).ToList();
    }

    public async Task<ApprovalDto> CreateAsync(CreateApprovalRequest request, CancellationToken ct = default)
    {
        var employeeId = await ResolveEmployeeIdAsync(request.EmployeeId, ct);
        _ = await _uow.Employees.GetByIdAsync(employeeId, ct)
            ?? throw NotFoundException.For("Employee", employeeId);

        var approval = new ApprovalRequest
        {
            EmployeeId = employeeId,
            Type = request.Type,
            Title = request.Title.Trim(),
            Details = request.Details.Trim(),
            Priority = request.Priority,
            Status = ApprovalStatus.Pending,
            SubmittedAtUtc = DateTime.UtcNow,
        };

        await _uow.Approvals.AddAsync(approval, ct);

        var emp = await _uow.Employees.GetByIdAsync(employeeId, ct);
        var empName = emp != null ? $"{emp.FirstName} {emp.LastName}".Trim() : "Employee";
        await _uow.Notifications.AddAsync(new Notification
        {
            IconKey = "documents",
            Title = "New Approval Request",
            Message = $"{empName} submitted {approval.Title}: {approval.Details}",
            TimeLabel = "Just now",
            IsRead = false,
            CreatedAtUtc = DateTime.UtcNow,
        }, ct);

        await _uow.SaveChangesAsync(ct);

        var loaded = await _uow.Approvals.GetWithEmployeeAsync(approval.Id, ct)
                     ?? throw NotFoundException.For("Approval request", approval.Id);
        return ToDto(loaded);
    }

    public async Task<ApprovalDto> DecideAsync(
        Guid id,
        bool approved,
        ApprovalDecisionRequest? request,
        CancellationToken ct = default)
    {
        var leave = await _uow.LeaveRequests.GetWithDetailsAsync(id, ct);
        if (leave != null)
        {
            if (leave.Status != LeaveStatus.Pending)
            {
                throw new ConflictException("This leave request has already been decided.");
            }

            leave.Status = approved ? LeaveStatus.Approved : LeaveStatus.Rejected;
            leave.DecidedAtUtc = DateTime.UtcNow;
            leave.DecidedByUserId = _currentUser.UserId;
            leave.DecisionNote = request?.Note;

            _uow.LeaveRequests.Update(leave);

            var empName = leave.Employee != null ? $"{leave.Employee.FirstName} {leave.Employee.LastName}".Trim() : "Employee";
            var empUser = await _uow.Users.FirstOrDefaultAsync(_uow.Users.Query().Where(u => u.EmployeeId == leave.EmployeeId), ct);
            if (empUser == null && leave.Employee != null && !string.IsNullOrWhiteSpace(leave.Employee.Email))
            {
                empUser = await _uow.Users.FirstOrDefaultAsync(_uow.Users.Query().Where(u => u.Email == leave.Employee.Email), ct);
            }

            await _uow.Notifications.AddAsync(new Notification
            {
                UserId = empUser?.Id,
                IconKey = approved ? "check" : "x",
                Title = approved ? "Leave Request Approved" : "Leave Request Rejected",
                Message = $"{leave.LeaveType?.Name ?? "Leave"} request for {empName} was {(approved ? "approved" : "rejected")}.",
                TimeLabel = "Just now",
                IsRead = false,
                CreatedAtUtc = DateTime.UtcNow,
            }, ct);

            await _uow.SaveChangesAsync(ct);
            return ToDto(leave);
        }

        var reg = await _uow.Regularizations.GetWithEmployeeAsync(id, ct);
        if (reg != null)
        {
            var decided = await _attendance.DecideRegularizationAsync(id, approved, ct);
            return ToDto(reg, decided.Status);
        }

        var approval = await _uow.Approvals.GetWithEmployeeAsync(id, ct)
                       ?? throw NotFoundException.For("Approval request", id);

        if (approval.Status != ApprovalStatus.Pending)
        {
            throw new ConflictException("This approval has already been decided.");
        }

        approval.Status = approved ? ApprovalStatus.Approved : ApprovalStatus.Rejected;
        approval.DecidedAtUtc = DateTime.UtcNow;
        approval.DecidedByUserId = _currentUser.UserId;
        approval.DecisionNote = request?.Note;

        _uow.Approvals.Update(approval);

        var employeeName = approval.Employee != null ? $"{approval.Employee.FirstName} {approval.Employee.LastName}".Trim() : "Employee";
        var approvalEmpUser = await _uow.Users.FirstOrDefaultAsync(_uow.Users.Query().Where(u => u.EmployeeId == approval.EmployeeId), ct);
        if (approvalEmpUser == null && approval.Employee != null && !string.IsNullOrWhiteSpace(approval.Employee.Email))
        {
            approvalEmpUser = await _uow.Users.FirstOrDefaultAsync(_uow.Users.Query().Where(u => u.Email == approval.Employee.Email), ct);
        }

        await _uow.Notifications.AddAsync(new Notification
        {
            UserId = approvalEmpUser?.Id,
            IconKey = approved ? "check" : "x",
            Title = approved ? "Approval Request Approved" : "Approval Request Rejected",
            Message = $"{approval.Title} request for {employeeName} was {(approved ? "approved" : "rejected")}.",
            TimeLabel = "Just now",
            IsRead = false,
            CreatedAtUtc = DateTime.UtcNow,
        }, ct);

        await _uow.SaveChangesAsync(ct);
        return ToDto(approval);
    }

    public async Task<int> ApproveAllAsync(CancellationToken ct = default)
    {
        var pendingApprovals = await _uow.Approvals.ListPendingAsync(ct);
        foreach (var approval in pendingApprovals.Where(a => a.Type != ApprovalType.Leave))
        {
            approval.Status = ApprovalStatus.Approved;
            approval.DecidedAtUtc = DateTime.UtcNow;
            approval.DecidedByUserId = _currentUser.UserId;
            _uow.Approvals.Update(approval);

            var empUser = await _uow.Users.FirstOrDefaultAsync(_uow.Users.Query().Where(u => u.EmployeeId == approval.EmployeeId), ct);
            var empName = approval.Employee != null ? $"{approval.Employee.FirstName} {approval.Employee.LastName}".Trim() : "Employee";
            await _uow.Notifications.AddAsync(new Notification
            {
                UserId = empUser?.Id,
                IconKey = "check",
                Title = "Approval Request Approved",
                Message = $"{approval.Title} request for {empName} was approved.",
                TimeLabel = "Just now",
                IsRead = false,
                CreatedAtUtc = DateTime.UtcNow,
            }, ct);
        }

        var pendingLeaves = await _uow.LeaveRequests.ToListAsync(
            _uow.LeaveRequests.Query().Where(l => l.Status == LeaveStatus.Pending),
            ct);
        foreach (var leave in pendingLeaves)
        {
            leave.Status = LeaveStatus.Approved;
            leave.DecidedAtUtc = DateTime.UtcNow;
            leave.DecidedByUserId = _currentUser.UserId;
            _uow.LeaveRequests.Update(leave);

            var empUser = await _uow.Users.FirstOrDefaultAsync(_uow.Users.Query().Where(u => u.EmployeeId == leave.EmployeeId), ct);
            var emp = await _uow.Employees.GetByIdAsync(leave.EmployeeId, ct);
            var empName = emp != null ? $"{emp.FirstName} {emp.LastName}".Trim() : "Employee";
            await _uow.Notifications.AddAsync(new Notification
            {
                UserId = empUser?.Id,
                IconKey = "check",
                Title = "Leave Request Approved",
                Message = $"Leave request for {empName} was approved.",
                TimeLabel = "Just now",
                IsRead = false,
                CreatedAtUtc = DateTime.UtcNow,
            }, ct);
        }

        var pendingRegs = await _uow.Regularizations.ToListAsync(
            _uow.Regularizations.Query().Where(r => r.Status == ApprovalStatus.Pending),
            ct);
        foreach (var regItem in pendingRegs)
        {
            await _attendance.DecideRegularizationAsync(regItem.Id, true, ct);
        }

        var total = pendingApprovals.Count(a => a.Type != ApprovalType.Leave) + pendingLeaves.Count + pendingRegs.Count;
        if (total > 0)
        {
            await _uow.SaveChangesAsync(ct);
        }

        return total;
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

    private static ApprovalDto ToDto(ApprovalRequest a)
    {
        var name = a.Employee is null ? "—" : $"{a.Employee.FirstName} {a.Employee.LastName}".Trim();
        return new ApprovalDto(
            a.Id,
            a.EmployeeId,
            name,
            Formatting.Initials(name),
            a.Type.ToString(),
            a.Title,
            a.Details,
            a.SubmittedAtUtc,
            Formatting.Relative(a.SubmittedAtUtc),
            a.Priority.ToString(),
            a.Status.ToString());
    }

    private static ApprovalDto ToDto(LeaveRequest l)
    {
        var name = l.Employee is null ? "—" : $"{l.Employee.FirstName} {l.Employee.LastName}".Trim();
        var typeName = l.LeaveType?.Name ?? "Leave";
        var reason = string.IsNullOrWhiteSpace(l.Reason) ? "" : $" ({l.Reason})";
        var details = $"{l.Days} day(s) · {l.FromDate:dd/MM/yyyy} - {l.ToDate:dd/MM/yyyy}{reason}";
        return new ApprovalDto(
            l.Id,
            l.EmployeeId,
            name,
            Formatting.Initials(name),
            "Leave",
            typeName,
            details,
            l.SubmittedAtUtc,
            Formatting.Relative(l.SubmittedAtUtc),
            "Medium",
            l.Status.ToString());
    }

    private static ApprovalDto ToDto(RegularizationRequest r) => ToDto(r, null);

    private static ApprovalDto ToDto(RegularizationRequest r, string? overrideStatus)
    {
        var name = r.Employee is null ? "—" : $"{r.Employee.FirstName} {r.Employee.LastName}".Trim();
        var details = $"{r.Date:dd/MM/yyyy} ({r.InTime:hh\\:mm} - {r.OutTime:hh\\:mm}) · {r.Reason}";
        return new ApprovalDto(
            r.Id,
            r.EmployeeId,
            name,
            Formatting.Initials(name),
            "Regularization",
            "Attendance Regularization",
            details,
            r.SubmittedAtUtc,
            Formatting.Relative(r.SubmittedAtUtc),
            "Medium",
            overrideStatus ?? r.Status.ToString());
    }
}
