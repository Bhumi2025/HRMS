using System.ComponentModel.DataAnnotations;
using Hrms.Domain.Enums;

namespace Hrms.Application.DTOs;

public sealed record PayrollRunDto(
    Guid Id,
    int Month,
    int Year,
    DateOnly PayDate,
    string Status,
    int EmployeeCount,
    decimal TotalGross,
    decimal TotalAllowances,
    decimal TotalDeductions,
    decimal TotalNet,
    decimal ReductionPercent = 0m);

public sealed record PayslipDto(
    Guid Id,
    Guid EmployeeId,
    string EmployeeName,
    string Department,
    int Month,
    int Year,
    decimal BasicSalary,
    decimal Allowances,
    decimal Deductions,
    decimal NetPay,
    int WorkingDays,
    string Status,
    DateOnly PayDate,
    string? EmployeeCode = null,
    string? Designation = null,
    string? BankName = null,
    string? AccountNumber = null,
    string? IfscCode = null,
    int WorkedDays = 0,
    int PaidLeaveDays = 0,
    int UnpaidDays = 0,
    int WeeklyOffDays = 0,
    string? Email = null,
    decimal ReductionPercent = 0m);

public sealed record RunPayrollRequest(
    [Range(1, 12)] int Month,
    [Range(2000, 2100)] int Year,
    DateOnly PayDate,
    PaymentMode PaymentMethod,
    decimal? ReductionPercent = 0);

public sealed record PayrollSummaryDto(
    decimal GrossPayroll,
    decimal TotalAllowances,
    decimal TotalDeductions,
    decimal NetPayable,
    int EmployeeCount,
    decimal BasicSalary = 0m);

public sealed record PayrollPreflightCheckDto(
    bool CanRun,
    int PendingLeavesCount,
    string Message,
    IReadOnlyList<string> PendingEmployeeNames);

public sealed record SendPayslipsRequest(
    IReadOnlyList<Guid> EmployeeIds,
    int Month,
    int Year,
    string? CustomMessage = null);

public sealed record SendPayslipsResultDto(
    int TotalRequested,
    int SuccessfullySent,
    string Message);
