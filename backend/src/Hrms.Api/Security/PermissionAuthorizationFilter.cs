using System.Security.Claims;
using Hrms.Application.Abstractions.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;

namespace Hrms.Api.Security;

/// <summary>
/// Enforces dynamic database-driven permissions across API endpoints.
/// Supports opt-outs for auth endpoints, user navigation, public routes, and user self-service.
/// Ensures Super Admin and Company Admin are never locked out of Settings, Roles, Permissions and Navigation.
/// </summary>
public sealed class PermissionAuthorizationFilter : IAsyncActionFilter
{
    private static readonly HashSet<string> OptOutPaths = new(StringComparer.OrdinalIgnoreCase)
    {
        "/api/navigation/user",
        "/api/files",
        "/health",
        "/swagger",
        "/"
    };

    private static readonly Dictionary<string, string> PathToModuleCode = new(StringComparer.OrdinalIgnoreCase)
    {
        { "/api/files", "DOCS" },
        { "/api/employees", "EMPL" },
        { "/api/shift", "SHIF" },
        { "/api/roster", "SHIF" },
        { "/api/attendance", "ATTD" },
        { "/api/leave", "LEAV" },
        { "/api/payroll", "PAYR" },
        { "/api/payslips", "PAYS" },
        { "/api/onboarding", "ONBD" },
        { "/api/offboarding", "EMPL" },
        { "/api/documents", "DOCS" },
        { "/api/approvals", "APPR" },
        { "/api/reports", "REPT" },
        { "/api/company", "COMP" },
        { "/api/organization", "COMP" },
        { "/api/roles", "SETT" },
        { "/api/navigation", "SETT" },
        { "/api/keygroups", "SETT" },
        { "/api/options", "SETT" },
        { "/api/erp", "SETT" },
        { "/api/assets", "DOCS" },
        { "/api/support", "DOCS" },
        { "/api/tasks", "DASH" },
        { "/api/performance", "DASH" },
        { "/api/announcements", "DASH" },
        { "/api/dashboard", "DASH" }
    };

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var endpoint = context.HttpContext.GetEndpoint();
        if (endpoint != null)
        {
            if (endpoint.Metadata.GetMetadata<IAllowAnonymous>() != null ||
                endpoint.Metadata.GetMetadata<OptOutPermissionAttribute>() != null)
            {
                await next();
                return;
            }
        }

        var path = context.HttpContext.Request.Path.Value ?? string.Empty;

