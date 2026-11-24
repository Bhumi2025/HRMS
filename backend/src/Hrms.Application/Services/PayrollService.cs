using Hrms.Application.Abstractions.Notifications;
using Hrms.Application.Abstractions.Persistence;
using Hrms.Application.Abstractions.Services;
using Hrms.Application.Abstractions.Tenancy;
using Hrms.Application.Common;
using Hrms.Application.DTOs;
using Hrms.Domain.Entities;
using Hrms.Domain.Enums;

namespace Hrms.Application.Services;

public sealed class PayrollService : IPayrollService
{
    private readonly IUnitOfWork _uow;
    private readonly IEmailSender? _emailSender;
    private readonly ITenantContext? _tenantContext;

    public PayrollService(
        IUnitOfWork uow,
        IEmailSender? emailSender = null,
        ITenantContext? tenantContext = null)
    {
        _uow = uow;
        _emailSender = emailSender;
        _tenantContext = tenantContext;
    }

    public async Task<PayrollSummaryDto> GetSummaryAsync(CancellationToken ct = default)
    {
        var payslips = _uow.Payslips.Query();

        var totals = await _uow.Payslips.FirstOrDefaultAsync(
            payslips.GroupBy(_ => 1).Select(g => new
            {
                Basic = g.Sum(p => p.BasicSalary),
                Allowances = g.Sum(p => p.Allowances),
                Deductions = g.Sum(p => p.Deductions),
                Net = g.Sum(p => p.NetPay),
            }),
            ct);

        var employees = await _uow.Payslips.CountQueryAsync(payslips.Select(p => p.EmployeeId).Distinct(), ct);
        var basic = totals?.Basic ?? 0m;
        var allowances = totals?.Allowances ?? 0m;
        var deductions = totals?.Deductions ?? 0m;
        var net = totals?.Net ?? 0m;
        var gross = basic + allowances;

        return new PayrollSummaryDto(
            gross,
            allowances,
            deductions,
            net,
            employees,
            basic);
    }

    public async Task<IReadOnlyList<PayrollRunDto>> GetRunsAsync(CancellationToken ct = default)
    {
        var runs = await _uow.PayrollRuns.ToListAsync(
            _uow.PayrollRuns.Query()
                .OrderByDescending(r => r.Year)
                .ThenByDescending(r => r.Month),
            ct);

        return runs.Select(ToRunDto).ToList();
    }

    public async Task<IReadOnlyList<PayslipDto>> GetPayslipsForRunAsync(Guid runId, CancellationToken ct = default)
    {
        var payslips = await _uow.Payslips.ListForRunAsync(runId, ct);
        if (payslips.Count == 0) return Array.Empty<PayslipDto>();

        var first = payslips[0];
        var daysInMonth = DateTime.DaysInMonth(first.Year, first.Month);
        var start = new DateOnly(first.Year, first.Month, 1);
        var end = new DateOnly(first.Year, first.Month, daysInMonth);

        var leaveTypes = await _uow.LeaveTypes.ListAsync(ct);
        var leaveTypeMap = leaveTypes.ToDictionary(lt => lt.Id, lt => lt.IsPaid);
        var approvedLeaves = await _uow.LeaveRequests.ToListAsync(
            _uow.LeaveRequests.Query()
                .Where(l => l.Status == LeaveStatus.Approved && l.FromDate <= end && l.ToDate >= start),
            ct);

        return payslips.Select(p =>
        {
            var empLeaves = approvedLeaves.Where(l => l.EmployeeId == p.EmployeeId).ToList();
            var realUnpaid = 0;
            var realPaid = 0;
            foreach (var l in empLeaves)
            {
                var isUnpaid = (leaveTypeMap.TryGetValue(l.LeaveTypeId, out var isPaid) && !isPaid) ||
                               (l.Reason != null && l.Reason.Contains("unpaid", StringComparison.OrdinalIgnoreCase));
                var from = l.FromDate > start ? l.FromDate : start;
                var to = l.ToDate < end ? l.ToDate : end;
                var overlap = (to.DayNumber - from.DayNumber) + 1;
                if (overlap > 0)
                {
                    if (isUnpaid) realUnpaid += overlap;
                    else realPaid += overlap;
                }
            }
            return ToPayslipDto(p, realUnpaid, realPaid);
        }).ToList();
    }

