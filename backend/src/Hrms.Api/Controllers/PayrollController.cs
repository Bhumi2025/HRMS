using Hrms.Application.Abstractions.Services;
using Hrms.Application.DTOs;
using Microsoft.AspNetCore.Mvc;

namespace Hrms.Api.Controllers;

[ApiController]
[Route("api/payroll")]
[Tags("Payroll")]
public sealed class PayrollController : ControllerBase
{
    private readonly IPayrollService _payroll;
    private readonly IEmployeeService _employees;

    public PayrollController(IPayrollService payroll, IEmployeeService employees)
    {
        _payroll = payroll;
        _employees = employees;
    }

    [HttpGet("summary")]
    [ProducesResponseType(typeof(PayrollSummaryDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<PayrollSummaryDto>> Summary(CancellationToken ct) =>
        Ok(await _payroll.GetSummaryAsync(ct));

    [HttpGet("runs")]
    [ProducesResponseType(typeof(IReadOnlyList<PayrollRunDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<PayrollRunDto>>> Runs(CancellationToken ct) =>
        Ok(await _payroll.GetRunsAsync(ct));

    [HttpGet("runs/{runId:guid}/payslips")]
    [ProducesResponseType(typeof(IReadOnlyList<PayslipDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<PayslipDto>>> RunPayslips(Guid runId, CancellationToken ct) =>
        Ok(await _payroll.GetPayslipsForRunAsync(runId, ct));

    [HttpGet("employees/{employeeId:guid}/payslips")]
    [ProducesResponseType(typeof(IReadOnlyList<PayslipDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<PayslipDto>>> EmployeePayslips(Guid employeeId, CancellationToken ct) =>
        Ok(await _payroll.GetPayslipsForEmployeeAsync(employeeId, ct));

    /// <summary>Payslips for the signed-in employee (or the first employee when unlinked).</summary>
    [HttpGet("me/payslips")]
    [ProducesResponseType(typeof(IReadOnlyList<PayslipDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<PayslipDto>>> MyPayslips(
        [FromQuery] Guid? employeeId,
        CancellationToken ct)
    {
        var id = await _employees.ResolveEmployeeIdAsync(employeeId, ct);
        return Ok(await _payroll.GetPayslipsForEmployeeAsync(id, ct));
    }

    /// <summary>Checks for any unresolved pending leaves before running payroll.</summary>
    [HttpGet("preflight-check")]
    [ProducesResponseType(typeof(PayrollPreflightCheckDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<PayrollPreflightCheckDto>> PreflightCheck(
        [FromQuery] int month,
        [FromQuery] int year,
        CancellationToken ct) =>
        Ok(await _payroll.PreflightCheckAsync(month, year, ct));

    /// <summary>Sends payslips to selected employees via registered email.</summary>
    [HttpPost("send-payslips")]
    [ProducesResponseType(typeof(SendPayslipsResultDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<SendPayslipsResultDto>> SendPayslips(
        [FromBody] SendPayslipsRequest request,
        CancellationToken ct) =>
        Ok(await _payroll.SendPayslipsAsync(request, ct));

    /// <summary>Processes payroll for a month. Fails with 409 if that period already exists.</summary>
    [HttpPost("run")]
    [ProducesResponseType(typeof(PayrollRunDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<PayrollRunDto>> Run(
        [FromBody] RunPayrollRequest request,
        CancellationToken ct)
    {
        var run = await _payroll.RunPayrollAsync(request, ct);
        return CreatedAtAction(nameof(Runs), run);
    }

    [HttpDelete("runs/{runId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteRun(Guid runId, CancellationToken ct)
    {
        var deleted = await _payroll.DeletePayrollRunAsync(runId, ct);
        return deleted ? NoContent() : NotFound();
    }
}
