using Hrms.Application.Abstractions.Persistence;
using Hrms.Application.Abstractions.Security;
using Hrms.Application.Abstractions.Services;
using Hrms.Application.Abstractions.Tenancy;
using Hrms.Application.Common;
using Hrms.Application.DTOs;
using Hrms.Domain.Enums;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Hrms.Application.Services;

public sealed class FaceRecognitionService : IFaceRecognitionService
{
    private readonly ITenantDatabaseService _tenantDb;
    private readonly ITenantResolutionService _tenants;
    private readonly ITenantContext _tenantContext;
    private readonly IJwtTokenService _tokenService;
    private readonly FaceRecognitionOptions _options;
    private readonly ILogger<FaceRecognitionService>? _logger;
    private readonly ICurrentUser? _currentUser;
    private readonly IUnitOfWork? _uow;

    public FaceRecognitionService(
        ITenantDatabaseService tenantDb,
        ITenantResolutionService tenants,
        ITenantContext tenantContext,
        IJwtTokenService tokenService,
        IOptions<FaceRecognitionOptions>? options = null,
        ILogger<FaceRecognitionService>? logger = null,
        ICurrentUser? currentUser = null,
        IUnitOfWork? uow = null)
    {
        _tenantDb = tenantDb;
        _tenants = tenants;
        _tenantContext = tenantContext;
        _tokenService = tokenService;
        _options = options?.Value ?? new FaceRecognitionOptions();
        _logger = logger;
        _currentUser = currentUser;
        _uow = uow;
    }

    public async Task<FaceLoginResponse> FaceLoginAsync(FaceLoginRequest request, CancellationToken ct = default)
    {
        if (request is null)
        {
            throw new ValidationException("Face login request payload is required.");
        }

        ValidateLivenessScore(request.LivenessScore);
        var candidateVector = FaceBiometricMatcher.ResolveAndValidateDescriptor(
            request.FaceDescriptor,
            request.FaceDescriptorJson,
            _options.ExpectedDescriptorLength);

        var targetEmail = string.IsNullOrWhiteSpace(request.Email) ? null : request.Email.Trim().ToLowerInvariant();
        var targetCode = string.IsNullOrWhiteSpace(request.EmployeeCode) ? null : request.EmployeeCode.Trim();

        var tenant = await ResolveActiveTenantAsync(request.CompanyCode, targetEmail, ct);
        var candidates = await _tenantDb.GetFaceLoginCandidatesAsync(tenant.DatabaseName!, ct);

        if (candidates.Count == 0)
        {
            _logger?.LogWarning("Face login rejected: no enrolled face biometrics exist in company {CompanyCode}.", tenant.Code);
            throw new UnauthorizedException("No enrolled face biometrics found. Please sign in with password and enroll your Face ID.");
        }

        // 1:1 targeted verification when Email or EmployeeCode is provided
        if (!string.IsNullOrWhiteSpace(targetEmail) || !string.IsNullOrWhiteSpace(targetCode))
        {
            var matchedCandidate = candidates.FirstOrDefault(c =>
                (!string.IsNullOrWhiteSpace(targetEmail) &&
                 (string.Equals(c.Email, targetEmail, StringComparison.OrdinalIgnoreCase) ||
                  string.Equals(c.UserEmail, targetEmail, StringComparison.OrdinalIgnoreCase))) ||
                (!string.IsNullOrWhiteSpace(targetCode) &&
                 string.Equals(c.EmployeeCode, targetCode, StringComparison.OrdinalIgnoreCase)));

            if (matchedCandidate is null)
            {
                _logger?.LogWarning("Face login 1:1 failed: no enrolled face found for identifier in company {CompanyCode}.", tenant.Code);
                throw new UnauthorizedException("Face biometric is not enrolled for this account. Please sign in with password first.");
            }

            EnsureCandidateActiveAndEligible(matchedCandidate, tenant.Code);

            var storedVector = FaceBiometricMatcher.TryParseDescriptor(matchedCandidate.FaceDescriptor);
            if (storedVector is null ||
                FaceBiometricMatcher.IsPlaceholderDescriptor(storedVector, matchedCandidate.FacePhotoUrl, _options.ExpectedDescriptorLength))
            {
                throw new UnauthorizedException("Enrolled face profile requires re-registration. Please sign in with password and re-enroll.");
            }

            var metrics = FaceBiometricMatcher.CompareUnitDescriptors(storedVector, candidateVector);
            if (metrics.UnitDistance > _options.VerifyMaxUnitDistance)
            {
                _logger?.LogWarning(
                    "Face login 1:1 mismatch for employee {EmployeeCode} in company {CompanyCode}: unitDistance={UnitDist:F4}, score={Score}",
                    matchedCandidate.EmployeeCode, tenant.Code, metrics.UnitDistance, metrics.ConfidenceScore);
                throw new UnauthorizedException("Face biometric verification failed. Identity could not be confirmed.");
            }

            return await IssueLoginResponseAsync(matchedCandidate, metrics, tenant, ct);
        }

        // 1:N biometric identification across enrolled employees
        TenantFaceCandidate? bestCandidate = null;
        FaceComparisonMetrics bestMetrics = default;
        double secondBestDistance = double.MaxValue;
        Guid secondBestEmployeeId = Guid.Empty;

        foreach (var candidate in candidates)
        {
            var storedVector = FaceBiometricMatcher.TryParseDescriptor(candidate.FaceDescriptor);
            if (storedVector is null ||
                FaceBiometricMatcher.IsPlaceholderDescriptor(storedVector, candidate.FacePhotoUrl, _options.ExpectedDescriptorLength))
            {
                continue;
            }

            var metrics = FaceBiometricMatcher.CompareUnitDescriptors(storedVector, candidateVector);
            if (bestCandidate is null || metrics.UnitDistance < bestMetrics.UnitDistance)
            {
                if (bestCandidate is not null && bestCandidate.EmployeeId != candidate.EmployeeId)
                {
                    secondBestDistance = bestMetrics.UnitDistance;
                    secondBestEmployeeId = bestCandidate.EmployeeId;
                }

                bestCandidate = candidate;
                bestMetrics = metrics;
            }
            else if (candidate.EmployeeId != bestCandidate.EmployeeId && metrics.UnitDistance < secondBestDistance)
            {
                secondBestDistance = metrics.UnitDistance;
                secondBestEmployeeId = candidate.EmployeeId;
            }
        }

        if (bestCandidate is null || bestMetrics.UnitDistance > _options.LoginMaxUnitDistance)
        {
            _logger?.LogWarning(
                "Face login 1:N rejected in company {CompanyCode}: bestUnitDistance={UnitDist:F4}, threshold={Threshold:F4}",
                tenant.Code, bestCandidate is null ? -1.0 : bestMetrics.UnitDistance, _options.LoginMaxUnitDistance);
            throw new UnauthorizedException("Face not recognized. Please align your face clearly in good lighting or sign in with password.");
        }

        if (secondBestEmployeeId != Guid.Empty &&
            secondBestDistance <= _options.LoginMaxUnitDistance + 0.04 &&
            (secondBestDistance - bestMetrics.UnitDistance) < _options.LoginAmbiguityMinMargin)
        {
            _logger?.LogWarning(
                "Face login 1:N rejected due to ambiguous close match in company {CompanyCode}: best={BestDist:F4}, second={SecondDist:F4}",
                tenant.Code, bestMetrics.UnitDistance, secondBestDistance);
            throw new UnauthorizedException("Ambiguous face match detected. Please sign in with your email and face verification.");
        }

        EnsureCandidateActiveAndEligible(bestCandidate, tenant.Code);
        return await IssueLoginResponseAsync(bestCandidate, bestMetrics, tenant, ct);
    }

