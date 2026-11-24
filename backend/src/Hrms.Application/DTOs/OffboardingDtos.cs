namespace Hrms.Application.DTOs;

public sealed record OffboardingDto(
    Guid Id,
    Guid EmployeeId,
    string EmployeeCode,
    string EmployeeName,
    string EmployeeInitials,
    string Department,
    string Designation,
    DateOnly ResignationDate,
    DateOnly FinalWorkingDate,
    string Reason,
    string? ReasonDetails,
    string Status,
    string? HandoverNotes,
    bool CompanyAssetsReturned,
    bool AccessRevoked,
    bool FinalSettlementProcessed,
    string? Remarks,
    DateTime CreatedAtUtc,
    DateTime? CompletedAtUtc);

public sealed record InitiateOffboardingRequest(
    Guid EmployeeId,
    DateOnly ResignationDate,
    DateOnly FinalWorkingDate,
    string Reason,
    string? ReasonDetails,
    string? HandoverNotes,
    string? Remarks);

public sealed record UpdateOffboardingRequest(
    DateOnly FinalWorkingDate,
    string Reason,
    string? ReasonDetails,
    string? HandoverNotes,
    bool CompanyAssetsReturned,
    bool AccessRevoked,
    bool FinalSettlementProcessed,
    string? Remarks,
    string? Status);

public sealed record CompleteOffboardingRequest(
    bool RevokeSystemAccess = true,
    string? FinalRemarks = null);

public sealed record OffboardingSummaryDto(
    int Total,
    int Pending,
    int InProgress,
    int Completed,
    int AssetsPending);
