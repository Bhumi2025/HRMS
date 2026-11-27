using System.Collections.Concurrent;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Hrms.Api.Security;

/// <summary>
/// Thread-safe per-IP 1-minute sliding window rate limiter shared by public authentication endpoints.
/// </summary>
internal static class EndpointRateLimiter
{
    private static readonly ConcurrentDictionary<string, (int Count, DateTime WindowStart)> Buckets = new();

    public static bool TryConsume(HttpContext httpContext, string scope, int maxPerMinute, out ObjectResult? limitResponse)
    {
        var ip = httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var key = $"{scope}:{ip}";
        var now = DateTime.UtcNow;
        var effectiveLimit = Math.Max(1, maxPerMinute);

        var entry = Buckets.AddOrUpdate(
            key,
            (1, now),
            (_, existing) => now - existing.WindowStart < TimeSpan.FromMinutes(1)
                ? (existing.Count + 1, existing.WindowStart)
                : (1, now));

        if (Buckets.Count > 4096)
        {
            var cutoff = now - TimeSpan.FromMinutes(2);
            foreach (var stale in Buckets.Where(kvp => kvp.Value.WindowStart < cutoff).Select(kvp => kvp.Key).ToList())
            {
                Buckets.TryRemove(stale, out _);
            }
        }

        if (entry.Count > effectiveLimit)
        {
            limitResponse = new ObjectResult(new ProblemDetails
            {
                Status = StatusCodes.Status429TooManyRequests,
                Title = "Rate limit exceeded. Please wait a moment."
            })
            {
                StatusCode = StatusCodes.Status429TooManyRequests
            };
            return false;
        }

        limitResponse = null;
        return true;
    }
}
