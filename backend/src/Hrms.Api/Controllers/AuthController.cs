using System.Security.Claims;
using Hrms.Api.Extensions;
using Hrms.Api.Security;
using Hrms.Application.Abstractions.Services;
using Hrms.Application.Common;
using Hrms.Application.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Hrms.Api.Controllers;

[ApiController]
[Route("api/auth")]
[Tags("Authentication")]
public sealed class AuthController : ControllerBase
{
    private readonly IAuthService _auth;
    private readonly IAccountActivationService _activation;
    private readonly Hrms.Application.Abstractions.Tenancy.ITenantResolutionService _tenants;
    private readonly IFaceRecognitionService _faceRecognition;
    private readonly FaceRecognitionOptions _faceOptions;

    public AuthController(
        IAuthService auth,
        IAccountActivationService activation,
        Hrms.Application.Abstractions.Tenancy.ITenantResolutionService tenants,
        IFaceRecognitionService faceRecognition,
        IOptions<FaceRecognitionOptions> faceOptions)
    {
        _auth = auth;
        _activation = activation;
        _tenants = tenants;
        _faceRecognition = faceRecognition;
        _faceOptions = faceOptions.Value;
    }

    /// <summary>Returns the public tenant branding for login screen resolution.</summary>
    [HttpGet("tenant-branding")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(TenantBrandingDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult<TenantBrandingDto>> TenantBranding(
        [FromQuery] string? code,
        [FromQuery] string? subdomain,
        CancellationToken ct)
    {
        if (!EndpointRateLimiter.TryConsume(HttpContext, "branding", 60, out var limited))
        {
            return limited!;
        }

        var lookup = !string.IsNullOrWhiteSpace(code) ? code.Trim() : (!string.IsNullOrWhiteSpace(subdomain) ? subdomain.Trim() : null);

        if (!string.IsNullOrWhiteSpace(lookup))
        {
            var resolved = await _tenants.ResolveByCodeAsync(lookup, ct);
            if (resolved != null && resolved.Status == Hrms.Domain.Enums.CompanyStatus.Active && !string.IsNullOrWhiteSpace(resolved.LogoUrl))
            {
                return Ok(new TenantBrandingDto(resolved.Name, resolved.Code, resolved.LogoUrl));
            }
        }

        // Identical response for unknown, suspended, and no-logo companies to prevent enumeration
        return Ok(new TenantBrandingDto("HR Nexus", "HRNEXUS", null));
    }

    /// <summary>Authenticates a user and returns a JWT access token.</summary>
    [HttpPost("login")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(LoginResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<LoginResponse>> Login(
        [FromBody] LoginRequest request,
        CancellationToken ct) =>
        Ok(await _auth.LoginAsync(request, ct));

    /// <summary>Authenticates a user via facial biometric verification and returns a JWT access token.</summary>
    [HttpPost("face-login")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(FaceLoginResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult<FaceLoginResponse>> FaceLogin(
        [FromBody] FaceLoginRequest request,
        CancellationToken ct)
    {
        if (!EndpointRateLimiter.TryConsume(HttpContext, "face-login", _faceOptions.RateLimitPerMinute, out var limited))
        {
            return limited!;
        }

        return Ok(await _faceRecognition.FaceLoginAsync(request, ct));
    }

    /// <summary>Returns the profile of the authenticated caller.</summary>
    [HttpGet("me")]
    [Authorize]
    [ProducesResponseType(typeof(UserDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<UserDto>> Me(CancellationToken ct)
    {
        var userId = User.GetUserId();
        return userId is null ? Unauthorized() : Ok(await _auth.GetCurrentUserAsync(userId.Value, ct));
    }

    /// <summary>Changes the caller's password.</summary>
    [HttpPost("change-password")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> ChangePassword(
        [FromBody] ChangePasswordRequest request,
        CancellationToken ct)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized();

        await _auth.ChangePasswordAsync(userId.Value, request, ct);
        return NoContent();
    }

    /// <summary>Updates the caller's profile details.</summary>
    [HttpPut("profile")]
    [Authorize]
    [ProducesResponseType(typeof(UserDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<UserDto>> UpdateProfile(
        [FromBody] UpdateProfileRequest request,
        CancellationToken ct)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized();

        return Ok(await _auth.UpdateProfileAsync(userId.Value, request, ct));
    }

    /// <summary>Validates an activation token so the set-password screen can render.</summary>
    [HttpGet("activate")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(ActivationInfoResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<ActivationInfoResponse>> ValidateActivation(
        [FromQuery] string token,
        CancellationToken ct) =>
        Ok(await _activation.ValidateAsync(token, ct));

    /// <summary>Sets the company admin password from an activation token and signs them in.</summary>
    [HttpPost("activate")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(LoginResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<LoginResponse>> Activate(
        [FromBody] ActivateAccountRequest request,
        CancellationToken ct) =>
        Ok(await _activation.ActivateAsync(request, ct));

    /// <summary>Validates an onboarded employee set-password token so the set-password screen can render.</summary>
    [HttpGet("set-password")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(SetPasswordInfoResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<SetPasswordInfoResponse>> ValidateSetPassword(
        [FromQuery] string token,
        CancellationToken ct) =>
        Ok(await _activation.ValidateSetPasswordAsync(token, ct));

    /// <summary>Sets the onboarded employee's password from their email link token and signs them in.</summary>
    [HttpPost("set-password")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(LoginResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<LoginResponse>> SetPassword(
        [FromBody] SetPasswordRequest request,
        CancellationToken ct) =>
        Ok(await _activation.SetPasswordAsync(request, ct));
}
