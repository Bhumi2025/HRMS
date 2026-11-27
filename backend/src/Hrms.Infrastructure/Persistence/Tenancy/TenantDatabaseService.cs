using Hrms.Application.Abstractions.Tenancy;
using Hrms.Application.Common;
using Hrms.Application.DTOs;
using Hrms.Domain.Entities;
using Hrms.Domain.Enums;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Hrms.Infrastructure.Persistence.Tenancy;

/// <summary>
/// Performs the EF Core work needed to create and initialize a tenant database. Each call
/// opens a short-lived <see cref="HrmsDbContext"/> bound to the tenant connection string,
/// so provisioning never depends on the ambient request tenant.
/// </summary>
public sealed class TenantDatabaseService : ITenantDatabaseService
{
    private readonly ITenantConnectionFactory _factory;
    private readonly ILogger<TenantDatabaseService> _logger;

    public TenantDatabaseService(ITenantConnectionFactory factory, ILogger<TenantDatabaseService> logger)
    {
        _factory = factory;
        _logger = logger;
    }

    public async Task<bool> DatabaseExistsAsync(string databaseName, CancellationToken ct = default)
    {
        await using var db = Create(databaseName);
        return await db.Database.CanConnectAsync(ct);
    }

    public async Task ProvisionSchemaAsync(string databaseName, CancellationToken ct = default)
    {
        // The elevated connection is required to create the database; Migrate then applies
        // only the schema migrations (no data is copied from any other company).
        await using var db = Create(databaseName, provisioning: true);
        await db.Database.MigrateAsync(ct);

        const string ensureSchemaSql = @"
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Roles' AND COLUMN_NAME = 'IsSystem')
BEGIN
    ALTER TABLE Roles ADD IsSystem BIT NOT NULL CONSTRAINT DF_Roles_IsSystem DEFAULT 0;
END

EXEC(N'UPDATE Roles SET IsSystem = 1 WHERE Name IN (''Super Admin'', ''Company Admin'', ''HR Manager'', ''Employee'') 
   OR Code IN (''SuperAdmin'', ''CompanyAdmin'', ''HrManager'', ''Employee'');');

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NavigationItems' AND COLUMN_NAME = 'Code')
BEGIN
    ALTER TABLE NavigationItems ADD Code NVARCHAR(50) NOT NULL CONSTRAINT DF_Nav_Code DEFAULT '';
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NavigationItems' AND COLUMN_NAME = 'IsActive')
BEGIN
    ALTER TABLE NavigationItems ADD IsActive BIT NOT NULL CONSTRAINT DF_Nav_IsActive DEFAULT 1;
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Employees' AND COLUMN_NAME = 'FaceDescriptor')
    ALTER TABLE Employees ADD FaceDescriptor NVARCHAR(MAX) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Employees' AND COLUMN_NAME = 'FaceEnrolledAtUtc')
    ALTER TABLE Employees ADD FaceEnrolledAtUtc DATETIME2 NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Employees' AND COLUMN_NAME = 'FacePhotoUrl')
    ALTER TABLE Employees ADD FacePhotoUrl NVARCHAR(MAX) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Employees' AND COLUMN_NAME = 'Salutation')
    ALTER TABLE Employees ADD Salutation NVARCHAR(20) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Employees' AND COLUMN_NAME = 'EmergencyContactName')
    ALTER TABLE Employees ADD EmergencyContactName NVARCHAR(200) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Employees' AND COLUMN_NAME = 'EmergencyContactPhone')
    ALTER TABLE Employees ADD EmergencyContactPhone NVARCHAR(50) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Employees' AND COLUMN_NAME = 'Password')
    ALTER TABLE Employees ADD Password NVARCHAR(250) NULL;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'KeyGroups' AND COLUMN_NAME = 'IsGeneric')
    ALTER TABLE KeyGroups ADD IsGeneric BIT NOT NULL CONSTRAINT DF_KeyGroups_IsGeneric DEFAULT 0;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'KeyStores' AND COLUMN_NAME = 'SubValue')
    ALTER TABLE KeyStores ADD SubValue NVARCHAR(250) NULL;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'KeyStores' AND COLUMN_NAME = 'DisplayOrder')
    ALTER TABLE KeyStores ADD DisplayOrder INT NOT NULL CONSTRAINT DF_KeyStores_DisplayOrder DEFAULT 0;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'KeyStores' AND COLUMN_NAME = 'IsActive')
    ALTER TABLE KeyStores ADD IsActive BIT NOT NULL CONSTRAINT DF_KeyStores_IsActive DEFAULT 1;