    public async Task<IReadOnlyList<PayslipDto>> GetPayslipsForEmployeeAsync(Guid employeeId, CancellationToken ct = default)
    {
        var payslips = await _uow.Payslips.ListForEmployeeAsync(employeeId, ct);
        return payslips
            .OrderByDescending(p => p.Year)
            .ThenByDescending(p => p.Month)
            .Select(p => ToPayslipDto(p))
            .ToList();
    }

    public async Task<PayrollPreflightCheckDto> PreflightCheckAsync(int month, int year, CancellationToken ct = default)
    {
        var daysInMonth = DateTime.DaysInMonth(year, month);
        var start = new DateOnly(year, month, 1);
        var end = new DateOnly(year, month, daysInMonth);

        // Find unresolved pending leaves that intersect with this payroll cycle
        var pendingLeaves = await _uow.LeaveRequests.ToListAsync(
            _uow.LeaveRequests.Query()
                .Where(l => l.Status == LeaveStatus.Pending && l.FromDate <= end && l.ToDate >= start),
            ct);

        if (pendingLeaves.Count > 0)
        {
            var empIds = pendingLeaves.Select(l => l.EmployeeId).Distinct().ToHashSet();
            var allEmployees = await _uow.Employees.ListAsync(ct);
            var names = allEmployees
                .Where(e => empIds.Contains(e.Id))
                .Select(e => $"{e.FirstName} {e.LastName}".Trim())
                .ToList();

            return new PayrollPreflightCheckDto(
                false,
                pendingLeaves.Count,
                $"You have {pendingLeaves.Count} pending leave approval(s) requiring HR resolution. Unresolved leaves affect attendance and unpaid salary deductions. Please approve or reject them before executing payroll.",
                names);
        }

        return new PayrollPreflightCheckDto(
            true,
            0,
            "All pre-flight checks passed: 0 pending leave requests found.",
            Array.Empty<string>());
    }

