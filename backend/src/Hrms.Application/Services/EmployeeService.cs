using System.Net;
using System.Security.Cryptography;
using Hrms.Application.Abstractions.Notifications;
using Hrms.Application.Abstractions.Persistence;
using Hrms.Application.Abstractions.Security;
using Hrms.Application.Abstractions.Services;
using Hrms.Application.Abstractions.Tenancy;
using Hrms.Application.Common;
using Hrms.Application.DTOs;
using Hrms.Domain.Entities;
using Hrms.Domain.Enums;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Hrms.Application.Services;

public sealed class EmployeeService : IEmployeeService
{
    private readonly IUnitOfWork _uow;
    private readonly ICurrentUser _currentUser;
    private readonly IPasswordHasher _passwordHasher;
    private readonly IEmailSender? _emailSender;
    private readonly ITenantContext? _tenantContext;
    private readonly ILogger<EmployeeService>? _logger;
    private readonly IJwtTokenService? _tokenService;
    private readonly AppOptions _appOptions;

    public EmployeeService(
        IUnitOfWork uow,
        ICurrentUser currentUser,
        IPasswordHasher passwordHasher,
        IEmailSender? emailSender = null,
        ITenantContext? tenantContext = null,
        ILogger<EmployeeService>? logger = null,
        IJwtTokenService? tokenService = null,
        IOptions<AppOptions>? appOptions = null)
    {
        _uow = uow;
        _currentUser = currentUser;
        _passwordHasher = passwordHasher;
        _emailSender = emailSender;
        _tenantContext = tenantContext;
        _logger = logger;
        _tokenService = tokenService;
        _appOptions = appOptions?.Value ?? new AppOptions();
    }

    public async Task<PagedResult<EmployeeListItemDto>> SearchAsync(EmployeeQuery query, CancellationToken ct = default)
    {
        var (page, pageSize) = Paging.Normalise(query.Page, query.PageSize);
        var (items, total) = await _uow.Employees.SearchAsync(query.Search, query.DepartmentId, query.Status, page, pageSize, ct);

        var empIds = items.Select(e => e.Id).ToList();
        var empEmails = items.Select(e => e.Email.Trim().ToUpperInvariant()).Distinct().ToList();

        var linkedUsers = items.Count == 0
            ? new List<(Guid? EmployeeId, string NormalizedEmail, string? RoleCode, string? RoleName)>()
            : (await _uow.Users.ToListAsync(
                _uow.Users.Query()
                    .Where(u => (u.EmployeeId != null && empIds.Contains(u.EmployeeId.Value)) || empEmails.Contains(u.NormalizedEmail))
                    .Select(u => new
                    {
                        u.EmployeeId,
                        u.NormalizedEmail,
                        RoleCode = u.Role != null ? u.Role.Code : null,
                        RoleName = u.Role != null ? u.Role.Name : null,
                    }),
                ct))
                .Select(u => (u.EmployeeId, u.NormalizedEmail, u.RoleCode, u.RoleName))
                .ToList();

        var byEmpId = linkedUsers
            .Where(u => u.EmployeeId.HasValue)
            .GroupBy(u => u.EmployeeId!.Value)
            .ToDictionary(g => g.Key, g => g.First());

        var byEmail = linkedUsers
            .GroupBy(u => u.NormalizedEmail)
            .ToDictionary(g => g.Key, g => g.First());

        var dtos = items.Select(e =>
        {
            string? roleCode = null;
            string? roleName = null;
            if (byEmpId.TryGetValue(e.Id, out var uById))
            {
                roleCode = uById.RoleCode;
                roleName = uById.RoleName;
            }
            else if (byEmail.TryGetValue(e.Email.Trim().ToUpperInvariant(), out var uByEmail))
            {
                roleCode = uByEmail.RoleCode;
                roleName = uByEmail.RoleName;
            }

            if (string.IsNullOrWhiteSpace(roleCode))
            {
                var isHrTitle = !string.IsNullOrWhiteSpace(e.JobTitle) &&
                    (e.JobTitle.Contains("HR", StringComparison.OrdinalIgnoreCase) ||
                     e.JobTitle.Contains("Human Resources", StringComparison.OrdinalIgnoreCase));
                roleCode = isHrTitle ? "HrManager" : "Employee";
                roleName = isHrTitle ? "HR Manager" : "Employee";
            }

            return ToListDto(e, roleCode, roleName);
        }).ToList();

        return new PagedResult<EmployeeListItemDto>(dtos, total, page, pageSize);
    }

    public async Task<bool> IsEmailAvailableAsync(string email, Guid? excludeEmployeeId = null, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            return false;
        }

        var lowerEmail = email.Trim().ToLowerInvariant();
        var normEmail = lowerEmail.ToUpperInvariant();

