using Hrms.Application.Abstractions.Persistence;
using Hrms.Application.Abstractions.Services;
using Hrms.Application.Common;
using Hrms.Application.DTOs;
using Hrms.Domain.Entities;

namespace Hrms.Application.Services;

public sealed class OrganizationService : IOrganizationService
{
    private readonly IUnitOfWork _uow;

    public OrganizationService(IUnitOfWork uow)
    {
        _uow = uow;
    }

    // ── Departments ──
    public async Task<IReadOnlyList<DepartmentDto>> GetDepartmentsAsync(CancellationToken ct = default)
    {
        return await _uow.Departments.ToListAsync(
            _uow.Departments.Query()
                .OrderBy(d => d.Name)
                .Select(d => new DepartmentDto(d.Id, d.Name, d.Code, d.Description, d.IsActive, d.Employees.Count)),
            ct);
    }

    public async Task<DepartmentDto> CreateDepartmentAsync(SaveDepartmentRequest request, CancellationToken ct = default)
    {
        var name = request.Name.Trim();
        if (await _uow.Departments.AnyAsync(_uow.Departments.Query().Where(d => d.Name == name), ct))
        {
            throw new ConflictException($"A department named '{name}' already exists.");
        }

        var department = new Department
        {
            Name = name,
            Code = request.Code.Trim().ToUpperInvariant(),
            Description = request.Description,
            IsActive = request.IsActive,
        };

        await _uow.Departments.AddAsync(department, ct);
        await _uow.SaveChangesAsync(ct);
        return new DepartmentDto(department.Id, department.Name, department.Code, department.Description, department.IsActive, 0);
    }

    public async Task<DepartmentDto> UpdateDepartmentAsync(Guid id, SaveDepartmentRequest request, CancellationToken ct = default)
    {
        var department = await _uow.Departments.GetByIdAsync(id, ct)
                         ?? throw NotFoundException.For("Department", id);

        department.Name = request.Name.Trim();
        department.Code = request.Code.Trim().ToUpperInvariant();
        department.Description = request.Description;
        department.IsActive = request.IsActive;

        _uow.Departments.Update(department);
        await _uow.SaveChangesAsync(ct);

        var count = await _uow.Employees.CountQueryAsync(
            _uow.Employees.Query().Where(e => e.DepartmentId == id),
            ct);

        return new DepartmentDto(department.Id, department.Name, department.Code, department.Description, department.IsActive, count);
    }

    public async Task DeleteDepartmentAsync(Guid id, CancellationToken ct = default)
    {
        var department = await _uow.Departments.GetByIdAsync(id, ct)
                         ?? throw NotFoundException.For("Department", id);

        if (await _uow.Employees.AnyAsync(_uow.Employees.Query().Where(e => e.DepartmentId == id), ct))
        {
            throw new ConflictException("This department still has employees assigned to it.");
        }

        _uow.Departments.Remove(department);
        await _uow.SaveChangesAsync(ct);
    }

    // ── Designations ──
    public async Task<IReadOnlyList<DesignationDto>> GetDesignationsAsync(CancellationToken ct = default)
    {
        return await _uow.Designations.ToListAsync(
            _uow.Designations.Query()
                .OrderBy(d => d.Name)
                .Select(d => new DesignationDto(
                    d.Id,
                    d.Name,
                    d.Grade,
                    d.DepartmentId,
                    d.Department != null ? d.Department.Name : null,
                    d.Description,
                    d.Employees.Count)),
            ct);
    }

    public async Task<DesignationDto> CreateDesignationAsync(SaveDesignationRequest request, CancellationToken ct = default)
    {
        var designation = new Designation
        {
            Name = request.Name.Trim(),
            Grade = request.Grade?.Trim() ?? string.Empty,
            DepartmentId = request.DepartmentId,
            Description = request.Description,
        };

        await _uow.Designations.AddAsync(designation, ct);
        await _uow.SaveChangesAsync(ct);

        string? departmentName = null;
        if (designation.DepartmentId.HasValue)
        {
            var dept = await _uow.Departments.GetByIdAsync(designation.DepartmentId.Value, ct);
            departmentName = dept?.Name;
        }

        return new DesignationDto(designation.Id, designation.Name, designation.Grade, designation.DepartmentId, departmentName, designation.Description, 0);
    }

