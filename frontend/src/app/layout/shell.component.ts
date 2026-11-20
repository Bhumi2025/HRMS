import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { ApiService } from '../core/api/api.service';
import { NAV_CONFIG } from '../core/data/nav-config';
import { notificationsFor } from '../core/data/notifications.data';
import { ICONS, IconName } from '../core/icons/icons';
import { IconDirective } from '../core/icons/icon.directive';
import { AppNotification } from '../core/models';
import { PunchService } from '../core/services/punch.service';
import { SessionService } from '../core/services/session.service';
import { ThemeService } from '../core/services/theme.service';
import { ToastService } from '../core/services/toast.service';
import { UiService } from '../core/services/ui.service';
import { PermissionService } from '../core/services/permission.service';
import { NotificationStateService, DetailedNotification } from '../core/services/notification-state.service';
import { FacePunchModalComponent } from '../shared/face-punch-modal.component';

interface MasterNavItem {
  label: string;
  section: string;
  icon: IconName;
  path: string;
  empPath?: string;
  superOnly?: boolean;
  queryParams?: Record<string, string>;
  isSubItem?: boolean;
}

const MASTER_NAV_CATALOGUE: MasterNavItem[] = [
  // Overview
  { label: 'Dashboard', section: 'Overview', icon: 'dashboard', path: '/dashboard', empPath: '/me/dashboard' },

  // HR Modules
  { label: 'Company', section: 'HR Modules', icon: 'company', path: '/company', empPath: '/company' },
  { label: 'Employees', section: 'HR Modules', icon: 'employees', path: '/employees', empPath: '/employees' },
  { label: 'Punch In/Out', section: 'HR Modules', icon: 'camera', path: '/punch-in-out' },
  { label: 'Profile', section: 'HR Modules', icon: 'user', path: '/employee-profile', empPath: '/me/profile' },
  { label: 'Shift', section: 'HR Modules', icon: 'clock', path: '/shift', empPath: '/shift' },
  { label: 'Attendance', section: 'HR Modules', icon: 'attendance', path: '/attendance', empPath: '/me/attendance' },
  { label: 'Leave', section: 'HR Modules', icon: 'leave', path: '/leave', empPath: '/me/leave' },
  { label: 'Payroll', section: 'HR Modules', icon: 'payroll', path: '/payroll', empPath: '/payroll' },
  { label: 'Payslips', section: 'HR Modules', icon: 'payslip', path: '/payslips', empPath: '/me/payslips' },
  { label: 'Onboarding', section: 'HR Modules', icon: 'onboarding', path: '/onboarding', empPath: '/onboarding' },
  { label: 'Documents', section: 'HR Modules', icon: 'documents', path: '/documents', empPath: '/me/documents' },
  { label: 'Approvals', section: 'HR Modules', icon: 'approvals', path: '/approvals', empPath: '/approvals' },
  { label: 'Reports', section: 'HR Modules', icon: 'reports', path: '/reports', empPath: '/reports' },
  { label: 'Settings', section: 'HR Modules', icon: 'settings', path: '/settings', empPath: '/settings' },
];

/**
 * Application chrome shared by every role — ported from renderLayout() and
 * renderEmployeeLayout(). Renders the role-driven sidebar, the header with its
 * notification / punch / avatar fly-outs, the change-password modal, and the
 * routed page content.
 */
