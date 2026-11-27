import { NavSection, Role } from '../models';

const overview = (): NavSection => ({
  section: 'Overview',
  items: [
    { icon: 'dashboard', label: 'Dashboard', path: '/dashboard' },
  ],
});

const hrModules = (approvalBadge?: string, includeSettings = false): NavSection => ({
  section: 'HR Modules',
  items: [
    { icon: 'company', label: 'Company', path: '/company' },
    { icon: 'employees', label: 'Employees', path: '/employees' },
    { icon: 'user', label: 'Profile', path: '/employee-profile' },
    { icon: 'clock', label: 'Shift', path: '/shift' },
    { icon: 'attendance', label: 'Attendance', path: '/attendance' },
    { icon: 'leave', label: 'Leave', path: '/leave' },
    { icon: 'payroll', label: 'Payroll', path: '/payroll' },
    { icon: 'payslip', label: 'Payslips', path: '/payslips' },
    { icon: 'onboarding', label: 'Onboarding', path: '/onboarding' },
    { icon: 'employees', label: 'Offboarding', path: '/offboarding' },
    { icon: 'approvals', label: 'Approvals', path: '/approvals', badge: approvalBadge },
    { icon: 'reports', label: 'Reports', path: '/reports' },
    ...(includeSettings ? [{ icon: 'settings' as const, label: 'Settings', path: '/settings' }] : []),
  ],
});

/** Sidebar navigation per role — dynamically filtered by PermissionService. */
export const NAV_CONFIG: Record<Role, NavSection[]> = {
  'Super Admin': [
    {
      section: 'Platform',
      items: [
        { icon: 'dashboard', label: 'Dashboard', path: '/dashboard' },
        { icon: 'company', label: 'Company', path: '/companies' },
      ],
    },
  ],
  'Company Admin': [overview(), hrModules(undefined, true)],
  'HR Manager': [overview(), hrModules(undefined, false)],
  Employee: [
    {
      section: 'Main',
      items: [
        { icon: 'dashboard', label: 'Dashboard', path: '/me/dashboard' },
        { icon: 'user', label: 'Profile', path: '/me/profile' },
      ],
    },
    {
      section: 'Work',
      items: [
        { icon: 'attendance', label: 'Attendance', path: '/me/attendance' },
        { icon: 'leave', label: 'Leave', path: '/me/leave' },
        { icon: 'payslip', label: 'Payslips', path: '/me/payslips' },
      ],
    },
    {
      section: 'More',
      items: [
        { icon: 'bell', label: 'News', path: '/me/announcements' },
        { icon: 'settings', label: 'Settings', path: '/me/settings' },
      ],
    },
  ],
};

/** Where each role lands after signing in — mirrors the map in index.html's `go()`. */
export const ROLE_LANDING: Record<Role, string> = {
  'Super Admin': '/dashboard',
  'Company Admin': '/dashboard',
  'HR Manager': '/dashboard',
  Employee: '/me/dashboard',
};