    public async Task<DesignationDto> UpdateDesignationAsync(Guid id, SaveDesignationRequest request, CancellationToken ct = default)
    {
        var designation = await _uow.Designations.GetByIdAsync(id, ct)
                          ?? throw NotFoundException.For("Designation", id);

        designation.Name = request.Name.Trim();
        designation.Grade = request.Grade?.Trim() ?? string.Empty;
        designation.DepartmentId = request.DepartmentId;
        designation.Description = request.Description;

        _uow.Designations.Update(designation);
        await _uow.SaveChangesAsync(ct);

        string? departmentName = null;
        if (designation.DepartmentId.HasValue)
        {
            var dept = await _uow.Departments.GetByIdAsync(designation.DepartmentId.Value, ct);
            departmentName = dept?.Name;
        }

        var count = await _uow.Employees.CountQueryAsync(
            _uow.Employees.Query().Where(e => e.DesignationId == id),
            ct);

        return new DesignationDto(designation.Id, designation.Name, designation.Grade, designation.DepartmentId, departmentName, designation.Description, count);
    }

    public async Task DeleteDesignationAsync(Guid id, CancellationToken ct = default)
    {
        var designation = await _uow.Designations.GetByIdAsync(id, ct)
                          ?? throw NotFoundException.For("Designation", id);

        _uow.Designations.Remove(designation);
        await _uow.SaveChangesAsync(ct);
    }

    // ── Branches ──
    public async Task<IReadOnlyList<BranchDto>> GetBranchesAsync(CancellationToken ct = default)
    {
        return await _uow.Branches.ToListAsync(
            _uow.Branches.Query()
                .OrderBy(b => b.Name)
                .Select(b => new BranchDto(b.Id, b.Name, b.Location, b.ManagerName, b.EmployeeCount, b.IsActive)),
            ct);
    }

    public async Task<BranchDto> CreateBranchAsync(SaveBranchRequest request, CancellationToken ct = default)
    {
        var branch = new Branch
        {
            Name = request.Name.Trim(),
            Location = request.Location.Trim(),
            ManagerName = request.ManagerName.Trim(),
            EmployeeCount = request.EmployeeCount,
        };

        await _uow.Branches.AddAsync(branch, ct);
        await _uow.SaveChangesAsync(ct);
        return new BranchDto(branch.Id, branch.Name, branch.Location, branch.ManagerName, branch.EmployeeCount, branch.IsActive);
    }

    public async Task<BranchDto> UpdateBranchAsync(Guid id, SaveBranchRequest request, CancellationToken ct = default)
    {
        var branch = await _uow.Branches.GetByIdAsync(id, ct)
                     ?? throw NotFoundException.For("Branch", id);

        branch.Name = request.Name.Trim();
        branch.Location = request.Location.Trim();
        branch.ManagerName = request.ManagerName.Trim();
        branch.EmployeeCount = request.EmployeeCount;

        _uow.Branches.Update(branch);
        await _uow.SaveChangesAsync(ct);
        return new BranchDto(branch.Id, branch.Name, branch.Location, branch.ManagerName, branch.EmployeeCount, branch.IsActive);
    }

    public async Task DeleteBranchAsync(Guid id, CancellationToken ct = default)
    {
        var branch = await _uow.Branches.GetByIdAsync(id, ct)
                     ?? throw NotFoundException.For("Branch", id);

        _uow.Branches.Remove(branch);
        await _uow.SaveChangesAsync(ct);
    }

