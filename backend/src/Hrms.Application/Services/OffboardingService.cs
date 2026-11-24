using Hrms.Application.Abstractions.Persistence;
using Hrms.Application.Abstractions.Security;
using Hrms.Application.Abstractions.Services;
using Hrms.Application.Common;
using Hrms.Application.DTOs;
using Hrms.Domain.Entities;
using Hrms.Domain.Enums;

namespace Hrms.Application.Services;

public sealed class OffboardingService : IOffboardingService
{
    private readonly IUnitOfWork _uow;
    private readonly ICurrentUser _currentUser;

    public OffboardingService(IUnitOfWork uow, ICurrentUser currentUser)
    {
        _uow = uow;
        _currentUser = currentUser;
    }

    public async Task<IReadOnlyList<OffboardingDto>> ListAsync(string? status = null, string? search = null, CancellationToken ct = default)
    {
        var records = await _uow.OffboardingRecords.ListAsync(ct);
        var employees = await _uow.Employees.ListWithDepartmentAsync(ct);
        var designations = await _uow.Designations.ListAsync(ct);

        var empMap = employees.ToDictionary(e => e.Id);
        var desigMap = designations.ToDictionary(d => d.Id);

        var query = records.AsEnumerable();

        if (!string.IsNullOrWhiteSpace(status) && Enum.TryParse<OffboardingStatus>(status, true, out var parsedStatus))
        {
            query = query.Where(o => o.Status == parsedStatus);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim().ToLowerInvariant();
            query = query.Where(o =>
            {
                var emp = empMap.TryGetValue(o.EmployeeId, out var e) ? e : null;
                return (emp != null && (
                    emp.FirstName.ToLowerInvariant().Contains(s) ||
                    emp.LastName.ToLowerInvariant().Contains(s) ||
                    emp.EmployeeCode.ToLowerInvariant().Contains(s) ||
                    emp.JobTitle.ToLowerInvariant().Contains(s)
                )) ||
                o.Reason.ToLowerInvariant().Contains(s) ||
                (o.Remarks != null && o.Remarks.ToLowerInvariant().Contains(s));
            });
        }

        return query.OrderByDescending(o => o.CreatedAtUtc)
            .Select(o =>
            {
                var emp = empMap.TryGetValue(o.EmployeeId, out var e) ? e : null;
                var desig = emp?.DesignationId.HasValue == true && desigMap.TryGetValue(emp.DesignationId.Value, out var d) ? d.Name : emp?.JobTitle ?? "—";
                return ToDto(o, emp, desig);
            }).ToList();
    }

    public async Task<OffboardingSummaryDto> GetSummaryAsync(CancellationToken ct = default)
    {
        var records = await _uow.OffboardingRecords.ListAsync(ct);
        var total = records.Count;
        var pending = records.Count(r => r.Status == OffboardingStatus.Pending);
        var inProgress = records.Count(r => r.Status == OffboardingStatus.InProgress);
        var completed = records.Count(r => r.Status == OffboardingStatus.Completed);
        var assetsPending = records.Count(r => r.Status != OffboardingStatus.Completed && !r.CompanyAssetsReturned);

        return new OffboardingSummaryDto(total, pending, inProgress, completed, assetsPending);
    }

    public async Task<OffboardingDto> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        var record = await _uow.OffboardingRecords.GetByIdAsync(id, ct)
                     ?? throw NotFoundException.For("Offboarding record", id);

