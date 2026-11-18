using Hrms.Application.Abstractions.Tenancy;
using Hrms.Application.Common;
using Hrms.Application.DTOs;
using Hrms.Domain.Entities;
using Hrms.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace Hrms.Infrastructure.Persistence.Tenancy;

/// <summary>
/// Performs the EF Core work needed to create and initialize a tenant database. Each call
/// opens a short-lived <see cref="HrmsDbContext"/> bound to the tenant connection string,
/// so provisioning never depends on the ambient request tenant.
/// </summary>
public sealed class TenantDatabaseService : ITenantDatabaseService
{
    private readonly ITenantConnectionFactory _factory;

    public TenantDatabaseService(ITenantConnectionFactory factory)
    {
        _factory = factory;
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

EXEC(N'UPDATE Roles SET IsSystem = 1 WHERE Name IN (''Super Admin'', ''Company Admin'', ''HR Manager'', ''Manager'', ''Employee'') 
   OR Code IN (''SuperAdmin'', ''CompanyAdmin'', ''HrManager'', ''Manager'', ''Employee'');');

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

-- 7. Ensure EmployeePunches.IsOpen
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'EmployeePunches' AND COLUMN_NAME = 'IsOpen')
    ALTER TABLE EmployeePunches ADD IsOpen BIT NOT NULL CONSTRAINT DF_EmployeePunches_IsOpen DEFAULT 0;

-- 8. Ensure Shifts.LateGraceMinutes
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Shifts' AND COLUMN_NAME = 'LateGraceMinutes')
    ALTER TABLE Shifts ADD LateGraceMinutes INT NOT NULL CONSTRAINT DF_Shifts_LateGraceMinutes DEFAULT 15;

-- 9. Ensure LeaveRequests.IsHalfDay
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'LeaveRequests' AND COLUMN_NAME = 'IsHalfDay')
    ALTER TABLE LeaveRequests ADD IsHalfDay BIT NOT NULL CONSTRAINT DF_LeaveRequests_IsHalfDay DEFAULT 0;
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
        EnsureRole("Manager", "Manager", "Team management, reviews and shift approvals");
        EnsureRole("Employee", "Employee", "Self-service portal");

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
            });
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
            ("DOCS", "Documents", "/documents", "documents", 11),
            ("APPR", "Approvals", "/approvals", "approvals", 12),
            ("REPT", "Reports", "/reports", "reports", 13),
            ("SETT", "Settings", "/settings", "settings", 14),
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
            })
            .FirstOrDefaultAsync(ct);

        return record is null
            ? null
            : new TenantUserRecord(
                record.Id,
                record.Email,
                record.FullName,
                record.Initials,
                record.PasswordHash,
                record.IsActive,
                record.EmployeeId,
                record.RoleName,
                record.RoleCode);
    }

    public async Task RecordLoginAsync(string databaseName, Guid userId, CancellationToken ct = default)
    {
        await using var db = Create(databaseName);
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null)
        {
            return;
        }

        user.LastLoginAtUtc = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
    }

    public async Task SetUserPasswordAsync(string databaseName, string email, string passwordHash, CancellationToken ct = default)
    {
        await using var db = Create(databaseName);
        var normalizedEmail = email.Trim().ToUpperInvariant();

        var user = await db.Users.FirstOrDefaultAsync(u => u.NormalizedEmail == normalizedEmail, ct)
                   ?? throw new NotFoundException("The company administrator account was not found.");

        user.PasswordHash = passwordHash;
        user.IsActive = true;
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
                .Select(e => new
                {
                    e.Id,
                    e.EmployeeCode,
                    FullName = (e.FirstName + " " + e.LastName).Trim(),
                    e.Email,
                    Department = e.Department != null ? e.Department.Name : null,
                    Designation = e.Designation != null ? e.Designation.Name : (!string.IsNullOrEmpty(e.JobTitle) ? e.JobTitle : null),
                    Status = e.Status.ToString(),
                    e.JoinDate
                })
                .ToListAsync(ct);

            return items.Select(e => new CompanyEmployeeSummaryDto(
                e.Id,
                e.EmployeeCode,
                e.FullName,
                e.Email,
                e.Department,
                e.Designation,
                e.Status,
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
        if (string.IsNullOrWhiteSpace(databaseName))
        {
            return;
        }

        await using var db = Create(databaseName, provisioning: true);
        await db.Database.EnsureDeletedAsync(ct);
    }

    private HrmsDbContext Create(string databaseName, bool provisioning = false)
    {
        var connectionString = provisioning
            ? _factory.BuildProvisioning(databaseName)
            : _factory.BuildTenant(databaseName);

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
