using Hrms.Domain.Entities;

namespace Hrms.Application.Abstractions.Security;

/// <summary>Issues signed JWT access tokens.</summary>
public interface IJwtTokenService
{
    AuthToken CreateToken(User user, string roleName, Guid? companyId = null, string? companyCode = null);

    AuthToken CreateToken(TokenSubject subject);

    string CreateSetPasswordToken(SetPasswordTokenSubject subject, TimeSpan lifetime);

    Task<SetPasswordTokenPayload?> ValidateSetPasswordTokenAsync(string token, CancellationToken ct = default);
}

public sealed record AuthToken(string AccessToken, DateTime ExpiresAtUtc);

/// <summary>The claims required to mint a token, independent of a persisted user entity.</summary>
public sealed record TokenSubject(
    Guid UserId,
    string FullName,
    string Initials,
    string Email,
    string RoleName,
    Guid? EmployeeId,
    Guid? CompanyId,
    string? CompanyCode);

public sealed record SetPasswordTokenSubject(
    Guid UserId,
    Guid EmployeeId,
    string Email,
    string EmployeeCode,
    string EmployeeName,
    Guid? CompanyId,
    string? CompanyCode,
    string CompanyName);

public sealed record SetPasswordTokenPayload(
    Guid UserId,
    Guid EmployeeId,
    string Email,
    string EmployeeCode,
    string EmployeeName,
    Guid? CompanyId,
    string? CompanyCode,
    string CompanyName);

/// <summary>Hashes and verifies passwords (implemented with ASP.NET Core Identity's hasher).</summary>
public interface IPasswordHasher
{
    string Hash(string password);

    bool Verify(string password, string hash);
}
