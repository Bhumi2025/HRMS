using System.Text.Json;
using Hrms.Application.Common;

namespace Hrms.Application.Services;

public readonly record struct FaceComparisonMetrics(
    double UnitDistance,
    double CosineSimilarity,
    double ConfidenceScore);

/// <summary>
/// Shared biometric descriptor parsing, validation, L2 scaling, and similarity comparison
/// used across Face Recognition Login and Face Enrollment.
/// </summary>
public static class FaceBiometricMatcher
{
    public const int DefaultDescriptorLength = 128;

    public static float[] ResolveAndValidateDescriptor(
        float[]? vector,
        string? json,
        int expectedLength = DefaultDescriptorLength)
    {
        float[]? parsed = null;
        if (vector is { Length: > 0 })
        {
            parsed = (float[])vector.Clone();
        }
        else if (!string.IsNullOrWhiteSpace(json))
        {
            parsed = TryParseDescriptor(json);
        }

        if (parsed is null)
        {
            throw new ValidationException("Valid facial biometric descriptor data is required.");
        }

        ValidateDescriptorValues(parsed, expectedLength);
        return parsed;
    }

    public static float[] ParseAndValidateDescriptor(
        string? json,
        int expectedLength = DefaultDescriptorLength)
    {
        var parsed = TryParseDescriptor(json)
            ?? throw new ValidationException("Valid facial biometric descriptor data is required.");

        ValidateDescriptorValues(parsed, expectedLength);
        return parsed;
    }

    public static float[]? TryParseDescriptor(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            var parsed = JsonSerializer.Deserialize<float[]>(json);
            return parsed is { Length: > 0 } ? parsed : null;
        }
        catch
        {
            return null;
        }
    }

    public static bool IsPlaceholderDescriptor(float[]? descriptor, string? facePhotoUrl = null, int expectedLength = DefaultDescriptorLength)
    {
        if (descriptor is null || descriptor.Length < 64 || (expectedLength > 0 && descriptor.Length != expectedLength))
        {
            return true;
        }

        float min = float.MaxValue;
        float max = float.MinValue;
        double sumSq = 0.0;
        bool allPositiveDummyRange = true;
        bool allSeededUniformRange = true;

        foreach (var v in descriptor)
        {
            if (float.IsNaN(v) || float.IsInfinity(v))
            {
                return true;
            }

            if (v < min) min = v;
            if (v > max) max = v;
            sumSq += (double)v * v;

            if (v < 0.08f || v > 0.35f)
            {
                allPositiveDummyRange = false;
            }

            if (MathF.Abs(v) > 0.205f)
            {
                allSeededUniformRange = false;
            }
        }

        if (sumSq <= 1e-8 || (max - min) < 1e-4f)
        {
            return true;
        }

        if (allPositiveDummyRange)
        {
            return true;
        }

        // Seeded demo placeholders pair Unsplash stock avatars with uniform [-0.2, +0.2] random vectors.
        if (allSeededUniformRange &&
            !string.IsNullOrWhiteSpace(facePhotoUrl) &&
            facePhotoUrl.StartsWith("https://images.unsplash.com/", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return false;
    }

    public static float[] NormalizeUnit(float[] descriptor)
    {
        return NormalizeToScale(descriptor, 1.0f);
    }

    public static float[] NormalizeToScale(float[] descriptor, float targetNorm)
    {
        double sumSq = 0.0;
        for (int i = 0; i < descriptor.Length; i++)
        {
            sumSq += (double)descriptor[i] * descriptor[i];
        }

        var currentNorm = Math.Sqrt(sumSq);
        if (currentNorm <= 1e-8)
        {
            throw new ValidationException("Facial biometric descriptor has zero magnitude and cannot be processed.");
        }

        var factor = (double)targetNorm / currentNorm;
        var scaled = new float[descriptor.Length];
        for (int i = 0; i < descriptor.Length; i++)
        {
            scaled[i] = (float)(descriptor[i] * factor);
        }

        return scaled;
    }

    public static string SerializeDescriptor(float[] descriptor)
    {
        return JsonSerializer.Serialize(descriptor);
    }

    public static FaceComparisonMetrics CompareUnitDescriptors(float[] storedDescriptor, float[] candidateDescriptor)
    {
        if (storedDescriptor.Length != candidateDescriptor.Length || storedDescriptor.Length == 0)
        {
            return new FaceComparisonMetrics(double.MaxValue, -1.0, 0.0);
        }

        double dot = 0.0;
        double normSqA = 0.0;
        double normSqB = 0.0;

        for (int i = 0; i < storedDescriptor.Length; i++)
        {
            double a = storedDescriptor[i];
            double b = candidateDescriptor[i];
            dot += a * b;
            normSqA += a * a;
            normSqB += b * b;
        }

        if (normSqA <= 1e-8 || normSqB <= 1e-8)
        {
            return new FaceComparisonMetrics(double.MaxValue, -1.0, 0.0);
        }

        var cosine = Math.Clamp(dot / (Math.Sqrt(normSqA) * Math.Sqrt(normSqB)), -1.0, 1.0);
        var unitDist = Math.Sqrt(Math.Max(0.0, 2.0 * (1.0 - cosine)));

        double confidence;
        if (unitDist <= 0.14)
        {
            confidence = Math.Round(100.0 - (unitDist / 0.14) * 6.0, 2);
        }
        else if (unitDist <= 0.28)
        {
            confidence = Math.Round(94.0 - ((unitDist - 0.14) / 0.14) * 24.0, 2);
        }
        else if (unitDist <= 0.45)
        {
            confidence = Math.Round(70.0 - ((unitDist - 0.28) / 0.17) * 50.0, 2);
        }
        else
        {
            confidence = Math.Max(0.0, Math.Round(20.0 - ((unitDist - 0.45) / 0.25) * 20.0, 2));
        }

        return new FaceComparisonMetrics(
            UnitDistance: Math.Round(unitDist, 4),
            CosineSimilarity: Math.Round(cosine, 4),
            ConfidenceScore: confidence);
    }

    private static void ValidateDescriptorValues(float[] descriptor, int expectedLength)
    {
        if (expectedLength > 0 && descriptor.Length != expectedLength)
        {
            throw new ValidationException($"Facial biometric descriptor must contain exactly {expectedLength} dimensions.");
        }

        if (IsPlaceholderDescriptor(descriptor, facePhotoUrl: null, expectedLength: expectedLength))
        {
            throw new ValidationException("Invalid or placeholder facial biometric descriptor detected. Please scan a real face.");
        }
    }
}
