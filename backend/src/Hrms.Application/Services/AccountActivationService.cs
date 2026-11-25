using Hrms.Application.Abstractions.Persistence;
using Hrms.Application.Abstractions.Security;
using Hrms.Application.Abstractions.Services;
using Hrms.Application.Abstractions.Tenancy;
using Hrms.Application.Common;
using Hrms.Application.Common.Tenancy;
using Hrms.Application.DTOs;
using Hrms.Domain.Entities;
using Hrms.Domain.Enums;

namespace Hrms.Application.Services;

/// <summary>Validates and consumes company admin activation invitations.</summary>
public sealed class AccountActivationService : IAccountActivationService
{
    private readonly IMasterUnitOfWork _master;
    private readonly ITenantDatabaseService _tenantDb;
    private readonly IPasswordHasher _passwordHasher;
    private readonly IJwtTokenService _tokenService;
    private readonly ITenantResolutionService? _tenantResolver;

    public AccountActivationService(
        IMasterUnitOfWork master,
        ITenantDatabaseService tenantDb,
        IPasswordHasher passwordHasher,
        IJwtTokenService tokenService,
        ITenantResolutionService? tenantResolver = null)
    {
        _master = master;
        _tenantDb = tenantDb;
        _passwordHasher = passwordHasher;
        _tokenService = tokenService;
        _tenantResolver = tenantResolver;
    }

    public async Task<ActivationInfoResponse> ValidateAsync(string token, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return new ActivationInfoResponse(false, null, null, null, "This activation link is not valid.");
        }

        var invitation = await _master.Invitations.GetByTokenHashAsync(TenantNaming.HashToken(token), ct);
        if (invitation is null)
        {
            return new ActivationInfoResponse(false, null, null, null, "This activation link is not valid.");
        }