        var userExists = await _uow.Users.AnyAsync(
            _uow.Users.Query().Where(u => u.NormalizedEmail == normEmail && (!excludeEmployeeId.HasValue || u.EmployeeId != excludeEmployeeId.Value)),
            ct);
        if (userExists)
        {
            return false;
        }

        var empExists = await _uow.Employees.AnyAsync(
            _uow.Employees.Query().Where(e => e.Email.ToLower() == lowerEmail && (!excludeEmployeeId.HasValue || e.Id != excludeEmployeeId.Value)),
            ct);
        return !empExists;
    }

    public async Task<EmployeeDetailDto> GetAsync(Guid id, CancellationToken ct = default)
    {
        var employee = await _uow.Employees.GetWithDetailsAsync(id, ct)
                       ?? throw NotFoundException.For("Employee", id);

        var normEmpEmail = employee.Email.Trim().ToUpperInvariant();
        var linkedUser = await _uow.Users.FirstOrDefaultAsync(
            _uow.Users.Query()
                .Where(u => u.EmployeeId == id || u.NormalizedEmail == normEmpEmail || u.Email == employee.Email)
                .OrderByDescending(u => u.EmployeeId == id),
            ct);
        string? roleCode = null;
        string? roleName = null;
        if (linkedUser != null)
        {
            var role = await _uow.Roles.GetByIdAsync(linkedUser.RoleId, ct);
            roleCode = role?.Code.ToString();
            roleName = role?.Name;
        }

        var hasPassword = !string.IsNullOrWhiteSpace(employee.Password) || !string.IsNullOrWhiteSpace(linkedUser?.PasswordHash);

        return ToDetailDto(employee, roleCode, roleName, hasPassword);
    }

    public async Task<EmployeeDetailDto> CreateAsync(CreateEmployeeRequest request, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(request.FirstName) || request.FirstName.Trim().Length < 2)
        {
            throw new ValidationException("First name is required and must be at least 2 characters.");
        }

        if (string.IsNullOrWhiteSpace(request.LastName))
        {
            throw new ValidationException("Last name is required.");
        }

        if (string.IsNullOrWhiteSpace(request.JobTitle))
        {
            throw new ValidationException("Job title is required.");
        }

        if (request.BasicSalary < 0)
        {
            throw new ValidationException("Basic salary must be non-negative.");
        }

        if (!string.IsNullOrWhiteSpace(request.Password) && request.Password.Trim().Length < 6)
        {
            throw new ValidationException("Account password must be at least 6 characters.");
        }

        var email = request.Email.Trim().ToLowerInvariant();
        if (!System.Text.RegularExpressions.Regex.IsMatch(email, @"^[^@\s]+@[^@\s]+\.[^@\s]+$"))
        {
            throw new ValidationException("Please provide a valid email address.");
        }

        if (!string.IsNullOrWhiteSpace(request.Phone))
        {
            var cleanPhone = System.Text.RegularExpressions.Regex.Replace(request.Phone.Trim(), @"[\s\-]", "");
            if (!System.Text.RegularExpressions.Regex.IsMatch(cleanPhone, @"^(?:\+?\d{7,15})$"))
            {
                throw new ValidationException("Please provide a valid contact number.");
            }
        }

        if (await _uow.Users.EmailExistsAsync(email, ct) ||
            await _uow.Employees.AnyAsync(_uow.Employees.Query().Where(e => e.Email.ToLower() == email), ct))
        {
            throw new ConflictException($"A user with email '{email}' already exists in this company. Email ID must be unique.");
        }

        var department = await _uow.Departments.GetByIdAsync(request.DepartmentId, ct)
                         ?? throw NotFoundException.For("Department", request.DepartmentId);

        var existingCodes = await _uow.Employees.ToListAsync(
            _uow.Employees.Query().Select(e => e.EmployeeCode), ct);

        var nextNum = 1001;
        foreach (var c in existingCodes)
        {
            if (c.StartsWith("EMP-", StringComparison.OrdinalIgnoreCase) &&
                int.TryParse(c[4..], out var num) && num >= nextNum)
            {
                nextNum = num + 1;
            }
        }

        var employee = new Employee
        {
            EmployeeCode = $"EMP-{nextNum}",
            Salutation = string.IsNullOrWhiteSpace(request.Salutation) ? null : request.Salutation.Trim(),
            FirstName = request.FirstName.Trim(),
            MiddleName = string.IsNullOrWhiteSpace(request.MiddleName) ? null : request.MiddleName.Trim(),
            LastName = request.LastName.Trim(),
            Email = email,
            Phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim(),
            DepartmentId = department.Id,
            DesignationId = request.DesignationId,
            BranchId = request.BranchId,
            ShiftId = request.ShiftId,
            ReportingManagerId = request.ReportingManagerId,
            JobTitle = request.JobTitle.Trim(),
            Grade = string.IsNullOrWhiteSpace(request.Grade) ? string.Empty : request.Grade.Trim(),
            EmploymentType = request.EmploymentType,
            Status = EmploymentStatus.Active,
            JoinDate = request.JoinDate,
            BasicSalary = request.BasicSalary,
            HousingAllowance = request.HousingAllowance,
            TransportAllowance = request.TransportAllowance,
            MobileAllowance = request.MobileAllowance,
            OtherAllowances = request.OtherAllowances,
            Currency = string.IsNullOrWhiteSpace(request.Currency) ? "INR" : request.Currency.Trim(),
            DateOfBirth = request.DateOfBirth,
            Gender = request.Gender ?? Gender.Female,
            MaritalStatus = request.MaritalStatus ?? MaritalStatus.Single,
            BloodGroup = string.IsNullOrWhiteSpace(request.BloodGroup) ? null : request.BloodGroup.Trim(),
            Address = string.IsNullOrWhiteSpace(request.Address) ? null : request.Address.Trim(),
            City = string.IsNullOrWhiteSpace(request.City) ? null : request.City.Trim(),
            State = string.IsNullOrWhiteSpace(request.State) ? null : request.State.Trim(),
            Country = string.IsNullOrWhiteSpace(request.Country) ? null : request.Country.Trim(),
            EmergencyContactName = string.IsNullOrWhiteSpace(request.EmergencyContactName) ? null : request.EmergencyContactName.Trim(),
            EmergencyContactPhone = string.IsNullOrWhiteSpace(request.EmergencyContactPhone) ? null : request.EmergencyContactPhone.Trim(),
            BankName = string.IsNullOrWhiteSpace(request.BankName) ? null : request.BankName.Trim(),
            AccountName = string.IsNullOrWhiteSpace(request.AccountName) ? null : request.AccountName.Trim(),
            AccountNumber = string.IsNullOrWhiteSpace(request.AccountNumber) ? null : request.AccountNumber.Trim(),
            Iban = string.IsNullOrWhiteSpace(request.Iban) ? request.IfscCode?.Trim() : request.Iban.Trim(),
            IfscCode = string.IsNullOrWhiteSpace(request.IfscCode) ? request.Iban?.Trim() : request.IfscCode.Trim(),
            PaymentMode = request.PaymentMode ?? PaymentMode.BankTransfer,
            Password = string.IsNullOrWhiteSpace(request.Password) ? null : request.Password.Trim(),
        };

        await _uow.Employees.AddAsync(employee, ct);
        await _uow.SaveChangesAsync(ct);

        var rawPassword = string.IsNullOrWhiteSpace(request.Password) ? null : request.Password.Trim();
        var passwordToHash = rawPassword ?? Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));

        var role = await ResolveRoleAsync(request.RoleCode, ct);

        if (role is null && (request.JobTitle.Contains("HR", StringComparison.OrdinalIgnoreCase) || department.Name.Contains("HR", StringComparison.OrdinalIgnoreCase)))
        {
            role = await ResolveRoleAsync("HrManager", ct);
        }

        role ??= await ResolveRoleAsync("Employee", ct) ?? (await _uow.Roles.ListAsync(ct)).First();

        var firstInitial = request.FirstName.Trim().Length > 0 ? request.FirstName.Trim()[0] : 'E';
        var lastInitial = request.LastName.Trim().Length > 0 ? request.LastName.Trim()[0] : 'M';
        var initials = $"{firstInitial}{lastInitial}".Trim().ToUpperInvariant();

        var user = new User
        {
            Email = email,
            NormalizedEmail = email.ToUpperInvariant(),
            PasswordHash = _passwordHasher.Hash(passwordToHash),
            FullName = $"{request.FirstName.Trim()} {request.LastName.Trim()}".Trim(),
            Initials = string.IsNullOrWhiteSpace(initials) ? "EM" : initials,
            RoleId = role.Id,
            EmployeeId = employee.Id,
            IsActive = true,
        };
        await _uow.Users.AddAsync(user, ct);
        var linkedUserId = user.Id;

        await _uow.SaveChangesAsync(ct);

        if (request.SendWelcomeEmail)
        {
            await SendOnboardingWelcomeEmailAsync(employee, linkedUserId, role.Name, ct);
        }

        return await GetAsync(employee.Id, ct);
    }

        public async Task<EmployeeDetailDto> UpdateAsync(Guid id, UpdateEmployeeRequest request, CancellationToken ct = default)
        {
            var employee = await _uow.Employees.GetWithDetailsAsync(id, ct)
                        ?? throw NotFoundException.For("Employee", id);

            await EnsureCallerCanEditEmployeeAsync(employee, ct);

            var email = request.Email.Trim().ToLowerInvariant();
            if (!System.Text.RegularExpressions.Regex.IsMatch(email, @"^[^@\s]+@[^@\s]+\.[^@\s]+$"))
            {
                throw new ValidationException("Please provide a valid email address.");
            }

            if (!string.IsNullOrWhiteSpace(request.Phone))
            {
                var cleanPhone = System.Text.RegularExpressions.Regex.Replace(request.Phone.Trim(), @"[\s\-]", "");
                if (!System.Text.RegularExpressions.Regex.IsMatch(cleanPhone, @"^(?:\+?\d{7,15})$"))
                {
                    throw new ValidationException("Please provide a valid contact number.");
                }
            }

            var normEmail = email.ToUpperInvariant();
            if (await _uow.Employees.AnyAsync(_uow.Employees.Query().Where(e => e.Email.ToLower() == email && e.Id != id), ct) ||
                await _uow.Users.AnyAsync(_uow.Users.Query().Where(u => u.NormalizedEmail == normEmail && u.EmployeeId != id), ct))
            {
                throw new ConflictException($"A user with email '{email}' already exists in this company. Email ID must be unique.");
            }

            _ = await _uow.Departments.GetByIdAsync(request.DepartmentId, ct)
                ?? throw NotFoundException.For("Department", request.DepartmentId);

            var previousEmail = employee.Email;
            employee.Salutation = string.IsNullOrWhiteSpace(request.Salutation) ? null : request.Salutation.Trim();
            employee.FirstName = request.FirstName.Trim();
            employee.MiddleName = request.MiddleName?.Trim();
            employee.LastName = request.LastName.Trim();
            employee.Email = email;
            employee.Phone = request.Phone;
            employee.DepartmentId = request.DepartmentId;
            employee.DesignationId = request.DesignationId;
            employee.BranchId = request.BranchId;
            employee.ReportingManagerId = request.ReportingManagerId;
            employee.JobTitle = request.JobTitle.Trim();
            employee.Grade = string.IsNullOrWhiteSpace(request.Grade) ? string.Empty : request.Grade.Trim();

        var emailLinkedUser = await _uow.Users.FirstOrDefaultAsync(
                _uow.Users.Query()
                    .Where(u => u.EmployeeId == employee.Id || u.Email == previousEmail)
                    .OrderByDescending(u => u.EmployeeId == employee.Id),
                ct);
            if (emailLinkedUser is not null)
            {
                await SyncLinkedUserAsync(emailLinkedUser, employee, request, email, normEmail, ct);
            }
            employee.EmploymentType = request.EmploymentType;
            employee.Status = request.Status;
            employee.JoinDate = request.JoinDate;
            employee.NoticePeriodDays = request.NoticePeriodDays;
            employee.BasicSalary = request.BasicSalary;
            employee.HousingAllowance = request.HousingAllowance;
            employee.TransportAllowance = request.TransportAllowance;
            employee.MobileAllowance = request.MobileAllowance;
            employee.OtherAllowances = request.OtherAllowances;
            employee.Currency = request.Currency;
            employee.BankName = !string.IsNullOrWhiteSpace(request.BankName) ? request.BankName.Trim() : (employee.BankName ?? "Emirates NBD");
            employee.AccountName = !string.IsNullOrWhiteSpace(request.AccountName) ? request.AccountName.Trim() : (employee.AccountName ?? $"{employee.FirstName} {employee.LastName}".Trim());
            employee.AccountNumber = !string.IsNullOrWhiteSpace(request.AccountNumber) ? request.AccountNumber.Trim() : employee.AccountNumber;
            employee.Iban = !string.IsNullOrWhiteSpace(request.Iban) ? request.Iban.Trim() : employee.Iban;
            employee.IfscCode = !string.IsNullOrWhiteSpace(request.IfscCode) ? request.IfscCode.Trim() : employee.IfscCode;
            employee.SwiftCode = !string.IsNullOrWhiteSpace(request.SwiftCode) ? request.SwiftCode.Trim() : employee.SwiftCode;
            employee.PaymentMode = request.PaymentMode;
            employee.WpsId = request.WpsId;
            employee.PassportNumber = request.PassportNumber;
            employee.PassportExpiry = request.PassportExpiry;
            employee.VisaNumber = request.VisaNumber;
            employee.VisaExpiry = request.VisaExpiry;
            employee.EmiratesId = request.EmiratesId;

        if (request.DateOfBirth.HasValue) employee.DateOfBirth = request.DateOfBirth.Value;
        if (request.Gender.HasValue) employee.Gender = request.Gender.Value;
        if (request.MaritalStatus.HasValue) employee.MaritalStatus = request.MaritalStatus.Value;
        if (request.BloodGroup != null) employee.BloodGroup = string.IsNullOrWhiteSpace(request.BloodGroup) ? null : request.BloodGroup.Trim();
        if (request.Nationality != null) employee.Nationality = string.IsNullOrWhiteSpace(request.Nationality) ? null : request.Nationality.Trim();
        if (request.Address != null) employee.Address = string.IsNullOrWhiteSpace(request.Address) ? null : request.Address.Trim();
        if (request.City != null) employee.City = string.IsNullOrWhiteSpace(request.City) ? null : request.City.Trim();
        if (request.State != null) employee.State = string.IsNullOrWhiteSpace(request.State) ? null : request.State.Trim();
        if (request.Country != null) employee.Country = string.IsNullOrWhiteSpace(request.Country) ? null : request.Country.Trim();
        if (request.EmergencyContactName != null) employee.EmergencyContactName = string.IsNullOrWhiteSpace(request.EmergencyContactName) ? null : request.EmergencyContactName.Trim();
        if (request.EmergencyContactPhone != null) employee.EmergencyContactPhone = string.IsNullOrWhiteSpace(request.EmergencyContactPhone) ? null : request.EmergencyContactPhone.Trim();
        if (!string.IsNullOrWhiteSpace(request.Password))
        {
            employee.Password = request.Password.Trim();
            var userToUpdate = await _uow.Users.FirstOrDefaultAsync(
                _uow.Users.Query().Where(u => u.EmployeeId == employee.Id || u.Email == employee.Email), ct);
            if (userToUpdate != null)
            {
                userToUpdate.PasswordHash = _passwordHasher.Hash(request.Password.Trim());
                _uow.Users.Update(userToUpdate);
            }
        }

        var normEmpEmail = employee.Email.Trim().ToUpperInvariant();
        var linkedUser = await _uow.Users.FirstOrDefaultAsync(
            _uow.Users.Query()
                .Where(u => u.EmployeeId == employee.Id || u.NormalizedEmail == normEmpEmail || u.Email == employee.Email)
                .OrderByDescending(u => u.EmployeeId == employee.Id),
            ct);
        if (linkedUser is not null)
        {
            await SyncLinkedUserAsync(linkedUser, employee, request, employee.Email, normEmpEmail, ct);
        }

        // Keep dedicated EmployeeBanks table in sync with primary employee bank details
        if (!string.IsNullOrWhiteSpace(employee.AccountNumber) || !string.IsNullOrWhiteSpace(employee.BankName) || !string.IsNullOrWhiteSpace(employee.Iban))
        {
            var primaryBank = await _uow.EmployeeBanks.FirstOrDefaultAsync(
                _uow.EmployeeBanks.Query().Where(b => b.EmployeeId == employee.Id && b.IsPrimary), ct);

            if (primaryBank == null)
            {
                primaryBank = await _uow.EmployeeBanks.FirstOrDefaultAsync(
                    _uow.EmployeeBanks.Query().Where(b => b.EmployeeId == employee.Id), ct);
            }

            var resolvedBankName = !string.IsNullOrWhiteSpace(employee.BankName) ? employee.BankName : "Emirates NBD";
            var resolvedAccountHolder = !string.IsNullOrWhiteSpace(employee.AccountName) ? employee.AccountName : $"{employee.FirstName} {employee.LastName}".Trim();
            var resolvedAccountNo = !string.IsNullOrWhiteSpace(employee.AccountNumber) ? employee.AccountNumber : (employee.Iban ?? "Not Set");
            var resolvedIfscOrSwift = employee.SwiftCode ?? employee.IfscCode ?? employee.Iban;

            if (primaryBank != null)
            {
                primaryBank.BankName = resolvedBankName;
                primaryBank.AccountHolderName = resolvedAccountHolder;
                primaryBank.AccountNumber = resolvedAccountNo;
                primaryBank.IfscOrSwiftCode = resolvedIfscOrSwift;
                primaryBank.IsPrimary = true;
                _uow.EmployeeBanks.Update(primaryBank);
            }
            else
            {
                primaryBank = new EmployeeBank
                {
                    EmployeeId = employee.Id,
                    BankName = resolvedBankName,
                    AccountHolderName = resolvedAccountHolder,
                    AccountNumber = resolvedAccountNo,
                    IfscOrSwiftCode = resolvedIfscOrSwift,
                    IsPrimary = true,
                };
                await _uow.EmployeeBanks.AddAsync(primaryBank, ct);
            }
        }

        _uow.Employees.Update(employee);
        await _uow.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var employee = await _uow.Employees.GetByIdAsync(id, ct)
                       ?? throw NotFoundException.For("Employee", id);

        var subordinates = await _uow.Employees.ToListAsync(
            _uow.Employees.Query().Where(e => e.ReportingManagerId == id), ct);
        foreach (var sub in subordinates)
        {
            sub.ReportingManagerId = null;
            _uow.Employees.Update(sub);
        }

        var users = await _uow.Users.ToListAsync(
            _uow.Users.Query().Where(u => u.EmployeeId == id), ct);
        foreach (var u in users)
        {
            _uow.Users.Remove(u);
        }

        var payslips = await _uow.Payslips.ToListAsync(
            _uow.Payslips.Query().Where(p => p.EmployeeId == id), ct);
        foreach (var p in payslips)
        {
            _uow.Payslips.Remove(p);
        }

        var punches = await _uow.Punches.ToListAsync(
            _uow.Punches.Query().Where(p => p.EmployeeId == id), ct);
        foreach (var p in punches)
        {
            _uow.Punches.Remove(p);
        }

        var attendance = await _uow.Attendance.ToListAsync(
            _uow.Attendance.Query().Where(a => a.EmployeeId == id), ct);
        foreach (var a in attendance)
        {
            _uow.Attendance.Remove(a);
        }

        var leaves = await _uow.LeaveRequests.ToListAsync(
            _uow.LeaveRequests.Query().Where(l => l.EmployeeId == id), ct);
        foreach (var l in leaves)
        {
            _uow.LeaveRequests.Remove(l);
        }

        var tasks = await _uow.Tasks.ToListAsync(
            _uow.Tasks.Query().Where(t => t.EmployeeId == id), ct);
        foreach (var t in tasks)
        {
            _uow.Tasks.Remove(t);
        }

        _uow.Employees.Remove(employee);
        await _uow.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<DepartmentHeadcountDto>> DepartmentHeadcountAsync(CancellationToken ct = default)
    {
        var rows = await _uow.Departments.ToListAsync(
            _uow.Departments.Query()
                .OrderBy(d => d.Name)
                .Select(d => new DepartmentHeadcountDto(d.Name, d.Employees.Count)),
            ct);

        return rows;
    }

    public async Task UpdatePhotoAsync(Guid id, string photoUrl, CancellationToken ct = default)
    {
        var employee = await _uow.Employees.GetByIdAsync(id, ct)
            ?? throw NotFoundException.For("Employee", id);

        await EnsureCallerCanEditEmployeeAsync(employee, ct);

        employee.FacePhotoUrl = photoUrl;
        _uow.Employees.Update(employee);
        await _uow.SaveChangesAsync(ct);
    }

    private async Task EnsureCallerCanEditEmployeeAsync(Employee target, CancellationToken ct)
    {
        var callerRole = _currentUser.Role?.Trim();
        if (string.IsNullOrWhiteSpace(callerRole))
        {
            return;
        }

        var isHrCaller = callerRole.Equals("HR Manager", StringComparison.OrdinalIgnoreCase) ||
                         callerRole.Equals("HrManager", StringComparison.OrdinalIgnoreCase);
        if (!isHrCaller)
        {
            return;
        }

        var linkedUser = await _uow.Users.FirstOrDefaultAsync(
            _uow.Users.Query().Where(u => u.EmployeeId == target.Id || u.Email == target.Email), ct);
        string? targetRoleCode = null;
        if (linkedUser is not null)
        {
            var role = await _uow.Roles.GetByIdAsync(linkedUser.RoleId, ct);
            targetRoleCode = role?.Code;
        }

        var targetIsHrOrAdmin =
            string.Equals(targetRoleCode, "HrManager", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(targetRoleCode, "CompanyAdmin", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(targetRoleCode, "SuperAdmin", StringComparison.OrdinalIgnoreCase) ||
            (string.IsNullOrWhiteSpace(targetRoleCode) &&
             !string.IsNullOrWhiteSpace(target.JobTitle) &&
             target.JobTitle.Contains("HR", StringComparison.OrdinalIgnoreCase));

        if (targetIsHrOrAdmin)
        {
            throw new ForbiddenException("HR Managers can only edit employee profiles, not HR Manager profiles.");
        }
    }

    public async Task<Guid> ResolveEmployeeIdAsync(Guid? explicitEmployeeId, CancellationToken ct = default)
    {
        if (explicitEmployeeId is { } id && id != Guid.Empty)
        {
            return id;
        }

        if (_currentUser.EmployeeId is { } own)
        {
            return own;
        }

        var first = await _uow.Employees.FirstOrDefaultAsync(
            _uow.Employees.Query().OrderBy(e => e.EmployeeCode).Select(e => (Guid?)e.Id),
            ct);

        return first ?? throw new NotFoundException("No employees exist yet.");
    }

    private static EmployeeListItemDto ToListDto(Employee e, string? roleCode = null, string? roleName = null) => new(
        e.Id,
        e.EmployeeCode,
        $"{e.FirstName} {e.LastName}".Trim(),
        e.Email,
        e.Department?.Name ?? "—",
        e.Grade,
        e.Status.ToString(),
        e.JoinDate,
        Gross(e),
        e.Currency,
        e.JobTitle,
        e.IsFaceEnrolled,
        e.FacePhotoUrl,
        roleCode,
        roleName);

    private static EmployeeDetailDto ToDetailDto(Employee e, string? roleCode = null, string? roleName = null, bool hasPassword = false) => new(
        e.Id,
        e.EmployeeCode,
        e.Salutation,
        e.FirstName,
        e.MiddleName,
        e.LastName,
        $"{e.FirstName} {e.LastName}".Trim(),
        e.Email,
        e.Phone,
        e.DateOfBirth,
        e.Gender.ToString(),
        e.MaritalStatus.ToString(),
        e.BloodGroup,
        e.Nationality,
        e.Address,
        e.City,
        e.State,
        e.Country,
        e.DepartmentId,
        e.Department?.Name ?? "—",
        e.DesignationId,
        e.Designation?.Name,
        e.BranchId,
        e.Branch?.Name,
        e.ReportingManager is null ? null : $"{e.ReportingManager.FirstName} {e.ReportingManager.LastName}".Trim(),
        e.JobTitle,
        e.Grade,
        e.EmploymentType.ToString(),
        e.Status.ToString(),
        e.JoinDate,
        e.NoticePeriodDays,
        e.BasicSalary,
        e.HousingAllowance,
        e.TransportAllowance,
        e.MobileAllowance,
        e.OtherAllowances,
        Gross(e),
        e.Currency,
        e.BankName,
        e.AccountName,
        e.AccountNumber,
        e.Iban,
        e.IfscCode,
        e.SwiftCode,
        e.PaymentMode.ToString(),
        e.WpsId,
        e.PassportNumber,
        e.PassportExpiry,
        e.VisaNumber,
        e.VisaExpiry,
        e.EmiratesId,
        roleCode,
        roleName,
        e.IsFaceEnrolled,
        e.FacePhotoUrl,
        e.EmergencyContactName,
        e.EmergencyContactPhone,
        e.Password,
        hasPassword || !string.IsNullOrWhiteSpace(e.Password));

    private static decimal Gross(Employee e) =>
        e.BasicSalary + e.HousingAllowance + e.TransportAllowance + e.MobileAllowance + e.OtherAllowances;

    private static string NormalizeRoleToken(string? value) =>
        new string((value ?? string.Empty).Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant();

    private async Task<Role?> ResolveRoleAsync(string? target, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(target))
        {
            return null;
        }

        var normalized = NormalizeRoleToken(target);
        var canonical = normalized switch
        {
            "manager" or "ca" or "companyadmin" => "companyadmin",
            "hr" or "hrmanager" => "hrmanager",
            "emp" or "employee" or "employeeselfserviceportal" => "employee",
            "sa" or "superadmin" => "superadmin",
            _ => normalized,
        };

        var roles = await _uow.Roles.ListAsync(ct);
        return roles.FirstOrDefault(r =>
            NormalizeRoleToken(r.Code) == canonical ||
            NormalizeRoleToken(r.Name) == canonical ||
            NormalizeRoleToken(r.Code) == normalized ||
            NormalizeRoleToken(r.Name) == normalized);
    }

    private async Task SyncLinkedUserAsync(
        User linkedUser,
        Employee employee,
        UpdateEmployeeRequest request,
        string email,
        string normEmail,
        CancellationToken ct)
    {
        var fullName = $"{employee.FirstName} {employee.LastName}".Trim();
        linkedUser.Email = email;
        linkedUser.NormalizedEmail = normEmail;
        linkedUser.FullName = fullName;
        linkedUser.Initials = Formatting.Initials(fullName);
        linkedUser.EmployeeId ??= employee.Id;

        if (!string.IsNullOrWhiteSpace(request.RoleCode))
        {
            var role = await ResolveRoleAsync(request.RoleCode, ct);
            if (role is not null)
            {
                linkedUser.RoleId = role.Id;
            }
        }
        else if (request.JobTitle.Contains("HR", StringComparison.OrdinalIgnoreCase))
        {
            var currentRole = await _uow.Roles.GetByIdAsync(linkedUser.RoleId, ct);
            if (currentRole is not null && NormalizeRoleToken(currentRole.Code) is "emp" or "employee")
            {
                var hrRole = await ResolveRoleAsync("HrManager", ct);
                if (hrRole is not null)
                {
                    linkedUser.RoleId = hrRole.Id;
                }
            }
        }

        if (employee.Status == EmploymentStatus.Active)
        {
            linkedUser.IsActive = true;
        }
        else if (employee.Status is EmploymentStatus.Offboarding or EmploymentStatus.Terminated or EmploymentStatus.Resigned)
        {
            linkedUser.IsActive = false;
        }

        _uow.Users.Update(linkedUser);
    }

    private async Task SendOnboardingWelcomeEmailAsync(Employee employee, Guid userId, string roleName, CancellationToken ct)
    {
        if (_emailSender is null || string.IsNullOrWhiteSpace(employee.Email))
        {
            return;
        }

        try
        {
            var companySettings = await _uow.CompanySettings.FirstOrDefaultAsync(
                _uow.CompanySettings.Query().OrderBy(c => c.CreatedAtUtc), ct);
            var companyName = !string.IsNullOrWhiteSpace(companySettings?.CompanyName)
                ? companySettings.CompanyName
                : (!string.IsNullOrWhiteSpace(_tenantContext?.Tenant?.Name) ? _tenantContext.Tenant.Name : "HRMS Portal");

            var employeeName = string.Join(" ", new[] { employee.FirstName, employee.MiddleName, employee.LastName }
                .Where(s => !string.IsNullOrWhiteSpace(s)));

            var expiryHours = _appOptions.InvitationExpiryHours > 0 ? _appOptions.InvitationExpiryHours : 72;
            var baseUrl = string.IsNullOrWhiteSpace(_appOptions.FrontendBaseUrl)
                ? "http://localhost:4200"
                : _appOptions.FrontendBaseUrl.TrimEnd('/');

            var token = _tokenService?.CreateSetPasswordToken(
                new SetPasswordTokenSubject(
                    userId,
                    employee.Id,
                    employee.Email,
                    employee.EmployeeCode,
                    employeeName,
                    _tenantContext?.CompanyId,
                    _tenantContext?.Tenant?.Code,
                    companyName),
                TimeSpan.FromHours(expiryHours)) ?? string.Empty;

            var setPasswordUrl = string.IsNullOrEmpty(token)
                ? $"{baseUrl}/set-password"
                : $"{baseUrl}/set-password?token={Uri.EscapeDataString(token)}";

            var resolvedRole = string.IsNullOrWhiteSpace(roleName) ? "Employee" : roleName.Trim();
            var safeCompany = WebUtility.HtmlEncode(companyName);
            var safeCode = WebUtility.HtmlEncode(employee.EmployeeCode);
            var safeName = WebUtility.HtmlEncode(employeeName);
            var safeEmail = WebUtility.HtmlEncode(employee.Email);
            var safeRole = WebUtility.HtmlEncode(resolvedRole);
            var safeUrl = WebUtility.HtmlEncode(setPasswordUrl);

            var htmlBody = $"""
                <div style="font-family: Arial, Helvetica, sans-serif; color: #1e293b; max-width: 560px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden;">
                  <div style="background: #1e40af; color: #ffffff; padding: 18px 24px;">
                    <h2 style="margin: 0; font-size: 18px;">Welcome to {safeCompany}</h2>
                  </div>
                  <div style="padding: 20px 24px; background: #ffffff;">
                    <p style="margin: 0 0 16px; font-size: 14px;">Hello <strong>{safeName}</strong>, your onboarding is complete. Here are your account details:</p>
                    <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 22px;">
                      <tr>
                        <td style="padding: 8px 12px; border: 1px solid #e2e8f0; background: #f8fafc; font-weight: 600; width: 40%;">Company Name</td>
                        <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">{safeCompany}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 12px; border: 1px solid #e2e8f0; background: #f8fafc; font-weight: 600;">Employee Code</td>
                        <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">{safeCode}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 12px; border: 1px solid #e2e8f0; background: #f8fafc; font-weight: 600;">Employee Name</td>
                        <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">{safeName}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 12px; border: 1px solid #e2e8f0; background: #f8fafc; font-weight: 600;">Email</td>
                        <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">{safeEmail}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 12px; border: 1px solid #e2e8f0; background: #f8fafc; font-weight: 600;">Role</td>
                        <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">{safeRole}</td>
                      </tr>
                    </table>
                    <div style="text-align: center; margin-top: 8px;">
                      <a href="{safeUrl}" style="display: inline-block; padding: 12px 28px; background: #1e40af; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 14px;">Set Password</a>
                    </div>
                  </div>
                </div>
                """;

            var textBody =
                $"Welcome to {companyName}\n\n" +
                $"Company Name: {companyName}\n" +
                $"Employee Code: {employee.EmployeeCode}\n" +
                $"Employee Name: {employeeName}\n" +
                $"Email: {employee.Email}\n" +
                $"Role: {resolvedRole}\n\n" +
                $"Set Password: {setPasswordUrl}";

            var result = await _emailSender.SendAsync(
                new EmailMessage(
                    employee.Email,
                    $"Welcome to {companyName} - Onboarding Details",
                    htmlBody,
                    textBody),
                ct);

            if (!result.Delivered && !result.Simulated)
            {
                _logger?.LogWarning("Onboarding email delivery failed for {EmployeeCode}: {Error}", employee.EmployeeCode, result.Error);
            }
        }
        catch (Exception ex)
        {
            _logger?.LogWarning(ex, "Unexpected error sending onboarding email for {EmployeeCode}.", employee.EmployeeCode);
        }
    }
}
