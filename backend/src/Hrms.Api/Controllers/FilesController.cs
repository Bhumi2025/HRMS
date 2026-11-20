using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Hrms.Api.Security;
using Hrms.Application.Abstractions.Security;
using Hrms.Application.Abstractions.Tenancy;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Hrms.Api.Controllers;

[ApiController]
[Route("api/files")]
[Authorize]
[OptOutPermission]
[Tags("Files")]
public sealed class FilesController : ControllerBase
{
    private readonly IWebHostEnvironment _env;
    private readonly IConfiguration _config;
    private readonly ILogger<FilesController> _logger;
    private readonly ITenantContext? _tenantContext;
    private readonly ICurrentUser? _currentUser;

    public FilesController(
        IWebHostEnvironment env,
        IConfiguration config,
        ILogger<FilesController> logger,
        ITenantContext? tenantContext = null,
        ICurrentUser? currentUser = null)
    {
        _env = env;
        _config = config;
        _logger = logger;
        _tenantContext = tenantContext;
        _currentUser = currentUser;
    }

    [HttpPost("upload")]
    [Consumes("multipart/form-data")]
    public async Task<IActionResult> Upload(
        IFormFile? file,
        [FromQuery] string? companyCode = null,
        [FromQuery] string? userId = null,
        CancellationToken ct = default)
    {
        if (file == null || file.Length == 0)
        {
            return BadRequest(new { message = "No file was uploaded." });
        }

        // Strict limit: at most 2 MB across the entire project
        const long maxSizeBytes = 2 * 1024 * 1024;
        if (file.Length > maxSizeBytes)
        {
            return BadRequest(new { message = "File size exceeds the maximum limit of 2MB." });
        }

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        // Allowed formats: PDF, JPG, PNG only (up to 2MB)
        var allowedExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".pdf", ".jpg", ".jpeg", ".png"
        };
        if (string.IsNullOrWhiteSpace(ext) || !allowedExtensions.Contains(ext))
        {
            return BadRequest(new { message = $"File format '{ext}' is not supported. Allowed formats are PDF, JPG, and PNG only (up to 2MB)." });
        }

        // Determine company code
        var effectiveCompanyCode = !string.IsNullOrWhiteSpace(companyCode)
            ? companyCode.Trim()
            : Request.Headers["X-Company-Code"].FirstOrDefault() ?? _tenantContext?.Tenant?.Code ?? "HRNEXUS";
        var sanitizedCompanyCode = Regex.Replace(effectiveCompanyCode, @"[^a-zA-Z0-9_\-]", "");
        if (string.IsNullOrWhiteSpace(sanitizedCompanyCode)) sanitizedCompanyCode = "HRNEXUS";

        // Determine user ID
        var effectiveUserId = !string.IsNullOrWhiteSpace(userId)
            ? userId.Trim()
            : _currentUser?.UserId?.ToString() ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "onboarding";
        var sanitizedUserId = Regex.Replace(effectiveUserId, @"[^a-zA-Z0-9_\-]", "");
        if (string.IsNullOrWhiteSpace(sanitizedUserId)) sanitizedUserId = "onboarding";

        // Generate clean unique file name
        var uniqueFileName = $"{Guid.NewGuid():N}{ext}";
        var folder = $"{sanitizedCompanyCode}/{sanitizedUserId}";

        // Save local backup copy on disk so file is NEVER lost
        var uploadsFolder = Path.Combine(_env.ContentRootPath, "uploads", sanitizedCompanyCode, sanitizedUserId);
        if (!Directory.Exists(uploadsFolder))
        {
            Directory.CreateDirectory(uploadsFolder);
        }
        var localFilePath = Path.Combine(uploadsFolder, uniqueFileName);

