using Hrms.Application.Abstractions.Security;
using Hrms.Application.Abstractions.Tenancy;
using Hrms.Application.Common;
using Hrms.Application.DTOs;
using Hrms.Application.Services;
using Hrms.Domain.Entities;
using Hrms.Domain.Enums;
using Hrms.Infrastructure.Persistence;
using Hrms.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Xunit;

namespace Hrms.Tests;

public sealed class OnboardingEmailTests
{
    private sealed class StubCurrentUser : ICurrentUser
    {
        public bool IsAuthenticated => true;
        public Guid? UserId => Guid.NewGuid();
        public string? Email => "hr@acme.test";
        public string? Role => "CompanyAdmin";
        public Guid? EmployeeId => null;
        public Guid? CompanyId => Guid.NewGuid();
        public bool IsInRole(string role) => string.Equals(Role, role, StringComparison.OrdinalIgnoreCase);
    }

    private sealed class StubTenantContext : ITenantContext
    {
        public ResolvedTenant? Tenant { get; private set; }
        public Guid? CompanyId => Tenant?.CompanyId;
        public void Set(ResolvedTenant? tenant) => Tenant = tenant;
    }

    private static (HrmsDbContext db, UnitOfWork uow, Guid departmentId) SetupDb(string companyName)
    {
        var options = new DbContextOptionsBuilder<HrmsDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        var db = new HrmsDbContext(options);

        var dept = new Department { Name = "Engineering", Code = "ENG" };
        db.Departments.Add(dept);
        db.Roles.Add(new Role { Name = "Employee", Code = "Employee" });
        db.CompanySettings.Add(new CompanySettings { CompanyName = companyName, TimeZone = "Asia/Kolkata" });
        db.SaveChanges();

        return (db, new UnitOfWork(db), dept.Id);
    }

    private static CreateEmployeeRequest MakeRequest(Guid departmentId, string email, bool sendWelcomeEmail) =>
        new(
            Salutation: null,
            FirstName: "Aarav",
            MiddleName: null,
            LastName: "Sharma",
            Email: email,
            Phone: "+91 98765 43210",
            DepartmentId: departmentId,
            DesignationId: null,
            BranchId: null,
            ShiftId: null,
            ReportingManagerId: null,
            JobTitle: "Software Intern",
            Grade: "L3",
            EmploymentType: EmploymentType.Intern,
            JoinDate: new DateOnly(2026, 11, 25),
            BasicSalary: 50000m,
            HousingAllowance: 0m,
            TransportAllowance: 0m,
            MobileAllowance: 0m,
            OtherAllowances: 0m,
            Currency: "INR",
            BankName: "HDFC Bank",
            AccountNumber: "1234567890",
            Password: null,
            RoleCode: "Employee",
            SendWelcomeEmail: sendWelcomeEmail);

    private static IOptions<JwtOptions> MakeJwtOptions() =>
        Options.Create(new JwtOptions
        {
            Issuer = "Hrms.Api",
            Audience = "Hrms.Client",
            Key = "hrms-super-secret-development-signing-key-change-in-production-2026",
            ExpiryMinutes = 480,
        });

    private static IOptions<AppOptions> MakeAppOptions() =>
        Options.Create(new AppOptions
        {
            FrontendBaseUrl = "http://localhost:4200",
            InvitationExpiryHours = 72,
        });

    [Fact]
    public async Task CreateAsync_SendWelcomeEmailTrue_SendsBasicDetailsAndSetPasswordButtonOnly()
    {
        var (db, uow, deptId) = SetupDb("Acme Academy");
        var emailSender = new FakeEmailSender();
        var tokenService = new JwtTokenService(MakeJwtOptions());
        var service = new EmployeeService(
            uow,
            new StubCurrentUser(),
            new FakePasswordHasher(),
            emailSender,
            new StubTenantContext(),
            null,
            tokenService,
            MakeAppOptions());

        var created = await service.CreateAsync(MakeRequest(deptId, "aarav.sharma@example.com", true));

        Assert.Null(created.Password);
        var linkedUser = await db.Users.SingleAsync(u => u.Email == "aarav.sharma@example.com");
        Assert.Equal(created.Id, linkedUser.EmployeeId);

        var msg = Assert.Single(emailSender.Sent);
        Assert.Equal("aarav.sharma@example.com", msg.To);
        Assert.Contains("Acme Academy", msg.HtmlBody);
        Assert.Contains(created.EmployeeCode, msg.HtmlBody);
        Assert.Contains("Aarav Sharma", msg.HtmlBody);
        Assert.Contains("aarav.sharma@example.com", msg.HtmlBody);
        Assert.Contains("Employee", msg.HtmlBody);
        Assert.Contains("Set Password", msg.HtmlBody);
        Assert.Contains("http://localhost:4200/set-password?token=", msg.HtmlBody);

        // Extract and validate token round-trip
        var prefix = "http://localhost:4200/set-password?token=";
        var start = msg.HtmlBody.IndexOf(prefix, StringComparison.Ordinal) + prefix.Length;
        var end = msg.HtmlBody.IndexOf('"', start);
        var rawToken = Uri.UnescapeDataString(msg.HtmlBody[start..end]);
        var payload = await tokenService.ValidateSetPasswordTokenAsync(rawToken);
        Assert.NotNull(payload);
        Assert.Equal("aarav.sharma@example.com", payload!.Email);
        Assert.Equal(created.EmployeeCode, payload.EmployeeCode);

        // Must only include basic details + Set Password button — no password value or extra fields
        Assert.DoesNotContain("Employee@123", msg.HtmlBody);
        Assert.DoesNotContain("50000", msg.HtmlBody);
        Assert.DoesNotContain("HDFC", msg.HtmlBody);
        Assert.DoesNotContain("98765", msg.HtmlBody);
        Assert.DoesNotContain("Software Intern", msg.HtmlBody);
    }

    [Fact]
    public async Task CreateAsync_SendWelcomeEmailFalse_DoesNotSendEmail()
    {
        var (_, uow, deptId) = SetupDb("Acme Academy");
        var emailSender = new FakeEmailSender();
        var service = new EmployeeService(uow, new StubCurrentUser(), new FakePasswordHasher(), emailSender, new StubTenantContext());

        await service.CreateAsync(MakeRequest(deptId, "noemail@example.com", false));

        Assert.Empty(emailSender.Sent);
    }

    [Fact]
    public async Task CreateAsync_SmtpFailure_StillCompletesOnboarding()
    {
        var (_, uow, deptId) = SetupDb("Acme Academy");
        var emailSender = new FakeEmailSender { Fail = true };
        var service = new EmployeeService(uow, new StubCurrentUser(), new FakePasswordHasher(), emailSender, new StubTenantContext());

        var created = await service.CreateAsync(MakeRequest(deptId, "failok@example.com", true));

        Assert.Equal("failok@example.com", created.Email);
        Assert.Single(emailSender.Sent);
    }
}
