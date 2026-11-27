using Hrms.Api.Security;
using Hrms.Application.Abstractions.Services;
using Hrms.Application.Common;
using Hrms.Application.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Hrms.Api.Controllers;

[ApiController]
[Route("api/face-recognition")]
[Tags("Face Recognition")]
public sealed class FaceRecognitionController : ControllerBase
{
    private readonly IFaceRecognitionService _faceRecognition;
    private readonly FaceRecognitionOptions _options;

    public FaceRecognitionController(
        IFaceRecognitionService faceRecognition,
        IOptions<FaceRecognitionOptions> options)
    {
        _faceRecognition = faceRecognition;
        _options = options.Value;
    }

    /// <summary>Authenticates an employee using facial biometric matching and returns a JWT access token.</summary>
    [HttpPost("login")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(FaceLoginResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult<FaceLoginResponse>> Login(
        [FromBody] FaceLoginRequest request,
        CancellationToken ct)
    {
        if (!EndpointRateLimiter.TryConsume(HttpContext, "face-login", _options.RateLimitPerMinute, out var limited))
        {
            return limited!;
        }

        return Ok(await _faceRecognition.FaceLoginAsync(request, ct));
    }

    /// <summary>Verifies a captured facial biometric descriptor against enrolled employees without issuing a session token.</summary>
    [HttpPost("verify")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(FaceMatchResultDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult<FaceMatchResultDto>> Verify(
        [FromBody] FaceVerifyRequest request,
        CancellationToken ct)
    {
        if (!EndpointRateLimiter.TryConsume(HttpContext, "face-verify", _options.RateLimitPerMinute, out var limited))
        {
            return limited!;
        }

        return Ok(await _faceRecognition.VerifyFaceAsync(request, ct));
    }

    /// <summary>Returns the face biometric enrollment status for the caller or specified employee.</summary>
    [HttpGet("status")]
    [Authorize]
    [ProducesResponseType(typeof(FaceEnrollmentStatusDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<FaceEnrollmentStatusDto>> Status(
        [FromQuery] Guid? employeeId,
        CancellationToken ct) =>
        Ok(await _faceRecognition.GetEnrollmentStatusAsync(employeeId, ct));
}