    // ── Holidays ──
    public async Task<IReadOnlyList<HolidayDto>> GetHolidaysAsync(Guid? templateId = null, CancellationToken ct = default)
    {
        var q = _uow.Holidays.Query();
        if (templateId.HasValue)
        {
            q = q.Where(h => h.HolidayTemplateId == templateId.Value);
        }

        return await _uow.Holidays.ToListAsync(
            q.OrderBy(h => h.Date)
             .Select(h => new HolidayDto(
                 h.Id,
                 h.Name,
                 h.Date,
                 h.Date.DayOfWeek.ToString(),
                 h.Type.ToString(),
                 h.HolidayTemplateId,
                 h.HolidayTemplate != null ? h.HolidayTemplate.Name : null,
                 h.Description,
                 h.Icon)),
            ct);
    }

    public async Task<HolidayDto> CreateHolidayAsync(SaveHolidayRequest request, CancellationToken ct = default)
    {
        var holiday = new Holiday
        {
            Name = request.Name.Trim(),
            Date = request.Date,
            Type = request.Type,
            HolidayTemplateId = request.HolidayTemplateId,
            Description = request.Description?.Trim(),
            Icon = request.Icon ?? "calendar",
        };

        await _uow.Holidays.AddAsync(holiday, ct);
        await _uow.SaveChangesAsync(ct);

        string? tmplName = null;
        if (holiday.HolidayTemplateId.HasValue)
        {
            var tmpl = await _uow.HolidayTemplates.GetByIdAsync(holiday.HolidayTemplateId.Value, ct);
            tmplName = tmpl?.Name;
        }

        return new HolidayDto(
            holiday.Id,
            holiday.Name,
            holiday.Date,
            holiday.Date.DayOfWeek.ToString(),
            holiday.Type.ToString(),
            holiday.HolidayTemplateId,
            tmplName,
            holiday.Description,
            holiday.Icon);
    }

    public async Task<HolidayDto> UpdateHolidayAsync(Guid id, SaveHolidayRequest request, CancellationToken ct = default)
    {
        var holiday = await _uow.Holidays.GetByIdAsync(id, ct)
                      ?? throw NotFoundException.For("Holiday", id);

        holiday.Name = request.Name.Trim();
        holiday.Date = request.Date;
        holiday.Type = request.Type;
        holiday.HolidayTemplateId = request.HolidayTemplateId;
        holiday.Description = request.Description?.Trim();
        if (!string.IsNullOrWhiteSpace(request.Icon)) holiday.Icon = request.Icon;

        _uow.Holidays.Update(holiday);
        await _uow.SaveChangesAsync(ct);

        string? tmplName = null;
        if (holiday.HolidayTemplateId.HasValue)
        {
            var tmpl = await _uow.HolidayTemplates.GetByIdAsync(holiday.HolidayTemplateId.Value, ct);
            tmplName = tmpl?.Name;
        }

        return new HolidayDto(
            holiday.Id,
            holiday.Name,
            holiday.Date,
            holiday.Date.DayOfWeek.ToString(),
            holiday.Type.ToString(),
            holiday.HolidayTemplateId,
            tmplName,
            holiday.Description,
            holiday.Icon);
    }

    public async Task DeleteHolidayAsync(Guid id, CancellationToken ct = default)
    {
        var holiday = await _uow.Holidays.GetByIdAsync(id, ct)
                      ?? throw NotFoundException.For("Holiday", id);

        _uow.Holidays.Remove(holiday);
        await _uow.SaveChangesAsync(ct);
    }

    // ── Holiday Templates ──
    public async Task<IReadOnlyList<HolidayTemplateDto>> GetHolidayTemplatesAsync(CancellationToken ct = default)
    {
        return await _uow.HolidayTemplates.ToListAsync(
            _uow.HolidayTemplates.Query()
                .OrderByDescending(t => t.IsDefault)
                .ThenBy(t => t.Name)
                .Select(t => new HolidayTemplateDto(
                    t.Id,
                    t.Name,
                    t.Description,
                    t.IsDefault,
                    t.Holidays.Count,
                    t.Assignments.Count,
                    null)),
            ct);
    }

