using System.Text;

namespace Hrms.Api.Configuration;

/// <summary>
/// Lightweight, zero-dependency environment configuration loader.
/// Discovers and loads .env files from the execution directory, content root, or parent folders,
/// and maps friendly variable names into ASP.NET Core hierarchical configuration sections.
/// </summary>
public static class EnvLoader
{
    private static readonly Dictionary<string, string> ConfigKeyAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        // Connection Strings
        ["DEFAULT_CONNECTION"] = "ConnectionStrings:DefaultConnection",
        ["MASTER_CONNECTION"] = "ConnectionStrings:MasterConnection",
        ["TENANT_CONNECTION_BASE"] = "Tenancy:TenantConnectionBase",
        ["PROVISIONING_CONNECTION_BASE"] = "Tenancy:ProvisioningConnectionBase",

        // Cloudinary CDN
        ["CLOUDINARY_CLOUD_NAME"] = "Cloudinary:CloudName",
        ["CLOUDINARY_API_KEY"] = "Cloudinary:ApiKey",
        ["CLOUDINARY_API_SECRET"] = "Cloudinary:ApiSecret",
        ["CLOUDINARY_UPLOAD_PRESET"] = "Cloudinary:UploadPreset",

        // SMTP & Email
        ["SMTP_ENABLED"] = "Email:Enabled",
        ["SMTP_HOST"] = "Email:Host",
        ["SMTP_PORT"] = "Email:Port",
        ["SMTP_USE_SSL"] = "Email:UseSsl",
        ["SMTP_USER"] = "Email:UserName",
        ["SMTP_PASSWORD"] = "Email:Password",
        ["SMTP_FROM_EMAIL"] = "Email:FromAddress",
        ["SMTP_FROM_NAME"] = "Email:FromName",
        ["EMAIL_HOST"] = "Email:Host",
        ["EMAIL_PORT"] = "Email:Port",
        ["EMAIL_USERNAME"] = "Email:UserName",
        ["EMAIL_PASSWORD"] = "Email:Password",
        ["EMAIL_FROM"] = "Email:FromAddress",
        ["EMAIL_FROM_NAME"] = "Email:FromName",

        // SmtpSettings Section
        ["SMTP_SERVER"] = "SmtpSettings:Server",
        ["SMTP_SENDER_EMAIL"] = "SmtpSettings:SenderEmail",
        ["SMTP_SENDER_NAME"] = "SmtpSettings:SenderName",
        ["SMTP_SIMULATION_MODE"] = "SmtpSettings:SimulationMode",

        // JWT & Security
        ["JWT_KEY"] = "Jwt:Key",
        ["JWT_ISSUER"] = "Jwt:Issuer",
        ["JWT_AUDIENCE"] = "Jwt:Audience",
        ["JWT_EXPIRY_MINUTES"] = "Jwt:ExpiryMinutes",