    public async Task<FaceMatchResultDto> VerifyFaceAsync(FaceVerifyRequest request, CancellationToken ct = default)
    {
        if (request is null)
        {
            throw new ValidationException("Face verification request payload is required.");
        }

        var candidateVector = FaceBiometricMatcher.ResolveAndValidateDescriptor(
            request.FaceDescriptor,
            request.FaceDescriptorJson,
            _options.ExpectedDescriptorLength);

        var targetEmail = string.IsNullOrWhiteSpace(request.Email) ? null : request.Email.Trim().ToLowerInvariant();
        var targetCode = string.IsNullOrWhiteSpace(request.EmployeeCode) ? null : request.EmployeeCode.Trim();
        var tenant = await ResolveActiveTenantAsync(request.CompanyCode, targetEmail, ct);
        var candidates = await _tenantDb.GetFaceLoginCandidatesAsync(tenant.DatabaseName!, ct);

        if (request.EmployeeId.HasValue || !string.IsNullOrWhiteSpace(targetEmail) || !string.IsNullOrWhiteSpace(targetCode))
        {
            var target = candidates.FirstOrDefault(c =>
                (request.EmployeeId.HasValue && c.EmployeeId == request.EmployeeId.Value) ||
                (!string.IsNullOrWhiteSpace(targetEmail) &&
                 (string.Equals(c.Email, targetEmail, StringComparison.OrdinalIgnoreCase) ||
                  string.Equals(c.UserEmail, targetEmail, StringComparison.OrdinalIgnoreCase))) ||
                (!string.IsNullOrWhiteSpace(targetCode) &&
                 string.Equals(c.EmployeeCode, targetCode, StringComparison.OrdinalIgnoreCase)));

            if (target is null)
            {
                return new FaceMatchResultDto(false, 0, 1.0, 0, null, null, null, null, "No enrolled face found for target employee.");
            }

            if (target.IsOffboarded || target.EmployeeStatus != EmploymentStatus.Active || !target.UserIsActive)
            {
                return new FaceMatchResultDto(false, 0, 1.0, 0, target.EmployeeId, target.EmployeeCode, target.FullName, target.Email, "Employee account is inactive or offboarded.");
            }

            var stored = FaceBiometricMatcher.TryParseDescriptor(target.FaceDescriptor);
            if (stored is null || FaceBiometricMatcher.IsPlaceholderDescriptor(stored, target.FacePhotoUrl, _options.ExpectedDescriptorLength))
            {
                return new FaceMatchResultDto(false, 0, 1.0, 0, target.EmployeeId, target.EmployeeCode, target.FullName, target.Email, "Stored biometric profile is a placeholder and must be re-enrolled.");
            }

            var metrics = FaceBiometricMatcher.CompareUnitDescriptors(stored, candidateVector);
            var matched = metrics.UnitDistance <= _options.VerifyMaxUnitDistance;
            return new FaceMatchResultDto(
                matched,
                metrics.ConfidenceScore,
                metrics.UnitDistance,
                metrics.CosineSimilarity,
                matched ? target.EmployeeId : null,
                matched ? target.EmployeeCode : null,
                matched ? target.FullName : null,
                matched ? target.Email : null,
                matched ? $"Face verified ({metrics.ConfidenceScore}% match)." : $"Face did not match ({metrics.ConfidenceScore}% match).");
        }

        TenantFaceCandidate? best = null;
        FaceComparisonMetrics bestMetrics = default;

        foreach (var c in candidates)
        {
            if (c.IsOffboarded || c.EmployeeStatus != EmploymentStatus.Active || !c.UserIsActive)
            {
                continue;
            }

            var stored = FaceBiometricMatcher.TryParseDescriptor(c.FaceDescriptor);
            if (stored is null || FaceBiometricMatcher.IsPlaceholderDescriptor(stored, c.FacePhotoUrl, _options.ExpectedDescriptorLength))
            {
                continue;
            }

            var metrics = FaceBiometricMatcher.CompareUnitDescriptors(stored, candidateVector);
            if (best is null || metrics.UnitDistance < bestMetrics.UnitDistance)
            {
                best = c;
                bestMetrics = metrics;
            }
        }

        if (best is null || bestMetrics.UnitDistance > _options.LoginMaxUnitDistance)
        {
            return new FaceMatchResultDto(
                false,
                best is null ? 0 : bestMetrics.ConfidenceScore,
                best is null ? 1.0 : bestMetrics.UnitDistance,
                best is null ? 0 : bestMetrics.CosineSimilarity,
                null,
                null,
                null,
                null,
                "Face not recognized.");
        }

        return new FaceMatchResultDto(
            true,
            bestMetrics.ConfidenceScore,
            bestMetrics.UnitDistance,
            bestMetrics.CosineSimilarity,
            best.EmployeeId,
            best.EmployeeCode,
            best.FullName,
            best.Email,
            $"Face matched {best.FullName} ({bestMetrics.ConfidenceScore}% match).");
    }