        await using (var fileStream = new FileStream(localFilePath, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            await file.CopyToAsync(fileStream, ct);
        }

        // Read file bytes for Cloudinary upload
        var fileBytes = await System.IO.File.ReadAllBytesAsync(localFilePath, ct);

        // Cloudinary upload integration
        var cloudName = _config["Cloudinary:CloudName"] ?? "awtmmhwl";
        var apiKey = _config["Cloudinary:ApiKey"] ?? "337337895791817";
        var apiSecret = _config["Cloudinary:ApiSecret"] ?? "";
        var uploadPreset = _config["Cloudinary:UploadPreset"];

        string? cloudinaryUrl = null;
        try
        {
            // 1. Try Signed Upload if ApiKey and ApiSecret are available
            if (!string.IsNullOrWhiteSpace(cloudName) && !string.IsNullOrWhiteSpace(apiKey) && !string.IsNullOrWhiteSpace(apiSecret))
            {
                var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
                var publicId = Path.GetFileNameWithoutExtension(uniqueFileName);

                var toSign = $"folder={folder}&public_id={publicId}&timestamp={timestamp}{apiSecret}";
                using var sha1 = SHA1.Create();
                var hash = sha1.ComputeHash(Encoding.UTF8.GetBytes(toSign));
                var signature = BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();

                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
                using var form = new MultipartFormDataContent();
                var byteContent = new ByteArrayContent(fileBytes);
                form.Add(byteContent, "file", file.FileName);
                form.Add(new StringContent(apiKey), "api_key");
                form.Add(new StringContent(timestamp), "timestamp");
                form.Add(new StringContent(folder), "folder");
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
                        cloudinaryUrl = secUrl.GetString();
                        _logger.LogInformation("Cloudinary upload successful: {Url}", cloudinaryUrl);
                    }
                }
                else
                {
                    var errContent = await response.Content.ReadAsStringAsync(ct);
                    _logger.LogWarning("Cloudinary signed upload returned status {Status}: {Reason} - {Error}", response.StatusCode, response.ReasonPhrase, errContent);
                }
            }
            // 2. Try Unsigned Upload preset if signed was not possible or preset configured
            else if (!string.IsNullOrWhiteSpace(cloudName) && !string.IsNullOrWhiteSpace(uploadPreset))
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
                using var form = new MultipartFormDataContent();
                var byteContent = new ByteArrayContent(fileBytes);
                form.Add(byteContent, "file", file.FileName);
                form.Add(new StringContent(uploadPreset), "upload_preset");
                form.Add(new StringContent(folder), "folder");

                var endpoint = $"https://api.cloudinary.com/v1_1/{cloudName}/auto/upload";
                var response = await client.PostAsync(endpoint, form, ct);
                if (response.IsSuccessStatusCode)
                {
                    var responseJson = await response.Content.ReadAsStringAsync(ct);
                    using var doc = JsonDocument.Parse(responseJson);
                    if (doc.RootElement.TryGetProperty("secure_url", out var secUrl))
                    {
                        cloudinaryUrl = secUrl.GetString();
                        _logger.LogInformation("Cloudinary unsigned upload successful: {Url}", cloudinaryUrl);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Cloudinary upload encountered an exception; falling back to reliable local server URL.");
        }

        // If Cloudinary succeeded, use Cloudinary CDN URL; otherwise use safe local server download endpoint
        var localDownloadUrl = $"/api/files/download/{sanitizedCompanyCode}/{sanitizedUserId}/{uniqueFileName}";
        var finalUrl = !string.IsNullOrWhiteSpace(cloudinaryUrl) ? cloudinaryUrl : localDownloadUrl;

        return Ok(new
        {
            fileName = file.FileName,
            storedName = uniqueFileName,
            url = finalUrl,
            cloudinaryUrl = cloudinaryUrl,
            localPath = localDownloadUrl,
            size = $"{file.Length / 1024} KB"
        });
    }