        // 1. Opt-out for auth (login, logout, refresh, etc.) and user's own navigation
        if (path.StartsWith("/api/auth", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/swagger", StringComparison.OrdinalIgnoreCase) ||
            OptOutPaths.Contains(path))
        {
            await next();
            return;
        }

        // 2. Unauthenticated requests are handled by standard ASP.NET Core authentication/challenge
        var user = context.HttpContext.User;
        if (user?.Identity?.IsAuthenticated != true)
        {
            await next();
            return;
        }

        var roleName = user.FindFirstValue(ClaimTypes.Role) ?? string.Empty;

        // 3. Platform bypass for Super Admin
        if (roleName.Equals("Super Admin", StringComparison.OrdinalIgnoreCase) ||
            roleName.Equals("SuperAdmin", StringComparison.OrdinalIgnoreCase))
        {
            await next();
            return;
        }

        // Lockout protection: Company Admin ALWAYS retains full access to Settings, Roles, Permissions, Navigation
        bool isCompanyAdmin = roleName.Equals("Company Admin", StringComparison.OrdinalIgnoreCase) ||
                              roleName.Equals("CompanyAdmin", StringComparison.OrdinalIgnoreCase);
        bool isHrManager = roleName.Equals("HR Manager", StringComparison.OrdinalIgnoreCase) ||
                           roleName.Equals("HrManager", StringComparison.OrdinalIgnoreCase);

        // Immediate offboarding & deactivation check for employee callers across all protected endpoints
        if (!isCompanyAdmin && !isHrManager)
        {
            var uowCheck = context.HttpContext.RequestServices.GetService(typeof(IUnitOfWork)) as IUnitOfWork;
            if (uowCheck != null)
            {
                var idClaim = user.FindFirstValue(ClaimTypes.NameIdentifier);
                Guid? callerUserId = Guid.TryParse(idClaim, out var pUid) ? pUid : null;
                var empClaimStr = user.FindFirstValue("employeeId");
                Guid? callerEmpId = Guid.TryParse(empClaimStr, out var pEid) ? pEid : null;

                bool isBlocked = false;

                if (callerUserId.HasValue)
                {
                    var dbUser = await uowCheck.Users.GetByIdAsync(callerUserId.Value);
                    if (dbUser != null)
                    {
                        if (!dbUser.IsActive)
                        {
                            isBlocked = true;
                        }
                        if (!callerEmpId.HasValue && dbUser.EmployeeId.HasValue)
                        {
                            callerEmpId = dbUser.EmployeeId.Value;
                        }
                        if (!callerEmpId.HasValue && !string.IsNullOrWhiteSpace(dbUser.Email))
                        {
                            var matchedEmp = await uowCheck.Employees.FirstOrDefaultAsync(
                                uowCheck.Employees.Query().Where(e => e.Email.ToLower() == dbUser.Email.ToLower()));
                            if (matchedEmp != null)
                            {
                                callerEmpId = matchedEmp.Id;
                            }
                        }
                    }
                }

                if (!isBlocked && callerEmpId.HasValue)
                {
                    var emp = await uowCheck.Employees.GetByIdAsync(callerEmpId.Value);
                    if (emp != null && (emp.Status is Domain.Enums.EmploymentStatus.Offboarding or Domain.Enums.EmploymentStatus.Terminated or Domain.Enums.EmploymentStatus.Resigned))
                    {
                        isBlocked = true;
                    }
                    else
                    {
                        try
                        {
                            var hasOffboardRecord = await uowCheck.OffboardingRecords.AnyAsync(
                                uowCheck.OffboardingRecords.Query().Where(o => o.EmployeeId == callerEmpId.Value && (o.Status == Domain.Entities.OffboardingStatus.Completed || o.AccessRevoked)));
                            if (hasOffboardRecord)
                            {
                                isBlocked = true;
                            }
                        }
                        catch
                        {
                            // Soft-fail: if the table cannot be queried, do not block or crash the request
                        }
                    }
                }

                if (isBlocked)
                {
                    context.Result = new ObjectResult(new
                    {
                        message = "Your account has been deactivated. Please contact HR.",
                        title = "Your account has been deactivated. Please contact HR."
                    })
                    {
                        StatusCode = StatusCodes.Status403Forbidden
                    };
                    return;
                }
            }
        }

        // 4. Employee self-service opt-outs (personal data operations and read-only lookups)
        var empClaim = user.FindFirstValue("employeeId");
        bool isOwnEmployeePath = false;
        if (!string.IsNullOrWhiteSpace(empClaim))
        {
            if (path.StartsWith($"/api/employees/{empClaim}", StringComparison.OrdinalIgnoreCase))
            {
                isOwnEmployeePath = true;
            }
            else if (path.StartsWith("/api/employees/", StringComparison.OrdinalIgnoreCase))
            {
                var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
                if (segments.Length >= 3 && Guid.TryParse(segments[2], out var targetId) && Guid.TryParse(empClaim, out var userEmpId) && targetId == userEmpId)
                {
                    isOwnEmployeePath = true;
                }
            }
        }

        if (path.StartsWith("/api/employees/me", StringComparison.OrdinalIgnoreCase) ||
            isOwnEmployeePath ||
            path.StartsWith("/api/documents", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/files", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/attendance/today", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/attendance/punch", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/attendance/punches/today", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/attendance/enrolled-faces", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/attendance/clock-in", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/attendance/clock-out", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/dashboard/me", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/payslips/my", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/payroll/me/payslips", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/notifications", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/profile", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/face-recognition", StringComparison.OrdinalIgnoreCase) ||
            (context.HttpContext.Request.Method == "GET" && (
                path.StartsWith("/api/organization/company", StringComparison.OrdinalIgnoreCase) ||
                path.StartsWith("/api/organization/departments", StringComparison.OrdinalIgnoreCase) ||
                path.StartsWith("/api/organization/designations", StringComparison.OrdinalIgnoreCase) ||
                path.StartsWith("/api/organization/branches", StringComparison.OrdinalIgnoreCase) ||
                path.StartsWith("/api/options/group", StringComparison.OrdinalIgnoreCase) ||
                path.StartsWith("/api/options/groups", StringComparison.OrdinalIgnoreCase)
            )) ||
            (context.HttpContext.Request.Method == "POST" && path.StartsWith("/api/options/multiple", StringComparison.OrdinalIgnoreCase)))
        {
            await next();
            return;
        }

        // 5. Determine target module code from route path
        string? moduleCode = null;
        foreach (var (prefix, code) in PathToModuleCode)
        {
            if (path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                moduleCode = code;
                break;
            }
        }

        // If not mapped to a known module, deny by default for non-admin roles
        if (moduleCode == null)
        {
            context.Result = new ObjectResult(new { message = $"Access denied: endpoint '{path}' is not mapped to an authorized module." })
            {
                StatusCode = StatusCodes.Status403Forbidden
            };
            return;
        }

        // Lockout protection: Company Admin is guaranteed full read/write access to Settings
        if (isCompanyAdmin && moduleCode == "SETT")
        {
            await next();
            return;
        }

        // Restrict Company Settings (Key Groups, Navigation, Roles) to Company Admin / Super Admin only
        if (isHrManager && moduleCode == "SETT")
        {
            context.Result = new ObjectResult(new
            {
                errorCode = "PERMISSION_DENIED",
                message = "Access denied: Settings and Key Group Management are restricted to Company Admin."
            })
            {
                StatusCode = StatusCodes.Status403Forbidden
            };
            return;
        }

        // 6. Check database permissions via tenant UnitOfWork
        var uow = context.HttpContext.RequestServices.GetService(typeof(IUnitOfWork)) as IUnitOfWork;
        if (uow == null)
        {
            await next();
            return;
        }

        var dbRole = await uow.Roles.FirstOrDefaultAsync(
            uow.Roles.Query().Where(r => r.Name.ToLower() == roleName.ToLower() || r.Code.ToLower() == roleName.ToLower()));

        if (dbRole == null)
        {
            context.Result = new ObjectResult(new { message = $"Access denied: role '{roleName}' not found." })
            {
                StatusCode = StatusCodes.Status403Forbidden
            };
            return;
        }

        var navItem = await uow.NavigationItems.FirstOrDefaultAsync(
            uow.NavigationItems.Query().Where(n => n.Code.ToLower() == moduleCode.ToLower()));

        if (navItem == null)
        {
            // If the navigation item doesn't exist yet, proceed
            await next();
            return;
        }

        var perm = await uow.RoleNavigations.FirstOrDefaultAsync(
            uow.RoleNavigations.Query().Where(rn => rn.RoleId == dbRole.Id && rn.NavigationItemId == navItem.Id));

        if (perm == null)
        {
            context.Result = new ObjectResult(new { errorCode = "PERMISSION_DENIED", message = $"Access denied: no permissions granted for module '{navItem.Title}'." })
            {
                StatusCode = StatusCodes.Status403Forbidden
            };
            return;
        }

        if (perm.IsFull)
        {
            await next();
            return;
        }

        var method = context.HttpContext.Request.Method;
        bool isCompanyProfileEdit = path.StartsWith("/api/organization/company", StringComparison.OrdinalIgnoreCase);

        bool allowed = method switch
        {
            "GET" => perm.IsView,
            "POST" => isCompanyProfileEdit ? perm.IsEdit : perm.IsCreate,
            "PUT" or "PATCH" => perm.IsEdit,
            "DELETE" => perm.IsDelete,
            _ => true
        };

        if (!allowed)
        {
            context.Result = new ObjectResult(new { errorCode = "PERMISSION_DENIED", message = $"Access denied: you do not have permission for {method} operations on '{navItem.Title}'." })
            {
                StatusCode = StatusCodes.Status403Forbidden
            };
            return;
        }

        await next();
    }
}
