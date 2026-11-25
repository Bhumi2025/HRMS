using Hrms.Application.Common.Tenancy;

namespace Hrms.Tests;

public sealed class TenantNamingTests
{
    [Theory]
    [InlineData("Acme Widgets LLC", "acme_widgets_llc")]
    [InlineData("  HRNexus Global  ", "hrnexus_global")]
    [InlineData("A/B -- C", "a_b_c")]
    [InlineData("!!!", "")]
    public void Slugify_ProducesSafeLowercaseTokens(string input, string expected)
    {
        Assert.Equal(expected, TenantNaming.Slugify(input));
    }

    [Fact]
    public void GenerateDatabaseName_UsesPascalPrefixWithoutUnderscores()
    {
        var single = TenantNaming.GenerateDatabaseName("siddharth", Guid.NewGuid(), _ => false);
        Assert.Equal("HRMSSiddharth", single);

        var name = TenantNaming.GenerateDatabaseName("Acme Widgets", Guid.NewGuid(), _ => false);
        Assert.Equal("HRMSAcmeWidgets", name);
        Assert.StartsWith("HRMS", name);
        Assert.True(TenantNaming.IsValidDatabaseName(name));
        Assert.DoesNotContain("_", name);
        Assert.DoesNotContain(" ", name);
    }

    [Fact]
    public void GenerateDatabaseName_AppendsSuffixOnCollisionWithoutUnderscores()
    {
        var companyId = Guid.NewGuid();

        var name = TenantNaming.GenerateDatabaseName("Acme", companyId, candidate => candidate == "HRMSAcme");

        Assert.NotEqual("HRMSAcme", name);
        Assert.StartsWith("HRMSAcme", name);
        Assert.DoesNotContain("_", name);
        Assert.True(TenantNaming.IsValidDatabaseName(name));
    }

    [Theory]
    [InlineData("HRMSDefault")]             // default database name
    [InlineData("HRMSSiddharth")]
    [InlineData("hrms_t_acme")]             // legacy tenant DB names remain valid
    public void IsValidDatabaseName_AcceptsSafeNames(string value)
    {
        Assert.True(TenantNaming.IsValidDatabaseName(value));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("HRMS; DROP DATABASE other")]   // SQL injection attempt
    [InlineData("hrms' OR 1=1")]
    [InlineData("hrms]--")]
    [InlineData("name with spaces")]
    [InlineData("name<bracket>")]
    public void IsValidDatabaseName_RejectsUnsafeNames(string? value)
    {
        Assert.False(TenantNaming.IsValidDatabaseName(value));
    }

    [Fact]
    public void GenerateCode_IsUppercaseAndUnique()
    {
        var code = TenantNaming.GenerateCode(null, "Acme Widgets", _ => false);
        Assert.Equal("ACMEWIDGETS", code);

        var unique = TenantNaming.GenerateCode(null, "Acme", candidate => candidate == "ACME");
        Assert.NotEqual("ACME", unique);
    }

    [Fact]
    public void Token_IsUrlSafe_AndHashIsStable()
    {
        var token = TenantNaming.CreateToken();

        Assert.DoesNotContain('+', token);
        Assert.DoesNotContain('/', token);
        Assert.DoesNotContain('=', token);
        Assert.Equal(TenantNaming.HashToken(token), TenantNaming.HashToken(token));
        Assert.NotEqual(token, TenantNaming.HashToken(token));
    }
}
