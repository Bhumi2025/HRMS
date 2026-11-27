using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Hrms.Application.Abstractions.Security;
using Hrms.Application.Abstractions.Tenancy;
using Hrms.Application.Common;
using Hrms.Application.DTOs;
using Hrms.Application.Services;
using Hrms.Domain.Entities;
using Hrms.Domain.Enums;
using Hrms.Infrastructure.Persistence;
using Hrms.Infrastructure.Persistence.Master;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;

namespace Hrms.Tests;

public sealed class FaceRecognitionLoginTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static ResolvedTenant ActiveTenant(string code = "ACME", string dbName = "hrms_t_acme", bool isDefault = false) =>
        new(Guid.NewGuid(), code, "Acme Corp", dbName, CompanyStatus.Active, isDefault, null);

    private static float[] MakeBasisVector(int dominantAxis, int secondaryAxis = -1, float secondaryWeight = 0f, float scale = 1.0f)
    {
        var vec = new float[128];
        for (int i = 0; i < 128; i++)
        {
            vec[i] = (i % 2 == 0 ? 0.005f : -0.005f);
        }

        vec[dominantAxis % 128] += 1.0f;
        if (secondaryAxis >= 0)
        {
            vec[secondaryAxis % 128] += secondaryWeight;
        }

        return FaceBiometricMatcher.NormalizeToScale(vec, scale);
    }

    private static float[] BlendUnitAngle(float[] a, float[] b, double angleRadians, float scale = 1.0f)
    {
        var ua = FaceBiometricMatcher.NormalizeUnit(a);
        var ub = FaceBiometricMatcher.NormalizeUnit(b);
        double dot = 0;
        for (int i = 0; i < 128; i++) dot += ua[i] * ub[i];

        var ortho = new float[128];
        for (int i = 0; i < 128; i++) ortho[i] = (float)(ub[i] - dot * ua[i]);
        var orthoUnit = FaceBiometricMatcher.NormalizeUnit(ortho);

        var cos = Math.Cos(angleRadians);
        var sin = Math.Sin(angleRadians);
        var blended = new float[128];
        for (int i = 0; i < 128; i++)
        {
            blended[i] = (float)(cos * ua[i] + sin * orthoUnit[i]);
        }

        return FaceBiometricMatcher.NormalizeToScale(blended, scale);
    }

    private static (HrmsDbContext db, UnitOfWork uow, Employee emp1, Employee emp2) SetupInMemoryTenantDb()
    {
        var options = new DbContextOptionsBuilder<HrmsDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        var db = new HrmsDbContext(options);

        var emp1 = new Employee
        {
            Id = Guid.NewGuid(),
            FirstName = "Rutavi",
            LastName = "Patel",
            EmployeeCode = "EMP-1027",
            Email = "rutavi@acme.com",
            Status = EmploymentStatus.Active,
            JobTitle = "Software Engineer",
            Grade = "L3",
            Currency = "INR"
        };

        var emp2 = new Employee
        {
            Id = Guid.NewGuid(),
            FirstName = "Jaydev",
            LastName = "Patel",
            EmployeeCode = "EMP-1030",
            Email = "jaydev@acme.com",
            Status = EmploymentStatus.Active,
            JobTitle = "Senior Engineer",
            Grade = "L4",
            Currency = "INR"
        };

        db.Employees.AddRange(emp1, emp2);
        db.SaveChanges();

        return (db, new UnitOfWork(db), emp1, emp2);
    }

    private sealed class TestTenantResolver : ITenantResolutionService
    {
        private readonly ResolvedTenant? _tenant;

        public TestTenantResolver(ResolvedTenant? tenant) => _tenant = tenant;

        public Task<ResolvedTenant?> ResolveByCodeAsync(string code, CancellationToken ct = default) =>
            Task.FromResult(_tenant is not null && string.Equals(_tenant.Code, code, StringComparison.OrdinalIgnoreCase) ? _tenant : null);

        public Task<ResolvedTenant?> ResolveByIdAsync(Guid companyId, CancellationToken ct = default) =>
            Task.FromResult(_tenant is not null && _tenant.CompanyId == companyId ? _tenant : null);

        public Task<ResolvedTenant?> ResolveDefaultAsync(CancellationToken ct = default) =>
            Task.FromResult(_tenant);

        public Task<ResolvedTenant?> ResolveByEmailAsync(string email, CancellationToken ct = default) =>
            Task.FromResult(_tenant);

        public void InvalidateCache(Guid companyId, string code) { }
    }

    private sealed class TestCurrentUser : ICurrentUser
    {
        public bool IsAuthenticated { get; init; } = true;
        public Guid? UserId { get; init; }
        public string? Email { get; init; }
        public string? Role { get; init; } = "Employee";
        public Guid? EmployeeId { get; init; }
        public Guid? CompanyId { get; init; }
        public bool IsInRole(string role) => string.Equals(Role, role, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task FaceLoginAsync_OneToMany_MatchesRegardlessOfStoredAndProbeNormScale()
    {
        var tenant = ActiveTenant();
        var tenantDb = new FakeTenantDatabaseService();
        tenantDb.Databases.Add(tenant.DatabaseName!);

        var aliceVec = MakeBasisVector(dominantAxis: 0, scale: 1.0f); // Stored at norm 1.0
        var bobVec = MakeBasisVector(dominantAxis: 20, scale: 1.42f); // Stored at raw face-api norm 1.42

        tenantDb.SeedFaceCandidate(tenant.DatabaseName!, new TenantFaceCandidate(
            EmployeeId: Guid.NewGuid(),
            EmployeeCode: "EMP-101",
            FullName: "Alice Rao",
            Email: "alice@acme.com",
            EmployeeStatus: EmploymentStatus.Active,
            IsOffboarded: false,
            FaceDescriptor: FaceBiometricMatcher.SerializeDescriptor(aliceVec),
            FacePhotoUrl: "data:image/jpeg;base64,alice",
            FaceEnrolledAtUtc: DateTime.UtcNow,
            UserId: Guid.NewGuid(),
            UserEmail: "alice@acme.com",
            UserFullName: "Alice Rao",
            UserInitials: "AR",
            UserIsActive: true,
            RoleName: "Employee",
            RoleCode: "Employee"));

        tenantDb.SeedFaceCandidate(tenant.DatabaseName!, new TenantFaceCandidate(
            EmployeeId: Guid.NewGuid(),
            EmployeeCode: "EMP-102",
            FullName: "Bob Shah",
            Email: "bob@acme.com",
            EmployeeStatus: EmploymentStatus.Active,
            IsOffboarded: false,
            FaceDescriptor: FaceBiometricMatcher.SerializeDescriptor(bobVec),
            FacePhotoUrl: "data:image/jpeg;base64,bob",
            FaceEnrolledAtUtc: DateTime.UtcNow,
            UserId: Guid.NewGuid(),
            UserEmail: "bob@acme.com",
            UserFullName: "Bob Shah",
            UserInitials: "BS",
            UserIsActive: true,
            RoleName: "HR Manager",
            RoleCode: "HrManager"));

        // Probe comes in slightly perturbed (~0.10 unit distance) and unnormalized at norm 1.48
        var probe = BlendUnitAngle(aliceVec, MakeBasisVector(5), angleRadians: 0.10, scale: 1.48f);

        var service = new FaceRecognitionService(
            tenantDb,
            new TestTenantResolver(tenant),
            new StubTenantContext(),
            new FakeJwtTokenService());

        var result = await service.FaceLoginAsync(new FaceLoginRequest(
            FaceDescriptor: probe,
            CompanyCode: "ACME",
            LivenessScore: 0.92));

        Assert.Equal("alice@acme.com", result.User.Email);
        Assert.StartsWith("token:alice@acme.com:ACME", result.AccessToken);
        Assert.True(result.MatchScore >= 85.0);
        Assert.True(result.UnitDistance <= 0.25);
    }

    [Fact]
    public async Task FaceLoginAsync_OneToOne_WithEmailAndMatchingFace_Succeeds()
    {
        var tenant = ActiveTenant();
        var tenantDb = new FakeTenantDatabaseService();
        tenantDb.Databases.Add(tenant.DatabaseName!);

        var aliceVec = MakeBasisVector(dominantAxis: 3, scale: 1.50f);
        tenantDb.SeedFaceCandidate(tenant.DatabaseName!, new TenantFaceCandidate(
            Guid.NewGuid(), "EMP-201", "Alice Verification", "alice.v@acme.com",
            EmploymentStatus.Active, false, FaceBiometricMatcher.SerializeDescriptor(aliceVec),
            "data:image/jpeg;base64,av", DateTime.UtcNow,
            Guid.NewGuid(), "alice.v@acme.com", "Alice Verification", "AV", true, "Employee", "Employee"));

        var probe = BlendUnitAngle(aliceVec, MakeBasisVector(9), angleRadians: 0.12, scale: 1.0f);

        var service = new FaceRecognitionService(
            tenantDb,
            new TestTenantResolver(tenant),
            new StubTenantContext(),
            new FakeJwtTokenService());

        var result = await service.FaceLoginAsync(new FaceLoginRequest(
            FaceDescriptor: probe,
            Email: "alice.v@acme.com",
            CompanyCode: "ACME"));

        Assert.Equal("alice.v@acme.com", result.User.Email);
        Assert.NotEmpty(result.AccessToken);
    }

    [Fact]
    public async Task FaceLoginAsync_ImpostorFace_ThrowsUnauthorizedException()
    {
        var tenant = ActiveTenant();
        var tenantDb = new FakeTenantDatabaseService();
        tenantDb.Databases.Add(tenant.DatabaseName!);

        var enrolled = MakeBasisVector(dominantAxis: 0, scale: 1.50f);
        var impostor = MakeBasisVector(dominantAxis: 45, scale: 1.50f); // unit distance ~1.41

        tenantDb.SeedFaceCandidate(tenant.DatabaseName!, new TenantFaceCandidate(
            Guid.NewGuid(), "EMP-301", "Enrolled User", "enrolled@acme.com",
            EmploymentStatus.Active, false, FaceBiometricMatcher.SerializeDescriptor(enrolled),
            null, DateTime.UtcNow,
            Guid.NewGuid(), "enrolled@acme.com", "Enrolled User", "EU", true, "Employee", "Employee"));

        var service = new FaceRecognitionService(
            tenantDb,
            new TestTenantResolver(tenant),
            new StubTenantContext(),
            new FakeJwtTokenService());

        await Assert.ThrowsAsync<UnauthorizedException>(() =>
            service.FaceLoginAsync(new FaceLoginRequest(FaceDescriptor: impostor, CompanyCode: "ACME")));
    }

    [Fact]
    public async Task FaceLoginAsync_AmbiguousNearTieBetweenTwoEmployees_ThrowsUnauthorizedException()
    {
        var tenant = ActiveTenant();
        var tenantDb = new FakeTenantDatabaseService();
        tenantDb.Databases.Add(tenant.DatabaseName!);

        var anchor = MakeBasisVector(dominantAxis: 0, scale: 1.0f);
        var orthA = MakeBasisVector(dominantAxis: 10, scale: 1.0f);
        var orthB = MakeBasisVector(dominantAxis: 20, scale: 1.0f);

        // Two enrolled vectors each at ~0.18 radians from anchor in opposite directions
        var empAVec = BlendUnitAngle(anchor, orthA, 0.18, 1.50f);
        var empBVec = BlendUnitAngle(anchor, orthB, 0.19, 1.50f);

        tenantDb.SeedFaceCandidate(tenant.DatabaseName!, new TenantFaceCandidate(
            Guid.NewGuid(), "EMP-A", "Twin A", "twina@acme.com",
            EmploymentStatus.Active, false, FaceBiometricMatcher.SerializeDescriptor(empAVec),
            null, DateTime.UtcNow,
            Guid.NewGuid(), "twina@acme.com", "Twin A", "TA", true, "Employee", "Employee"));

        tenantDb.SeedFaceCandidate(tenant.DatabaseName!, new TenantFaceCandidate(
            Guid.NewGuid(), "EMP-B", "Twin B", "twinb@acme.com",
            EmploymentStatus.Active, false, FaceBiometricMatcher.SerializeDescriptor(empBVec),
            null, DateTime.UtcNow,
            Guid.NewGuid(), "twinb@acme.com", "Twin B", "TB", true, "Employee", "Employee"));

        var service = new FaceRecognitionService(
            tenantDb,
            new TestTenantResolver(tenant),
            new StubTenantContext(),
            new FakeJwtTokenService());

        var ex = await Assert.ThrowsAsync<UnauthorizedException>(() =>
            service.FaceLoginAsync(new FaceLoginRequest(FaceDescriptor: anchor, CompanyCode: "ACME")));

        Assert.Contains("Ambiguous", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(EmploymentStatus.Offboarding, false, true)]
    [InlineData(EmploymentStatus.Terminated, false, true)]
    [InlineData(EmploymentStatus.Active, true, true)]
    [InlineData(EmploymentStatus.Active, false, false)]
    public async Task FaceLoginAsync_InactiveOffboardedOrDeactivatedAccount_ThrowsForbiddenException(
        EmploymentStatus empStatus,
        bool isOffboarded,
        bool userIsActive)
    {
        var tenant = ActiveTenant();
        var tenantDb = new FakeTenantDatabaseService();
        tenantDb.Databases.Add(tenant.DatabaseName!);

        var vec = MakeBasisVector(dominantAxis: 7, scale: 1.50f);
        tenantDb.SeedFaceCandidate(tenant.DatabaseName!, new TenantFaceCandidate(
            Guid.NewGuid(), "EMP-401", "Blocked User", "blocked@acme.com",
            empStatus, isOffboarded, FaceBiometricMatcher.SerializeDescriptor(vec),
            null, DateTime.UtcNow,
            Guid.NewGuid(), "blocked@acme.com", "Blocked User", "BU", userIsActive, "Employee", "Employee"));

        var service = new FaceRecognitionService(
            tenantDb,
            new TestTenantResolver(tenant),
            new StubTenantContext(),
            new FakeJwtTokenService());

        var ex = await Assert.ThrowsAsync<ForbiddenException>(() =>
            service.FaceLoginAsync(new FaceLoginRequest(FaceDescriptor: vec, CompanyCode: "ACME")));

        Assert.Contains("deactivated", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task FaceLoginAsync_SuspendedCompany_ThrowsForbiddenException()
    {
        var suspended = new ResolvedTenant(Guid.NewGuid(), "SUSP", "Suspended", "hrms_t_susp", CompanyStatus.Suspended, false, null);
        var service = new FaceRecognitionService(
            new FakeTenantDatabaseService(),
            new TestTenantResolver(suspended),
            new StubTenantContext(),
            new FakeJwtTokenService());

        var ex = await Assert.ThrowsAsync<ForbiddenException>(() =>
            service.FaceLoginAsync(new FaceLoginRequest(
                FaceDescriptor: MakeBasisVector(0, scale: 1.50f),
                CompanyCode: "SUSP")));

        Assert.Contains("suspended", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task FaceLoginAsync_LowLivenessOrWrongDimensions_ThrowsValidationException()
    {
        var service = new FaceRecognitionService(
            new FakeTenantDatabaseService(),
            new TestTenantResolver(ActiveTenant()),
            new StubTenantContext(),
            new FakeJwtTokenService());

        await Assert.ThrowsAsync<ValidationException>(() =>
            service.FaceLoginAsync(new FaceLoginRequest(
                FaceDescriptor: MakeBasisVector(0),
                CompanyCode: "ACME",
                LivenessScore: 0.15)));

        await Assert.ThrowsAsync<ValidationException>(() =>
            service.FaceLoginAsync(new FaceLoginRequest(
                FaceDescriptor: new[] { 0.1f, 0.2f, 0.3f },
                CompanyCode: "ACME")));
    }

    [Fact]
    public async Task EnrollFaceAsync_DistinctFacesRegardlessOfNormalization_DoNotFalseDuplicateMatch()
    {
        var (_, uow, emp1, emp2) = SetupInMemoryTenantDb();
        var attendance = new AttendanceService(uow, new TestCurrentUser { UserId = Guid.NewGuid(), Role = "HrManager" });

        // Rutavi stored with norm = 1.0, Jaydev scanned with unit distance ~0.40 (cos ~0.92 — previously falsely collided at norm 1.0 with d = 0.40 <= 0.58!)
        var rutaviVec = MakeBasisVector(dominantAxis: 1, scale: 1.0f);
        var jaydevVec = BlendUnitAngle(rutaviVec, MakeBasisVector(dominantAxis: 2), angleRadians: 0.40, scale: 1.0f);

        var enrolled1 = await attendance.EnrollFaceAsync(emp1.Id, new EnrollFaceRequest(
            FaceBiometricMatcher.SerializeDescriptor(rutaviVec),
            "data:image/jpeg;base64,rutavi"));
        Assert.True(enrolled1);

        var enrolled2 = await attendance.EnrollFaceAsync(emp2.Id, new EnrollFaceRequest(
            FaceBiometricMatcher.SerializeDescriptor(jaydevVec),
            "data:image/jpeg;base64,jaydev"));
        Assert.True(enrolled2);

        // Returning enrolled faces must canonicalize stored vectors to norm ~1.50 so frontend client Euclidean threshold never false-triggers on distinct people
        var list = await attendance.GetEnrolledFacesAsync();
        Assert.Equal(2, list.Count);
        foreach (var item in list)
        {
            var parsed = FaceBiometricMatcher.TryParseDescriptor(item.FaceDescriptor)!;
            var norm = Math.Sqrt(parsed.Sum(v => (double)v * v));
            Assert.InRange(norm, 1.49, 1.51);
        }

        // Meanwhile re-enrolling Rutavi's face (even scaled at raw 1.42 norm!) under emp2 MUST still throw duplicate!
        var rutaviRawProbe = BlendUnitAngle(rutaviVec, MakeBasisVector(dominantAxis: 8), angleRadians: 0.08, scale: 1.42f);
        var ex = await Assert.ThrowsAsync<ValidationException>(() =>
            attendance.EnrollFaceAsync(emp2.Id, new EnrollFaceRequest(
                FaceBiometricMatcher.SerializeDescriptor(rutaviRawProbe),
                "data:image/jpeg;base64,otherimg")));
        Assert.Contains("Duplicate face detected", ex.Message);
    }

    [Fact]
    public async Task GetEnrolledFacesAsync_FiltersUnsplashPlaceholdersAndOffboardedEmployees()
    {
        var (db, uow, activeEmp, offboardedEmp) = SetupInMemoryTenantDb();

        // Seed Unsplash dummy vector like old DbSeeder produced (128 values in [-0.2, 0.2])
        var rng = new Random(42);
        var fakeSeededVec = Enumerable.Range(0, 128).Select(_ => (float)Math.Round(rng.NextDouble() * 0.4 - 0.2, 4)).ToArray();

        var placeholderEmp = new Employee
        {
            Id = Guid.NewGuid(),
            FirstName = "Placeholder",
            LastName = "Demo",
            EmployeeCode = "EMP-9991",
            Email = "placeholder@acme.com",
            Status = EmploymentStatus.Active,
            JobTitle = "QA",
            Grade = "L2",
            Currency = "INR",
            FacePhotoUrl = "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150",
            FaceDescriptor = FaceBiometricMatcher.SerializeDescriptor(fakeSeededVec),
            FaceEnrolledAtUtc = DateTime.UtcNow
        };

        offboardedEmp.Status = EmploymentStatus.Terminated;
        offboardedEmp.FacePhotoUrl = "data:image/jpeg;base64,off";
        offboardedEmp.FaceDescriptor = FaceBiometricMatcher.SerializeDescriptor(MakeBasisVector(15, scale: 1.0f));
        offboardedEmp.FaceEnrolledAtUtc = DateTime.UtcNow;

        activeEmp.FacePhotoUrl = "data:image/jpeg;base64,active";
        activeEmp.FaceDescriptor = FaceBiometricMatcher.SerializeDescriptor(MakeBasisVector(4, scale: 1.0f));
        activeEmp.FaceEnrolledAtUtc = DateTime.UtcNow;

        db.Employees.Add(placeholderEmp);
        await db.SaveChangesAsync();

        var service = new AttendanceService(uow, new TestCurrentUser { UserId = Guid.NewGuid(), Role = "HrManager" });
        var list = await service.GetEnrolledFacesAsync();

        Assert.Single(list);
        Assert.Equal(activeEmp.Id, list[0].EmployeeId);
        Assert.False(placeholderEmp.IsFaceEnrolled);
    }

    [Fact]
    public async Task GetEnrollmentStatusAsync_EmployeeInspectingOtherEmployee_ThrowsForbiddenException()
    {
        var (_, uow, emp1, emp2) = SetupInMemoryTenantDb();
        var service = new FaceRecognitionService(
            new FakeTenantDatabaseService(),
            new TestTenantResolver(ActiveTenant()),
            new StubTenantContext(),
            new FakeJwtTokenService(),
            Options.Create(new FaceRecognitionOptions()),
            logger: null,
            currentUser: new TestCurrentUser { IsAuthenticated = true, Role = "Employee", EmployeeId = emp1.Id },
            uow: uow);

        await Assert.ThrowsAsync<ForbiddenException>(() => service.GetEnrollmentStatusAsync(emp2.Id));
    }

    [Fact]
    public async Task HttpPipeline_FaceLoginVerifyAndStatus_WorkEndToEnd()
    {
        var runTag = Guid.NewGuid().ToString("N")[..8];
        var masterDbName = $"Hrms_FaceTest_Master_{runTag}";
        var defaultDbName = $"Hrms_FaceTest_Default_{runTag}";
        var localDbBase = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=True;TrustServerCertificate=True;";

        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:MasterConnection", $@"Server=(localdb)\MSSQLLocalDB;Database={masterDbName};Integrated Security=True;TrustServerCertificate=True;");
            builder.UseSetting("ConnectionStrings:DefaultConnection", $@"Server=(localdb)\MSSQLLocalDB;Database={defaultDbName};Integrated Security=True;TrustServerCertificate=True;");
            builder.UseSetting("Tenancy:TenantConnectionBase", localDbBase);
            builder.UseSetting("Tenancy:ProvisioningConnectionBase", localDbBase);
        });

        Guid activeEmpId = Guid.Empty;
        Guid offboardedEmpId = Guid.Empty;
        string companyCode;
        var activeFaceVec = MakeBasisVector(dominantAxis: 33, scale: 1.0f);
        var offboardedFaceVec = MakeBasisVector(dominantAxis: 77, scale: 1.50f);

        try
        {
            using (var scope = factory.Services.CreateScope())
            {
                var masterDb = scope.ServiceProvider.GetRequiredService<HrmsMasterDbContext>();
                var company = await masterDb.Companies.FirstAsync(c => c.Status == CompanyStatus.Active);
                companyCode = company.Code;

                var tenantDb = scope.ServiceProvider.GetRequiredService<HrmsDbContext>();
                var empRole = await tenantDb.Roles.FirstAsync(r => r.Code == "Employee");
                var dept = await tenantDb.Departments.FirstAsync();

                activeEmpId = Guid.NewGuid();
                var activeEmail = $"face.test.{activeEmpId:N}@testcorp.com";
                var activeEmp = new Employee
                {
                    Id = activeEmpId,
                    FirstName = "Face",
                    LastName = "Tester",
                    EmployeeCode = $"FT-{activeEmpId.ToString()[..6].ToUpperInvariant()}",
                    Email = activeEmail,
                    DepartmentId = dept.Id,
                    JobTitle = "Engineer",
                    Grade = "L3",
                    Currency = "INR",
                    Status = EmploymentStatus.Active,
                    FacePhotoUrl = "data:image/jpeg;base64,facetest",
                    FaceDescriptor = FaceBiometricMatcher.SerializeDescriptor(activeFaceVec),
                    FaceEnrolledAtUtc = DateTime.UtcNow
                };
                var activeUser = new User
                {
                    Id = Guid.NewGuid(),
                    Email = activeEmail,
                    NormalizedEmail = activeEmail.ToUpperInvariant(),
                    PasswordHash = "unused",
                    FullName = "Face Tester",
                    Initials = "FT",
                    RoleId = empRole.Id,
                    EmployeeId = activeEmpId,
                    IsActive = true
                };

                offboardedEmpId = Guid.NewGuid();
                var offEmail = $"face.off.{offboardedEmpId:N}@testcorp.com";
                var offEmp = new Employee
                {
                    Id = offboardedEmpId,
                    FirstName = "Offboarded",
                    LastName = "Tester",
                    EmployeeCode = $"FO-{offboardedEmpId.ToString()[..6].ToUpperInvariant()}",
                    Email = offEmail,
                    DepartmentId = dept.Id,
                    JobTitle = "Engineer",
                    Grade = "L3",
                    Currency = "INR",
                    Status = EmploymentStatus.Terminated,
                    FacePhotoUrl = "data:image/jpeg;base64,faceoff",
                    FaceDescriptor = FaceBiometricMatcher.SerializeDescriptor(offboardedFaceVec),
                    FaceEnrolledAtUtc = DateTime.UtcNow
                };
                var offUser = new User
                {
                    Id = Guid.NewGuid(),
                    Email = offEmail,
                    NormalizedEmail = offEmail.ToUpperInvariant(),
                    PasswordHash = "unused",
                    FullName = "Offboarded Tester",
                    Initials = "OT",
                    RoleId = empRole.Id,
                    EmployeeId = offboardedEmpId,
                    IsActive = true
                };

                tenantDb.Employees.AddRange(activeEmp, offEmp);
                tenantDb.Users.AddRange(activeUser, offUser);
                await tenantDb.SaveChangesAsync();
            }

            var client = factory.CreateClient();

            // 1. POST /api/auth/face-login (probe slightly rotated and at raw norm 1.45)
            var probe = BlendUnitAngle(activeFaceVec, MakeBasisVector(dominantAxis: 5), 0.11, 1.45f);
            var loginReq = new FaceLoginRequest(FaceDescriptor: probe, CompanyCode: companyCode, LivenessScore: 95);
            var loginResp = await client.PostAsync(
                "/api/auth/face-login",
                new StringContent(JsonSerializer.Serialize(loginReq, JsonOptions), Encoding.UTF8, "application/json"));

            Assert.Equal(HttpStatusCode.OK, loginResp.StatusCode);
            var loginBody = JsonSerializer.Deserialize<FaceLoginResponse>(
                await loginResp.Content.ReadAsStringAsync(), JsonOptions)!;
            Assert.Equal(activeEmpId, loginBody.User.EmployeeId);
            Assert.NotEmpty(loginBody.AccessToken);

            // 2. Use returned JWT against GET /api/face-recognition/status (own succeeds, other 403)
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", loginBody.AccessToken);
            var ownStatusResp = await client.GetAsync("/api/face-recognition/status");
            Assert.Equal(HttpStatusCode.OK, ownStatusResp.StatusCode);
            var statusDto = JsonSerializer.Deserialize<FaceEnrollmentStatusDto>(
                await ownStatusResp.Content.ReadAsStringAsync(), JsonOptions)!;
            Assert.True(statusDto.IsFaceEnrolled);

            var otherStatusResp = await client.GetAsync($"/api/face-recognition/status?employeeId={offboardedEmpId}");
            Assert.Equal(HttpStatusCode.Forbidden, otherStatusResp.StatusCode);

            // 3. POST /api/face-recognition/verify
            client.DefaultRequestHeaders.Authorization = null;
            var verifyResp = await client.PostAsync(
                "/api/face-recognition/verify",
                new StringContent(JsonSerializer.Serialize(new FaceVerifyRequest(FaceDescriptor: probe, CompanyCode: companyCode), JsonOptions), Encoding.UTF8, "application/json"));
            Assert.Equal(HttpStatusCode.OK, verifyResp.StatusCode);
            var verifyDto = JsonSerializer.Deserialize<FaceMatchResultDto>(
                await verifyResp.Content.ReadAsStringAsync(), JsonOptions)!;
            Assert.True(verifyDto.Matched);
            Assert.Equal(activeEmpId, verifyDto.EmployeeId);

            // 4. POST /api/face-recognition/login with impostor face -> 401
            var impostorResp = await client.PostAsync(
                "/api/face-recognition/login",
                new StringContent(JsonSerializer.Serialize(new FaceLoginRequest(FaceDescriptor: MakeBasisVector(dominantAxis: 110, scale: 1.50f), CompanyCode: companyCode), JsonOptions), Encoding.UTF8, "application/json"));
            Assert.Equal(HttpStatusCode.Unauthorized, impostorResp.StatusCode);

            // 5. POST /api/face-recognition/login with terminated employee face -> 403
            var offResp = await client.PostAsync(
                "/api/face-recognition/login",
                new StringContent(JsonSerializer.Serialize(new FaceLoginRequest(FaceDescriptor: offboardedFaceVec, CompanyCode: companyCode), JsonOptions), Encoding.UTF8, "application/json"));
            Assert.Equal(HttpStatusCode.Forbidden, offResp.StatusCode);
        }
        finally
        {
            await factory.DisposeAsync();
            Microsoft.Data.SqlClient.SqlConnection.ClearAllPools();
            await using var conn = new Microsoft.Data.SqlClient.SqlConnection(localDbBase);
            await conn.OpenAsync();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
IF DB_ID(N'{masterDbName}') IS NOT NULL
BEGIN
    ALTER DATABASE [{masterDbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [{masterDbName}];
END
IF DB_ID(N'{defaultDbName}') IS NOT NULL
BEGIN
    ALTER DATABASE [{defaultDbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [{defaultDbName}];
END";
            await cmd.ExecuteNonQueryAsync();
        }
    }
}
