import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ROLE_LANDING } from './data/nav-config';
import { SessionService } from './services/session.service';

/** Blocks the app shell unless a role has been chosen at the login screen. */
export const authGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  return session.isAuthenticated() ? true : router.parseUrl('/login');
};

/** Sends `/` to the signed-in role's landing page (or to login when signed out). */
export const landingRedirectGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  const role = session.role();
  return router.parseUrl(role ? ROLE_LANDING[role] : '/login');
};

/**
 * Restricts platform administration (company management) to the Super Admin.
 * This is a UX guard only — the API enforces the same rule server-side.
 */
export const superAdminGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  return session.role() === 'Super Admin' ? true : router.parseUrl(session.landingPath());
};

/**
 * Restricts administrative HR/Company modules to Super Admin, Company Admin, HR Manager, and Manager.
 * Employees attempting to access admin routes are redirected to their employee self-service dashboard (`/me/dashboard`).
 */
export const nonEmployeeGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  if (session.role() === 'Employee') {
    return router.parseUrl('/me/dashboard');
  }
  return true;
};