@Component({
  selector: 'app-shell',
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, IconDirective, FacePunchModalComponent],
  templateUrl: './shell.component.html',
})
export class ShellComponent implements OnInit, OnDestroy {
  protected readonly session = inject(SessionService);
  protected readonly theme = inject(ThemeService);
  protected readonly ui = inject(UiService);
  protected readonly punch = inject(PunchService);
  protected readonly perms = inject(PermissionService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly api = inject(ApiService);

  protected readonly sidebarOpen = signal(false);
  protected readonly pendingApprovalsCount = signal<number>(0);

  private readonly allOrganizationsTenant = {
    id: 'all',
    name: 'All Organizations',
    location: 'ALL',
    logo: 'assets/images/shape-logo.png',
  };

  protected readonly tenants = signal<{ id: string; name: string; location: string; logo: string }[]>([
    { id: 'all', name: 'All Organizations', location: 'ALL', logo: 'assets/images/shape-logo.png' },
    { id: 'default', name: 'HR Nexus Corporation', location: 'HRNEXUS', logo: 'assets/images/shape-logo.png' },
  ]);
  protected readonly selectedTenant = computed(() => {
    const list = this.tenants();
    const allOption = list.find((t) => t.id === 'all') || this.allOrganizationsTenant;
    if (this.role() !== 'Super Admin') {
      const u = this.user();
      if (!u) return allOption;
      return list.find((t) => (u.companyId && t.id === u.companyId) || (u.companyCode && t.location === u.companyCode)) || {
        id: u.companyId || 'current',
        name: u.companyName || 'HR Nexus Corporation',
        location: u.companyCode || 'HRNEXUS',
        logo: 'assets/images/shape-logo.png',
      };
    }

    const code = this.user()?.companyCode;
    const cid = this.user()?.companyId;
    if (!code || code === 'ALL' || cid === 'all') {
      return allOption;
    }
    const match = list.find((t) => (cid && t.id === cid) || (code && t.location.toUpperCase() === code.toUpperCase()));
    return match || allOption;
  });
  protected readonly tenantOpen = signal(false);

  protected readonly user = computed(() => this.session.user());
  protected readonly role = computed(() => this.session.activeRole());
  protected readonly companyLogo = computed(() => this.session.companyLogo() || null);
  protected readonly currentCompanyName = computed(() => {
    if (this.role() === 'Super Admin') {
      return this.selectedTenant()?.name || 'All Organizations';
    }
    return this.user()?.companyName || this.selectedTenant()?.name || 'HR Nexus Corporation';
  });

  protected readonly greeting = computed(() => {
    const hr = new Date().getHours();
    return hr < 12 ? 'Good Morning' : hr < 17 ? 'Good Afternoon' : 'Good Evening';
  });

  protected readonly userDisplayName = computed(() => {
    const role = this.role();
    if (role === 'HR Manager' || role === 'Company Admin') return 'HR Manager';
    return this.user()?.name || role || 'User';
  });

  protected readonly todayFormatted = computed(() => {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date());
  });

  protected readonly backendNavItems = signal<any[]>([]);

