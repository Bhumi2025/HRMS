namespace Hrms.Application.DTOs;

public sealed record FaceLoginRequest(
    float[]? FaceDescriptor = null,
    string? FaceDescriptorJson = null,
    string? Email = null,
    string? EmployeeCode = null,
    string? CompanyCode = null,
    double? LivenessScore = null);

public sealed record FaceVerifyRequest(
    float[]? FaceDescriptor = null,
    string? FaceDescriptorJson = null,
    Guid? EmployeeId = null,
    string? Email = null,
    string? EmployeeCode = null,
    string? CompanyCode = null);

public sealed record FaceMatchResultDto(
    bool Matched,
    double ConfidenceScore,
    double UnitDistance,
    double CosineSimilarity,
    Guid? EmployeeId,
    string? EmployeeCode,
    string? FullName,
    string? Email,
    string Message);

public sealed record FaceLoginResponse(
    string AccessToken,
    DateTime ExpiresAtUtc,
    UserDto User,
    double MatchScore,
    double UnitDistance,
    double CosineSimilarity);

public sealed record FaceEnrollmentStatusDto(
    Guid EmployeeId,
    string EmployeeCode,
    string FullName,
    bool IsFaceEnrolled,
    DateTime? EnrolledAtUtc,
    string? FacePhotoUrl);