    public async Task<FaceEnrollmentStatusDto> GetEnrollmentStatusAsync(Guid? employeeId, CancellationToken ct = default)
    {
        if (_uow is null || _currentUser is null)
        {
            throw new InvalidOperationException("Enrollment status lookup requires an active authenticated request context.");
        }

        var targetId = employeeId ?? _currentUser.EmployeeId;
        if (!targetId.HasValue || targetId.Value == Guid.Empty)
        {
            throw new NotFoundException("No employee profile is linked to this user account.");
        }

        if (_currentUser.IsAuthenticated &&
            _currentUser.IsInRole("Employee") &&
            _currentUser.EmployeeId is { } ownId &&
            ownId != targetId.Value)
        {
            throw new ForbiddenException("Employees may only inspect their own face enrollment status.");
        }

        var employee = await _uow.Employees.GetByIdAsync(targetId.Value, ct)
            ?? throw NotFoundException.For("Employee", targetId.Value);

        var parsed = FaceBiometricMatcher.TryParseDescriptor(employee.FaceDescriptor);
        var isEnrolled = parsed is not null &&
                         !FaceBiometricMatcher.IsPlaceholderDescriptor(parsed, employee.FacePhotoUrl, _options.ExpectedDescriptorLength);

        return new FaceEnrollmentStatusDto(
            employee.Id,
            employee.EmployeeCode,
            employee.FullName,
            isEnrolled,
            isEnrolled ? employee.FaceEnrolledAtUtc : null,
            employee.FacePhotoUrl);
    }