        var company = await _master.Companies.GetByIdAsync(invitation.CompanyId, ct);
        return Describe(invitation, company);
    }

    public async Task<LoginResponse> ActivateAsync(ActivateAccountRequest request, CancellationToken ct = default)
    {
        var invitation = await _master.Invitations.GetByTokenHashAsync(TenantNaming.HashToken(request.Token), ct)
                         ?? throw new ValidationException("This activation link is not valid.");

        if (invitation.Status == InvitationStatus.Accepted)
        {
            throw new ValidationException("This account has already been activated.");
        }

        if (invitation.ExpiresAtUtc < DateTime.UtcNow)
        {
            invitation.Status = InvitationStatus.Expired;
            _master.Invitations.Update(invitation);
            await _master.SaveChangesAsync(ct);
            throw new ValidationException("This activation link has expired. Ask your administrator to resend it.");
        }

        var company = await _master.Companies.GetByIdAsync(invitation.CompanyId, ct)
                      ?? throw new NotFoundException("The company for this invitation no longer exists.");

        if (string.IsNullOrWhiteSpace(company.DatabaseName))
        {
            throw new ValidationException("The company database is not ready yet.");
        }

        if (company.Status == CompanyStatus.Suspended)
        {
            throw new ForbiddenException("This company has been suspended.");
        }

        var email = invitation.Email.Trim().ToLowerInvariant();
        await _tenantDb.SetUserPasswordAsync(company.DatabaseName, email, _passwordHasher.Hash(request.NewPassword), ct);

        var user = await _tenantDb.FindUserByEmailAsync(company.DatabaseName, email, ct)
                   ?? throw new NotFoundException("The company administrator account was not found.");

        invitation.Status = InvitationStatus.Accepted;
        invitation.AcceptedAtUtc = DateTime.UtcNow;
        invitation.LastError = null;
        _master.Invitations.Update(invitation);

        if (company.Status != CompanyStatus.Active)
        {
            company.Status = CompanyStatus.Active;
            company.ProvisionedAtUtc ??= DateTime.UtcNow;
            _master.Companies.Update(company);
        }

        await _master.SaveChangesAsync(ct);
        _tenantResolver?.InvalidateCache(company.Id, company.Code);
        await _tenantDb.RecordLoginAsync(company.DatabaseName, user.Id, ct);

        var token = _tokenService.CreateToken(new TokenSubject(
            user.Id,
            user.FullName,
            user.Initials,
            user.Email,
            user.RoleName,
            user.EmployeeId,
            company.Id,
            company.Code));

        var dto = new UserDto(
            user.Id,
            user.FullName,
            user.Email,
            user.Initials,
            user.RoleName,
            user.RoleCode,
            user.EmployeeId,
            company.Id,
            company.Name,
            company.Code);

        return new LoginResponse(token.AccessToken, token.ExpiresAtUtc, dto);
    }

    public async Task<SetPasswordInfoResponse> ValidateSetPasswordAsync(string token, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return new SetPasswordInfoResponse(false, null, null, null, null, null, "This set-password link is missing its token.");
        }

        var payload = await _tokenService.ValidateSetPasswordTokenAsync(token, ct);
        if (payload is null)
        {
            return new SetPasswordInfoResponse(false, null, null, null, null, null, "This set-password link is invalid or has expired.");
        }

        var company = await ResolveCompanyForTokenAsync(payload, ct);
        if (company is null)
        {
            return new SetPasswordInfoResponse(false, payload.CompanyName, payload.CompanyCode, payload.EmployeeCode, payload.EmployeeName, payload.Email, "The company for this account no longer exists.");
        }

        if (company.Status == CompanyStatus.Suspended)
        {
            return new SetPasswordInfoResponse(false, company.Name, company.Code, payload.EmployeeCode, payload.EmployeeName, payload.Email, "This company has been suspended.");
        }

        return new SetPasswordInfoResponse(
            true,
            string.IsNullOrWhiteSpace(payload.CompanyName) ? company.Name : payload.CompanyName,
            company.Code,
            payload.EmployeeCode,
            payload.EmployeeName,
            payload.Email,
            null);
    }

    public async Task<LoginResponse> SetPasswordAsync(SetPasswordRequest request, CancellationToken ct = default)
    {
        var payload = await _tokenService.ValidateSetPasswordTokenAsync(request.Token, ct)
                      ?? throw new ValidationException("This set-password link is invalid or has expired.");

        var company = await ResolveCompanyForTokenAsync(payload, ct)
                      ?? throw new NotFoundException("The company for this account no longer exists.");

        if (company.Status == CompanyStatus.Suspended)
        {
            throw new ForbiddenException("This company has been suspended.");
        }

        var dbName = company.DatabaseName ?? string.Empty;
        var email = payload.Email.Trim().ToLowerInvariant();
        await _tenantDb.SetUserPasswordAsync(dbName, email, _passwordHasher.Hash(request.NewPassword), ct, request.NewPassword);

        var user = await _tenantDb.FindUserByEmailAsync(dbName, email, ct)
                   ?? throw new NotFoundException("The employee account was not found.");

        if (!user.IsActive || user.IsOffboarded || user.EmployeeStatus is EmploymentStatus.Offboarding or EmploymentStatus.Terminated or EmploymentStatus.Resigned)
        {
            throw new ForbiddenException("Your account has been deactivated. Please contact HR.");
        }

        await _tenantDb.RecordLoginAsync(dbName, user.Id, ct);

        var authToken = _tokenService.CreateToken(new TokenSubject(
            user.Id,
            user.FullName,
            user.Initials,
            user.Email,
            user.RoleName,
            user.EmployeeId,
            company.Id,
            company.Code));

        var dto = new UserDto(
            user.Id,
            user.FullName,
            user.Email,
            user.Initials,
            user.RoleName,
            user.RoleCode,
            user.EmployeeId,
            company.Id,
            company.Name,
            company.Code,
            company.LogoUrl);

        return new LoginResponse(authToken.AccessToken, authToken.ExpiresAtUtc, dto);
    }

    private async Task<Company?> ResolveCompanyForTokenAsync(SetPasswordTokenPayload payload, CancellationToken ct)
    {
        if (payload.CompanyId is { } companyId)
        {
            var byId = await _master.Companies.GetByIdAsync(companyId, ct);
            if (byId is not null) return byId;
        }

        if (!string.IsNullOrWhiteSpace(payload.CompanyCode))
        {
            var byCode = await _master.Companies.GetByCodeAsync(payload.CompanyCode, ct);
            if (byCode is not null) return byCode;
        }

        return await _master.Companies.GetDefaultAsync(ct);
    }

    private static ActivationInfoResponse Describe(CompanyInvitation invitation, Company? company)
    {
        var name = company?.Name;
        var code = company?.Code;

        if (invitation.Status == InvitationStatus.Accepted)
        {
            return new ActivationInfoResponse(false, name, code, invitation.Email, "This account has already been activated.");
        }

        if (invitation.ExpiresAtUtc < DateTime.UtcNow)
        {
            return new ActivationInfoResponse(false, name, code, invitation.Email, "This activation link has expired. Ask your administrator to resend it.");
        }

        return new ActivationInfoResponse(true, name, code, invitation.Email, null);
    }
}
