using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Security.Claims;
using Hrms.Api.Configuration;
using Hrms.Api.Middleware;
using Hrms.Api.Services;
using Hrms.Api.Startup;
using Hrms.Api.Workers;
using Hrms.Application;
using Hrms.Application.Abstractions.Security;
using Hrms.Application.Common;
using Hrms.Infrastructure;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;

// ── Environment Variables (.env) ──
var envDict = EnvLoader.Load();

var builder = WebApplication.CreateBuilder(args);

if (envDict.Count > 0)
{
    builder.Configuration.AddInMemoryCollection(envDict);
}

// Ensure listening on all interfaces (0.0.0.0) so LAN devices can access directly
var configuredUrls = builder.Configuration["Urls"] ?? "http://0.0.0.0:5096";
builder.WebHost.UseUrls(configuredUrls);

// ── Controllers / JSON ──
builder.Services.AddControllers(options =>
    {
        options.Filters.Add<Hrms.Api.Security.PermissionAuthorizationFilter>();
    })
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        options.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
        options.JsonSerializerOptions.Converters.Add(new Hrms.Api.Serialization.FlexibleEnumConverterFactory());
        options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
        options.JsonSerializerOptions.Converters.Add(new UtcDateTimeJsonConverter());
    });

builder.Services.Configure<Microsoft.AspNetCore.Builder.ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto;
    // KnownProxies and KnownIPNetworks default to loopback (127.0.0.1 and ::1).
    // Read additional trusted proxy IPs or CIDR networks from configuration if provided:
    var proxyIps = builder.Configuration.GetSection("ForwardedHeaders:KnownProxies").Get<string[]>() ?? Array.Empty<string>();
    foreach (var ipStr in proxyIps)
    {
        if (System.Net.IPAddress.TryParse(ipStr, out var ip))
        {
            options.KnownProxies.Add(ip);
        }
    }

    var networkCidrs = builder.Configuration.GetSection("ForwardedHeaders:KnownNetworks").Get<string[]>() ?? Array.Empty<string>();
    foreach (var cidr in networkCidrs)
    {
        if (System.Net.IPNetwork.TryParse(cidr, out var network))
        {
            options.KnownIPNetworks.Add(network);
        }
    }
});


// ── Layers ──
builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);

// ── Current user ──
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, CurrentUser>();

// ── Authentication / authorisation ──
var jwtOptions = builder.Configuration.GetSection(JwtOptions.SectionName).Get<JwtOptions>()
                 ?? throw new InvalidOperationException("The 'Jwt' configuration section is missing.");

if (string.IsNullOrWhiteSpace(jwtOptions.Key) || jwtOptions.Key.Length < 32)
{
    throw new InvalidOperationException("Jwt:Key must be configured with at least 32 characters.");
}

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtOptions.Issuer,
            ValidateAudience = true,
            ValidAudience = jwtOptions.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtOptions.Key)),
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromSeconds(30),
            NameClaimType = ClaimTypes.Name,
            RoleClaimType = ClaimTypes.Role,
        };
    });

builder.Services.AddAuthorization(options =>
{
    // HrAdmin policy: Super Admin, Company Admin, HR Manager, or dynamic custom roles (PermissionAuthorizationFilter enforces granular rights)
    options.AddPolicy("HrAdmin", policy => policy.RequireAssertion(ctx =>
    {
        var role = ctx.User.FindFirst(ClaimTypes.Role)?.Value;
        if (string.IsNullOrWhiteSpace(role)) return false;
        if (role.Equals("Super Admin", StringComparison.OrdinalIgnoreCase) ||
            role.Equals("SuperAdmin", StringComparison.OrdinalIgnoreCase) ||
            role.Equals("Company Admin", StringComparison.OrdinalIgnoreCase) ||
            role.Equals("CompanyAdmin", StringComparison.OrdinalIgnoreCase) ||
            role.Equals("HR Manager", StringComparison.OrdinalIgnoreCase) ||
            role.Equals("HrManager", StringComparison.OrdinalIgnoreCase))
            return true;

        // Custom roles: allowed past basic policy check; PermissionAuthorizationFilter validates granular module permissions
        return !role.Equals("Employee", StringComparison.OrdinalIgnoreCase);
    }));

    options.AddPolicy("ManagerOrAbove", policy => policy.RequireAssertion(ctx =>
    {
        var role = ctx.User.FindFirst(ClaimTypes.Role)?.Value;
        if (string.IsNullOrWhiteSpace(role)) return false;
        return !role.Equals("Employee", StringComparison.OrdinalIgnoreCase);
    }));

    // Platform-level: only the Super Admin may manage companies.
    options.AddPolicy("SuperAdminOnly", policy => policy.RequireRole("Super Admin", "SuperAdmin"));
});