        // Application URLs
        ["FRONTEND_BASE_URL"] = "App:FrontendBaseUrl",
        ["INVITATION_EXPIRY_HOURS"] = "App:InvitationExpiryHours",
        ["PORTAL_URL"] = "App:FrontendBaseUrl"
    };

    /// <summary>
    /// Searches for a .env file, populates environment variables, and returns
    /// a dictionary suitable for adding to ASP.NET Core IConfiguration.
    /// </summary>
    public static Dictionary<string, string?> Load()
    {
        var envFilePath = FindEnvFile();
        var result = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);

        if (string.IsNullOrEmpty(envFilePath) || !File.Exists(envFilePath))
        {
            Console.WriteLine("[EnvLoader] No .env file found in search paths; using system environment variables and appsettings.");
            return result;
        }

        Console.WriteLine($"[EnvLoader] Loading environment variables from '{envFilePath}'...");

        try
        {
            var lines = File.ReadAllLines(envFilePath, Encoding.UTF8);
            foreach (var rawLine in lines)
            {
                var line = rawLine.Trim();
                if (string.IsNullOrWhiteSpace(line) || line.StartsWith('#') || line.StartsWith("//"))
                {
                    continue;
                }

                // Strip leading 'export ' if present (e.g. bash export format)
                if (line.StartsWith("export ", StringComparison.OrdinalIgnoreCase))
                {
                    line = line.Substring(7).Trim();
                }

                var separatorIndex = line.IndexOf('=');
                if (separatorIndex <= 0)
                {
                    continue;
                }

                var key = line.Substring(0, separatorIndex).Trim();
                var val = line.Substring(separatorIndex + 1).Trim();

                // Strip surrounding single or double quotes
                if ((val.StartsWith('"') && val.EndsWith('"')) || (val.StartsWith('\'') && val.EndsWith('\'')))
                {
                    if (val.Length >= 2)
                    {
                        val = val.Substring(1, val.Length - 2);
                    }
                }

                // Sanitize SQL Server connection strings (strip SSMS-specific invalid ADO.NET keywords and quotes)
                if (key.Contains("CONNECTION", StringComparison.OrdinalIgnoreCase))
                {
                    val = SanitizeConnectionString(val);
                }

                // Set process environment variable
                Environment.SetEnvironmentVariable(key, val);
                result[key] = val;

                // If key is in standard ASP.NET double-underscore format (e.g. ConnectionStrings__DefaultConnection)
                // also convert to colon format (ConnectionStrings:DefaultConnection) for Configuration
                if (key.Contains("__"))
                {
                    var colonKey = key.Replace("__", ":");
                    result[colonKey] = val;
                }

                // Map friendly aliases to configuration keys
                if (ConfigKeyAliases.TryGetValue(key, out var configKey))
                {
                    result[configKey] = val;

                    // Also sync related duplicate sections (e.g. SmtpSettings vs Email)
                    if (key.Equals("SMTP_HOST", StringComparison.OrdinalIgnoreCase) || key.Equals("EMAIL_HOST", StringComparison.OrdinalIgnoreCase))
                    {
                        result["SmtpSettings:Server"] = val;
                        result["Email:Host"] = val;
                    }
                    else if (key.Equals("SMTP_PORT", StringComparison.OrdinalIgnoreCase) || key.Equals("EMAIL_PORT", StringComparison.OrdinalIgnoreCase))
                    {
                        result["SmtpSettings:Port"] = val;
                        result["Email:Port"] = val;
                    }
                    else if (key.Equals("SMTP_USER", StringComparison.OrdinalIgnoreCase) || key.Equals("EMAIL_USERNAME", StringComparison.OrdinalIgnoreCase))
                    {
                        result["SmtpSettings:Username"] = val;
                        result["Email:UserName"] = val;
                    }
                    else if (key.Equals("SMTP_PASSWORD", StringComparison.OrdinalIgnoreCase) || key.Equals("EMAIL_PASSWORD", StringComparison.OrdinalIgnoreCase))
                    {
                        result["SmtpSettings:Password"] = val;
                        result["Email:Password"] = val;
                    }
                    else if (key.Equals("SMTP_FROM_EMAIL", StringComparison.OrdinalIgnoreCase) || key.Equals("EMAIL_FROM", StringComparison.OrdinalIgnoreCase))
                    {
                        result["SmtpSettings:SenderEmail"] = val;
                        result["Email:FromAddress"] = val;
                    }
                    else if (key.Equals("SMTP_FROM_NAME", StringComparison.OrdinalIgnoreCase) || key.Equals("EMAIL_FROM_NAME", StringComparison.OrdinalIgnoreCase))
                    {
                        result["SmtpSettings:SenderName"] = val;
                        result["Email:FromName"] = val;
                    }
                    else if (key.Equals("SMTP_USE_SSL", StringComparison.OrdinalIgnoreCase))
                    {
                        result["SmtpSettings:UseSsl"] = val;
                        result["Email:UseSsl"] = val;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[EnvLoader] Error reading .env file: {ex.Message}");
        }

        return result;
    }

    private static string? FindEnvFile()
    {
        // 1. Explicit path via environment variable
        var explicitPath = Environment.GetEnvironmentVariable("ENV_FILE_PATH");
        if (!string.IsNullOrEmpty(explicitPath) && File.Exists(explicitPath))
        {
            return explicitPath;
        }

        // 2. Candidate starting directories
        var candidates = new List<string>
        {
            Directory.GetCurrentDirectory(),
            AppContext.BaseDirectory
        };

        foreach (var startDir in candidates)
        {
            if (string.IsNullOrWhiteSpace(startDir) || !Directory.Exists(startDir)) continue;

            var current = new DirectoryInfo(startDir);
            for (int i = 0; i < 5 && current != null; i++)
            {
                var filePath = Path.Combine(current.FullName, ".env");
                if (File.Exists(filePath))
                {
                    return filePath;
                }
                current = current.Parent;
            }
        }

        return null;
    }

    private static string SanitizeConnectionString(string cs)
    {
        if (string.IsNullOrWhiteSpace(cs)) return cs;
        // Remove invalid ADO.NET keyword "Command Timeout=...;" from SSMS
        cs = System.Text.RegularExpressions.Regex.Replace(cs, @"(?i)command\s+timeout\s*=\s*[^;]+;?", "");
        // Remove quotes around values
        cs = cs.Replace("\\\"", "").Replace("\"", "");
        // Ensure MARS is enabled for EF Core
        if (!cs.Contains("MultipleActiveResultSets", StringComparison.OrdinalIgnoreCase))
        {
            cs = cs.TrimEnd(';') + ";MultipleActiveResultSets=True;";
        }
        return cs.Trim();
    }
}
