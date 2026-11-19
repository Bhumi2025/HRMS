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
EXEC(N'UPDATE Roles SET IsSystem = 1 WHERE Name IN (''Super Admin'', ''Company Admin'', ''HR Manager'', ''Manager'', ''Employee'') 
   OR Code IN (''SuperAdmin'', ''CompanyAdmin'', ''HrManager'', ''Manager'', ''Employee'');');

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

-- 7. Ensure EmployeePunches.IsOpen
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'EmployeePunches' AND COLUMN_NAME = 'IsOpen')
    ALTER TABLE EmployeePunches ADD IsOpen BIT NOT NULL CONSTRAINT DF_EmployeePunches_IsOpen DEFAULT 0;

-- 8. Ensure Shifts.LateGraceMinutes
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Shifts' AND COLUMN_NAME = 'LateGraceMinutes')
    ALTER TABLE Shifts ADD LateGraceMinutes INT NOT NULL CONSTRAINT DF_Shifts_LateGraceMinutes DEFAULT 15;

-- 9. Ensure LeaveRequests.IsHalfDay
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'LeaveRequests' AND COLUMN_NAME = 'IsHalfDay')
    ALTER TABLE LeaveRequests ADD IsHalfDay BIT NOT NULL CONSTRAINT DF_LeaveRequests_IsHalfDay DEFAULT 0;

-- 10. Ensure CompanySettings.MaxPunchDurationHours
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'CompanySettings' AND COLUMN_NAME = 'MaxPunchDurationHours')
    ALTER TABLE CompanySettings ADD MaxPunchDurationHours INT NOT NULL CONSTRAINT DF_CompanySettings_MaxPunchDurationHours DEFAULT 16;

-- 11. Remove legacy ShiftAssignments table (Shift Roster Matrix removed)
IF OBJECT_ID('ShiftAssignments', 'U') IS NOT NULL
    DROP TABLE ShiftAssignments;
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
        await RunPunchAndTenantSettingsMigrationAsync(tenant, DefaultCompanyCode, defaultDbName, configuration, logger, ct);
        await DbSeeder.SeedAsync(tenant, hasher, isProduction, ct);
        await EnsureShiftTemplatesSeededAsync(tenant, logger, ct);
        await EnsureHolidayTemplatesSeededAsync(tenant, logger, ct);
        await EnsureNavigationItemsSeededAsync(tenant, logger, ct);

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
                        await RunPunchAndTenantSettingsMigrationAsync(tenantDb, company.Code, company.DatabaseName, configuration, logger, ct);
                        await EnsureShiftTemplatesSeededAsync(tenantDb, logger, ct);
                        await EnsureHolidayTemplatesSeededAsync(tenantDb, logger, ct);
                        await EnsureNavigationItemsSeededAsync(tenantDb, logger, ct);
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
            // 1. Remove any legacy /loans, /erp, /kiosk, /announcements, /analytics navigation items
            var toRemove = await db.NavigationItems
                .Where(n => n.Route.ToLower().Contains("/loans") ||
                            n.Route.ToLower().Contains("/erp") ||
                            n.Route.ToLower().Contains("/kiosk") ||
                            n.Route.ToLower().Contains("announcement") ||
                            n.Route.ToLower().Contains("/analytics") ||
                            n.Title.ToLower() == "loans" ||
                            n.Title.ToLower() == "analytics" ||
                            n.Code.ToLower() == "loan" ||
                            n.Code.ToLower() == "anal")
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
                ("DOCS", "Documents", "/documents", "documents", 11),
                ("APPR", "Approvals", "/approvals", "approvals", 12),
                ("REPT", "Reports", "/reports", "reports", 13),
                ("SETT", "Settings", "/settings", "settings", 14),
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

            // Grant full permissions to Super Admin, Company Admin, and HR Manager
            var allCurrentNavs = await db.NavigationItems.ToListAsync(ct);
            var rolesToGrant = await db.Roles
                .Where(r => r.Code == "SuperAdmin" || r.Code == "CompanyAdmin" || r.Code == "HrManager" ||
                            r.Name == "Super Admin" || r.Name == "Company Admin" || r.Name == "HR Manager")
                .ToListAsync(ct);

            var existingPerms = await db.RoleNavigations.ToListAsync(ct);
            var permKeySet = existingPerms.Select(p => $"{p.RoleId}:{p.NavigationItemId}").ToHashSet();

            foreach (var r in rolesToGrant)
            {
                foreach (var nav in allCurrentNavs)
                {
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

            // Grant role-appropriate permissions to Manager and Employee roles
            var otherRoles = await db.Roles
                .Where(r => r.Code == "Manager" || r.Code == "Employee" ||
                            r.Name == "Manager" || r.Name == "Employee")
                .ToListAsync(ct);

            foreach (var r in otherRoles)
            {
                bool isManager = r.Code == "Manager" || r.Name == "Manager";
                var allowedCodes = isManager
                    ? new[] { "DASH", "ANAL", "EMPL", "PROF", "ATTD", "LEAV", "DOCS", "APPR", "REPT", "COMP", "PAYS" }
                    : new[] { "DASH", "PROF", "ATTD", "LEAV", "PAYS", "DOCS" };

                foreach (var nav in allCurrentNavs)
                {
                    if (allowedCodes.Contains(nav.Code) && !permKeySet.Contains($"{r.Id}:{nav.Id}"))
                    {
                        bool isFull = isManager && new[] { "DASH", "PROF", "APPR" }.Contains(nav.Code);
                        bool isCreate = isManager
                            ? new[] { "DASH", "PROF", "APPR", "ATTD", "LEAV", "DOCS" }.Contains(nav.Code)
                            : new[] { "ATTD", "LEAV" }.Contains(nav.Code);
                        bool isEdit = isManager
                            ? new[] { "DASH", "PROF", "APPR", "ATTD", "LEAV", "DOCS" }.Contains(nav.Code)
                            : new[] { "DASH", "PROF" }.Contains(nav.Code);

                        db.RoleNavigations.Add(new RoleNavigation
                        {
                            RoleId = r.Id,
                            NavigationItemId = nav.Id,
                            IsFull = isFull,
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