        var employee = await _uow.Employees.GetWithDetailsAsync(record.EmployeeId, ct);
        var desig = employee?.Designation?.Name ?? employee?.JobTitle ?? "—";
        return ToDto(record, employee, desig);
    }

    public async Task<OffboardingDto> InitiateAsync(InitiateOffboardingRequest request, CancellationToken ct = default)
    {
        var employee = await _uow.Employees.GetWithDetailsAsync(request.EmployeeId, ct)
                       ?? throw NotFoundException.For("Employee", request.EmployeeId);

        if (string.IsNullOrWhiteSpace(request.Reason))
        {
            throw new ValidationException("Offboarding reason is required.");
        }

        if (request.FinalWorkingDate < request.ResignationDate)
        {
            throw new ValidationException("Final working date cannot be earlier than the resignation notice date.");
        }

        var existing = await _uow.OffboardingRecords.FirstOrDefaultAsync(
            _uow.OffboardingRecords.Query().Where(o => o.EmployeeId == request.EmployeeId && o.Status != OffboardingStatus.Completed && o.Status != OffboardingStatus.Cancelled),
            ct);

        if (existing != null)
        {
            throw new ConflictException($"An active offboarding process is already open for {employee.FullName} (Status: {existing.Status}).");
        }

        employee.Status = EmploymentStatus.Offboarding;
        _uow.Employees.Update(employee);

        var linkedUser = await _uow.Users.FirstOrDefaultAsync(
            _uow.Users.Query().Where(u => u.EmployeeId == employee.Id || (employee.Email != null && u.Email == employee.Email)), ct);
        if (linkedUser != null)
        {
            linkedUser.IsActive = false;
            _uow.Users.Update(linkedUser);
        }

        var record = new OffboardingRecord
        {
            EmployeeId = employee.Id,
            ResignationDate = request.ResignationDate,
            FinalWorkingDate = request.FinalWorkingDate,
            Reason = request.Reason.Trim(),
            ReasonDetails = request.ReasonDetails?.Trim(),
            HandoverNotes = request.HandoverNotes?.Trim(),
            Remarks = request.Remarks?.Trim(),
            Status = OffboardingStatus.Pending,
            InitiatedByUserId = _currentUser.UserId,
            CreatedAtUtc = DateTime.UtcNow
        };

        await _uow.OffboardingRecords.AddAsync(record, ct);

        // Notify HR
        await _uow.Notifications.AddAsync(new Notification
        {
            UserId = null,
            IconKey = "user_x",
            Title = "Offboarding Initiated",
            Message = $"Offboarding has been initiated for {employee.FullName} ({employee.EmployeeCode}). Final working day: {request.FinalWorkingDate:MMM d, yyyy}.",
            TimeLabel = "Offboarding",
            IsRead = false,
            CreatedAtUtc = DateTime.UtcNow
        }, ct);

        await _uow.SaveChangesAsync(ct);

        var desig = employee.Designation?.Name ?? employee.JobTitle ?? "—";
        return ToDto(record, employee, desig);
    }

    public async Task<OffboardingDto> UpdateAsync(Guid id, UpdateOffboardingRequest request, CancellationToken ct = default)
    {
        var record = await _uow.OffboardingRecords.GetByIdAsync(id, ct)
                     ?? throw NotFoundException.For("Offboarding record", id);

        var employee = await _uow.Employees.GetWithDetailsAsync(record.EmployeeId, ct);

        if (string.IsNullOrWhiteSpace(request.Reason))
        {
            throw new ValidationException("Offboarding reason is required.");
        }

        record.FinalWorkingDate = request.FinalWorkingDate;
        record.Reason = request.Reason.Trim();
        record.ReasonDetails = request.ReasonDetails?.Trim();
        record.HandoverNotes = request.HandoverNotes?.Trim();
        record.CompanyAssetsReturned = request.CompanyAssetsReturned;
        record.AccessRevoked = request.AccessRevoked;
        record.FinalSettlementProcessed = request.FinalSettlementProcessed;
        record.Remarks = request.Remarks?.Trim();

        if (!string.IsNullOrWhiteSpace(request.Status) && Enum.TryParse<OffboardingStatus>(request.Status, true, out var newStatus))
        {
            record.Status = newStatus;
            if (newStatus == OffboardingStatus.Completed)
            {
                record.CompletedAtUtc = DateTime.UtcNow;
                if (employee != null)
                {
                    employee.Status = EmploymentStatus.Terminated;
                    _uow.Employees.Update(employee);
                }

                var user = await _uow.Users.FirstOrDefaultAsync(
                    _uow.Users.Query().Where(u => u.EmployeeId == record.EmployeeId || (employee != null && u.Email == employee.Email)), ct);
                if (user != null)
                {
                    user.IsActive = false;
                    _uow.Users.Update(user);
                }
            }
            else if (newStatus == OffboardingStatus.Cancelled)
            {
                if (employee != null)
                {
                    employee.Status = EmploymentStatus.Active;
                    _uow.Employees.Update(employee);
                }

                var user = await _uow.Users.FirstOrDefaultAsync(
                    _uow.Users.Query().Where(u => u.EmployeeId == record.EmployeeId || (employee != null && u.Email == employee.Email)), ct);
                if (user != null)
                {
                    user.IsActive = true;
                    _uow.Users.Update(user);
                }
            }
        }

        _uow.OffboardingRecords.Update(record);
        await _uow.SaveChangesAsync(ct);

        var desig = employee?.Designation?.Name ?? employee?.JobTitle ?? "—";
        return ToDto(record, employee, desig);
    }

    public async Task<OffboardingDto> CompleteAsync(Guid id, CompleteOffboardingRequest request, CancellationToken ct = default)
    {
        var record = await _uow.OffboardingRecords.GetByIdAsync(id, ct)
                     ?? throw NotFoundException.For("Offboarding record", id);

        var employee = await _uow.Employees.GetWithDetailsAsync(record.EmployeeId, ct);

        if (record.Status == OffboardingStatus.Completed)
        {
            throw new ConflictException("This offboarding process has already been completed.");
        }

        record.Status = OffboardingStatus.Completed;
        record.CompletedAtUtc = DateTime.UtcNow;
        record.CompanyAssetsReturned = true;
        record.FinalSettlementProcessed = true;
        record.AccessRevoked = request.RevokeSystemAccess;

        if (!string.IsNullOrWhiteSpace(request.FinalRemarks))
        {
            record.Remarks = string.IsNullOrWhiteSpace(record.Remarks)
                ? request.FinalRemarks.Trim()
                : $"{record.Remarks} | {request.FinalRemarks.Trim()}";
        }

        if (employee != null)
        {
            employee.Status = EmploymentStatus.Terminated;
            _uow.Employees.Update(employee);
        }

        var user = await _uow.Users.FirstOrDefaultAsync(
            _uow.Users.Query().Where(u => u.EmployeeId == record.EmployeeId || (employee != null && u.Email == employee.Email)), ct);
        if (user != null)
        {
            user.IsActive = false;
            _uow.Users.Update(user);
        }

        _uow.OffboardingRecords.Update(record);

        var empName = employee?.FullName ?? "Employee";
        var empCode = employee?.EmployeeCode ?? "";

        // Notify HR
        await _uow.Notifications.AddAsync(new Notification
        {
            UserId = null,
            IconKey = "user_x",
            Title = "Offboarding Completed",
            Message = $"Offboarding has been successfully completed for {empName} ({empCode}). System access was {(request.RevokeSystemAccess ? "revoked" : "preserved")}.",
            TimeLabel = "Offboarding",
            IsRead = false,
            CreatedAtUtc = DateTime.UtcNow
        }, ct);

        await _uow.SaveChangesAsync(ct);

        var desig = employee?.Designation?.Name ?? employee?.JobTitle ?? "—";
        return ToDto(record, employee, desig);
    }

    private static OffboardingDto ToDto(OffboardingRecord r, Employee? emp, string desig)
    {
        var name = emp != null ? $"{emp.FirstName} {emp.LastName}".Trim() : "—";
        var code = emp?.EmployeeCode ?? "—";
        var dept = emp?.Department?.Name ?? "—";
        var initials = emp != null ? Formatting.Initials(name) : "EM";

        return new OffboardingDto(
            r.Id,
            r.EmployeeId,
            code,
            name,
            initials,
            dept,
            desig,
            r.ResignationDate,
            r.FinalWorkingDate,
            r.Reason,
            r.ReasonDetails,
            r.Status.ToString(),
            r.HandoverNotes,
            r.CompanyAssetsReturned,
            r.AccessRevoked,
            r.FinalSettlementProcessed,
            r.Remarks,
            r.CreatedAtUtc,
            r.CompletedAtUtc);
    }
}