// ── Response Compression ──
builder.Services.AddResponseCompression();

// ── CORS (Angular dev server & deployed client) ──
var rawAllowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
                     ?? new[] { "https://webnewhrms.aviquon.com", "http://localhost:4200" };
var allowedOrigins = rawAllowedOrigins
    .Where(o => !string.IsNullOrWhiteSpace(o))
    .Select(o => o.Trim().TrimEnd('/'))
    .Distinct(StringComparer.OrdinalIgnoreCase)
    .ToArray();

builder.Services.AddCors(options =>
{
    options.AddPolicy("Angular", policy =>
    {
        policy.SetIsOriginAllowed(origin =>
        {
            if (string.IsNullOrWhiteSpace(origin)) return false;
            try
            {
                var uri = new Uri(origin);
                // Allow local development on any port
                if (uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
                    uri.Host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
                // Allow exact configured origins
                var normalizedOrigin = origin.TrimEnd('/');
                if (allowedOrigins.Any(ao => ao.Equals(normalizedOrigin, StringComparison.OrdinalIgnoreCase)))
                {
                    return true;
                }
                // Allow aviquon.com subdomains
                if (uri.Host.EndsWith("aviquon.com", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            catch
            {
                // Invalid URI format
            }
            return false;
        })
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials()
        .WithExposedHeaders("Content-Disposition", "X-Company-Code", "X-Company-Id");
    });
});

// ── Background Workers ──
builder.Services.AddHostedService<DailyAttendanceCloseoutWorker>();

// ── OpenAPI / Swagger ──
builder.Services.AddHrmsSwagger();

var app = builder.Build();

if (app.Environment.IsProduction())
{
    var proxyIps = builder.Configuration.GetSection("ForwardedHeaders:KnownProxies").Get<string[]>() ?? Array.Empty<string>();
    var networkCidrs = builder.Configuration.GetSection("ForwardedHeaders:KnownNetworks").Get<string[]>() ?? Array.Empty<string>();
    if (proxyIps.Length == 0 && networkCidrs.Length == 0)
    {
        var secLogger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Security");
        secLogger.LogWarning("[SECURITY WARNING] Running in Production environment with no trusted reverse proxies configured in ForwardedHeaders:KnownProxies or ForwardedHeaders:KnownNetworks. Forwarded headers (X-Forwarded-For, X-Forwarded-Proto) from upstream reverse proxies (e.g. NGINX, Cloudflare, ALB) will be untrusted, and client RemoteIpAddress will reflect the load balancer instead of the real client IP.");
    }
}

if (args.Length > 0 && args[0].Equals("seed-admin", StringComparison.OrdinalIgnoreCase))
{
    var exitCode = await SeedAdminCli.ExecuteAsync(args, app.Services);
    Environment.Exit(exitCode);
    return;
}

// ── Databases: migrate the master registry, register the default company, seed the default tenant ──
await DatabaseBootstrap.InitializeAsync(app.Services, builder.Configuration);

// ── Pipeline ──
// ForwardedHeaders MUST execute first so subsequent middleware and logging see the true RemoteIpAddress
app.UseForwardedHeaders();
app.UseCors("Angular");
app.UseMiddleware<ExceptionHandlingMiddleware>();
app.UseResponseCompression();

var webRoot = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
Directory.CreateDirectory(Path.Combine(webRoot, "uploads"));

app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(webRoot),
    OnPrepareResponse = ctx =>
    {
        ctx.Context.Response.Headers["X-Content-Type-Options"] = "nosniff";
        if (ctx.File.Name.EndsWith(".svg", StringComparison.OrdinalIgnoreCase))
        {
            ctx.Context.Response.Headers["Content-Security-Policy"] = "sandbox";
        }
    }
});

app.UseAuthentication();

// Resolves the tenant database from the validated company claim before any query runs.
app.UseMiddleware<TenantResolutionMiddleware>();

app.UseAuthorization();

// Swagger UI is enabled in every environment so the API can be exercised by hand.
app.UseHrmsSwagger();

app.MapControllers();

app.MapGet("/", () => Results.Redirect("/swagger"))
    .ExcludeFromDescription();

app.MapGet("/health", () => Results.Ok(new { status = "healthy", service = "HRMS API", timestamp = DateTime.UtcNow }))
    .WithTags("System");

app.Run();

public class UtcDateTimeJsonConverter : JsonConverter<DateTime>
{
    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        return DateTime.SpecifyKind(reader.GetDateTime(), DateTimeKind.Utc);
    }

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options)
    {
        var utc = value.Kind == DateTimeKind.Utc ? value : DateTime.SpecifyKind(value, DateTimeKind.Utc);
        writer.WriteStringValue(utc.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"));
    }
}

public partial class Program { }
