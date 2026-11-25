using System.Security.Claims;
using System.Text;
using Hrms.Application.Abstractions.Security;
using Hrms.Application.Common;
using Hrms.Domain.Entities;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Hrms.Infrastructure.Security;

/// <summary>Issues HS256 JWT access tokens containing the user id, role, employee id and company.</summary>
public sealed class JwtTokenService : IJwtTokenService
{
    private readonly JwtOptions _options;

    public JwtTokenService(IOptions<JwtOptions> options)
    {
        _options = options.Value;
    }

    public AuthToken CreateToken(User user, string roleName, Guid? companyId = null, string? companyCode = null) =>
        CreateToken(new TokenSubject(
            user.Id,
            user.FullName,
            user.Initials,
            user.Email,
            roleName,
            user.EmployeeId,
            companyId,
            companyCode));

    public AuthToken CreateToken(TokenSubject subject)
    {
        if (string.IsNullOrWhiteSpace(_options.Key))
        {
            throw new InvalidOperationException("JWT signing key is not configured (Jwt:Key).");
        }

        var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.Key));
        var credentials = new SigningCredentials(signingKey, SecurityAlgorithms.HmacSha256);
        var expires = DateTime.UtcNow.AddMinutes(_options.ExpiryMinutes);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, subject.UserId.ToString()),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new(ClaimTypes.NameIdentifier, subject.UserId.ToString()),
            new(ClaimTypes.Name, subject.FullName),
            new(ClaimTypes.Email, subject.Email),
            new(ClaimTypes.Role, subject.RoleName),
            new("initials", subject.Initials),
        };

        if (subject.EmployeeId is { } employeeId)
        {
            claims.Add(new Claim("employeeId", employeeId.ToString()));
        }

        if (subject.CompanyId is { } companyId)
        {
            claims.Add(new Claim("companyId", companyId.ToString()));
        }

        if (!string.IsNullOrWhiteSpace(subject.CompanyCode))
        {
            claims.Add(new Claim("companyCode", subject.CompanyCode));
        }

        var descriptor = new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(claims),
            Expires = expires,
            Issuer = _options.Issuer,
            Audience = _options.Audience,
            SigningCredentials = credentials,
        };

        var handler = new JsonWebTokenHandler();
        var token = handler.CreateToken(descriptor);

        return new AuthToken(token, expires);
    }

    private const string SetPasswordPurpose = "employee_set_password";

    public string CreateSetPasswordToken(SetPasswordTokenSubject subject, TimeSpan lifetime)
    {
        if (string.IsNullOrWhiteSpace(_options.Key))
        {
            throw new InvalidOperationException("JWT signing key is not configured (Jwt:Key).");
        }

        var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.Key));
        var credentials = new SigningCredentials(signingKey, SecurityAlgorithms.HmacSha256);

        var claims = new List<Claim>
        {
            new("purpose", SetPasswordPurpose),
            new(JwtRegisteredClaimNames.Sub, subject.UserId.ToString()),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new("email", subject.Email),
            new("employeeId", subject.EmployeeId.ToString()),
            new("employeeCode", subject.EmployeeCode),
            new("employeeName", subject.EmployeeName),
            new("companyName", subject.CompanyName),
        };

        if (subject.CompanyId is { } companyId)
        {
            claims.Add(new Claim("companyId", companyId.ToString()));
        }

        if (!string.IsNullOrWhiteSpace(subject.CompanyCode))
        {
            claims.Add(new Claim("companyCode", subject.CompanyCode));
        }

        var descriptor = new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(claims),
            Expires = DateTime.UtcNow.Add(lifetime),
            Issuer = _options.Issuer,
            Audience = _options.Audience,
            SigningCredentials = credentials,
        };

        return new JsonWebTokenHandler().CreateToken(descriptor);
    }

    public async Task<SetPasswordTokenPayload?> ValidateSetPasswordTokenAsync(string token, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(_options.Key))
        {
            return null;
        }

        var handler = new JsonWebTokenHandler();
        var parameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = _options.Issuer,
            ValidateAudience = true,
            ValidAudience = _options.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.Key)),
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1),
        };

        var result = await handler.ValidateTokenAsync(token, parameters);
        if (!result.IsValid || result.Claims is null)
        {
            return null;
        }

        string? Claim(string name) =>
            result.Claims.TryGetValue(name, out var val) ? val?.ToString() : null;

        if (!string.Equals(Claim("purpose"), SetPasswordPurpose, StringComparison.Ordinal))
        {
            return null;
        }

        if (!Guid.TryParse(Claim(JwtRegisteredClaimNames.Sub) ?? Claim(ClaimTypes.NameIdentifier), out var userId) ||
            !Guid.TryParse(Claim("employeeId"), out var employeeId))
        {
            return null;
        }

        var email = Claim("email") ?? Claim(ClaimTypes.Email);
        var employeeCode = Claim("employeeCode") ?? string.Empty;
        var employeeName = Claim("employeeName") ?? string.Empty;
        var companyName = Claim("companyName") ?? "HRMS Portal";
        Guid? companyId = Guid.TryParse(Claim("companyId"), out var cid) ? cid : null;
        var companyCode = Claim("companyCode");

        if (string.IsNullOrWhiteSpace(email))
        {
            return null;
        }

        return new SetPasswordTokenPayload(
            userId,
            employeeId,
            email,
            employeeCode,
            employeeName,
            companyId,
            companyCode,
            companyName);
    }
}