    [HttpGet("download/{fileName}")]
    [AllowAnonymous]
    public IActionResult Download(string fileName)
    {
        var sanitized = Path.GetFileName(fileName);
        var uploadsFolder = Path.Combine(_env.ContentRootPath, "uploads");

        // 1. Direct root uploads match
        var directPath = Path.Combine(uploadsFolder, sanitized);
        if (System.IO.File.Exists(directPath))
        {
            return ServeFile(directPath, sanitized);
        }

        // 2. Recursive search in uploads/{CompanyCode}/{UserId}/{fileName}
        if (Directory.Exists(uploadsFolder))
        {
            try
            {
                var matches = Directory.GetFiles(uploadsFolder, sanitized, SearchOption.AllDirectories);
                if (matches.Length > 0 && System.IO.File.Exists(matches[0]))
                {
                    return ServeFile(matches[0], sanitized);
                }
            }
            catch { }
        }

        // 3. Search in wwwroot/uploads
        var webRoot = _env.WebRootPath ?? Path.Combine(_env.ContentRootPath, "wwwroot");
        var webrootUploads = Path.Combine(webRoot, "uploads");
        if (Directory.Exists(webrootUploads))
        {
            try
            {
                var matches = Directory.GetFiles(webrootUploads, sanitized, SearchOption.AllDirectories);
                if (matches.Length > 0 && System.IO.File.Exists(matches[0]))
                {
                    return ServeFile(matches[0], sanitized);
                }
            }
            catch { }
        }

        return FallbackPreview(sanitized);
    }

    [HttpGet("download/{companyCode}/{userId}/{fileName}")]
    [AllowAnonymous]
    public IActionResult DownloadTenant(string companyCode, string userId, string fileName)
    {
        var sanitizedCompany = Regex.Replace(companyCode, @"[^a-zA-Z0-9_\-]", "");
        var sanitizedUser = Regex.Replace(userId, @"[^a-zA-Z0-9_\-]", "");
        var sanitizedFile = Path.GetFileName(fileName);

        var path = Path.Combine(_env.ContentRootPath, "uploads", sanitizedCompany, sanitizedUser, sanitizedFile);
        if (System.IO.File.Exists(path))
        {
            return ServeFile(path, sanitizedFile);
        }

        return Download(sanitizedFile);
    }

    private IActionResult ServeFile(string filePath, string fileName)
    {
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        var contentType = ext switch
        {
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".webp" => "image/webp",
            ".svg" => "image/svg+xml",
            ".pdf" => "application/pdf",
            ".doc" => "application/msword",
            ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            _ => "application/octet-stream"
        };

        var bytes = System.IO.File.ReadAllBytes(filePath);
        return File(bytes, contentType, fileName);
    }

    private IActionResult FallbackPreview(string fileName)
    {
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        if (ext is ".jpg" or ".jpeg" or ".png" or ".svg" or ".webp")
        {
            var svg = $@"<svg xmlns='http://www.w3.org/2000/svg' width='600' height='400' viewBox='0 0 600 400'>
                <rect width='100%' height='100%' fill='#F1F5F9'/>
                <rect x='40' y='40' width='520' height='320' rx='12' fill='#FFFFFF' stroke='#CBD5E1' stroke-width='2'/>
                <text x='300' y='180' font-family='sans-serif' font-size='20' font-weight='bold' fill='#1E293B' text-anchor='middle'>{System.Net.WebUtility.HtmlEncode(fileName)}</text>
                <text x='300' y='220' font-family='sans-serif' font-size='14' fill='#64748B' text-anchor='middle'>HRMS Document Preview</text>
            </svg>";
            return Content(svg, "image/svg+xml");
        }

        var sampleBytes = Encoding.UTF8.GetBytes($"HRMS Employee Document\r\nDocument: {fileName}\r\nTimestamp: {DateTime.UtcNow:yyyy-MM-dd HH:mm:ss} UTC");
        return File(sampleBytes, "text/plain", fileName.EndsWith(".txt", StringComparison.OrdinalIgnoreCase) ? fileName : $"{fileName}.txt");
    }
}
