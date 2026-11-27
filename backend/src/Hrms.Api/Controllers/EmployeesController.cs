using Hrms.Application.Abstractions.Services;
using Hrms.Application.Common;
using Hrms.Application.DTOs;
using Hrms.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Hrms.Api.Controllers;

[ApiController]
[Route("api/employees")]
[Authorize]
[Tags("Employees")]
public sealed class EmployeesController : ControllerBase
{
    private readonly IEmployeeService _employees;
    private readonly Hrms.Application.Abstractions.Security.ICurrentUser _currentUser;

    public EmployeesController(IEmployeeService employees, Hrms.Application.Abstractions.Security.ICurrentUser currentUser)
    {
        _employees = employees;
        _currentUser = currentUser;
    }

    /// <summary>Paginated, filterable employee directory.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(PagedResult<EmployeeListItemDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<PagedResult<EmployeeListItemDto>>> Search(
        [FromQuery] string? search,
        [FromQuery] Guid? departmentId,
        [FromQuery] EmploymentStatus? status,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10,
        CancellationToken ct = default) =>
        Ok(await _employees.SearchAsync(new EmployeeQuery(search, departmentId, status, page, pageSize), ct));

    [HttpGet("department-headcount")]
    [ProducesResponseType(typeof(IReadOnlyList<DepartmentHeadcountDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<DepartmentHeadcountDto>>> DepartmentHeadcount(CancellationToken ct) =>
        Ok(await _employees.DepartmentHeadcountAsync(ct));

    [HttpGet("email-available")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> IsEmailAvailable(
        [FromQuery] string email,
        [FromQuery] Guid? excludeEmployeeId = null,
        CancellationToken ct = default)
    {
        var available = await _employees.IsEmailAvailableAsync(email, excludeEmployeeId, ct);
        return Ok(new
        {
            available,
            message = available
                ? null
                : $"A user with email '{email.Trim().ToLowerInvariant()}' already exists in this company. Email ID must be unique."
        });
    }

    /// <summary>Employee record linked to the signed-in user.</summary>
    [HttpGet("me")]
    [ProducesResponseType(typeof(EmployeeDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<EmployeeDetailDto>> Me(
        [FromQuery] Guid? employeeId,
        CancellationToken ct)
    {
        if (!employeeId.HasValue && !_currentUser.EmployeeId.HasValue)
        {
            return NotFound(new { message = "The signed-in user is an administrator without an assigned employee profile." });
        }
        var id = await _employees.ResolveEmployeeIdAsync(employeeId, ct);
        return Ok(await _employees.GetAsync(id, ct));
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(EmployeeDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<EmployeeDetailDto>> Get(Guid id, CancellationToken ct) =>
        Ok(await _employees.GetAsync(id, ct));

    [HttpPost]
    [Authorize(Policy = "HrAdmin")]
    [ProducesResponseType(typeof(EmployeeDetailDto), StatusCodes.Status201Created)]
    public async Task<ActionResult<EmployeeDetailDto>> Create(
        [FromBody] CreateEmployeeRequest request,
        CancellationToken ct)
    {
        var created = await _employees.CreateAsync(request, ct);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }

    [HttpPut("me")]
    [Authorize]
    [ProducesResponseType(typeof(EmployeeDetailDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<EmployeeDetailDto>> UpdateMe(
        [FromBody] UpdateEmployeeRequest request,
        CancellationToken ct)
    {
        var guarded = GuardRoleAssignment(request, out var errorResult);
        if (errorResult is not null)
        {
            return errorResult;
        }
        var id = await _employees.ResolveEmployeeIdAsync(null, ct);
        return Ok(await _employees.UpdateAsync(id, guarded, ct));
    }

    public sealed record UpdatePhotoRequest(string PhotoUrl);

    [HttpPut("me/photo")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> UpdateMyPhoto(
        [FromBody] UpdatePhotoRequest request,
        CancellationToken ct)
    {
        var id = await _employees.ResolveEmployeeIdAsync(null, ct);
        await _employees.UpdatePhotoAsync(id, request.PhotoUrl, ct);
        return Ok(new { message = "Photo updated successfully." });
    }

    [HttpPut("{id:guid}/photo")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> UpdatePhoto(
        Guid id,
        [FromBody] UpdatePhotoRequest request,
        CancellationToken ct)
    {
        if (!IsHrAdminCaller())
        {
            var empClaim = User.FindFirst("employeeId")?.Value;
            if (string.IsNullOrWhiteSpace(empClaim) || !Guid.TryParse(empClaim, out var userEmpId) || userEmpId != id)
            {
                return Forbid();
            }
        }

        await _employees.UpdatePhotoAsync(id, request.PhotoUrl, ct);
        return Ok(new { message = "Photo updated successfully." });
    }

    [HttpPut("{id:guid}")]
    [Authorize]
    [ProducesResponseType(typeof(EmployeeDetailDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<EmployeeDetailDto>> Update(
        Guid id,
        [FromBody] UpdateEmployeeRequest request,
        CancellationToken ct)
    {
        if (!IsHrAdminCaller())
        {
            var empClaim = User.FindFirst("employeeId")?.Value;
            if (string.IsNullOrWhiteSpace(empClaim) || !Guid.TryParse(empClaim, out var userEmpId) || userEmpId != id)
            {
                return Forbid();
            }
        }

        var guarded = GuardRoleAssignment(request, out var errorResult);
        if (errorResult is not null)
        {
            return errorResult;
        }

        return Ok(await _employees.UpdateAsync(id, guarded, ct));
    }

    private string CallerRoleNormalized()
    {
        var role = User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? _currentUser.Role ?? string.Empty;
        return new string(role.Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant();
    }

    private bool IsHrAdminCaller() =>
        CallerRoleNormalized() is "superadmin" or "sa" or "companyadmin" or "ca" or "hrmanager" or "hr";

    private UpdateEmployeeRequest GuardRoleAssignment(UpdateEmployeeRequest request, out ActionResult? errorResult)
    {
        errorResult = null;
        if (!IsHrAdminCaller())
        {
            return request with { RoleCode = null };
        }

        var caller = CallerRoleNormalized();
        var requested = new string((request.RoleCode ?? string.Empty).Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant();
        if (requested is "superadmin" or "sa" && caller is not ("superadmin" or "sa"))
        {
            errorResult = StatusCode(StatusCodes.Status403Forbidden, new { message = "Only Super Admin can assign the Super Admin role." });
            return request;
        }

        if (requested is "companyadmin" or "ca" or "manager" && caller is not ("superadmin" or "sa" or "companyadmin" or "ca"))
        {
            errorResult = StatusCode(StatusCodes.Status403Forbidden, new { message = "Only Company Admin can assign the Company Admin role." });
            return request;
        }

        return request;
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Policy = "HrAdmin")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await _employees.DeleteAsync(id, ct);
        return NoContent();
    }
}