    public async Task<HolidayTemplateDto> CreateHolidayTemplateAsync(SaveHolidayTemplateRequest request, CancellationToken ct = default)
    {
        var template = new HolidayTemplate
        {
            Name = request.Name.Trim(),
            Description = request.Description?.Trim(),
            IsDefault = request.IsDefault,
        };

        if (request.IsDefault)
        {
            var existingDefaults = await _uow.HolidayTemplates.ToListAsync(
                _uow.HolidayTemplates.Query().Where(t => t.IsDefault),
                ct);
            foreach (var d in existingDefaults)
            {
                d.IsDefault = false;
                _uow.HolidayTemplates.Update(d);
            }
        }

        await _uow.HolidayTemplates.AddAsync(template, ct);
        await _uow.SaveChangesAsync(ct);
        return new HolidayTemplateDto(template.Id, template.Name, template.Description, template.IsDefault, 0, 0, null);
    }

    public async Task<HolidayTemplateDto> UpdateHolidayTemplateAsync(Guid id, SaveHolidayTemplateRequest request, CancellationToken ct = default)
    {
        var template = await _uow.HolidayTemplates.GetByIdAsync(id, ct)
                       ?? throw NotFoundException.For("HolidayTemplate", id);

        template.Name = request.Name.Trim();
        template.Description = request.Description?.Trim();

        if (request.IsDefault && !template.IsDefault)
        {
            var existingDefaults = await _uow.HolidayTemplates.ToListAsync(
                _uow.HolidayTemplates.Query().Where(t => t.IsDefault && t.Id != id),
                ct);
            foreach (var d in existingDefaults)
            {
                d.IsDefault = false;
                _uow.HolidayTemplates.Update(d);
            }
        }
        template.IsDefault = request.IsDefault;

        _uow.HolidayTemplates.Update(template);
        await _uow.SaveChangesAsync(ct);

        var holidayCount = await _uow.Holidays.CountQueryAsync(_uow.Holidays.Query().Where(h => h.HolidayTemplateId == id), ct);
        var assignmentCount = await _uow.HolidayTemplateAssignments.CountQueryAsync(_uow.HolidayTemplateAssignments.Query().Where(a => a.HolidayTemplateId == id), ct);

        return new HolidayTemplateDto(template.Id, template.Name, template.Description, template.IsDefault, holidayCount, assignmentCount, null);
    }

    public async Task DeleteHolidayTemplateAsync(Guid id, CancellationToken ct = default)
    {
        var template = await _uow.HolidayTemplates.GetByIdAsync(id, ct)
                       ?? throw NotFoundException.For("HolidayTemplate", id);

        _uow.HolidayTemplates.Remove(template);
        await _uow.SaveChangesAsync(ct);
    }

    // ── Holiday Template Assignments ──
    public async Task<IReadOnlyList<HolidayTemplateAssignmentDto>> GetHolidayTemplateAssignmentsAsync(CancellationToken ct = default)
    {
        return await _uow.HolidayTemplateAssignments.ToListAsync(
            _uow.HolidayTemplateAssignments.Query()
                .OrderBy(a => a.HolidayTemplate != null ? a.HolidayTemplate.Name : "")
                .Select(a => new HolidayTemplateAssignmentDto(
                    a.Id,
                    a.HolidayTemplateId,
                    a.HolidayTemplate != null ? a.HolidayTemplate.Name : string.Empty,
                    a.DepartmentId,
                    a.Department != null ? a.Department.Name : null,
                    a.BranchId,
                    a.Branch != null ? a.Branch.Name : null,
                    a.EmployeeId,
                    a.Employee != null ? (a.Employee.FirstName + " " + a.Employee.LastName) : null)),
            ct);
    }

