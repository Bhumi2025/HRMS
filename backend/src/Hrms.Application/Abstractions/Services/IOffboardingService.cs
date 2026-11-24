using Hrms.Application.DTOs;

namespace Hrms.Application.Abstractions.Services;

public interface IOffboardingService
{
    Task<IReadOnlyList<OffboardingDto>> ListAsync(string? status = null, string? search = null, CancellationToken ct = default);

    Task<OffboardingSummaryDto> GetSummaryAsync(CancellationToken ct = default);

    Task<OffboardingDto> GetByIdAsync(Guid id, CancellationToken ct = default);

    Task<OffboardingDto> InitiateAsync(InitiateOffboardingRequest request, CancellationToken ct = default);

    Task<OffboardingDto> UpdateAsync(Guid id, UpdateOffboardingRequest request, CancellationToken ct = default);

    Task<OffboardingDto> CompleteAsync(Guid id, CompleteOffboardingRequest request, CancellationToken ct = default);
}