  /** Sidebar sections dynamically generated per role */
  protected readonly nav = computed(() => {
    const isSuper = this.role() === 'Super Admin';
    const isCompanyAdmin = this.role() === 'Company Admin';
    const isEmp = this.role() === 'Employee';
    const count = this.pendingApprovalsCount();

    // 1. In Super Admin: strictly Dashboard and Company (Settings removed for Super Admin)
    if (isSuper) {
      return [
        {
          section: 'Platform',
          items: [
            { icon: 'dashboard' as IconName, label: 'Dashboard', path: '/dashboard' },
            { icon: 'company' as IconName, label: 'Company', path: '/company' },
          ],
        },
      ];
    }

    // 2. In Employee: strictly self-service items under employee control
    if (isEmp) {
      return NAV_CONFIG['Employee'];
    }

    const backendItems = this.backendNavItems();

    // Helper to filter out Loans, ERP, Face Kiosk, Key Group, Navigation, Permissions, Roles from main menu bar
    const isExcludedFromSidebar = (route?: string, title?: string): boolean => {
      const r = (route || '').toLowerCase();
      const t = (title || '').toLowerCase();
      if (r === '/erp' || t.includes('erp') || t.includes('erp integration')) return true;
      if (r === '/kiosk' || t.includes('kiosk') || t.includes('face kiosk')) return true;
      if (r === '/loans' || t.includes('loan') || t.includes('loans')) return true;
      if (t === 'announcements' || r.includes('announcement')) return true;
      if (
        t === 'key group' ||
        t === 'key groups' ||
        t === 'navigation' ||
        t === 'permission' ||
        t === 'permissions' ||
        t === 'role' ||
        t === 'roles' ||
        r.includes('#keygroup') ||
        r.includes('#navigation') ||
        r.includes('#permission') ||
        r.includes('#role') ||
        r.includes('tab=keygroup') ||
        r.includes('tab=navigation') ||
        r.includes('tab=permission') ||
        r.includes('tab=role')
      ) {
        return true;
      }
      return false;
    };

    const getSection = (item: any): string => {
      const title = (item.title || item.label || '').toLowerCase();
      const route = (item.route || item.path || '').toLowerCase();
      if (title.includes('dash') || route.includes('dash') || title.includes('anal') || route.includes('anal')) {
        return 'Overview';
      }
      return 'HR Modules';
    };

    const parseBackendItem = (
      i: any,
      isChild = false
    ): { icon: IconName; label: string; path: string; badge?: string; queryParams?: Record<string, string>; isSubItem?: boolean } => {
      const iconKey = (i.icon as IconName) in ICONS ? (i.icon as IconName) : 'settings';
      let rawRoute: string = i.route || '/settings';
      let queryParams: Record<string, string> | undefined = undefined;

      if (rawRoute.includes('#')) {
        const [base, frag] = rawRoute.split('#');
        rawRoute = base;
        queryParams = { tab: frag };
      } else if (rawRoute.includes('?tab=')) {
        const [base, tabVal] = rawRoute.split('?tab=');
        rawRoute = base;
        queryParams = { tab: tabVal };
      }

      let path = isEmp && rawRoute === '/dashboard' ? '/me/dashboard' : (isEmp && rawRoute === '/employee-profile' ? '/me/profile' : rawRoute);
      const badge = i.title === 'Approvals' && count > 0 ? `${count}` : (i.badge || undefined);

      return {
        icon: iconKey,
        label: i.title,
        path,
        badge,
        queryParams,
        isSubItem: isChild || i.parentId != null,
      };
    };

    // 2. For Company Admin (Admin):
    // Full catalogue with Overview, HR Modules, and Master Setup (Settings, Reports),
    // with ERP, Face Kiosk, Key Group, Navigation, Permissions, Roles excluded from the main menu bar.
    if (isCompanyAdmin) {
      const sections = ['Overview', 'HR Modules'];
      const result: { section: string; items: { icon: IconName; label: string; path: string; badge?: string; queryParams?: Record<string, string>; isSubItem?: boolean }[] }[] = [];

      for (const sec of sections) {
        const items: { icon: IconName; label: string; path: string; badge?: string; queryParams?: Record<string, string>; isSubItem?: boolean }[] = MASTER_NAV_CATALOGUE
          .filter((item) => item.section === sec && !isExcludedFromSidebar(item.path, item.label))
          .map((item) => {
            const badge = item.label === 'Approvals' && count > 0 ? `${count}` : undefined;
            return {
              icon: item.icon,
              label: item.label,
              path: item.path,
              badge,
              queryParams: item.queryParams,
              isSubItem: item.isSubItem,
            };
          });

        // Also check if backendItems has any custom navigation items in this section that are not in MASTER_NAV_CATALOGUE
        if (backendItems.length > 0) {
          const existingPaths = new Set(items.map((i) => (i.path || '').toLowerCase()));
          const existingLabels = new Set(items.map((i) => (i.label || '').toLowerCase()));

          for (const bItem of backendItems) {
            if (isExcludedFromSidebar(bItem.route, bItem.title)) continue;
            const bSection = getSection(bItem);
            if (bSection === sec) {
              const bRoute = (bItem.route || '').toLowerCase();
              const bTitle = (bItem.title || '').toLowerCase();
              if (!existingPaths.has(bRoute) && !existingLabels.has(bTitle)) {
                items.push(parseBackendItem(bItem, false));
              }
            }
          }
        }

        if (items.length > 0) {
          result.push({ section: sec, items });
        }
      }

      return result;
    }

    // 3. For other roles (Employee, Manager, HR Manager):
    const hasMeaningfulBackendItems = backendItems.length > 1 || (backendItems.length === 1 && backendItems[0].route !== '/settings' && backendItems[0].title !== 'Settings');

    if (hasMeaningfulBackendItems) {
      const sections = ['Overview', 'HR Modules'];
      const result: { section: string; items: { icon: IconName; label: string; path: string; badge?: string; queryParams?: Record<string, string>; isSubItem?: boolean }[] }[] = [];

      for (const sec of sections) {
        const matching = backendItems.filter((i) => getSection(i) === sec && !isExcludedFromSidebar(i.route, i.title));
        if (matching.length > 0) {
          const items: { icon: IconName; label: string; path: string; badge?: string; queryParams?: Record<string, string>; isSubItem?: boolean }[] = [];
          for (const topItem of matching) {
            items.push(parseBackendItem(topItem, false));
            if (topItem.children && Array.isArray(topItem.children) && topItem.children.length > 0) {
              for (const child of topItem.children) {
                if (!isExcludedFromSidebar(child.route, child.title)) {
                  items.push(parseBackendItem(child, true));
                }
              }
            }
          }
          if (sec === 'HR Modules' && !isEmp && (this.role() === 'HR Manager' || isCompanyAdmin)) {
            const punchIdx = items.findIndex((i) => i.path === '/punch-in-out' || i.label === 'Punch In/Out');
            const punchItem = { icon: 'camera' as IconName, label: 'Punch In/Out', path: '/punch-in-out' };
            if (punchIdx >= 0) {
              const [item] = items.splice(punchIdx, 1);
              const empIdx = items.findIndex((i) => i.path === '/employees' || i.label === 'Employees');
              if (empIdx >= 0) {
                items.splice(empIdx + 1, 0, item);
              } else {
                items.splice(punchIdx, 0, item);
              }
            } else {
              const empIdx = items.findIndex((i) => i.path === '/employees' || i.label === 'Employees');
              if (empIdx >= 0) {
                items.splice(empIdx + 1, 0, punchItem);
              } else {
                items.push(punchItem);
              }
            }
          }
          if (items.length > 0) {
            result.push({ section: sec, items });
          }
        }
      }
      return result;
    }

    // Fallback: evaluate through permission matrix
    const permitted = MASTER_NAV_CATALOGUE.filter((item) => {
      if (isExcludedFromSidebar(item.path, item.label)) return false;
      return this.perms.hasModuleAccess(item.label);
    });

    const sections = ['Overview', 'HR Modules'];
    const result: { section: string; items: { icon: IconName; label: string; path: string; badge?: string; queryParams?: Record<string, string>; isSubItem?: boolean }[] }[] = [];

    for (const sec of sections) {
      const items = permitted
        .filter((item) => item.section === sec)
        .map((item) => {
          const path = isEmp && item.empPath ? item.empPath : item.path;
          const badge = item.label === 'Approvals' && count > 0 ? `${count}` : undefined;
          return {
            icon: item.icon,
            label: item.label,
            path,
            badge,
            queryParams: item.queryParams,
            isSubItem: item.isSubItem,
          };
        });

      if (items.length > 0) {
        result.push({ section: sec, items });
      }
    }

    return result;
  });