    private async Task<ResolvedTenant> ResolveActiveTenantAsync(string? companyCode, string? email, CancellationToken ct)
    {
        ResolvedTenant? tenant = null;

        if (!string.IsNullOrWhiteSpace(companyCode))
        {
            tenant = await _tenants.ResolveByCodeAsync(companyCode.Trim(), ct);
            if (tenant is null)
            {
                throw new UnauthorizedException("Unknown company code.");
            }
        }
        else if (!string.IsNullOrWhiteSpace(email))
        {
            tenant = await _tenants.ResolveByEmailAsync(email, ct);
        }

        tenant ??= _tenantContext.Tenant ?? await _tenants.ResolveDefaultAsync(ct);

        if (tenant is null)
        {
            throw new UnauthorizedException("Unable to resolve company tenant.");
        }

        if (!tenant.IsDefault && tenant.Status != CompanyStatus.Active)
        {
            throw tenant.Status == CompanyStatus.Suspended
                ? new ForbiddenException("This company has been suspended. Contact your administrator.")
                : new ForbiddenException("This company is not active yet.");
        }

        if (string.IsNullOrWhiteSpace(tenant.DatabaseName))
        {
            throw new InvalidOperationException("The company database has not been provisioned.");
        }

        return tenant;
    }

    private void ValidateLivenessScore(double? livenessScore)
    {
        if (!livenessScore.HasValue)
        {
            return;
        }

        var normalized = livenessScore.Value > 1.0 ? livenessScore.Value / 100.0 : livenessScore.Value;
        if (double.IsNaN(normalized) || double.IsInfinity(normalized) || normalized < 0.30 || normalized > 1.0)
        {
            throw new ValidationException("Face detection confidence is invalid or too low. Look directly at the camera.");
        }
    }

    private void EnsureCandidateActiveAndEligible(TenantFaceCandidate candidate, string companyCode)
    {
        if (candidate.IsOffboarded ||
            candidate.EmployeeStatus is EmploymentStatus.Offboarding or EmploymentStatus.Terminated or EmploymentStatus.Resigned)
        {
            _logger?.LogWarning(
                "Face login blocked for offboarded/inactive employee {EmployeeCode} in company {CompanyCode} (status={Status}).",
                candidate.EmployeeCode, companyCode, candidate.EmployeeStatus);
            throw new ForbiddenException("Your account has been deactivated. Please contact HR.");
        }

        if (!candidate.UserId.HasValue || candidate.UserId.Value == Guid.Empty)
        {
            _logger?.LogWarning(
                "Face login blocked for employee {EmployeeCode} in company {CompanyCode}: no user account linked.",
                candidate.EmployeeCode, companyCode);
            throw new UnauthorizedException("No active login account is linked to this employee profile.");
        }

        if (!candidate.UserIsActive)
        {
            _logger?.LogWarning(
                "Face login blocked for deactivated user account {UserId} ({EmployeeCode}) in company {CompanyCode}.",
                candidate.UserId, candidate.EmployeeCode, companyCode);
            throw new ForbiddenException("Your account has been deactivated. Please contact HR.");
        }
    }

    private async Task<FaceLoginResponse> IssueLoginResponseAsync(
        TenantFaceCandidate candidate,
        FaceComparisonMetrics metrics,
        ResolvedTenant tenant,
        CancellationToken ct)
    {
        var userId = candidate.UserId!.Value;
        var fullName = !string.IsNullOrWhiteSpace(candidate.UserFullName) ? candidate.UserFullName : candidate.FullName;
        var email = !string.IsNullOrWhiteSpace(candidate.UserEmail) ? candidate.UserEmail : candidate.Email;
        var initials = !string.IsNullOrWhiteSpace(candidate.UserInitials) ? candidate.UserInitials : Formatting.Initials(fullName);

        await _tenantDb.RecordLoginAsync(tenant.DatabaseName!, userId, ct);

        var token = _tokenService.CreateToken(new TokenSubject(
            userId,
            fullName,
            initials,
            email,
            candidate.RoleName,
            candidate.EmployeeId,
            tenant.CompanyId,
            tenant.Code));

        var userDto = new UserDto(
            userId,
            fullName,
            email,
            initials,
            candidate.RoleName,
            candidate.RoleCode,
            candidate.EmployeeId,
            tenant.CompanyId,
            tenant.Name,
            tenant.Code,
            tenant.LogoUrl);

        _logger?.LogInformation(
            "Face login succeeded for employee {EmployeeCode} in company {CompanyCode} (score={Score}, unitDist={UnitDist:F4}).",
            candidate.EmployeeCode, tenant.Code, metrics.ConfidenceScore, metrics.UnitDistance);

        return new FaceLoginResponse(
            token.AccessToken,
            token.ExpiresAtUtc,
            userDto,
            metrics.ConfidenceScore,
            metrics.UnitDistance,
            metrics.CosineSimilarity);
    }
}
