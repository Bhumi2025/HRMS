using Hrms.Application.Abstractions.Persistence;
using Hrms.Application.Abstractions.Security;
using Hrms.Application.Abstractions.Services;
using Hrms.Application.Abstractions.Tenancy;
using Hrms.Domain.Entities;
using Hrms.Domain.Enums;
using Hrms.Infrastructure.Persistence;
using Hrms.Infrastructure.Persistence.Master;
using Hrms.Infrastructure.Seed;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Hrms.Api.Startup;

/// <summary>
/// Prepares the databases at startup: migrates the master registry, registers the default
/// company (backed by the primary connection string), brings the default tenant and all
/// registered tenant databases up to date using migrations + schema synchronization.
/// </summary>
public static class DatabaseBootstrap
{
    private const string DefaultCompanyCode = "HRNEXUS";

    public const string EnsureSchemaSql = @"
-- 1. Ensure Roles.IsSystem column exists
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Roles' AND COLUMN_NAME = 'IsSystem')
BEGIN
    ALTER TABLE Roles ADD IsSystem BIT NOT NULL CONSTRAINT DF_Roles_IsSystem DEFAULT 0;
END

-- 2. Ensure existing static system roles have IsSystem = 1
EXEC(N'UPDATE Roles SET IsSystem = 1 WHERE Name IN (''Super Admin'', ''Company Admin'', ''HR Manager'', ''Employee'') 
   OR Code IN (''SuperAdmin'', ''CompanyAdmin'', ''HrManager'', ''Employee'');');

-- 3. Ensure NavigationItems.Code and NavigationItems.IsActive exist
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NavigationItems' AND COLUMN_NAME = 'Code')
BEGIN
    ALTER TABLE NavigationItems ADD Code NVARCHAR(50) NOT NULL CONSTRAINT DF_Nav_Code DEFAULT '';
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NavigationItems' AND COLUMN_NAME = 'IsActive')
BEGIN
    ALTER TABLE NavigationItems ADD IsActive BIT NOT NULL CONSTRAINT DF_Nav_IsActive DEFAULT 1;
END

-- 4. Ensure Employee face columns
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
    ALTER TABLE Employees ADD Password NVARCHAR(256) NULL;

-- 5. Ensure KeyGroups.IsGeneric and KeyStores.SubValue / DisplayOrder / IsActive
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'KeyGroups' AND COLUMN_NAME = 'IsGeneric')
    ALTER TABLE KeyGroups ADD IsGeneric BIT NOT NULL CONSTRAINT DF_KeyGroups_IsGeneric DEFAULT 0;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'KeyStores' AND COLUMN_NAME = 'SubValue')
    ALTER TABLE KeyStores ADD SubValue NVARCHAR(250) NULL;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'KeyStores' AND COLUMN_NAME = 'DisplayOrder')
    ALTER TABLE KeyStores ADD DisplayOrder INT NOT NULL CONSTRAINT DF_KeyStores_DisplayOrder DEFAULT 0;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'KeyStores' AND COLUMN_NAME = 'IsActive')
    ALTER TABLE KeyStores ADD IsActive BIT NOT NULL CONSTRAINT DF_KeyStores_IsActive DEFAULT 1;

-- 6. Ensure CompanySettings LogoUrl, TimeZone, TaxNumberLabel, RegistrationNumberLabel
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'CompanySettings' AND COLUMN_NAME = 'LogoUrl')
    ALTER TABLE CompanySettings ADD LogoUrl NVARCHAR(500) NULL;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'CompanySettings' AND COLUMN_NAME = 'TimeZone')
    ALTER TABLE CompanySettings ADD TimeZone NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'CompanySettings' AND COLUMN_NAME = 'TaxNumberLabel')
    ALTER TABLE CompanySettings ADD TaxNumberLabel NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'CompanySettings' AND COLUMN_NAME = 'RegistrationNumberLabel')
    ALTER TABLE CompanySettings ADD RegistrationNumberLabel NVARCHAR(100) NULL;

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

-- 10. Ensure CompanySettings.MaxPunchDurationHours & WorkingDaysPerWeek
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'CompanySettings' AND COLUMN_NAME = 'MaxPunchDurationHours')
    ALTER TABLE CompanySettings ADD MaxPunchDurationHours INT NOT NULL CONSTRAINT DF_CompanySettings_MaxPunchDurationHours DEFAULT 16;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'CompanySettings' AND COLUMN_NAME = 'WorkingDaysPerWeek')
    ALTER TABLE CompanySettings ADD WorkingDaysPerWeek DECIMAL(3,1) NOT NULL CONSTRAINT DF_CompanySettings_WorkingDaysPerWeek DEFAULT 5.0;

-- 10b. Ensure PayrollRuns and Payslips have ReductionPercent
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'PayrollRuns' AND COLUMN_NAME = 'ReductionPercent')
    ALTER TABLE PayrollRuns ADD ReductionPercent DECIMAL(5,2) NOT NULL CONSTRAINT DF_PayrollRuns_ReductionPercent DEFAULT 0;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Payslips' AND COLUMN_NAME = 'ReductionPercent')
    ALTER TABLE Payslips ADD ReductionPercent DECIMAL(5,2) NOT NULL CONSTRAINT DF_Payslips_ReductionPercent DEFAULT 0;

-- 10c. Ensure OffboardingRecords table
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

-- 11. Remove legacy ShiftAssignments table (Shift Roster Matrix removed)
IF OBJECT_ID('ShiftAssignments', 'U') IS NOT NULL
    DROP TABLE ShiftAssignments;

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

-- 14. Ensure default currency is INR for CompanySettings and Employees
IF OBJECT_ID('CompanySettings', 'U') IS NOT NULL
BEGIN
    UPDATE CompanySettings 
    SET PayrollCurrency = 'INR' 
    WHERE PayrollCurrency IS NULL OR PayrollCurrency = '' OR PayrollCurrency = 'USD' OR PayrollCurrency = 'AED';
END
IF OBJECT_ID('Employees', 'U') IS NOT NULL
BEGIN
    UPDATE Employees 
    SET Currency = 'INR' 
    WHERE Currency IS NULL OR Currency = '' OR Currency = 'USD' OR Currency = 'AED';

    UPDATE Employees
    SET Gender = 'Other'
    WHERE Gender IN ('PreferNotToSay', 'Prefer not to say', '4');

    UPDATE Employees
    SET MaritalStatus = 'Single'
    WHERE MaritalStatus IN ('Divorced', 'Widowed', '3', '4');
END

