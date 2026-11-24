using Hrms.Domain.Common;
using Hrms.Domain.Enums;

namespace Hrms.Domain.Entities;

public enum OffboardingStatus
{
    Pending = 1,
    InProgress = 2,
    Completed = 3,
    Cancelled = 4,
}

public class OffboardingRecord : BaseEntity
{
    public Guid EmployeeId { get; set; }

    public Employee? Employee { get; set; }

    public DateOnly ResignationDate { get; set; }

    public DateOnly FinalWorkingDate { get; set; }

    public string Reason { get; set; } = string.Empty;

    public string? ReasonDetails { get; set; }

    public OffboardingStatus Status { get; set; } = OffboardingStatus.Pending;

    public string? HandoverNotes { get; set; }

    public bool CompanyAssetsReturned { get; set; }

    public bool AccessRevoked { get; set; }

    public bool FinalSettlementProcessed { get; set; }

    public string? Remarks { get; set; }

    public Guid? InitiatedByUserId { get; set; }

    public User? InitiatedByUser { get; set; }

    public DateTime? CompletedAtUtc { get; set; }
}
