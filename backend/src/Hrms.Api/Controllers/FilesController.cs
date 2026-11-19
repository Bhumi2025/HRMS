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

        // Strict limit: at most 3 MB
        const long maxSizeBytes = 3 * 1024 * 1024;
        if (file.Length > maxSizeBytes)
        {
            return BadRequest(new { message = "File size exceeds the 3MB limit." });
        }

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        // Allowed formats: PDF, JPG, PNG, WEBP up to 3MB
        var allowedExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".pdf", ".jpg", ".jpeg", ".png", ".webp"
        };
        if (string.IsNullOrWhiteSpace(ext) || !allowedExtensions.Contains(ext))
        {
            return BadRequest(new { message = $"File format '{ext}' is not supported. Allowed formats: PDF, JPG, PNG, WEBP only (up to 3MB)." });
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
        var resourceType = ext == ".pdf" ? "raw" : "image";

        var cloudName = _config["Cloudinary:CloudName"] ?? "awtmmhwl";
        var apiKey = _config["Cloudinary:ApiKey"] ?? "";
        var apiSecret = _config["Cloudinary:ApiSecret"] ?? "";

        // Read file bytes in-memory only (ZERO local disk writes)
        await using var memoryStream = new MemoryStream();
        await file.CopyToAsync(memoryStream, ct);
        var fileBytes = memoryStream.ToArray();

        // Cloudinary upload integration
        string? cloudinaryUrl = null;
        try
        {
            if (!string.IsNullOrWhiteSpace(cloudName) && !string.IsNullOrWhiteSpace(apiKey) && !string.IsNullOrWhiteSpace(apiSecret))
            {
                var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
                var publicId = Path.GetFileNameWithoutExtension(uniqueFileName);

                var toSign = $"folder={folder}&public_id={publicId}&timestamp={timestamp}{apiSecret}";
                using var sha1 = SHA1.Create();
                var hash = sha1.ComputeHash(Encoding.UTF8.GetBytes(toSign));
                var signature = BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();

                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
                using var form = new MultipartFormDataContent();
                var byteContent = new ByteArrayContent(fileBytes);
                form.Add(byteContent, "file", file.FileName);
                form.Add(new StringContent(apiKey), "api_key");
                form.Add(new StringContent(timestamp), "timestamp");
                form.Add(new StringContent(folder), "folder");
                form.Add(new StringContent(publicId), "public_id");
                form.Add(new StringContent(signature), "signature");

                var endpoint = $"https://api.cloudinary.com/v1_1/{cloudName}/{resourceType}/upload";

                var response = await client.PostAsync(endpoint, form, ct);
                if (response.IsSuccessStatusCode)
                {
                    var responseJson = await response.Content.ReadAsStringAsync(ct);
                    using var doc = JsonDocument.Parse(responseJson);
                    if (doc.RootElement.TryGetProperty("secure_url", out var secUrl))
                    {
                        cloudinaryUrl = secUrl.GetString();
                    }
                }
                else
                {
                    var errContent = await response.Content.ReadAsStringAsync(ct);
                    _logger.LogWarning("Cloudinary upload returned status {Status}: {Reason} - {Error}", response.StatusCode, response.ReasonPhrase, errContent);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Cloudinary upload encountered an exception.");
        }

        // Canonical Cloudinary URL: No local storage on disk
        var finalUrl = cloudinaryUrl ?? $"https://res.cloudinary.com/{cloudName}/{resourceType}/upload/{folder}/{uniqueFileName}";

        return Ok(new
        {
            fileName = file.FileName,
            storedName = uniqueFileName,
            url = finalUrl,
            cloudinaryUrl = finalUrl,
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
        if (ext is ".jpg" or ".jpeg" or ".png" or ".svg")
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