    public async Task<PayrollRunDto> RunPayrollAsync(RunPayrollRequest request, CancellationToken ct = default)
    {
        if (await _uow.PayrollRuns.GetByPeriodAsync(request.Year, request.Month, ct) is { } existing)
        {
            throw new ConflictException(
                $"Payroll for {Formatting.MonthYear(request.Month, request.Year)} has already been processed (status: {existing.Status}).");
        }

        var employees = await _uow.Employees.ListWithDepartmentAsync(ct);
        var active = employees.Where(e => e.Status != EmploymentStatus.Terminated).ToList();

        if (active.Count == 0)
        {
            throw new ValidationException("There are no employees to run payroll for.");
        }

        var daysInMonth = DateTime.DaysInMonth(request.Year, request.Month);
        var start = new DateOnly(request.Year, request.Month, 1);
        var end = new DateOnly(request.Year, request.Month, daysInMonth);

        // Load company work schedule to determine standard monthly working days (e.g. 5 days = 22 days, 5.5 days = 24.5 days)
        var companySettings = (await _uow.CompanySettings.ListAsync(ct)).FirstOrDefault();
        var workingDaysPerWeek = companySettings?.WorkingDaysPerWeek ?? 5.0m;
        if (workingDaysPerWeek < 1.0m || workingDaysPerWeek > 7.0m) workingDaysPerWeek = 5.0m;

        // Holidays in this month: deducted from required full working days as requested
        var holidays = await _uow.Holidays.ToListAsync(
            _uow.Holidays.Query().Where(h => h.Date >= start && h.Date <= end),
            ct);
        var holidayDates = holidays.Select(h => h.Date).ToHashSet();

        decimal monthlyWorkingDays = 0m;
        for (var day = 1; day <= daysInMonth; day++)
        {
            var curDate = new DateOnly(request.Year, request.Month, day);
            if (holidayDates.Contains(curDate))
            {
                // Holiday in month: deducted from working days
                continue;
            }

            var dt = new DateTime(request.Year, request.Month, day);
            if (dt.DayOfWeek >= DayOfWeek.Monday && dt.DayOfWeek <= DayOfWeek.Friday)
            {
                monthlyWorkingDays += 1.0m;
            }
            else if (dt.DayOfWeek == DayOfWeek.Saturday)
            {
                if (workingDaysPerWeek >= 6.0m) monthlyWorkingDays += 1.0m;
                else if (workingDaysPerWeek >= 5.5m) monthlyWorkingDays += 0.5m;
            }
            else if (dt.DayOfWeek == DayOfWeek.Sunday)
            {
                if (workingDaysPerWeek >= 7.0m) monthlyWorkingDays += 1.0m;
            }
        }
        if (monthlyWorkingDays <= 0m) monthlyWorkingDays = 22m;

        // Load leave types and approved leaves in this cycle to compute unpaid days
        var leaveTypes = await _uow.LeaveTypes.ListAsync(ct);
        var leaveTypeMap = leaveTypes.ToDictionary(lt => lt.Id, lt => lt.IsPaid);

        var approvedLeaves = await _uow.LeaveRequests.ToListAsync(
            _uow.LeaveRequests.Query()
                .Where(l => l.Status == LeaveStatus.Approved && l.FromDate <= end && l.ToDate >= start),
            ct);

        var run = new PayrollRun
        {
            Month = request.Month,
            Year = request.Year,
            PayDate = request.PayDate,
            PaymentMethod = request.PaymentMethod,
            Status = PayrollStatus.Processed,
            EmployeeCount = active.Count,
            ProcessedAtUtc = DateTime.UtcNow,
            ReductionPercent = request.ReductionPercent ?? 0m,
        };

        var payslips = new List<Payslip>();

        foreach (var employee in active)
        {
            var basic = employee.BasicSalary;
            var dailyRate = monthlyWorkingDays > 0 ? (basic / monthlyWorkingDays) : 0m;

            // Calculate unpaid leave days for this employee in this month
            var empLeaves = approvedLeaves.Where(l => l.EmployeeId == employee.Id).ToList();
            var unpaidDays = 0;
            foreach (var l in empLeaves)
            {
                var isUnpaid = (leaveTypeMap.TryGetValue(l.LeaveTypeId, out var isPaid) && !isPaid) ||
                               (l.Reason != null && l.Reason.Contains("unpaid", StringComparison.OrdinalIgnoreCase));
                if (isUnpaid)
                {
                    var from = l.FromDate > start ? l.FromDate : start;
                    var to = l.ToDate < end ? l.ToDate : end;
                    var overlap = (to.DayNumber - from.DayNumber) + 1;
                    if (overlap > 0) unpaidDays += overlap;
                }
            }

            // 1. Unpaid leave deduction: unpaid_leaves * (gross / totalDays)
            var unpaidDeduction = Math.Round(unpaidDays * dailyRate, 2);
            var salaryAfterUnpaid = Math.Max(0m, basic - unpaidDeduction);

            // 2. Company-wide reduction cut: % applied to salary after unpaid leaves
            var reductionRate = (request.ReductionPercent ?? 0m) / 100m;
            var reductionDeduction = Math.Round(salaryAfterUnpaid * reductionRate, 2);

            // 3. Total deductions & Net salary
            var deductions = unpaidDeduction + reductionDeduction;

            // User requirement: Currently not providing any allowance (frontend & backend)
            var allowances = 0m;
            var net = Math.Round(basic + allowances - deductions, 2);

            payslips.Add(new Payslip
            {
                PayrollRunId = run.Id,
                EmployeeId = employee.Id,
                Month = request.Month,
                Year = request.Year,
                BasicSalary = basic,
                Allowances = allowances,
                Deductions = deductions,
                NetPay = net,
                WorkingDays = (int)Math.Round(monthlyWorkingDays),
                Status = PayrollStatus.Processed,
                PayDate = request.PayDate,
                ReductionPercent = request.ReductionPercent ?? 0m,
            });
        }

        run.TotalGross = payslips.Sum(p => p.BasicSalary);
        run.TotalAllowances = 0m;
        run.TotalDeductions = payslips.Sum(p => p.Deductions);
        run.TotalNet = payslips.Sum(p => p.NetPay);

        await _uow.PayrollRuns.AddAsync(run, ct);
        await _uow.Payslips.AddRangeAsync(payslips, ct);

        // HR Broadcast Notification
        var monthDate = new DateTime(request.Year, request.Month, 1);
        await _uow.Notifications.AddAsync(new Notification
        {
            IconKey = "card",
            Title = "Payroll Run Processed",
            Message = $"Payroll for {monthDate:MMMM yyyy} was processed for {payslips.Count} employees. Total Net: ${run.TotalNet:N0}.",
            TimeLabel = "Just now",
            IsRead = false,
            CreatedAtUtc = DateTime.UtcNow,
        }, ct);

        // Individual Employee In-App Notifications
        var employeeIds = payslips.Select(p => p.EmployeeId).Distinct().ToList();
        var empUsers = await _uow.Users.ToListAsync(
            _uow.Users.Query().Where(u => u.EmployeeId.HasValue && employeeIds.Contains(u.EmployeeId.Value)), ct);

        foreach (var p in payslips)
        {
            var u = empUsers.FirstOrDefault(usr => usr.EmployeeId == p.EmployeeId);
            if (u != null)
            {
                await _uow.Notifications.AddAsync(new Notification
                {
                    UserId = u.Id,
                    IconKey = "payroll",
                    Title = $"Payslip Available: {monthDate:MMMM yyyy}",
                    Message = $"Your payslip for {monthDate:MMMM yyyy} is now available in your portal. Net Salary: ₹{p.NetPay:N2}.",
                    TimeLabel = "Payslip",
                    IsRead = false,
                    CreatedAtUtc = DateTime.UtcNow,
                }, ct);
            }
        }

        await _uow.SaveChangesAsync(ct);

        return ToRunDto(run);
    }