  protected readonly notifState = inject(NotificationStateService);
  protected readonly notifications = computed(() => this.notifState.notifications());
  protected readonly unreadCount = computed(() => this.notifState.unreadCount());

  protected readonly homePath = computed(() => (this.role() === 'Employee' ? '/me/profile' : '/employee-profile'));

  private readonly navSub = this.router.events
    .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
    .subscribe(() => {
      this.sidebarOpen.set(false);
      this.ui.closePanel();
      this.updateTitle();
      this.loadPendingApprovals();
    });

  constructor() {
    this.updateTitle();
  }

  ngOnInit(): void {
    this.refetchBranding();
    this.loadPendingApprovals();
    this.loadUserNavigation();
    if (this.role() === 'Super Admin') {
      this.api.tenantCompanies().subscribe({
        next: (items) => {
          const allOption = this.allOrganizationsTenant;
          const mapped = [
            allOption,
            ...(items || []).map((c) => ({
              id: c.id,
              name: c.name,
              location: c.code,
              logo: c.logoUrl || 'assets/images/shape-logo.png',
            })),
          ];
          this.tenants.set(mapped);
          const stored = this.readStoredTenant();
          if (stored && stored.id !== 'all') {
            const matched = mapped.find((m) => m.id === stored.id || (stored.location && m.location === stored.location));
            if (matched) {
              this.session.updateUser({
                companyId: matched.id && matched.id !== 'default' ? matched.id : undefined,
                companyName: matched.name,
                companyCode: matched.location,
              });
            }
          }
        },
        error: () => {},
      });
    }
  }

  private refetchBranding(): void {
    if (!this.session.isAuthenticated()) return;
    this.api.company().subscribe({
      next: (settings) => {
        if (settings) {
          this.session.updateCompanyLogo(settings.logoUrl ?? null);
          if (settings.companyName) {
            this.session.updateUser({ companyName: settings.companyName });
          }
        }
      },
      error: () => {
        // Fallback for Super Admin or non-tenant contexts
        this.api.me().subscribe({
          next: (u) => {
            if (u?.companyLogoUrl) {
              this.session.updateCompanyLogo(u.companyLogoUrl);
            }
          },
          error: () => {},
        });
      },
    });
  }

  private loadPendingApprovals(): void {
    if (!this.session.isAuthenticated() || this.role() === 'Employee') {
      this.pendingApprovalsCount.set(0);
      return;
    }
    this.api.approvals({ status: 'Pending' }).subscribe({
      next: (res) => {
        this.pendingApprovalsCount.set(res?.length || 0);
      },
      error: () => {
        this.pendingApprovalsCount.set(0);
      },
    });
  }

  private loadUserNavigation(): void {
    if (!this.session.isAuthenticated() || this.role() === 'Employee') return;
    this.api.userNavigation().subscribe({
      next: (items) => {
        if (items && items.length > 0) {
          this.backendNavItems.set(items);
        }
      },
      error: () => {
        /* Backend offline or unauthenticated fallback */
      },
    });
  }