-- 15. Clean up obsolete Grade/Level key group and restricted Gender/MaritalStatus options
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

    public static async Task InitializeAsync(IServiceProvider services, IConfiguration configuration, CancellationToken ct = default)
    {
        using var scope = services.CreateScope();
        var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("DatabaseBootstrap");
        var master = scope.ServiceProvider.GetRequiredService<HrmsMasterDbContext>();
        var tenant = scope.ServiceProvider.GetRequiredService<HrmsDbContext>();
        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher>();
        var masterUow = scope.ServiceProvider.GetRequiredService<IMasterUnitOfWork>();
        var navService = scope.ServiceProvider.GetRequiredService<INavigationService>();
        var optionsService = scope.ServiceProvider.GetRequiredService<IOptionsService>();
        var tenantConnFactory = scope.ServiceProvider.GetRequiredService<ITenantConnectionFactory>();
        var env = scope.ServiceProvider.GetService<Microsoft.Extensions.Hosting.IHostEnvironment>();
        var isProduction = env?.IsProduction() ?? false;

        // 1. Migrate Master Database & Ensure Schema
        await master.Database.MigrateAsync(ct);
        await master.Database.ExecuteSqlRawAsync(@"
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Companies' AND COLUMN_NAME = 'LogoUrl')
    ALTER TABLE Companies ADD LogoUrl NVARCHAR(500) NULL;
", ct);

        // 2. Ensure default company is registered
        await EnsureDefaultCompanyAsync(masterUow, configuration, logger, ct);

        // 3. Migrate and seed default tenant
        var defaultDbName = tenant.Database.GetDbConnection().Database;
        await tenant.Database.MigrateAsync(ct);
        await tenant.Database.ExecuteSqlRawAsync(EnsureSchemaSql, ct);
        await RunOneTimeKeyGroupCleanupMigrationAsync(tenant, DefaultCompanyCode, defaultDbName, logger, ct);
        await EnsureDefaultKeyGroupsBackfilledAsync(tenant, DefaultCompanyCode, defaultDbName, logger, ct);
        await RunPunchAndTenantSettingsMigrationAsync(tenant, DefaultCompanyCode, defaultDbName, configuration, logger, ct);
        await DbSeeder.SeedAsync(tenant, hasher, isProduction, ct);
        await EnsureDefaultGeneralDepartmentAndDesignationAsync(tenant, logger, ct);
        await EnsureShiftTemplatesSeededAsync(tenant, logger, ct);
        await EnsureHolidayTemplatesSeededAsync(tenant, logger, ct);
        await EnsureNavigationItemsSeededAsync(tenant, logger, ct);
        await EnsureDefaultSystemUsersAsync(tenant, hasher, logger, ct);
        await EnsureEmployeeUsersSynchronizedAsync(tenant, hasher, logger, ct);

        // In production, ensure initial SuperAdmin user if configured via environment
        if (isProduction)
        {
            await EnsureProductionSuperAdminAsync(tenant, hasher, configuration, logger, ct);
        }

        // Ensure default navigation items and permissions are populated
        try
        {
            await navService.GetNavigationTreeAsync(ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to initialize default navigation items on default tenant.");
        }

        // Ensure default key group options are populated on default tenant
        try
        {
            await optionsService.GetKeyGroupsAsync(ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to initialize default key groups on default tenant.");
        }

        // 4. Migrate and update schema for all other existing tenant databases
        var companies = await masterUow.Companies.ListAsync(null, ct);
        foreach (var company in companies)
        {
            if (!string.IsNullOrWhiteSpace(company.DatabaseName) &&
                !company.DatabaseName.Equals(defaultDbName, StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    var options = new DbContextOptionsBuilder<HrmsDbContext>()
                        .UseSqlServer(tenantConnFactory.BuildProvisioning(company.DatabaseName), sql =>
                        {
                            sql.EnableRetryOnFailure(3);
                            sql.MigrationsAssembly(typeof(HrmsDbContext).Assembly.FullName);
                        })
                        .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning))
                        .Options;

                    await using var tenantDb = new HrmsDbContext(options);
                    if (await tenantDb.Database.CanConnectAsync(ct))
                    {
                        await tenantDb.Database.MigrateAsync(ct);
                        await tenantDb.Database.ExecuteSqlRawAsync(EnsureSchemaSql, ct);
                        await RunOneTimeKeyGroupCleanupMigrationAsync(tenantDb, company.Code, company.DatabaseName, logger, ct);
                        await EnsureDefaultKeyGroupsBackfilledAsync(tenantDb, company.Code, company.DatabaseName, logger, ct);
                        await RunPunchAndTenantSettingsMigrationAsync(tenantDb, company.Code, company.DatabaseName, configuration, logger, ct);
                        await EnsureDefaultGeneralDepartmentAndDesignationAsync(tenantDb, logger, ct);
                        await EnsureShiftTemplatesSeededAsync(tenantDb, logger, ct);
                        await EnsureHolidayTemplatesSeededAsync(tenantDb, logger, ct);
                        await EnsureNavigationItemsSeededAsync(tenantDb, logger, ct);
                        await EnsureDefaultSystemUsersAsync(tenantDb, hasher, logger, ct);
                        await EnsureEmployeeUsersSynchronizedAsync(tenantDb, hasher, logger, ct);
                        logger.LogInformation("Successfully updated schema on existing tenant database '{DatabaseName}'", company.DatabaseName);
                    }
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Could not update schema for tenant '{CompanyCode}' ({DatabaseName})", company.Code, company.DatabaseName);
                }
            }
        }

        logger.LogInformation(
            "Databases ready. Seeded logins: {SuperAdmin}, {HrManager}, {Employee}",
            DbSeeder.SuperAdminEmail, DbSeeder.HrManagerEmail, DbSeeder.EmployeeEmail);
    }

    private static async Task EnsureDefaultCompanyAsync(
        IMasterUnitOfWork master,
        IConfiguration configuration,
        ILogger logger,
        CancellationToken ct)
    {
        if (await master.Companies.GetDefaultAsync(ct) is not null)
        {
            return;
        }

        var connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("Connection string 'DefaultConnection' is not configured.");
        var databaseName = new SqlConnectionStringBuilder(connectionString).InitialCatalog;

        var company = await master.Companies.GetByCodeAsync(DefaultCompanyCode, ct);
        if (company is null)
        {
            company = new Company
            {
                Name = "HRNexus Corp",
                Code = DefaultCompanyCode,
                DatabaseName = databaseName,
                IsDefault = true,
                AdminFullName = "Alex Johnson",
                AdminEmail = DbSeeder.SuperAdminEmail,
                Status = CompanyStatus.Active,
                ProvisionedAtUtc = DateTime.UtcNow,
            };
            await master.Companies.AddAsync(company, ct);
        }
        else
        {
            company.IsDefault = true;
            company.DatabaseName ??= databaseName;
            master.Companies.Update(company);
        }

        await master.SaveChangesAsync(ct);

        var defaultInvitation = await master.Invitations.GetLatestForCompanyAsync(company.Id, ct);
        if (defaultInvitation is null)
        {
            var inv = new CompanyInvitation
            {
                CompanyId = company.Id,
                Email = company.AdminEmail,
                Status = InvitationStatus.Sent,
                TokenHash = Hrms.Application.Common.Tenancy.TenantNaming.HashToken(Hrms.Application.Common.Tenancy.TenantNaming.CreateToken()),
                ExpiresAtUtc = DateTime.UtcNow.AddYears(1),
                SentAtUtc = DateTime.UtcNow,
            };
            await master.Invitations.AddAsync(inv, ct);
            await master.SaveChangesAsync(ct);
        }

        logger.LogInformation("Registered default company '{Code}' backed by database {Database}.", DefaultCompanyCode, databaseName);
    }

    private static async Task RunOneTimeKeyGroupCleanupMigrationAsync(
        HrmsDbContext db,
        string companyCode,
        string databaseName,
        ILogger logger,
        CancellationToken ct)
    {
        const string migrationId = "20261023_PurgeObsoleteRelationalKeyGroups";

        try
        {
            const string ensureTrackerSql = @"
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'AppMigrations')
BEGIN
    CREATE TABLE AppMigrations (
        MigrationId NVARCHAR(100) NOT NULL PRIMARY KEY,
        AppliedAtUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END";
            await db.Database.ExecuteSqlRawAsync(ensureTrackerSql, ct);

            var conn = db.Database.GetDbConnection();
            if (conn.State != System.Data.ConnectionState.Open)
            {
                await conn.OpenAsync(ct);
            }

            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = "SELECT COUNT(1) FROM AppMigrations WHERE MigrationId = @id";
                var param = cmd.CreateParameter();
                param.ParameterName = "@id";
                param.Value = migrationId;
                cmd.Parameters.Add(param);
                var exists = Convert.ToInt32(await cmd.ExecuteScalarAsync(ct) ?? 0);
                if (exists > 0)
                {
                    return; // Already executed on this tenant database
                }
            }

            int removedStores = 0;
            int removedGroups = 0;

            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = @"
SELECT 
    COUNT(s.Id) AS StoreCount,
    COUNT(DISTINCT g.Id) AS GroupCount
FROM KeyGroups g
LEFT JOIN KeyStores s ON s.KeyGroupId = g.Id
WHERE UPPER(g.Code) IN ('DEPARTMENT', 'SHIFT', 'DESIGNATION')";
                using var reader = await cmd.ExecuteReaderAsync(ct);
                if (await reader.ReadAsync(ct))
                {
                    removedStores = reader.IsDBNull(0) ? 0 : reader.GetInt32(0);
                    removedGroups = reader.IsDBNull(1) ? 0 : reader.GetInt32(1);
                }
            }

            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = @"
DELETE s
FROM KeyStores s
INNER JOIN KeyGroups g ON s.KeyGroupId = g.Id
WHERE UPPER(g.Code) IN ('DEPARTMENT', 'SHIFT', 'DESIGNATION');

DELETE FROM KeyGroups
WHERE UPPER(Code) IN ('DEPARTMENT', 'SHIFT', 'DESIGNATION');

INSERT INTO AppMigrations (MigrationId, AppliedAtUtc)
VALUES (@id, SYSUTCDATETIME());";
                var param = cmd.CreateParameter();
                param.ParameterName = "@id";
                param.Value = migrationId;
                cmd.Parameters.Add(param);
                await cmd.ExecuteNonQueryAsync(ct);
            }

            logger.LogInformation(
                "One-time migration [{MigrationId}] completed for tenant '{CompanyCode}' ({DatabaseName}): purged {StoreCount} obsolete KeyStore rows and {GroupCount} KeyGroup rows.",
                migrationId, companyCode, databaseName, removedStores, removedGroups);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to complete one-time key group cleanup migration for tenant '{CompanyCode}' ({DatabaseName})", companyCode, databaseName);
        }
    }

    private static async Task EnsureDefaultKeyGroupsBackfilledAsync(
        HrmsDbContext db,
        string companyCode,
        string databaseName,
        ILogger logger,
        CancellationToken ct)
    {
        const string migrationId = "20261127_BackfillDefaultKeyGroups";

        try
        {
            const string ensureTrackerSql = @"
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'AppMigrations')
BEGIN
    CREATE TABLE AppMigrations (
        MigrationId NVARCHAR(100) NOT NULL PRIMARY KEY,
        AppliedAtUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END";
            await db.Database.ExecuteSqlRawAsync(ensureTrackerSql, ct);

            var conn = db.Database.GetDbConnection();
            if (conn.State != System.Data.ConnectionState.Open)
            {
                await conn.OpenAsync(ct);
            }

            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = "SELECT COUNT(1) FROM AppMigrations WHERE MigrationId = @id";
                var param = cmd.CreateParameter();
                param.ParameterName = "@id";
                param.Value = migrationId;
                cmd.Parameters.Add(param);
                var exists = Convert.ToInt32(await cmd.ExecuteScalarAsync(ct) ?? 0);
                if (exists > 0)
                {
                    return;
                }
            }

            await db.Database.ExecuteSqlRawAsync("IF OBJECT_ID('KeyGroups', 'U') IS NOT NULL UPDATE KeyGroups SET IsGeneric = 0;", ct);

            var defaultGroups = new (string Code, string Name, string[] Options)[]
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

            foreach (var (code, name, options) in defaultGroups)
            {
                var grp = await db.KeyGroups.FirstOrDefaultAsync(g => g.Code.ToUpper() == code, ct);
                if (grp is null)
                {
                    grp = new KeyGroup
                    {
                        Code = code,
                        Name = name,
                        Description = $"{name} dictionary options",
                        IsGeneric = false
                    };
                    db.KeyGroups.Add(grp);
                    await db.SaveChangesAsync(ct);
                }

                var existingStores = await db.KeyStores.Where(s => s.KeyGroupId == grp.Id).ToListAsync(ct);
                var existingKeys = existingStores.Select(s => s.Key.Trim().ToUpperInvariant()).ToHashSet();
                var order = existingStores.Count > 0 ? existingStores.Max(s => s.DisplayOrder) + 1 : 1;

                foreach (var opt in options)
                {
                    if (!existingKeys.Contains(opt.ToUpperInvariant()))
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

            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = "INSERT INTO AppMigrations (MigrationId, AppliedAtUtc) VALUES (@id, SYSUTCDATETIME());";
                var param = cmd.CreateParameter();
                param.ParameterName = "@id";
                param.Value = migrationId;
                cmd.Parameters.Add(param);
                await cmd.ExecuteNonQueryAsync(ct);
            }

            logger.LogInformation(
                "One-time migration [{MigrationId}] completed for tenant '{CompanyCode}' ({DatabaseName}).",
                migrationId, companyCode, databaseName);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to backfill default key groups for tenant '{CompanyCode}' ({DatabaseName})", companyCode, databaseName);
        }
    }

    private static async Task RunPunchAndTenantSettingsMigrationAsync(
        HrmsDbContext db,
        string companyCode,
        string databaseName,
        IConfiguration configuration,
        ILogger logger,
        CancellationToken ct)
    {
        try
        {
            var conn = db.Database.GetDbConnection();
            if (conn.State != System.Data.ConnectionState.Open)
            {
                await conn.OpenAsync(ct);
            }

            // 1. Timezone: verify and set from configurable default if provided, otherwise leave unconfigured
            var defaultTz = configuration["Company:DefaultTimeZone"] ?? configuration["DefaultTimeZone"];
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = "SELECT COUNT(1) FROM CompanySettings WHERE TimeZone IS NULL OR LTRIM(RTRIM(TimeZone)) = ''";
                var missingCount = Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
                if (missingCount > 0)
                {
                    if (!string.IsNullOrWhiteSpace(defaultTz))
                    {
                        logger.LogInformation(
                            "Tenant '{CompanyCode}' ({DatabaseName}) has {Count} CompanySettings row(s) with no TimeZone configured. Initializing to configured default '{DefaultTimeZone}'.",
                            companyCode, databaseName, missingCount, defaultTz);

                        using var updateCmd = conn.CreateCommand();
                        updateCmd.CommandText = "UPDATE CompanySettings SET TimeZone = @tz WHERE TimeZone IS NULL OR LTRIM(RTRIM(TimeZone)) = ''";
                        var param = updateCmd.CreateParameter();
                        param.ParameterName = "@tz";
                        param.Value = defaultTz;
                        updateCmd.Parameters.Add(param);
                        await updateCmd.ExecuteNonQueryAsync(ct);
                    }
                    else
                    {
                        logger.LogWarning(
                            "Tenant '{CompanyCode}' ({DatabaseName}) has {Count} CompanySettings row(s) with no TimeZone configured. Time zone must be configured before punches can be recorded.",
                            companyCode, databaseName, missingCount);
                    }
                }
            }

            // 2. Punch IsOpen Backfill & Filtered Unique Index Migration
            using (var checkIndexCmd = conn.CreateCommand())
            {
                checkIndexCmd.CommandText = "SELECT COUNT(1) FROM sys.indexes WHERE name = 'IX_EmployeePunches_EmployeeId_IsOpen' AND object_id = OBJECT_ID('EmployeePunches')";
                var indexExists = Convert.ToInt32(await checkIndexCmd.ExecuteScalarAsync(ct)) > 0;

                if (!indexExists)
                {
                    // Backfill IsOpen = 1 for punches that have PunchType = 0 (ClockIn) and no subsequent ClockOut
                    using var backfillCmd = conn.CreateCommand();
                    backfillCmd.CommandText = @"
UPDATE p
SET IsOpen = 1
FROM EmployeePunches p
WHERE CAST(p.PunchType AS NVARCHAR(20)) IN ('ClockIn', '0')
  AND NOT EXISTS (
      SELECT 1 FROM EmployeePunches o
      WHERE o.EmployeeId = p.EmployeeId
        AND o.PunchTime > p.PunchTime
        AND CAST(o.PunchType AS NVARCHAR(20)) IN ('ClockOut', '1')
  );";
                    var backfilledCount = await backfillCmd.ExecuteNonQueryAsync(ct);

                    // Resolve employees with more than 1 open punch: keep only the newest one open, close older ones as incomplete
                    using var resolveCmd = conn.CreateCommand();
                    resolveCmd.CommandText = @"
;WITH RankedOpen AS (
    SELECT Id, EmployeeId, PunchTime,
           ROW_NUMBER() OVER (PARTITION BY EmployeeId ORDER BY PunchTime DESC) AS rn
    FROM EmployeePunches
    WHERE IsOpen = 1
)
UPDATE p
SET IsOpen = 0,
    Note = CASE 
        WHEN p.Note IS NULL OR LTRIM(RTRIM(p.Note)) = '' THEN 'Incomplete shift - auto-closed prior to index creation'
        ELSE p.Note + ' | Incomplete shift (auto-closed prior to index creation)'
    END
FROM EmployeePunches p
INNER JOIN RankedOpen r ON p.Id = r.Id
WHERE r.rn > 1;";
                    var resolvedDuplicates = await resolveCmd.ExecuteNonQueryAsync(ct);

                    // Create the filtered unique index
                    using var createIndexCmd = conn.CreateCommand();
                    createIndexCmd.CommandText = "CREATE UNIQUE INDEX IX_EmployeePunches_EmployeeId_IsOpen ON EmployeePunches (EmployeeId) WHERE [IsOpen] = 1;";
                    await createIndexCmd.ExecuteNonQueryAsync(ct);

                    logger.LogInformation(
                        "Tenant '{CompanyCode}' ({DatabaseName}) punch migration completed: {Backfilled} open punches identified, {DuplicatesClosed} older duplicate open punches resolved/auto-closed. Created filtered unique index IX_EmployeePunches_EmployeeId_IsOpen.",
                        companyCode, databaseName, backfilledCount, resolvedDuplicates);
                }
            }

            // 3. AttendanceRecords Deduplication and Unique Index (EmployeeId, Date)
            using (var checkAttIndexCmd = conn.CreateCommand())
            {
                checkAttIndexCmd.CommandText = @"
SELECT COUNT(1) 
FROM sys.indexes 
WHERE name = 'IX_AttendanceRecords_EmployeeId_Date' 
  AND object_id = OBJECT_ID('AttendanceRecords') 
  AND is_unique = 1";
                var attIndexUnique = Convert.ToInt32(await checkAttIndexCmd.ExecuteScalarAsync(ct)) > 0;

                if (!attIndexUnique)
                {
                    // Safe deduplication: Keep the record with non-absent status, highest WorkHours, or latest update
                    using var dedupCmd = conn.CreateCommand();
                    dedupCmd.CommandText = @"
;WITH RankedAttendance AS (
    SELECT 
        Id,
        EmployeeId,
        [Date],
        ROW_NUMBER() OVER (
            PARTITION BY EmployeeId, [Date] 
            ORDER BY 
                CASE WHEN Status NOT IN ('Absent', '0') THEN 1 ELSE 0 END DESC,
                WorkHours DESC,
                UpdatedAtUtc DESC,
                CreatedAtUtc DESC
        ) AS rn
    FROM AttendanceRecords
)
DELETE FROM AttendanceRecords
WHERE Id IN (
    SELECT Id FROM RankedAttendance WHERE rn > 1
);";
                    var deletedDuplicates = await dedupCmd.ExecuteNonQueryAsync(ct);

                    // Drop non-unique index if it exists, then create unique index
                    using var dropIndexCmd = conn.CreateCommand();
                    dropIndexCmd.CommandText = @"
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AttendanceRecords_EmployeeId_Date' AND object_id = OBJECT_ID('AttendanceRecords') AND is_unique = 0)
    DROP INDEX IX_AttendanceRecords_EmployeeId_Date ON AttendanceRecords;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AttendanceRecords_EmployeeId_Date' AND object_id = OBJECT_ID('AttendanceRecords'))
    CREATE UNIQUE INDEX IX_AttendanceRecords_EmployeeId_Date ON AttendanceRecords (EmployeeId, [Date]);";
                    await dropIndexCmd.ExecuteNonQueryAsync(ct);

                    logger.LogInformation(
                        "Tenant '{CompanyCode}' ({DatabaseName}) attendance records migration: safely merged/removed {DeletedDuplicates} duplicate attendance rows and ensured unique index IX_AttendanceRecords_EmployeeId_Date.",
                        companyCode, databaseName, deletedDuplicates);
                }
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to run punch and tenant settings migration for tenant '{CompanyCode}' ({DatabaseName})", companyCode, databaseName);
        }
    }

    private static async Task EnsureDefaultSystemUsersAsync(
        HrmsDbContext db,
        IPasswordHasher hasher,
        ILogger logger,
        CancellationToken ct)
    {
        try
        {
            var superAdminRole = await db.Roles.FirstOrDefaultAsync(r => r.Code == "SuperAdmin", ct);
            var companyAdminRole = await db.Roles.FirstOrDefaultAsync(r => r.Code == "CompanyAdmin", ct);
            var hrRole = await db.Roles.FirstOrDefaultAsync(r => r.Code == "HrManager", ct);

            // 1. Ensure SuperAdmin: admin@hrnexus.com / Admin@123
            if (superAdminRole != null)
            {
                var admin = await db.Users.FirstOrDefaultAsync(u => u.NormalizedEmail == "ADMIN@HRNEXUS.COM", ct);
                if (admin == null)
                {
                    admin = new User
                    {
                        Email = "admin@hrnexus.com",
                        NormalizedEmail = "ADMIN@HRNEXUS.COM",
                        FullName = "Alex Johnson",
                        Initials = "SA",
                        RoleId = superAdminRole.Id,
                        IsActive = true,
                        PasswordHash = hasher.Hash("Admin@123")
                    };
                    db.Users.Add(admin);
                }
                else
                {
                    admin.IsActive = true;
                    admin.RoleId = superAdminRole.Id;
                    if (!hasher.Verify("Admin@123", admin.PasswordHash))
                    {
                        admin.PasswordHash = hasher.Hash("Admin@123");
                    }
                }
            }

            // 2. Ensure CompanyAdmin: companyadmin@hrnexus.com / Admin@123
            if (companyAdminRole != null)
            {
                var ca = await db.Users.FirstOrDefaultAsync(u => u.NormalizedEmail == "COMPANYADMIN@HRNEXUS.COM", ct);
                if (ca == null)
                {
                    ca = new User
                    {
                        Email = "companyadmin@hrnexus.com",
                        NormalizedEmail = "COMPANYADMIN@HRNEXUS.COM",
                        FullName = "David Vance",
                        Initials = "CA",
                        RoleId = companyAdminRole.Id,
                        IsActive = true,
                        PasswordHash = hasher.Hash("Admin@123")
                    };
                    db.Users.Add(ca);
                }
                else
                {
                    ca.IsActive = true;
                    ca.RoleId = companyAdminRole.Id;
                    if (!hasher.Verify("Admin@123", ca.PasswordHash))
                    {
                        ca.PasswordHash = hasher.Hash("Admin@123");
                    }
                }
            }

            // 3. Ensure HR Manager: hr@hrnexus.com / Hr@12345
            if (hrRole != null)
            {
                var hr = await db.Users.FirstOrDefaultAsync(u => u.NormalizedEmail == "HR@HRNEXUS.COM", ct);
                if (hr == null)
                {
                    hr = new User
                    {
                        Email = "hr@hrnexus.com",
                        NormalizedEmail = "HR@HRNEXUS.COM",
                        FullName = "HR Manager",
                        Initials = "HR",
                        RoleId = hrRole.Id,
                        IsActive = true,
                        PasswordHash = hasher.Hash("Hr@12345")
                    };
                    db.Users.Add(hr);
                }
                else
                {
                    hr.IsActive = true;
                    hr.RoleId = hrRole.Id;
                    if (!hasher.Verify("Hr@12345", hr.PasswordHash) && !hasher.Verify("Admin@123", hr.PasswordHash))
                    {
                        hr.PasswordHash = hasher.Hash("Hr@12345");
                    }
                }
            }

            await db.SaveChangesAsync(ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to ensure default system users.");
        }
    }

    private static async Task EnsureEmployeeUsersSynchronizedAsync(
        HrmsDbContext db,
        IPasswordHasher hasher,
        ILogger logger,
        CancellationToken ct)
    {
        try
        {
            var employeeRole = await db.Roles.FirstOrDefaultAsync(r => r.Code == "Employee", ct);
            var hrRole = await db.Roles.FirstOrDefaultAsync(r => r.Code == "HrManager", ct);
            if (employeeRole == null) return;

            var employees = await db.Employees.ToListAsync(ct);
            var users = await db.Users.ToListAsync(ct);

            var systemEmails = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "admin@hrnexus.com",
                "companyadmin@hrnexus.com",
                "hr@hrnexus.com"
            };

            // Step 1: Deduplicate multiple users pointing to the same EmployeeId
            foreach (var emp in employees)
            {
                if (string.IsNullOrWhiteSpace(emp.Email)) continue;
                var empEmail = emp.Email.Trim().ToLowerInvariant();
                var normEmail = empEmail.ToUpperInvariant();

                var usersForEmp = users.Where(u => u.EmployeeId == emp.Id && !systemEmails.Contains(u.Email) && !systemEmails.Contains(u.NormalizedEmail)).ToList();
                if (usersForEmp.Count > 1)
                {
                    var canonical = usersForEmp.FirstOrDefault(u => u.NormalizedEmail == normEmail || string.Equals(u.Email?.Trim(), empEmail, StringComparison.OrdinalIgnoreCase))
                                 ?? usersForEmp.First();

                    foreach (var extra in usersForEmp.Where(u => u.Id != canonical.Id).ToList())
                    {
                        var belongsToOther = employees.Any(e => e.Id != emp.Id && string.Equals(e.Email?.Trim(), extra.Email?.Trim(), StringComparison.OrdinalIgnoreCase));
                        if (!belongsToOther)
                        {
                            var extraNotifs = await db.Notifications.Where(n => n.UserId == extra.Id).ToListAsync(ct);
                            foreach (var n in extraNotifs)
                            {
                                n.UserId = canonical.Id;
                            }
                            db.Users.Remove(extra);
                            users.Remove(extra);
                            logger.LogInformation("Removed duplicate user {Email} for employee {EmpEmail}", extra.Email, empEmail);
                        }
                        else
                        {
                            extra.EmployeeId = null;
                        }
                    }
                }
            }

            var updatedCount = 0;
            var createdCount = 0;

            foreach (var emp in employees)
            {
                if (string.IsNullOrWhiteSpace(emp.Email)) continue;

                var empEmail = emp.Email.Trim().ToLowerInvariant();
                var normEmail = empEmail.ToUpperInvariant();
                var rawPassword = !string.IsNullOrWhiteSpace(emp.Password) ? emp.Password.Trim() : "Employee@123";

                // Match by NormalizedEmail FIRST to prevent duplicate key conflicts
                var matchedUser = users.FirstOrDefault(u => u.NormalizedEmail == normEmail || string.Equals(u.Email?.Trim(), empEmail, StringComparison.OrdinalIgnoreCase));

                if (matchedUser is null)
                {
                    var userByEmp = users.FirstOrDefault(u => u.EmployeeId == emp.Id && !systemEmails.Contains(u.Email) && !systemEmails.Contains(u.NormalizedEmail));
                    if (userByEmp != null && !users.Any(u => u.NormalizedEmail == normEmail))
                    {
                        matchedUser = userByEmp;
                    }
                }

                if (matchedUser is null)
                {
                    var firstInitial = emp.FirstName.Trim().Length > 0 ? emp.FirstName.Trim()[0] : 'E';
                    var lastInitial = emp.LastName.Trim().Length > 0 ? emp.LastName.Trim()[0] : 'M';
                    var initials = $"{firstInitial}{lastInitial}".Trim().ToUpperInvariant();

                    var isHr = emp.JobTitle != null && emp.JobTitle.Contains("HR", StringComparison.OrdinalIgnoreCase);
                    var roleId = isHr && hrRole != null ? hrRole.Id : employeeRole.Id;

                    var newUser = new User
                    {
                        Email = empEmail,
                        NormalizedEmail = normEmail,
                        PasswordHash = hasher.Hash(rawPassword),
                        FullName = $"{emp.FirstName.Trim()} {emp.LastName.Trim()}".Trim(),
                        Initials = string.IsNullOrWhiteSpace(initials) ? "EM" : initials,
                        RoleId = roleId,
                        EmployeeId = emp.Id,
                        IsActive = emp.Status == EmploymentStatus.Active,
                    };
                    db.Users.Add(newUser);
                    users.Add(newUser);
                    createdCount++;
                }
                else
                {
                    var changed = false;

                    if (matchedUser.EmployeeId != emp.Id && !systemEmails.Contains(matchedUser.Email) && !systemEmails.Contains(matchedUser.NormalizedEmail))
                    {
                        matchedUser.EmployeeId = emp.Id;
                        changed = true;
                    }

                    if (emp.Status != EmploymentStatus.Active && matchedUser.IsActive)
                    {
                        matchedUser.IsActive = false;
                        changed = true;
                    }
                    else if (emp.Status == EmploymentStatus.Active && !matchedUser.IsActive)
                    {
                        matchedUser.IsActive = true;
                        changed = true;
                    }

                    // Backfill Employee.Password only when the existing User hash actually verifies against the default password
                    if (string.IsNullOrWhiteSpace(emp.Password) && hasher.Verify("Employee@123", matchedUser.PasswordHash))
                    {
                        emp.Password = "Employee@123";
                        changed = true;
                    }
                    // Sync password hash only when an explicit Employee.Password is stored
                    else if (!string.IsNullOrWhiteSpace(emp.Password) && !hasher.Verify(emp.Password.Trim(), matchedUser.PasswordHash))
                    {
                        matchedUser.PasswordHash = hasher.Hash(emp.Password.Trim());
                        changed = true;
                    }

                    if (!systemEmails.Contains(matchedUser.Email) && !systemEmails.Contains(matchedUser.NormalizedEmail))
                    {
                        if (string.IsNullOrWhiteSpace(matchedUser.NormalizedEmail) || matchedUser.NormalizedEmail != normEmail)
                        {
                            matchedUser.NormalizedEmail = normEmail;
                            changed = true;
                        }
                        if (string.IsNullOrWhiteSpace(matchedUser.Email) || !string.Equals(matchedUser.Email, empEmail, StringComparison.OrdinalIgnoreCase))
                        {
                            matchedUser.Email = empEmail;
                            changed = true;
                        }

                        var expectedName = $"{emp.FirstName.Trim()} {emp.LastName.Trim()}".Trim();
                        if (!string.IsNullOrWhiteSpace(expectedName))
                        {
                            var fCh = emp.FirstName.Trim().Length > 0 ? emp.FirstName.Trim()[0] : 'E';
                            var lCh = emp.LastName.Trim().Length > 0 ? emp.LastName.Trim()[0] : 'M';
                            var expectedInitials = $"{fCh}{lCh}".Trim().ToUpperInvariant();
                            if (matchedUser.FullName != expectedName)
                            {
                                matchedUser.FullName = expectedName;
                                changed = true;
                            }
                            if (matchedUser.Initials != expectedInitials)
                            {
                                matchedUser.Initials = string.IsNullOrWhiteSpace(expectedInitials) ? "EM" : expectedInitials;
                                changed = true;
                            }
                        }
                    }

                    if (changed)
                    {
                        updatedCount++;
                    }
                }
            }

            if (createdCount > 0 || updatedCount > 0)
            {
                await db.SaveChangesAsync(ct);
                logger.LogInformation("Employee-User credentials sync completed: {Created} accounts provisioned, {Updated} accounts updated.", createdCount, updatedCount);
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to synchronize Employee user accounts in database bootstrap.");
        }
    }

    private static async Task EnsureProductionSuperAdminAsync(
        HrmsDbContext db,
        IPasswordHasher hasher,
        IConfiguration configuration,
        ILogger logger,
        CancellationToken ct)
    {
        var superAdminRole = await db.Roles.FirstOrDefaultAsync(r => r.Code == "SuperAdmin", ct);
        if (superAdminRole == null) return;

        var existingAdmin = await db.Users.AnyAsync(u => u.RoleId == superAdminRole.Id, ct);
        if (existingAdmin) return;

        var adminEmail = configuration["SUPERADMIN_EMAIL"] ?? configuration["Seed:SuperAdminEmail"];
        var adminPassword = configuration["SUPERADMIN_PASSWORD"] ?? configuration["Seed:SuperAdminPassword"];
        var adminName = configuration["SUPERADMIN_NAME"] ?? "Platform Administrator";

        if (!string.IsNullOrWhiteSpace(adminEmail) && !string.IsNullOrWhiteSpace(adminPassword))
        {
            var adminUser = new User
            {
                Email = adminEmail.Trim().ToLowerInvariant(),
                FullName = adminName.Trim(),
                Initials = "SA",
                RoleId = superAdminRole.Id,
                PasswordHash = hasher.Hash(adminPassword),
                IsActive = true
            };
            db.Users.Add(adminUser);
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Initial production SuperAdmin '{Email}' created from environment configuration.", adminEmail);
        }
        else
        {
            logger.LogWarning("No SuperAdmin exists and SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD environment variables are not set. Set these variables or use the CLI setup command to create the initial administrator.");
        }
    }

    private static async Task EnsureDefaultGeneralDepartmentAndDesignationAsync(
        HrmsDbContext db,
        ILogger logger,
        CancellationToken ct)
    {
        try
        {
            var generalDept = await db.Departments
                .FirstOrDefaultAsync(d => d.Name.ToLower() == "general", ct);
            if (generalDept is null)
            {
                generalDept = new Department
                {
                    Name = "General",
                    Code = "GEN",
                    Description = "General department",
                    IsActive = true
                };
                db.Departments.Add(generalDept);
                await db.SaveChangesAsync(ct);
                logger.LogInformation("Seeded default 'General' department into tenant database.");
            }
            else if (!generalDept.IsActive)
            {
                generalDept.IsActive = true;
                await db.SaveChangesAsync(ct);
            }

            var empDesig = await db.Designations
                .FirstOrDefaultAsync(d => d.Name.ToLower() == "employee" && d.DepartmentId == generalDept.Id, ct);
            if (empDesig is null)
            {
                empDesig = new Designation
                {
                    Name = "Employee",
                    Grade = string.Empty,
                    DepartmentId = generalDept.Id,
                    Description = "Default employee designation"
                };
                db.Designations.Add(empDesig);
                await db.SaveChangesAsync(ct);
                logger.LogInformation("Seeded default 'Employee' designation under 'General' department.");
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to ensure default 'General' department and 'Employee' designation.");
        }
    }

    private static async Task EnsureShiftTemplatesSeededAsync(
        HrmsDbContext db,
        ILogger logger,
        CancellationToken ct)
    {
        try
        {
            if (!await db.ShiftTemplates.AnyAsync(ct))
            {
                var shifts = await db.Shifts.ToListAsync(ct);
                if (shifts.Count > 0)
                {
                    foreach (var s in shifts)
                    {
                        var code = s.Name switch
                        {
                            "Morning Shift" => "MS",
                            "Evening Shift" => "ES",
                            "Night Shift" => "NS",
                            _ => string.Concat(s.Name.Split(' ').Select(w => w.FirstOrDefault())).ToUpper()
                        };
                        var tmpl = new ShiftTemplate
                        {
                            Name = s.Name,
                            Description = $"Code: {code} | {s.WorkingDays ?? "Mon - Fri"}",
                            GracePeriodMinutes = s.LateGraceMinutes,
                            HalfDayHours = s.DailyHours > 0 ? (decimal)s.DailyHours / 2m : 4.5m,
                            FullDayHours = s.DailyHours > 0 ? (decimal)s.DailyHours : 9.0m,
                            IsDefault = s.Name.Contains("Morning", StringComparison.OrdinalIgnoreCase),
                            IsNightShift = s.Name.Contains("Night", StringComparison.OrdinalIgnoreCase),
                        };
                        db.ShiftTemplates.Add(tmpl);
                        foreach (DayOfWeek dow in new[] { DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday })
                        {
                            db.Shiftdays.Add(new Shiftday
                            {
                                ShiftTemplateId = tmpl.Id,
                                DayOfWeek = dow,
                                StartTime = s.StartTime,
                                EndTime = s.EndTime,
                                IsWeekOff = false,
                                BreakMinutes = 60
                            });
                        }
                    }
                    await db.SaveChangesAsync(ct);
                    logger.LogInformation("Seeded {Count} shift templates into tenant database.", shifts.Count);
                }
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to check or seed shift templates.");
        }
    }

    private static async Task EnsureHolidayTemplatesSeededAsync(
        HrmsDbContext db,
        ILogger logger,
        CancellationToken ct)
    {
        try
        {
            var year = DateTime.UtcNow.Year; // 2026

            // 1. Get or create India National Holiday Template
            var indiaTemplate = await db.HolidayTemplates
                .FirstOrDefaultAsync(t => t.Name.Contains("India") && t.IsDefault, ct);

            if (indiaTemplate is null)
            {
                indiaTemplate = await db.HolidayTemplates.FirstOrDefaultAsync(t => t.IsDefault, ct);
            }

            if (indiaTemplate is null)
            {
                indiaTemplate = new HolidayTemplate
                {
                    Name = $"India National & Gazetted Holidays ({year})",
                    Description = "Standard national and gazetted public holidays for Indian establishments and corporate offices",
                    IsDefault = true,
                };
                db.HolidayTemplates.Add(indiaTemplate);
                await db.SaveChangesAsync(ct);
            }

            // 2. Get or create India Corporate & Optional Template
            var corporateTemplate = await db.HolidayTemplates
                .FirstOrDefaultAsync(t => t.Name.Contains("Optional") || t.Name.Contains("Corporate"), ct);

            if (corporateTemplate is null)
            {
                corporateTemplate = new HolidayTemplate
                {
                    Name = $"India Corporate & Optional Holidays ({year})",
                    Description = "Optional and restricted festival holidays for corporate teams in India",
                    IsDefault = false,
                };
                db.HolidayTemplates.Add(corporateTemplate);
                await db.SaveChangesAsync(ct);
            }

            // 3. Remove obsolete non-Indian holidays (e.g. UAE National Day)
            var obsoleteHolidays = await db.Holidays
                .Where(h => h.Name.Contains("UAE") || h.Name.Contains("Emirates"))
                .ToListAsync(ct);
            if (obsoleteHolidays.Count > 0)
            {
                db.Holidays.RemoveRange(obsoleteHolidays);
                await db.SaveChangesAsync(ct);
            }

            // 4. Ensure authentic Indian Holidays are seeded and linked
            var indianHolidayDefinitions = new (string Name, DateOnly Date, HolidayType Type, bool IsCorporate, string Icon, string Description)[]
            {
                ("New Year's Day", new DateOnly(year, 1, 1), HolidayType.Optional, false, "calendar", "First day of the Gregorian New Year"),
                ("Makar Sankranti / Uttarayan", new DateOnly(year, 1, 14), HolidayType.Optional, false, "sun", "Harvest festival celebrated across India"),
                ("Republic Day", new DateOnly(year, 1, 26), HolidayType.National, false, "flag", "National holiday commemorating Constitution of India"),
                ("Maha Shivratri", new DateOnly(year, 2, 15), HolidayType.Religious, false, "moon", "Gazetted festival honoring Lord Shiva"),
                ("Holi", new DateOnly(year, 3, 4), HolidayType.Religious, false, "sparkles", "Spring festival of colors and unity"),
                ("Eid-ul-Fitr", new DateOnly(year, 3, 20), HolidayType.Religious, false, "moon", "Islamic festival marking the end of Ramadan"),
                ("Mahavir Jayanti", new DateOnly(year, 3, 31), HolidayType.Religious, false, "sun", "Birth anniversary of Bhagwan Mahavira"),
                ("Good Friday", new DateOnly(year, 4, 3), HolidayType.Religious, false, "cross", "Christian holy day marking crucifixion of Jesus Christ"),
                ("Buddha Purnima", new DateOnly(year, 5, 1), HolidayType.Religious, false, "sun", "Celebration of Gautama Buddha's birth and enlightenment"),
                ("Bakrid / Eid al-Adha", new DateOnly(year, 5, 27), HolidayType.Religious, false, "moon", "Feast of Sacrifice"),
                ("Muharram", new DateOnly(year, 6, 26), HolidayType.Religious, false, "calendar", "First month of Islamic calendar and Ashura"),
                ("Independence Day", new DateOnly(year, 8, 15), HolidayType.National, false, "flag", "National holiday celebrating Independence of India"),
                ("Milad-un-Nabi", new DateOnly(year, 8, 26), HolidayType.Religious, false, "moon", "Observance of the Prophet Muhammad's birthday"),
                ("Raksha Bandhan", new DateOnly(year, 8, 28), HolidayType.Optional, true, "heart", "Celebration of fraternal bond and protection"),
                ("Janmashtami", new DateOnly(year, 9, 4), HolidayType.Religious, false, "sparkles", "Birth celebration of Lord Krishna"),
                ("Ganesh Chaturthi", new DateOnly(year, 9, 14), HolidayType.Religious, false, "star", "Festival welcoming Lord Ganesha"),
                ("Mahatma Gandhi Jayanti", new DateOnly(year, 10, 2), HolidayType.National, false, "award", "National holiday marking birth of Mahatma Gandhi"),
                ("Dussehra (Vijaya Dashami)", new DateOnly(year, 10, 20), HolidayType.Religious, false, "zap", "Triumph of righteousness over evil"),
                ("Diwali (Deepavali)", new DateOnly(year, 11, 8), HolidayType.Religious, false, "flame", "Festival of Lights and prosperity"),
                ("Govardhan Puja / Bhai Dooj", new DateOnly(year, 11, 10), HolidayType.Optional, true, "gift", "Festive celebration following Diwali"),
                ("Guru Nanak Jayanti", new DateOnly(year, 11, 24), HolidayType.Religious, false, "sun", "Birth anniversary of Guru Nanak Dev Ji"),
                ("Christmas Day", new DateOnly(year, 12, 25), HolidayType.Religious, false, "gift", "Celebration of the birth of Jesus Christ"),
            };

            var existingHolidays = await db.Holidays.ToListAsync(ct);
            var holidaysChanged = false;

            foreach (var item in indianHolidayDefinitions)
            {
                var targetTemplateId = item.IsCorporate ? corporateTemplate.Id : indiaTemplate.Id;
                var match = existingHolidays.FirstOrDefault(h =>
                    h.Name.Equals(item.Name, StringComparison.OrdinalIgnoreCase) ||
                    (item.Name.Contains("Makar") && h.Name.Contains("Uttrayan", StringComparison.OrdinalIgnoreCase)) ||
                    (item.Name.Contains("Christmas") && h.Name.Contains("Christmas", StringComparison.OrdinalIgnoreCase)) ||
                    (item.Name.Contains("Eid-ul-Fitr") && h.Name.Contains("Eid Al Fitr", StringComparison.OrdinalIgnoreCase)) ||
                    (item.Name.Contains("Eid al-Adha") && h.Name.Contains("Eid Al Adha", StringComparison.OrdinalIgnoreCase)));

                if (match != null)
                {
                    match.Name = item.Name;
                    match.Date = item.Date;
                    match.Type = item.Type;
                    match.HolidayTemplateId = targetTemplateId;
                    match.Icon = item.Icon;
                    match.Description = item.Description;
                    holidaysChanged = true;
                }
                else
                {
                    db.Holidays.Add(new Holiday
                    {
                        Name = item.Name,
                        Date = item.Date,
                        Type = item.Type,
                        HolidayTemplateId = targetTemplateId,
                        Icon = item.Icon,
                        Description = item.Description,
                    });
                    holidaysChanged = true;
                }
            }

            if (holidaysChanged)
            {
                await db.SaveChangesAsync(ct);
            }

            // 5. Ensure Holiday Template Assignments are populated
            var existingAssignments = await db.HolidayTemplateAssignments.ToListAsync(ct);
            var assignmentsChanged = false;

            // Assign indiaTemplate to all departments if not assigned
            var departments = await db.Departments.ToListAsync(ct);
            foreach (var dept in departments)
            {
                if (!existingAssignments.Any(a => a.HolidayTemplateId == indiaTemplate.Id && a.DepartmentId == dept.Id))
                {
                    db.HolidayTemplateAssignments.Add(new HolidayTemplateAssignment
                    {
                        HolidayTemplateId = indiaTemplate.Id,
                        DepartmentId = dept.Id,
                    });
                    assignmentsChanged = true;
                }
            }

            // Assign templates to branches
            var branches = await db.Branches.ToListAsync(ct);
            foreach (var branch in branches)
            {
                var targetTemplateId = (branch.Name.Contains("London", StringComparison.OrdinalIgnoreCase) || branch.Name.Contains("Riyadh", StringComparison.OrdinalIgnoreCase))
                    ? corporateTemplate.Id
                    : indiaTemplate.Id;

                if (!existingAssignments.Any(a => a.HolidayTemplateId == targetTemplateId && a.BranchId == branch.Id))
                {
                    db.HolidayTemplateAssignments.Add(new HolidayTemplateAssignment
                    {
                        HolidayTemplateId = targetTemplateId,
                        BranchId = branch.Id,
                    });
                    assignmentsChanged = true;
                }
            }

            if (assignmentsChanged)
            {
                await db.SaveChangesAsync(ct);
            }

            logger.LogInformation("Ensured HolidayTemplates and HolidayTemplateAssignments seeded with Indian holidays.");
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to ensure Indian holiday templates seeded.");
        }
    }

    private static async Task EnsureNavigationItemsSeededAsync(
        HrmsDbContext db,
        ILogger logger,
        CancellationToken ct)
    {
        try
        {
            // 1. Remove any legacy /loans, /erp, /kiosk, /announcements, /analytics, /documents navigation items
            var toRemove = await db.NavigationItems
                .Where(n => n.Route.ToLower().Contains("/loans") ||
                            n.Route.ToLower().Contains("/erp") ||
                            n.Route.ToLower().Contains("/kiosk") ||
                            n.Route.ToLower().Contains("announcement") ||
                            n.Route.ToLower().Contains("/analytics") ||
                            n.Route.ToLower().Contains("/documents") ||
                            n.Title.ToLower() == "loans" ||
                            n.Title.ToLower() == "analytics" ||
                            n.Title.ToLower() == "documents" ||
                            n.Code.ToLower() == "loan" ||
                            n.Code.ToLower() == "anal" ||
                            n.Code.ToLower() == "docs")
                .ToListAsync(ct);

            if (toRemove.Count > 0)
            {
                var removeIds = toRemove.Select(n => n.Id).ToList();
                var permsToRemove = await db.RoleNavigations
                    .Where(rn => removeIds.Contains(rn.NavigationItemId))
                    .ToListAsync(ct);
                db.RoleNavigations.RemoveRange(permsToRemove);
                db.NavigationItems.RemoveRange(toRemove);
                await db.SaveChangesAsync(ct);
            }

            // Reassign any legacy 'Manager' role users to 'CompanyAdmin' and remove standalone 'Manager' role
            var legacyManagerRoles = await db.Roles
                .Where(r => r.Code.ToLower() == "manager" || r.Name.ToLower() == "manager")
                .ToListAsync(ct);
            if (legacyManagerRoles.Count > 0)
            {
                var companyAdminRole = await db.Roles
                    .FirstOrDefaultAsync(r => r.Code.ToLower() == "companyadmin" || r.Name.ToLower() == "company admin", ct);
                if (companyAdminRole != null)
                {
                    var legacyIds = legacyManagerRoles.Select(r => r.Id).ToList();
                    var mgrUsers = await db.Users.Where(u => legacyIds.Contains(u.RoleId)).ToListAsync(ct);
                    foreach (var u in mgrUsers)
                    {
                        u.RoleId = companyAdminRole.Id;
                    }
                    var mgrNavs = await db.RoleNavigations.Where(rn => legacyIds.Contains(rn.RoleId)).ToListAsync(ct);
                    db.RoleNavigations.RemoveRange(mgrNavs);
                    db.Roles.RemoveRange(legacyManagerRoles);
                    await db.SaveChangesAsync(ct);
                }
            }

            // 2. Standard navigation items matching sidebar
            var standardItems = new (string Code, string Title, string Route, string Icon, int Order)[]
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
            var existingByCode = existingNavs.ToDictionary(n => n.Code.ToUpperInvariant());

            foreach (var (code, title, route, icon, order) in standardItems)
            {
                if (!existingByCode.TryGetValue(code, out var nav))
                {
                    nav = new NavigationItem
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
                else
                {
                    nav.Title = title;
                    nav.Route = route;
                    nav.Icon = icon;
                    nav.OrderIndex = order;
                    nav.IsActive = true;
                }
            }

            await db.SaveChangesAsync(ct);

            // Grant full permissions to Super Admin and Company Admin; grant operational non-settings permissions to HR Manager
            var allCurrentNavs = await db.NavigationItems.ToListAsync(ct);
            var settingsNavIds = allCurrentNavs
                .Where(n => n.Code is "SETT" or "KEYG" or "NAVM" or "PERM" or "ROLE" ||
                            n.Route.StartsWith("/settings", StringComparison.OrdinalIgnoreCase))
                .Select(n => n.Id)
                .ToHashSet();

            var superAndCompanyAdmins = await db.Roles
                .Where(r => r.Code == "SuperAdmin" || r.Code == "CompanyAdmin" ||
                            r.Name == "Super Admin" || r.Name == "Company Admin")
                .ToListAsync(ct);

            var hrRoles = await db.Roles
                .Where(r => r.Code == "HrManager" || r.Name == "HR Manager")
                .ToListAsync(ct);

            if (hrRoles.Count > 0 && settingsNavIds.Count > 0)
            {
                var hrIds = hrRoles.Select(r => r.Id).ToList();
                var hrSettingsPerms = await db.RoleNavigations
                    .Where(rn => hrIds.Contains(rn.RoleId) && settingsNavIds.Contains(rn.NavigationItemId))
                    .ToListAsync(ct);
                if (hrSettingsPerms.Count > 0)
                {
                    db.RoleNavigations.RemoveRange(hrSettingsPerms);
                    await db.SaveChangesAsync(ct);
                }
            }

            var existingPerms = await db.RoleNavigations.ToListAsync(ct);
            var existingByRoleNav = existingPerms.ToDictionary(p => $"{p.RoleId}:{p.NavigationItemId}");
            var permKeySet = existingPerms.Select(p => $"{p.RoleId}:{p.NavigationItemId}").ToHashSet();

            foreach (var r in superAndCompanyAdmins)
            {
                foreach (var nav in allCurrentNavs)
                {
                    var k = $"{r.Id}:{nav.Id}";
                    if (!existingByRoleNav.TryGetValue(k, out var existingPerm))
                    {
                        db.RoleNavigations.Add(new RoleNavigation
                        {
                            RoleId = r.Id,
                            NavigationItemId = nav.Id,
                            IsFull = true,
                            IsView = true,
                            IsCreate = true,
                            IsEdit = true,
                            IsDelete = true
                        });
                        permKeySet.Add(k);
                    }
                    else if (!existingPerm.IsFull || !existingPerm.IsView || !existingPerm.IsCreate || !existingPerm.IsEdit || !existingPerm.IsDelete)
                    {
                        existingPerm.IsFull = true;
                        existingPerm.IsView = true;
                        existingPerm.IsCreate = true;
                        existingPerm.IsEdit = true;
                        existingPerm.IsDelete = true;
                    }
                }
            }

            foreach (var r in hrRoles)
            {
                foreach (var nav in allCurrentNavs)
                {
                    if (settingsNavIds.Contains(nav.Id))
                    {
                        continue;
                    }

                    if (!permKeySet.Contains($"{r.Id}:{nav.Id}"))
                    {
                        db.RoleNavigations.Add(new RoleNavigation
                        {
                            RoleId = r.Id,
                            NavigationItemId = nav.Id,
                            IsFull = true,
                            IsView = true,
                            IsCreate = true,
                            IsEdit = true,
                            IsDelete = true
                        });
                        permKeySet.Add($"{r.Id}:{nav.Id}");
                    }
                }
            }

            // Grant role-appropriate permissions to Employee role
            var otherRoles = await db.Roles
                .Where(r => r.Code == "Employee" || r.Name == "Employee")
                .ToListAsync(ct);

            foreach (var r in otherRoles)
            {
                var allowedCodes = new[] { "DASH", "PROF", "ATTD", "LEAV", "PAYS" };

                foreach (var nav in allCurrentNavs)
                {
                    if (allowedCodes.Contains(nav.Code) && !permKeySet.Contains($"{r.Id}:{nav.Id}"))
                    {
                        bool isCreate = new[] { "ATTD", "LEAV" }.Contains(nav.Code);
                        bool isEdit = new[] { "DASH", "PROF" }.Contains(nav.Code);

                        db.RoleNavigations.Add(new RoleNavigation
                        {
                            RoleId = r.Id,
                            NavigationItemId = nav.Id,
                            IsFull = false,
                            IsView = true,
                            IsCreate = isCreate,
                            IsEdit = isEdit,
                            IsDelete = false
                        });
                        permKeySet.Add($"{r.Id}:{nav.Id}");
                    }
                }
            }

            await db.SaveChangesAsync(ct);
            logger.LogInformation("Seeded standard navigation items and permissions for all roles into tenant database.");
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to ensure standard navigation items seeded.");
        }
    }
}

