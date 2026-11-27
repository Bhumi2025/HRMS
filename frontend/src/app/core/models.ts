import { IconName } from './icons/icons';

/** The application roles: Super Admin (platform), Company Admin (tenant), HR Manager, and Employee. */
export type Role = 'Super Admin' | 'HR Manager' | 'Company Admin' | 'Employee';

export const ROLES: Role[] = ['Super Admin', 'Company Admin', 'HR Manager', 'Employee'];

export interface NavItem {
  icon: IconName;
  label: string;
  /** Absolute Angular router path. */
  path: string;
  badge?: string;
  queryParams?: Record<string, string>;
  isSubItem?: boolean;
}

export interface NavSection {
  section: string;
  items: NavItem[];
}

export interface SessionUser {
  id?: string;
  role: Role;
  name: string;
  email?: string;
  /** Two letter avatar initials, e.g. "SA". */
  initials: string;
  /** Linked employee record, when the API provides one. */
  employeeId?: string;
  /** The tenant company the session belongs to. */
  companyId?: string;
  companyName?: string;
  companyCode?: string;
  companyLogoUrl?: string;
}

export type ToastType = 'success' | 'danger' | 'warning' | 'info';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

export interface AppNotification {
  id?: string;
  /** Inline SVG string for the leading icon. */
  icon: string;
  title: string;
  message: string;
  time: string;
  unread: boolean;
}