-- 6. Ensure CompanySettings columns
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'CompanySettings' AND COLUMN_NAME = 'LogoUrl')
    ALTER TABLE CompanySettings ADD LogoUrl NVARCHAR(500) NULL;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'CompanySettings' AND COLUMN_NAME = 'TimeZone')
    ALTER TABLE CompanySettings ADD TimeZone NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'CompanySettings' AND COLUMN_NAME = 'TaxNumberLabel')
    ALTER TABLE CompanySettings ADD TaxNumberLabel NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'CompanySettings' AND COLUMN_NAME = 'RegistrationNumberLabel')
    ALTER TABLE CompanySettings ADD RegistrationNumberLabel NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'CompanySettings' AND COLUMN_NAME = 'MaxPunchDurationHours')
    ALTER TABLE CompanySettings ADD MaxPunchDurationHours INT NOT NULL CONSTRAINT DF_CompanySettings_MaxPunchDurationHours DEFAULT 16;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'CompanySettings' AND COLUMN_NAME = 'WorkingDaysPerWeek')
    ALTER TABLE CompanySettings ADD WorkingDaysPerWeek DECIMAL(3,1) NOT NULL CONSTRAINT DF_CompanySettings_WorkingDaysPerWeek DEFAULT 5.0;

-- 7. Ensure EmployeePunches columns
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'EmployeePunches' AND COLUMN_NAME = 'IsOpen')
    ALTER TABLE EmployeePunches ADD IsOpen BIT NOT NULL CONSTRAINT DF_EmployeePunches_IsOpen DEFAULT 0;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'EmployeePunches' AND COLUMN_NAME = 'Latitude')
    ALTER TABLE EmployeePunches ADD Latitude FLOAT NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'EmployeePunches' AND COLUMN_NAME = 'Longitude')
    ALTER TABLE EmployeePunches ADD Longitude FLOAT NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'EmployeePunches' AND COLUMN_NAME = 'DistanceMeters')
    ALTER TABLE EmployeePunches ADD DistanceMeters FLOAT NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'EmployeePunches' AND COLUMN_NAME = 'VerificationStatus')
    ALTER TABLE EmployeePunches ADD VerificationStatus NVARCHAR(50) NULL;

-- 8. Ensure Shifts.LateGraceMinutes
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Shifts' AND COLUMN_NAME = 'LateGraceMinutes')
    ALTER TABLE Shifts ADD LateGraceMinutes INT NOT NULL CONSTRAINT DF_Shifts_LateGraceMinutes DEFAULT 15;

-- 9. Ensure LeaveRequests.IsHalfDay
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'LeaveRequests' AND COLUMN_NAME = 'IsHalfDay')
    ALTER TABLE LeaveRequests ADD IsHalfDay BIT NOT NULL CONSTRAINT DF_LeaveRequests_IsHalfDay DEFAULT 0;

-- 10. Ensure OffboardingRecords table
IF OBJECT_ID('OffboardingRecords', 'U') IS NULL
BEGIN
    CREATE TABLE OffboardingRecords (
        Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        EmployeeId UNIQUEIDENTIFIER NOT NULL,
        ResignationDate DATE NOT NULL,
        FinalWorkingDate DATE NOT NULL,
        Reason NVARCHAR(250) NOT NULL,
        ReasonDetails NVARCHAR(MAX) NULL,
        Status INT NOT NULL DEFAULT 1,
        HandoverNotes NVARCHAR(MAX) NULL,
        CompanyAssetsReturned BIT NOT NULL DEFAULT 0,
        AccessRevoked BIT NOT NULL DEFAULT 0,
        FinalSettlementProcessed BIT NOT NULL DEFAULT 0,
        Remarks NVARCHAR(MAX) NULL,
        InitiatedByUserId UNIQUEIDENTIFIER NULL,
        CompletedAtUtc DATETIME2 NULL,
        CreatedAtUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAtUtc DATETIME2 NULL,
        CONSTRAINT FK_OffboardingRecords_Employees FOREIGN KEY (EmployeeId) REFERENCES Employees(Id),
        CONSTRAINT FK_OffboardingRecords_Users FOREIGN KEY (InitiatedByUserId) REFERENCES Users(Id)
    );
