using Hrms.Application.Abstractions.Services;
using Hrms.Application.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Hrms.Api.Controllers;

[ApiController]
[Route("api/offboarding")]
[Authorize(Policy = "HrAdmin")]
[Tags("Offboarding")]
public sealed class OffboardingController : ControllerBase
{
    private readonly IOffboardingService _offboarding;

    public OffboardingController(IOffboardingService offboarding)
    {
        _offboarding = offboarding;
    }

    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<OffboardingDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<OffboardingDto>>> List(
        [FromQuery] string? status,
        [FromQuery] string? search,
        CancellationToken ct) =>
        Ok(await _offboarding.ListAsync(status, search, ct));

    [HttpGet("summary")]
    [ProducesResponseType(typeof(OffboardingSummaryDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<OffboardingSummaryDto>> Summary(CancellationToken ct) =>
        Ok(await _offboarding.GetSummaryAsync(ct));

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(OffboardingDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<OffboardingDto>> GetById(Guid id, CancellationToken ct) =>
        Ok(await _offboarding.GetByIdAsync(id, ct));

    [HttpPost]
    [ProducesResponseType(typeof(OffboardingDto), StatusCodes.Status201Created)]
    public async Task<ActionResult<OffboardingDto>> Initiate(
        [FromBody] InitiateOffboardingRequest request,
        CancellationToken ct)
    {
        var created = await _offboarding.InitiateAsync(request, ct);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPut("{id:guid}")]
    [ProducesResponseType(typeof(OffboardingDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<OffboardingDto>> Update(
        Guid id,
        [FromBody] UpdateOffboardingRequest request,
        CancellationToken ct) =>
        Ok(await _offboarding.UpdateAsync(id, request, ct));

    [HttpPost("{id:guid}/complete")]
    [ProducesResponseType(typeof(OffboardingDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<OffboardingDto>> Complete(
        Guid id,
        [FromBody] CompleteOffboardingRequest request,
        CancellationToken ct) =>
        Ok(await _offboarding.CompleteAsync(id, request, ct));
}
