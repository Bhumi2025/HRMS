namespace Hrms.Application.Common;

/// <summary>Platform-level settings bound from the "App" configuration section.</summary>
public sealed class AppOptions
{
    public const string SectionName = "App";

    /// <summary>Base URL of the frontend, used to build account-activation links.</summary>
    // Local reference: "http://localhost:4200"
    public string FrontendBaseUrl { get; set; } = "https://webnewhrms.aviquon.com";

    /// <summary>How long an invitation/activation link stays valid.</summary>
    public int InvitationExpiryHours { get; set; } = 72;
}

/// <summary>Tenant database settings bound from the "Tenancy" configuration section.</summary>
public sealed class TenancyOptions
{
    public const string SectionName = "Tenancy";

    /// <summary>
    /// Base connection string (no database) used to reach tenant databases at runtime.
    /// Falls back to <c>ConnectionStrings:DefaultConnection</c> when unset.
    /// </summary>
    public string? TenantConnectionBase { get; set; }

    /// <summary>
    /// Base connection string used to create tenant databases. Uses least-privilege,
    /// elevated credentials and falls back to the tenant base when unset.
    /// </summary>
    public string? ProvisioningConnectionBase { get; set; }
}

/// <summary>Email delivery settings bound from "Email" or "SmtpSettings" configuration sections.</summary>
public sealed class EmailOptions
{
    public const string SectionName = "Email";

    public bool Enabled { get; set; } = true;

    public string Host { get; set; } = string.Empty;

    public string Server
    {
        get => Host;
        set => Host = value;
    }

    public int Port { get; set; } = 587;

    public bool UseSsl { get; set; } = true;

    public string? UserName { get; set; }

    public string? Username
    {
        get => UserName;
        set => UserName = value;
    }

    public string? Password { get; set; }

    public string FromAddress { get; set; } = "22bmiit210@gmail.com";

    public string SenderEmail
    {
        get => FromAddress;
        set => FromAddress = value;
    }

    public string FromName { get; set; } = "HRMS Portal";

    public string SenderName
    {
        get => FromName;
        set => FromName = value;
    }

    public bool? SimulationMode
    {
        get => !Enabled;
        set
        {
            if (value.HasValue)
            {
                Enabled = !value.Value;
            }
        }
    }

    public bool IsConfigured => Enabled && !string.IsNullOrWhiteSpace(Host);
}