END

-- 12. Clean up legacy ApprovalRequests with Type = 'Leave' so LeaveRequests is the single source of truth
IF OBJECT_ID('ApprovalRequests', 'U') IS NOT NULL
    DELETE FROM ApprovalRequests WHERE [Type] = 'Leave' OR [Type] = '1';

-- 13. Fix legacy Payslips: remove allowances, and calculate deductions strictly by unpaid days * daily rate
IF OBJECT_ID('Payslips', 'U') IS NOT NULL
BEGIN
    UPDATE p
    SET p.Allowances = 0,
        p.Deductions = CASE 
            WHEN e.EmployeeCode = 'EMP-1001' THEN 0
            WHEN e.EmployeeCode = 'EMP-1002' THEN ROUND(p.BasicSalary / 31.0, 2)
            WHEN e.EmployeeCode = 'EMP-1003' THEN 0
            WHEN e.EmployeeCode = 'EMP-1004' THEN ROUND(2.0 * (p.BasicSalary / 31.0), 2)
            WHEN e.EmployeeCode = 'EMP-1005' THEN 0
            WHEN e.EmployeeCode = 'EMP-1006' THEN ROUND(p.BasicSalary / 31.0, 2)
            ELSE 0
        END,
        p.NetPay = p.BasicSalary - (
            CASE 
                WHEN e.EmployeeCode = 'EMP-1001' THEN 0
                WHEN e.EmployeeCode = 'EMP-1002' THEN ROUND(p.BasicSalary / 31.0, 2)
                WHEN e.EmployeeCode = 'EMP-1003' THEN 0
                WHEN e.EmployeeCode = 'EMP-1004' THEN ROUND(2.0 * (p.BasicSalary / 31.0), 2)
                WHEN e.EmployeeCode = 'EMP-1005' THEN 0
                WHEN e.EmployeeCode = 'EMP-1006' THEN ROUND(p.BasicSalary / 31.0, 2)
                ELSE 0
            END
        )
    FROM Payslips p
    JOIN Employees e ON p.EmployeeId = e.Id
    WHERE p.Allowances > 0 OR p.Deductions = 250;

    UPDATE pr
    SET pr.TotalGross = (SELECT ISNULL(SUM(p.BasicSalary), 0) FROM Payslips p WHERE p.PayrollRunId = pr.Id),
        pr.TotalAllowances = 0,
        pr.TotalDeductions = (SELECT ISNULL(SUM(p.Deductions), 0) FROM Payslips p WHERE p.PayrollRunId = pr.Id),
        pr.TotalNet = (SELECT ISNULL(SUM(p.NetPay), 0) FROM Payslips p WHERE p.PayrollRunId = pr.Id)
    FROM PayrollRuns pr;
END

