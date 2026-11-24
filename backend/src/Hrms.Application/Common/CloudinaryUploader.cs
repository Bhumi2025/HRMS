using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Hrms.Application.Common;

/// <summary>
/// Helper for uploading assets directly to Cloudinary using signed authentication.
/// </summary>
public static class CloudinaryUploader
{
    public static async Task<string?> UploadAsync(
        byte[] fileBytes,
        string fileName,
        string folder,
        string? cloudName = null,
        string? apiKey = null,
        string? apiSecret = null,
        CancellationToken ct = default)
    {
        cloudName = string.IsNullOrWhiteSpace(cloudName) ? "dvy7hrlmp" : cloudName.Trim();
        apiKey = string.IsNullOrWhiteSpace(apiKey) ? "521133217566947" : apiKey.Trim();
        apiSecret = string.IsNullOrWhiteSpace(apiSecret) ? "wGbQBySQ5Q0xoh3G4eQys7SuU38" : apiSecret.Trim();

        try
        {
            var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
            var publicId = Path.GetFileNameWithoutExtension(fileName);
            var sanitizedFolder = folder.Trim('/');

            // Cloudinary requires signature parameters in alphabetical order: folder, public_id, timestamp
            var toSign = $"folder={sanitizedFolder}&public_id={publicId}&timestamp={timestamp}{apiSecret}";
            using var sha1 = SHA1.Create();
            var hash = sha1.ComputeHash(Encoding.UTF8.GetBytes(toSign));
            var signature = BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();

            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(25) };
            using var form = new MultipartFormDataContent();
            var byteContent = new ByteArrayContent(fileBytes);
            form.Add(byteContent, "file", fileName);
            form.Add(new StringContent(apiKey), "api_key");
            form.Add(new StringContent(timestamp), "timestamp");
            form.Add(new StringContent(sanitizedFolder), "folder");
            form.Add(new StringContent(publicId), "public_id");
            form.Add(new StringContent(signature), "signature");

            var endpoint = $"https://api.cloudinary.com/v1_1/{cloudName}/auto/upload";
            var response = await client.PostAsync(endpoint, form, ct);

            if (response.IsSuccessStatusCode)
            {
                var responseJson = await response.Content.ReadAsStringAsync(ct);
                using var doc = JsonDocument.Parse(responseJson);
                if (doc.RootElement.TryGetProperty("secure_url", out var secUrl))
                {
                    return secUrl.GetString();
                }
            }
        }
        catch
        {
            // Non-blocking fallback to local storage
        }

        return null;
    }
}
