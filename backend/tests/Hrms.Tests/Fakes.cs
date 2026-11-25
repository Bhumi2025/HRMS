using Hrms.Application.Abstractions.Notifications;
using Hrms.Application.Abstractions.Security;
using Hrms.Application.Abstractions.Tenancy;
using Hrms.Application.DTOs;
using Hrms.Domain.Entities;

namespace Hrms.Tests;

/// <summary>
/// In-memory stand-in for the real per-tenant EF Core work. It models a "database"
/// per name and a set of users per (database, email), and — like the real service —
/// only creates an admin once so provisioning stays idempotent.
/// </summary>
internal sealed class FakeTenantDatabaseService : ITenantDatabaseService
{
    public HashSet<string> Databases { get; } = new(StringComparer.OrdinalIgnoreCase);

    public Dictionary<string, TenantUserRecord> Users { get; } = new(StringComparer.Ordinal);

    public bool ThrowOnProvision { get; set; }

    public int ProvisionCalls { get; private set; }

    public Task<bool> DatabaseExistsAsync(string databaseName, CancellationToken ct = default) =>
        Task.FromResult(Databases.Contains(databaseName));

    public Task ProvisionSchemaAsync(string databaseName, CancellationToken ct = default)
    {
        ProvisionCalls++;
        if (ThrowOnProvision)
        {
            throw new InvalidOperationException("simulated database creation failure");
        }

        Databases.Add(databaseName);
        return Task.CompletedTask;
    }

    public Task BootstrapAsync(string databaseName, TenantBootstrap bootstrap, CancellationToken ct = default)
    {
        Databases.Add(databaseName);

        var key = Key(databaseName, bootstrap.AdminEmail);
        if (!Users.ContainsKey(key))
        {
            Users[key] = new TenantUserRecord(
                Guid.NewGuid(),
                bootstrap.AdminEmail.ToLowerInvariant(),
                bootstrap.AdminFullName,
                "CA",
                bootstrap.AdminPasswordHash,
                true,
                null,
                "Company Admin",
                "CompanyAdmin");
        }

        return Task.CompletedTask;
    }

    public Task<TenantUserRecord?> FindUserByEmailAsync(string databaseName, string email, CancellationToken ct = default) =>
        Task.FromResult(Users.TryGetValue(Key(databaseName, email), out var user) ? user : null);

    public Task RecordLoginAsync(string databaseName, Guid userId, CancellationToken ct = default, string? verifiedPlainPassword = null) =>
        Task.CompletedTask;

    public Task SetUserPasswordAsync(string databaseName, string email, string passwordHash, CancellationToken ct = default, string? plainPassword = null)
    {
        var key = Key(databaseName, email);
        if (Users.TryGetValue(key, out var user))
        {
            Users[key] = user with { PasswordHash = passwordHash };
        }

        return Task.CompletedTask;
    }

    public Task<int> CountUsersAsync(string databaseName, CancellationToken ct = default) =>
        Task.FromResult(Users.Keys.Count(k => k.StartsWith(databaseName + "|", StringComparison.OrdinalIgnoreCase)));

    public Task<IReadOnlyList<CompanyEmployeeSummaryDto>> GetEmployeesAsync(string databaseName, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<CompanyEmployeeSummaryDto>>(Array.Empty<CompanyEmployeeSummaryDto>());

    public Task DropDatabaseAsync(string databaseName, CancellationToken ct = default)
    {
        Databases.Remove(databaseName);
        var keys = Users.Keys.Where(k => k.StartsWith(databaseName + "|", StringComparison.OrdinalIgnoreCase)).ToList();
        foreach (var key in keys)
        {
            Users.Remove(key);
        }

        return Task.CompletedTask;
    }

    /// <summary>Seeds a user directly (used to set up login scenarios).</summary>
    public TenantUserRecord SeedUser(string databaseName, string email, string passwordHash, string roleName = "Company Admin", string roleCode = "CompanyAdmin", bool isActive = true)
    {
        var record = new TenantUserRecord(Guid.NewGuid(), email.ToLowerInvariant(), "Test User", "TU", passwordHash, isActive, null, roleName, roleCode);
        Users[Key(databaseName, email)] = record;
        return record;
    }

    private static string Key(string databaseName, string email) => $"{databaseName}|{email.Trim().ToLowerInvariant()}";
}

internal sealed class FakePasswordHasher : IPasswordHasher
{
    public string Hash(string password) => "H:" + password;

    public bool Verify(string password, string hash) => hash == "H:" + password;
}

internal sealed class FakeEmailSender : IEmailSender
{
    public List<EmailMessage> Sent { get; } = new();

    public bool Fail { get; set; }

    public bool Delivered { get; set; } = true;

    public Task<EmailResult> SendAsync(EmailMessage message, CancellationToken ct = default)
    {
        Sent.Add(message);

        if (Fail)
        {
            return Task.FromResult(EmailResult.Failed("smtp unavailable"));
        }

        return Task.FromResult(Delivered ? EmailResult.Success() : EmailResult.Skipped());
    }
}

internal sealed class FakeJwtTokenService : IJwtTokenService
{
    private static readonly Dictionary<string, SetPasswordTokenPayload> SetPasswordTokens = new(StringComparer.Ordinal);

    public AuthToken CreateToken(User user, string roleName, Guid? companyId = null, string? companyCode = null) =>
        new("token", DateTime.UtcNow.AddHours(1));

    public AuthToken CreateToken(TokenSubject subject) =>
        new("token:" + subject.Email + ":" + subject.CompanyCode, DateTime.UtcNow.AddHours(1));

    public string CreateSetPasswordToken(SetPasswordTokenSubject subject, TimeSpan lifetime)
    {
        var token = $"sp-{Guid.NewGuid():N}";
        SetPasswordTokens[token] = new SetPasswordTokenPayload(
            subject.UserId,
            subject.EmployeeId,
            subject.Email,
            subject.EmployeeCode,
            subject.EmployeeName,
            subject.CompanyId,
            subject.CompanyCode,
            subject.CompanyName);
        return token;
    }

    public Task<SetPasswordTokenPayload?> ValidateSetPasswordTokenAsync(string token, CancellationToken ct = default) =>
        Task.FromResult(SetPasswordTokens.TryGetValue(token, out var payload) ? payload : null);
}

internal sealed class FakeTenantConnectionFactory : ITenantConnectionFactory
{
    public string BuildTenant(string databaseName) => "tenant:" + databaseName;

    public string BuildProvisioning(string databaseName) => "provisioning:" + databaseName;

    public string BuildDefault() => "default";
}

internal sealed class StubTenantContext : ITenantContext
{
    public ResolvedTenant? Tenant { get; private set; }

    public Guid? CompanyId => Tenant?.CompanyId;

    public void Set(ResolvedTenant? tenant) => Tenant = tenant;
}