  protected markRead(notification: DetailedNotification): void {
    if (notification.unread && notification.id) {
      this.notifState.markRead(notification.id);
    }

    this.ui.closePanel();
    const isEmp = this.role() === 'Employee';
    if (notification.actionUrl) {
      let target = notification.actionUrl;
      if (isEmp) {
        if (target.startsWith('/approvals') || target.startsWith('/leave')) target = '/me/leave';
        else if (target.startsWith('/attendance')) target = '/me/attendance';
        else if (target.startsWith('/dashboard')) target = '/me/dashboard';
        else if (target.startsWith('/payslips') || target.startsWith('/payroll')) target = '/me/payslips';
        else if (target.startsWith('/documents')) target = '/me/documents';
        else if (target.startsWith('/company') || target.startsWith('/employees') || target.startsWith('/settings')) target = '/me/dashboard';
      }
      this.router.navigate([target]);
    } else {
      const t = (notification.title || '').toLowerCase();
      if (t.includes('birthday')) {
        this.toast.show(`Celebration wish sent for ${notification.title}! 🎂`, 'success');
      } else {
        this.router.navigate([isEmp ? '/me/notifications' : '/notifications']);
      }
    }
  }

  protected viewAllNotifications(): void {
    this.ui.closePanel();
    const target = this.role() === 'Employee' ? '/me/notifications' : '/notifications';
    this.router.navigate([target]);
  }

  ngOnDestroy(): void {
    this.navSub.unsubscribe();
  }

  protected toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
  }

  protected closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  protected openChangePassword(): void {
    this.ui.closePanel();
    this.ui.open('chgPwdModal');
  }

  protected logout(): void {
    this.ui.closePanel();
    this.session.logout();
    void this.router.navigateByUrl('/login');
  }

  protected toggleDark(): void {
    this.theme.toggle();
  }

  protected toggleTenantMenu(event: MouseEvent): void {
    if (this.role() !== 'Super Admin') return;
    event.stopPropagation();
    this.tenantOpen.update((v) => !v);
  }

  protected selectTenant(tenant: { id: string; name: string; location: string; logo: string }): void {
    sessionStorage.setItem('current_tenant', JSON.stringify(tenant));
    if (tenant.id === 'all') {
      this.session.updateUser({
        companyId: undefined,
        companyName: 'All Organizations',
        companyCode: undefined,
      });
      this.toast.show('Switched to Platform View: All Organizations', 'success');
    } else {
      this.session.updateUser({
        companyId: tenant.id && tenant.id !== 'default' ? tenant.id : undefined,
        companyName: tenant.name,
        companyCode: tenant.location,
      });
      this.toast.show(`Switched to tenant: ${tenant.name} (${tenant.location})`, 'success');
    }
    this.tenantOpen.set(false);
  }

  private readStoredTenant(): { id: string; name: string; location: string; logo: string } | null {
    try {
      const s = sessionStorage.getItem('current_tenant');
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  }

  protected toggleFullscreen(): void {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen();
    } else {
      void document.exitFullscreen();
    }
  }

  protected clockIn(): void {
    this.punch.requestClockIn();
  }

  protected clockOut(): void {
    this.punch.requestClockOut();
  }

  protected startBreak(): void {
    this.punch.requestStartBreak();
  }

  protected endBreak(): void {
    this.punch.requestEndBreak();
  }

  protected savePassword(): void {
    this.ui.close('chgPwdModal');
    this.toast.show('Password updated successfully!');
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const switcher = document.querySelector('.tenant-switcher-wrap');
    if (switcher && !switcher.contains(target)) {
      this.tenantOpen.set(false);
    }
    const panels: { key: 'notif' | 'avatar'; panel: string; button: string }[] = [
      { key: 'notif', panel: 'notifPanel', button: 'notifBtn' },
      { key: 'avatar', panel: 'avatarMenu', button: 'avatarBtn' },
    ];
    for (const p of panels) {
      if (!this.ui.isPanel(p.key)) continue;
      const panelEl = document.getElementById(p.panel);
      const buttonEl = document.getElementById(p.button);
      if (panelEl && buttonEl && !panelEl.contains(target) && !buttonEl.contains(target)) {
        this.ui.closePanel();
      }
    }
  }

  /** Sets `document.title` from the deepest matched route's `data.title`. */
  private updateTitle(): void {
    let route: ActivatedRouteSnapshot | null = this.router.routerState.snapshot.root;
    let title: string | undefined;
    while (route) {
      const candidate = route.data['title'];
      if (typeof candidate === 'string') title = candidate;
      route = route.firstChild;
    }
    document.title = title ? `${title} — HRMS` : 'HRMS';
  }
}