    public async Task<SendPayslipsResultDto> SendPayslipsAsync(SendPayslipsRequest request, CancellationToken ct = default)
    {
        if (request.EmployeeIds == null || request.EmployeeIds.Count == 0)
        {
            throw new ValidationException("No employees selected for payslip distribution.");
        }

        var companyName = _tenantContext?.Tenant?.Name ?? "HRNexus Corp";
        var monthName = new DateTime(request.Year, request.Month, 1).ToString("MMMM yyyy");
        var daysInMonth = DateTime.DaysInMonth(request.Year, request.Month);
        var periodLabel = $"01-{new DateTime(request.Year, request.Month, 1):MMM-yyyy} to {daysInMonth:D2}-{new DateTime(request.Year, request.Month, 1):MMM-yyyy}";

        int sentCount = 0;

        foreach (var empId in request.EmployeeIds)
        {
            var employee = await _uow.Employees.GetWithDetailsAsync(empId, ct);
            if (employee == null || string.IsNullOrWhiteSpace(employee.Email)) continue;

            var payslip = await _uow.Payslips.FirstOrDefaultAsync(
                _uow.Payslips.Query().Where(p => p.EmployeeId == empId && p.Month == request.Month && p.Year == request.Year),
                ct);

            var basic = payslip?.BasicSalary ?? employee.BasicSalary;
            var allowances = 0m;
            var deductions = payslip?.Deductions ?? 0m;
            var netPay = payslip?.NetPay ?? (basic - deductions);
            var dailyRate = daysInMonth > 0 ? (basic / daysInMonth) : 0m;
            var unpaidDays = dailyRate > 0 ? (int)Math.Round(deductions / dailyRate) : 0;
            var payableDays = Math.Max(0, daysInMonth - unpaidDays);
            var unpaidDeduction = deductions;
            var deptName = employee.Department?.Name ?? "General";
            var bankName = employee.BankName ?? "—";
            var accountNum = employee.AccountNumber ?? "—";

            var html = $@"
<!DOCTYPE html>
<html>
<head>
<meta charset='utf-8'/>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; background: #f8fafc; margin: 0; padding: 20px; }}
  .box {{ max-width: 650px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; }}
  .header {{ padding: 24px; border-bottom: 2px solid #e2e8f0; display: flex; justify-content: space-between; align-items: flex-start; }}
  .company-title {{ font-size: 20px; font-weight: 800; color: #0f172a; margin-bottom: 4px; }}
  .sub {{ font-size: 12px; color: #64748b; line-height: 1.4; }}
  .period {{ font-size: 13px; font-weight: 700; color: #2563eb; text-align: right; }}
  .section-title {{ font-size: 13px; font-weight: 700; color: #0f172a; margin: 16px 24px 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }}
  .details-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; padding: 0 24px 16px; font-size: 12px; }}
  .details-row {{ display: flex; justify-content: space-between; }}
  .lbl {{ color: #64748b; }}
  .val {{ font-weight: 600; color: #0f172a; }}
  table.payslip-tbl {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
  table.payslip-tbl th {{ background: #f1f5f9; text-align: left; padding: 8px 12px; font-weight: 700; color: #475569; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; }}
  table.payslip-tbl td {{ padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }}
  .net-banner {{ margin: 20px 24px; background: #ecfdf5; border: 1.5px solid #a7f3d0; border-radius: 8px; padding: 14px 18px; }}
  .net-val {{ font-size: 22px; font-weight: 800; color: #059669; }}
  .footer {{ text-align: center; font-size: 11px; color: #94a3b8; padding: 16px; border-top: 1px solid #f1f5f9; }}
</style>
</head>
<body>
<div class='box'>
  <div class='header'>
    <div>
      <div class='company-title'>{companyName}</div>
      <div class='sub'>Enterprise HRMS & Payroll Service</div>
    </div>
    <div style='text-align: right;'>
      <div class='period'>Payslip from {periodLabel}</div>
    </div>
  </div>

  <div class='section-title'>Employee Details</div>
  <div class='details-grid'>
    <div class='details-row'><span class='lbl'>Employee Name:</span> <span class='val'>{employee.FirstName} {employee.LastName}</span></div>
    <div class='details-row'><span class='lbl'>Code:</span> <span class='val'>{employee.EmployeeCode}</span></div>
    <div class='details-row'><span class='lbl'>Designation:</span> <span class='val'>{employee.JobTitle}</span></div>
    <div class='details-row'><span class='lbl'>Department:</span> <span class='val'>{deptName}</span></div>
    <div class='details-row'><span class='lbl'>Date of Joining:</span> <span class='val'>{employee.JoinDate:dd-MMM-yyyy}</span></div>
    <div class='details-row'><span class='lbl'>Bank Name:</span> <span class='val'>{bankName}</span></div>
    <div class='details-row'><span class='lbl'>Account Number:</span> <span class='val'>{accountNum}</span></div>
    <div class='details-row'><span class='lbl'>Work Location:</span> <span class='val'>{companyName}</span></div>
  </div>

  <table class='payslip-tbl'>
    <thead>
      <tr>
        <th style='width: 35%;'>Earnings</th>
        <th style='width: 15%; text-align: right;'>Amount</th>
        <th style='width: 35%;'>Deductions</th>
        <th style='width: 15%; text-align: right;'>Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Basic Salary</td>
        <td style='text-align: right; font-weight: 600;'>{basic:N2}</td>
        <td>Unpaid Leave (LOP) Deduction</td>
        <td style='text-align: right; font-weight: 600; color: #dc2626;'>{unpaidDeduction:N2}</td>
      </tr>
      {(allowances > 0 ? $@"<tr><td>Allowances (HRA / Special)</td><td style='text-align: right; font-weight: 600;'>{allowances:N2}</td><td></td><td></td></tr>" : "")}
      <tr style='background: #f8fafc; font-weight: 700;'>
        <td>Total Gross Earnings</td>
        <td style='text-align: right;'>{(basic + allowances):N2}</td>
        <td>Total Deductions</td>
        <td style='text-align: right; color: #dc2626;'>{deductions:N2}</td>
      </tr>
    </tbody>
  </table>

  <div style='margin: 16px 24px; padding: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 12px; display: flex; justify-content: space-around; text-align: center;'>
    <div><span class='lbl'>Total Days:</span> <span class='val'>{daysInMonth}</span></div>
    <div><span class='lbl'>Payable Days:</span> <span class='val'>{payableDays}</span></div>
    <div><span class='lbl'>Unpaid Days:</span> <span class='val' style='color: #dc2626;'>{unpaidDays}</span></div>
  </div>

  <div class='net-banner'>
    <div style='font-size: 12px; font-weight: 700; color: #065f46;'>Total Net Payable:</div>
    <div class='net-val'>₹{netPay:N2}</div>
    <div style='font-size: 11px; color: #047857; margin-top: 4px;'>Total Net Payable = Gross Earnings - Total Deductions</div>
  </div>

  <div class='footer'>This PDF is system-generated, no signature required.</div>
</div>
</body>
</html>";

            if (_emailSender != null)
            {
                var msg = new EmailMessage(
                    employee.Email,
                    $"Your Payslip for {monthName} - {companyName}",
                    html,
                    $"Your payslip for {monthName} is ready. Net Payable: ₹{netPay:N2}.");
                var res = await _emailSender.SendAsync(msg, ct);
                if (res.Delivered || res.Simulated) sentCount++;
            }

            var empUser = await _uow.Users.FirstOrDefaultAsync(
                _uow.Users.Query().Where(u => u.EmployeeId == empId), ct);
            if (empUser != null)
            {
                await _uow.Notifications.AddAsync(new Notification
                {
                    UserId = empUser.Id,
                    IconKey = "payroll",
                    Title = $"Payslip Delivered: {monthName}",
                    Message = $"Your payslip for {monthName} has been distributed to your portal and email. Net Salary: ₹{netPay:N2}.",
                    TimeLabel = "Payslip",
                    IsRead = false,
                    CreatedAtUtc = DateTime.UtcNow
                }, ct);
            }
        }

        await _uow.SaveChangesAsync(ct);

        return new SendPayslipsResultDto(
            request.EmployeeIds.Count,
            sentCount,
            $"Payslips successfully emailed to {sentCount} of {request.EmployeeIds.Count} employees.");
    }

    private static PayrollRunDto ToRunDto(PayrollRun run) => new(
        run.Id,
        run.Month,
        run.Year,
        run.PayDate,
        run.Status.ToString(),
        run.EmployeeCount,
        run.TotalGross,
        run.TotalAllowances,
        run.TotalDeductions,
        run.TotalNet,
        run.ReductionPercent);

    private static PayslipDto ToPayslipDto(Payslip p) => ToPayslipDto(p, null, null);

    private static PayslipDto ToPayslipDto(Payslip p, int? actualUnpaid, int? actualPaid = null)
    {
        var name = p.Employee is null ? "—" : $"{p.Employee.FirstName} {p.Employee.LastName}".Trim();
        var unpaidDays = actualUnpaid ?? 0;
        var paidDays = actualPaid ?? 0;
        var workedDays = p.WorkingDays;

        return new PayslipDto(
            p.Id,
            p.EmployeeId,
            name,
            p.Employee?.Department?.Name ?? "—",
            p.Month,
            p.Year,
            p.BasicSalary,
            0m,
            p.Deductions,
            p.BasicSalary - p.Deductions,
            p.WorkingDays,
            p.Status.ToString(),
            p.PayDate,
            p.Employee?.EmployeeCode,
            p.Employee?.JobTitle ?? "Specialist",
            p.Employee?.BankName ?? "—",
            p.Employee?.AccountNumber ?? "—",
            p.Employee?.IfscCode ?? "—",
            workedDays,
            paidDays,
            unpaidDays,
            8,
            p.Employee?.Email,
            p.ReductionPercent);
    }

    public async Task<bool> DeletePayrollRunAsync(Guid runId, CancellationToken ct = default)
    {
        var run = await _uow.PayrollRuns.GetByIdAsync(runId, ct);
        if (run is null) return false;

        var payslips = await _uow.Payslips.ToListAsync(
            _uow.Payslips.Query().Where(p => p.PayrollRunId == runId),
            ct);

        if (payslips.Count > 0)
        {
            _uow.Payslips.RemoveRange(payslips);
        }

        _uow.PayrollRuns.Remove(run);
        await _uow.SaveChangesAsync(ct);
        return true;
    }
}