    public async Task<HolidayTemplateAssignmentDto> CreateHolidayTemplateAssignmentAsync(SaveHolidayTemplateAssignmentRequest request, CancellationToken ct = default)
    {
        var template = await _uow.HolidayTemplates.GetByIdAsync(request.HolidayTemplateId, ct)
                       ?? throw NotFoundException.For("HolidayTemplate", request.HolidayTemplateId);

        var assignment = new HolidayTemplateAssignment
        {
            HolidayTemplateId = request.HolidayTemplateId,
            DepartmentId = request.DepartmentId,
            BranchId = request.BranchId,
            EmployeeId = request.EmployeeId,
        };

        await _uow.HolidayTemplateAssignments.AddAsync(assignment, ct);
        await _uow.SaveChangesAsync(ct);

        string? deptName = null;
        if (request.DepartmentId.HasValue)
        {
            var dept = await _uow.Departments.GetByIdAsync(request.DepartmentId.Value, ct);
            deptName = dept?.Name;
        }

        string? branchName = null;
        if (request.BranchId.HasValue)
        {
            var branch = await _uow.Branches.GetByIdAsync(request.BranchId.Value, ct);
            branchName = branch?.Name;
        }

        string? empName = null;
        if (request.EmployeeId.HasValue)
        {
            var emp = await _uow.Employees.GetByIdAsync(request.EmployeeId.Value, ct);
            if (emp != null) empName = $"{emp.FirstName} {emp.LastName}";
        }

        return new HolidayTemplateAssignmentDto(
            assignment.Id,
            template.Id,
            template.Name,
            assignment.DepartmentId,
            deptName,
            assignment.BranchId,
            branchName,
            assignment.EmployeeId,
            empName);
    }

    public async Task DeleteHolidayTemplateAssignmentAsync(Guid id, CancellationToken ct = default)
    {
        var assignment = await _uow.HolidayTemplateAssignments.GetByIdAsync(id, ct)
                         ?? throw NotFoundException.For("HolidayTemplateAssignment", id);

        _uow.HolidayTemplateAssignments.Remove(assignment);
        await _uow.SaveChangesAsync(ct);
    }

    // ── Shifts ──
    public async Task<IReadOnlyList<ShiftDto>> GetShiftsAsync(CancellationToken ct = default)
    {
        return await _uow.Shifts.ToListAsync(
            _uow.Shifts.Query()
                .OrderBy(s => s.Name)
                .Select(s => new ShiftDto(s.Id, s.Name, s.StartTime.ToString(), s.EndTime.ToString(), s.DailyHours, s.WorkingDays)),
            ct);
    }

    public async Task<ShiftDto> CreateShiftAsync(SaveShiftRequest request, CancellationToken ct = default)
    {
        if (request.EndTime <= request.StartTime)
        {
            throw new ValidationException("The shift end time must be after the start time.");
        }

        var shift = new Shift
        {
            Name = request.Name.Trim(),
            StartTime = request.StartTime,
            EndTime = request.EndTime,
            DailyHours = request.DailyHours,
            WorkingDays = request.WorkingDays.Trim(),
        };

        await _uow.Shifts.AddAsync(shift, ct);
        await _uow.SaveChangesAsync(ct);
        return new ShiftDto(shift.Id, shift.Name, shift.StartTime.ToString(), shift.EndTime.ToString(), shift.DailyHours, shift.WorkingDays);
    }

    public async Task<ShiftDto> UpdateShiftAsync(Guid id, SaveShiftRequest request, CancellationToken ct = default)
    {
        if (request.EndTime <= request.StartTime)
        {
            throw new ValidationException("The shift end time must be after the start time.");
        }

        var shift = await _uow.Shifts.GetByIdAsync(id, ct)
                    ?? throw NotFoundException.For("Shift", id);

        shift.Name = request.Name.Trim();
        shift.StartTime = request.StartTime;
        shift.EndTime = request.EndTime;
        shift.DailyHours = request.DailyHours;
        shift.WorkingDays = request.WorkingDays.Trim();

        _uow.Shifts.Update(shift);
        await _uow.SaveChangesAsync(ct);
        return new ShiftDto(shift.Id, shift.Name, shift.StartTime.ToString(), shift.EndTime.ToString(), shift.DailyHours, shift.WorkingDays);
    }

    public async Task DeleteShiftAsync(Guid id, CancellationToken ct = default)
    {
        var shift = await _uow.Shifts.GetByIdAsync(id, ct)
                    ?? throw NotFoundException.For("Shift", id);

        _uow.Shifts.Remove(shift);
        await _uow.SaveChangesAsync(ct);
    }
}