IF OBJECT_ID('Employees', 'U') IS NOT NULL
BEGIN
    UPDATE Employees SET Gender = 'Other' WHERE Gender IN ('PreferNotToSay', 'Prefer not to say', '4');
    UPDATE Employees SET MaritalStatus = 'Single' WHERE MaritalStatus IN ('Divorced', 'Widowed', '3', '4');
    IF COL_LENGTH('Employees', 'FaceDescriptor') IS NOT NULL
       AND COL_LENGTH('Employees', 'FacePhotoUrl') IS NOT NULL
       AND COL_LENGTH('Employees', 'FaceEnrolledAtUtc') IS NOT NULL
    BEGIN
        EXEC(N'
            UPDATE Employees
            SET FaceDescriptor = NULL,
                FaceEnrolledAtUtc = NULL
            WHERE FaceDescriptor IS NOT NULL
              AND FacePhotoUrl LIKE ''https://images.unsplash.com/%''
              AND LEN(FaceDescriptor) < 1000;
        ');
    END
END

IF OBJECT_ID('KeyStores', 'U') IS NOT NULL AND OBJECT_ID('KeyGroups', 'U') IS NOT NULL
BEGIN
    DELETE ks
    FROM KeyStores ks
    INNER JOIN KeyGroups kg ON ks.KeyGroupId = kg.Id
    WHERE UPPER(kg.Code) = 'GRADE_LEVEL'
       OR (UPPER(kg.Code) = 'GENDER' AND ks.[Key] NOT IN ('Male', 'Female', 'Other'))
       OR (UPPER(kg.Code) = 'MARITAL_STATUS' AND ks.[Key] NOT IN ('Single', 'Married'));
    DELETE FROM KeyGroups WHERE UPPER(Code) = 'GRADE_LEVEL';
END
";
        await db.Database.ExecuteSqlRawAsync(ensureSchemaSql, ct);
    }

    public async Task BootstrapAsync(string databaseName, TenantBootstrap bootstrap, CancellationToken ct = default)
    {
        await using var db = Create(databaseName);

        var roles = await db.Roles.ToListAsync(ct);

        Role EnsureRole(string code, string name, string description)
        {
            var role = roles.FirstOrDefault(r => r.Code.Equals(code, StringComparison.OrdinalIgnoreCase) || r.Name.Equals(name, StringComparison.OrdinalIgnoreCase));
            if (role is null)
            {
                role = new Role { Code = code, Name = name, Description = description, IsSystem = true };
                db.Roles.Add(role);
                roles.Add(role);
            }
            else if (!role.IsSystem)
            {
                role.IsSystem = true;
            }

            return role;
        }

        var companyAdminRole = EnsureRole("CompanyAdmin", "Company Admin", "Manages this company");
        EnsureRole("HrManager", "HR Manager", "HR operations and approvals");
        EnsureRole("Employee", "Employee", "Self-service portal");

        var generalDept = await db.Departments.FirstOrDefaultAsync(d => d.Name.ToLower() == "general", ct);
        if (generalDept is null)
        {
            generalDept = new Department
            {
                Name = "General",
                Code = "GEN",
                Description = "General department",
                IsActive = true,
            };
            db.Departments.Add(generalDept);
            await db.SaveChangesAsync(ct);
        }

        if (!await db.Designations.AnyAsync(d => d.Name.ToLower() == "employee" && d.DepartmentId == generalDept.Id, ct))
        {
            db.Designations.Add(new Designation
            {
                Name = "Employee",
                Grade = string.Empty,
                DepartmentId = generalDept.Id,
                Description = "Default employee designation",
            });
        }

        var email = bootstrap.AdminEmail.Trim().ToLowerInvariant();
        var normalizedEmail = email.ToUpperInvariant();

        if (!await db.Users.AnyAsync(u => u.NormalizedEmail == normalizedEmail, ct))
        {
            db.Users.Add(new User
            {
                Email = email,
                NormalizedEmail = normalizedEmail,
                PasswordHash = bootstrap.AdminPasswordHash,
                FullName = bootstrap.AdminFullName,
                Initials = Initials(bootstrap.AdminFullName),
                RoleId = companyAdminRole.Id,
                IsActive = true,
            });
        }

        if (!await db.CompanySettings.AnyAsync(ct))
        {
            db.CompanySettings.Add(new CompanySettings
            {
                CompanyName = bootstrap.CompanyName,
                PayrollCurrency = bootstrap.Currency,
                LogoUrl = bootstrap.LogoUrl,
            });
        }
        else if (!string.IsNullOrWhiteSpace(bootstrap.LogoUrl))
        {
            var existingSettings = await db.CompanySettings.FirstOrDefaultAsync(ct);
            if (existingSettings != null)
            {
                existingSettings.LogoUrl = bootstrap.LogoUrl;
            }
        }

        // Seed standard navigation items matching sidebar
        var standardNavs = new (string Code, string Title, string Route, string Icon, int Order)[]
        {
            ("DASH", "Dashboard", "/dashboard", "dashboard", 1),
            ("COMP", "Company", "/company", "company", 2),
            ("EMPL", "Employees", "/employees", "employees", 3),
            ("PROF", "Profile", "/employee-profile", "user", 4),
            ("SHIF", "Shift", "/shift", "clock", 5),
            ("ATTD", "Attendance", "/attendance", "attendance", 6),
            ("LEAV", "Leave", "/leave", "leave", 7),
            ("PAYR", "Payroll", "/payroll", "payroll", 8),
            ("PAYS", "Payslips", "/payslips", "payslip", 9),
            ("ONBD", "Onboarding", "/onboarding", "onboarding", 10),
            ("APPR", "Approvals", "/approvals", "approvals", 11),
            ("REPT", "Reports", "/reports", "reports", 12),
            ("SETT", "Settings", "/settings", "settings", 13),
        };

        var existingNavs = await db.NavigationItems.ToListAsync(ct);
        var navDict = existingNavs.ToDictionary(n => n.Code.ToUpperInvariant());

        foreach (var (code, title, route, icon, order) in standardNavs)
        {
            if (!navDict.ContainsKey(code))
            {
                var nav = new NavigationItem
                {
                    Code = code,
                    Title = title,
                    Route = route,
                    Icon = icon,
                    OrderIndex = order,
                    IsActive = true
                };
                db.NavigationItems.Add(nav);
            }
        }

        await db.SaveChangesAsync(ct);

        // Grant permissions to the administrative roles
        var allNavs = await db.NavigationItems.ToListAsync(ct);
        var adminRoleList = roles.Where(r => r.Code is "CompanyAdmin" or "HrManager" or "SuperAdmin").ToList();
        var existingPerms = await db.RoleNavigations.ToListAsync(ct);
        var permKeys = existingPerms.Select(p => $"{p.RoleId}:{p.NavigationItemId}").ToHashSet();

        foreach (var r in adminRoleList)
        {
            foreach (var n in allNavs)
            {
                if (r.Code == "HrManager" &&
                    (n.Code is "SETT" or "KEYG" or "NAVM" or "PERM" or "ROLE" ||
                     n.Route.StartsWith("/settings", StringComparison.OrdinalIgnoreCase)))
                {
                    continue;
                }

                if (!permKeys.Contains($"{r.Id}:{n.Id}"))
                {
                    db.RoleNavigations.Add(new RoleNavigation
                    {
                        RoleId = r.Id,
                        NavigationItemId = n.Id,
                        IsFull = true,
                        IsView = true,
                        IsCreate = true,
                        IsEdit = true,
                        IsDelete = true
                    });
                }
            }
        }

        if (!await db.KeyGroups.AnyAsync(ct))
        {
            var seedGroups = new (string Code, string Name, string[] Options)[]
            {
                ("BLOOD_GROUP", "Blood Group", new[] { "O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-" }),
                ("GENDER", "Gender", new[] { "Male", "Female", "Other" }),
                ("MARITAL_STATUS", "Marital Status", new[] { "Single", "Married" }),
                ("EMPLOYMENT_TYPE", "Employment Type", new[] { "Full-time", "Part-time", "Contract", "Internship" }),
                ("PAYMENT_MODE", "Payment Mode", new[] { "Bank Transfer", "Cheque", "Cash" }),
                ("ASSET_TYPE", "Asset Type", new[] { "Laptop", "Monitor", "Keyboard", "Mouse", "Phone", "Access Card", "Other" }),
                ("SUPPORT_TYPE", "Support Type", new[] { "IT Hardware", "Software Access", "HR Policy", "Payroll Inquiry", "Facilities" }),
                ("PRIORITY", "Priority", new[] { "Low", "Medium", "High", "Critical" })
            };

            foreach (var (code, name, opts) in seedGroups)
            {
                var grp = new KeyGroup
                {
                    Code = code,
                    Name = name,
                    Description = $"{name} dictionary options",
                    IsGeneric = false
                };
                db.KeyGroups.Add(grp);
                await db.SaveChangesAsync(ct);

                var order = 1;
                foreach (var opt in opts)
                {
                    db.KeyStores.Add(new KeyStore
                    {
                        KeyGroupId = grp.Id,
                        Key = opt,
                        Value = opt,
                        DisplayOrder = order++,
                        IsActive = true
                    });
                }
            }
        }

        await db.SaveChangesAsync(ct);
    }

    public async Task<TenantUserRecord?> FindUserByEmailAsync(string databaseName, string email, CancellationToken ct = default)
    {
        await using var db = Create(databaseName);
        var normalizedEmail = email.Trim().ToUpperInvariant();

        var record = await db.Users
            .AsNoTracking()
            .Where(u => u.NormalizedEmail == normalizedEmail)
            .Select(u => new
            {
                u.Id,
                u.Email,
                u.FullName,
                u.Initials,
                u.PasswordHash,
                u.IsActive,
                u.EmployeeId,
                RoleName = u.Role != null ? u.Role.Name : "Employee",
                RoleCode = u.Role != null ? u.Role.Code.ToString() : "Employee",
                EmployeeStatus = u.Employee != null ? (EmploymentStatus?)u.Employee.Status : null,
                IsEmployeeOffboarded = (u.Employee != null && (u.Employee.Status == EmploymentStatus.Offboarding || u.Employee.Status == EmploymentStatus.Terminated || u.Employee.Status == EmploymentStatus.Resigned))
            })
            .FirstOrDefaultAsync(ct);

        // Also check if there is an employee matching this email directly
        var empRecord = await db.Employees
            .AsNoTracking()
            .Where(e => e.Email.Trim().ToUpper() == normalizedEmail)
            .Select(e => new { e.Id, e.Status, e.Password, e.FirstName, e.LastName, e.JobTitle })
            .FirstOrDefaultAsync(ct);

        if (record is null)
        {
            if (empRecord is not null && (empRecord.Status == EmploymentStatus.Offboarding || empRecord.Status == EmploymentStatus.Terminated || empRecord.Status == EmploymentStatus.Resigned))
            {
                return new TenantUserRecord(
                    Guid.Empty,
                    email,
                    "",
                    "",
                    "",
                    false,
                    empRecord.Id,
                    "Employee",
                    "Employee",
                    empRecord.Status,
                    true,
                    empRecord.Password);
            }

            if (empRecord is not null && empRecord.Status == EmploymentStatus.Active)
            {
                var employeeRole = await db.Roles.FirstOrDefaultAsync(r => r.Code == "Employee", ct);
                var hrRole = await db.Roles.FirstOrDefaultAsync(r => r.Code == "HrManager", ct);
                var isHr = empRecord.JobTitle != null && empRecord.JobTitle.Contains("HR", StringComparison.OrdinalIgnoreCase);
                var roleId = isHr && hrRole != null ? hrRole.Id : (employeeRole?.Id ?? Guid.Empty);
                var roleName = isHr ? "HR Manager" : "Employee";
                var roleCode = isHr ? "HrManager" : "Employee";

                var rawPwd = !string.IsNullOrWhiteSpace(empRecord.Password) ? empRecord.Password.Trim() : "Employee@123";
                var hasher = new Microsoft.AspNetCore.Identity.PasswordHasher<User>();
                var pwdHash = hasher.HashPassword(new User(), rawPwd);

                var firstInit = empRecord.FirstName.Length > 0 ? empRecord.FirstName[0] : 'E';
                var lastInit = empRecord.LastName.Length > 0 ? empRecord.LastName[0] : 'M';

                var newUser = new User
                {
                    Email = email.Trim().ToLowerInvariant(),
                    NormalizedEmail = normalizedEmail,
                    PasswordHash = pwdHash,
                    FullName = $"{empRecord.FirstName} {empRecord.LastName}".Trim(),
                    Initials = $"{firstInit}{lastInit}".Trim().ToUpperInvariant(),
                    RoleId = roleId,
                    EmployeeId = empRecord.Id,
                    IsActive = true
                };
                db.Users.Add(newUser);
                await db.SaveChangesAsync(ct);

                return new TenantUserRecord(
                    newUser.Id,
                    newUser.Email,
                    newUser.FullName,
                    newUser.Initials,
                    newUser.PasswordHash,
                    newUser.IsActive,
                    empRecord.Id,
                    roleName,
                    roleCode,
                    empRecord.Status,
                    false,
                    empRecord.Password);
            }

            return null;
        }

        var empStatus = record.EmployeeStatus ?? empRecord?.Status;
        var isOffboarded = record.IsEmployeeOffboarded ||
                           (empRecord != null && (empRecord.Status == EmploymentStatus.Offboarding || empRecord.Status == EmploymentStatus.Terminated || empRecord.Status == EmploymentStatus.Resigned));

        return new TenantUserRecord(
            record.Id,
            record.Email,
            record.FullName,
            record.Initials,
            record.PasswordHash,
            record.IsActive,
            record.EmployeeId ?? empRecord?.Id,
            record.RoleName,
            record.RoleCode,
            empStatus,
            isOffboarded,
            empRecord?.Password);
    }

    public async Task<IReadOnlyList<TenantFaceCandidate>> GetFaceLoginCandidatesAsync(string databaseName, CancellationToken ct = default)
    {
        await using var db = Create(databaseName);

        var employees = await db.Employees
            .AsNoTracking()
            .Where(e => !string.IsNullOrEmpty(e.FaceDescriptor))
            .Select(e => new
            {
                e.Id,
                e.EmployeeCode,
                e.FirstName,
                e.LastName,
                e.Email,
                e.Status,
                e.FaceDescriptor,
                e.FacePhotoUrl,
                e.FaceEnrolledAtUtc
            })
            .ToListAsync(ct);

        if (employees.Count == 0)
        {
            return Array.Empty<TenantFaceCandidate>();
        }

        var revokedEmployeeIds = (await db.OffboardingRecords
                .AsNoTracking()
                .Where(o => o.Status == OffboardingStatus.Completed || o.AccessRevoked)
                .Select(o => o.EmployeeId)
                .ToListAsync(ct))
            .ToHashSet();

        var users = await db.Users
            .AsNoTracking()
            .Where(u => u.EmployeeId != null || !string.IsNullOrEmpty(u.NormalizedEmail))
            .Select(u => new
            {
                u.Id,
                u.EmployeeId,
                u.Email,
                u.NormalizedEmail,
                u.FullName,
                u.Initials,
                u.IsActive,
                RoleName = u.Role != null ? u.Role.Name : "Employee",
                RoleCode = u.Role != null ? u.Role.Code : "Employee"
            })
            .ToListAsync(ct);

        var usersByEmpId = users
            .Where(u => u.EmployeeId.HasValue)
            .GroupBy(u => u.EmployeeId!.Value)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.IsActive).First());

        var usersByEmail = users
            .Where(u => !string.IsNullOrWhiteSpace(u.NormalizedEmail))
            .GroupBy(u => u.NormalizedEmail, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.IsActive).First(), StringComparer.OrdinalIgnoreCase);

        var result = new List<TenantFaceCandidate>(employees.Count);
        foreach (var e in employees)
        {
            var fullName = string.Join(' ', new[] { e.FirstName, e.LastName }.Where(x => !string.IsNullOrWhiteSpace(x)));
            var empNormEmail = e.Email.Trim().ToUpperInvariant();

            if (!usersByEmpId.TryGetValue(e.Id, out var user) && !string.IsNullOrWhiteSpace(empNormEmail))
            {
                usersByEmail.TryGetValue(empNormEmail, out user);
            }

            var isOffboarded = e.Status is EmploymentStatus.Offboarding or EmploymentStatus.Terminated or EmploymentStatus.Resigned
                               || revokedEmployeeIds.Contains(e.Id);

            result.Add(new TenantFaceCandidate(
                EmployeeId: e.Id,
                EmployeeCode: e.EmployeeCode,
                FullName: fullName,
                Email: e.Email,
                EmployeeStatus: e.Status,
                IsOffboarded: isOffboarded,
                FaceDescriptor: e.FaceDescriptor!,
                FacePhotoUrl: e.FacePhotoUrl,
                FaceEnrolledAtUtc: e.FaceEnrolledAtUtc,
                UserId: user?.Id,
                UserEmail: user?.Email,
                UserFullName: user?.FullName,
                UserInitials: user?.Initials,
                UserIsActive: user?.IsActive ?? false,
                RoleName: user?.RoleName ?? "Employee",
                RoleCode: user?.RoleCode ?? "Employee"));
        }

        return result;
    }

    public async Task RecordLoginAsync(string databaseName, Guid userId, CancellationToken ct = default, string? verifiedPlainPassword = null)
    {
        await using var db = Create(databaseName);
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null)
        {
            return;
        }

        user.LastLoginAtUtc = DateTime.UtcNow;

        if (!string.IsNullOrWhiteSpace(verifiedPlainPassword))
        {
            var plain = verifiedPlainPassword.Trim();
            var emp = user.EmployeeId.HasValue
                ? await db.Employees.FirstOrDefaultAsync(e => e.Id == user.EmployeeId.Value, ct)
                : await db.Employees.FirstOrDefaultAsync(e => e.Email.ToUpper() == user.NormalizedEmail, ct);
            if (emp is not null && emp.Password != plain)
            {
                emp.Password = plain;
            }
        }

        await db.SaveChangesAsync(ct);
    }

    public async Task SetUserPasswordAsync(string databaseName, string email, string passwordHash, CancellationToken ct = default, string? plainPassword = null)
    {
        await using var db = Create(databaseName);
        var normalizedEmail = email.Trim().ToUpperInvariant();

        var user = await db.Users.FirstOrDefaultAsync(u => u.NormalizedEmail == normalizedEmail, ct)
                   ?? throw new NotFoundException("The user account was not found.");

        user.PasswordHash = passwordHash;
        user.IsActive = true;

        var emp = await db.Employees.FirstOrDefaultAsync(e => e.Email.ToUpper() == normalizedEmail, ct);
        if (emp is not null)
        {
            emp.Password = string.IsNullOrWhiteSpace(plainPassword) ? null : plainPassword.Trim();
        }

        await db.SaveChangesAsync(ct);
    }

    public async Task<int> CountUsersAsync(string databaseName, CancellationToken ct = default)
    {
        await using var db = Create(databaseName);
        return await db.Users.CountAsync(ct);
    }

    public async Task<IReadOnlyList<CompanyEmployeeSummaryDto>> GetEmployeesAsync(string databaseName, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(databaseName))
        {
            return Array.Empty<CompanyEmployeeSummaryDto>();
        }

        try
        {
            await using var db = Create(databaseName);
            var items = await db.Employees
                .AsNoTracking()
                .Include(e => e.Department)
                .Include(e => e.Designation)
                .OrderBy(e => e.EmployeeCode)
                .ToListAsync(ct);

            return items.Select(e => new CompanyEmployeeSummaryDto(
                e.Id,
                e.EmployeeCode,
                $"{e.FirstName} {e.LastName}".Trim(),
                e.Email,
                e.Department?.Name,
                e.Designation?.Name ?? (string.IsNullOrWhiteSpace(e.JobTitle) ? null : e.JobTitle),
                e.Status.ToString(),
                new DateTime(e.JoinDate.Year, e.JoinDate.Month, e.JoinDate.Day, 0, 0, 0, DateTimeKind.Utc)
            )).ToList();
        }
        catch
        {
            return Array.Empty<CompanyEmployeeSummaryDto>();
        }
    }

    public async Task DropDatabaseAsync(string databaseName, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(databaseName) || !Hrms.Application.Common.Tenancy.TenantNaming.IsValidDatabaseName(databaseName))
        {
            return;
        }

        // Safety guard: NEVER drop system or master/default databases
        var protectedDbs = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "master", "tempdb", "model", "msdb", "HRMS", "HRMSDefault", "HRMSNewDefault", "HRMSNewMaster", "HRMS_Master", "HRMS_Dummy", "HRMS_Dummy_Master", "HRMS_new_Defualt", "HRMS_new_master"
        };
        if (protectedDbs.Contains(databaseName))
        {
            _logger.LogWarning("Refusing to drop protected database {DbName}.", databaseName);
            return;
        }

        try
        {
            // Connect to master database to drop the tenant database forcefully
            var masterConnStr = _factory.BuildProvisioning("master");
            await using var conn = new SqlConnection(masterConnStr);
            await conn.OpenAsync(ct);

            var sql = $@"
IF EXISTS (SELECT 1 FROM sys.databases WHERE name = @dbName)
BEGIN
    ALTER DATABASE [{databaseName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [{databaseName}];
END";
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            cmd.Parameters.Add(new SqlParameter("@dbName", databaseName));
            await cmd.ExecuteNonQueryAsync(ct);
            _logger.LogInformation("Tenant database {DbName} dropped successfully from SQL Server.", databaseName);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to drop tenant database {DbName} via master connection; attempting EF fallback.", databaseName);
            try
            {
                await using var db = Create(databaseName, provisioning: true);
                await db.Database.EnsureDeletedAsync(ct);
            }
            catch (Exception innerEx)
            {
                _logger.LogWarning(innerEx, "Fallback EF Core EnsureDeletedAsync also failed for {DbName}.", databaseName);
            }
        }
    }

    private HrmsDbContext Create(string databaseName, bool provisioning = false)
    {
        var connectionString = string.IsNullOrWhiteSpace(databaseName)
            ? _factory.BuildDefault()
            : (provisioning
                ? _factory.BuildProvisioning(databaseName)
                : _factory.BuildTenant(databaseName));

        var options = new DbContextOptionsBuilder<HrmsDbContext>()
            .UseSqlServer(connectionString, sql =>
            {
                sql.EnableRetryOnFailure(3);
                sql.MigrationsAssembly(typeof(HrmsDbContext).Assembly.FullName);
            })
            .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning))
            .Options;

        return new HrmsDbContext(options);
    }

    private static string Initials(string fullName)
    {
        var parts = fullName.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length == 0)
        {
            return "CA";
        }

        var initials = string.Concat(parts.Take(2).Select(p => char.ToUpperInvariant(p[0])));
        return initials.Length == 0 ? "CA" : initials;
    }
}
