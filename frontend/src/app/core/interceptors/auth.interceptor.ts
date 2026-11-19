import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { SessionService } from '../services/session.service';
import { ToastService } from '../services/toast.service';

/** Attaches the JWT access token and company code to every outgoing API request. Handles 403 error distinction. */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const session = inject(SessionService);
  const toast = inject(ToastService);
  const token = session.token();
  const companyCode = session.user()?.companyCode;
  const companyId = session.user()?.companyId;

  const setHeaders: Record<string, string> = {};
  if (token) {
    setHeaders['Authorization'] = `Bearer ${token}`;
  }
  const isPlatformOrSelfAuth = request.url.includes('/auth/change-password') ||
                               request.url.includes('/auth/profile') ||
                               request.url.includes('/auth/me') ||
                               request.url.includes('/companies');

  if (!isPlatformOrSelfAuth && companyCode && companyCode !== 'ALL' && !request.headers.has('X-Company-Code')) {
    setHeaders['X-Company-Code'] = companyCode;
  }
  if (!isPlatformOrSelfAuth && companyId && companyId !== 'all' && !request.headers.has('X-Company-Id')) {
    setHeaders['X-Company-Id'] = companyId;
  }

  const req = Object.keys(setHeaders).length > 0 ? request.clone({ setHeaders }) : request;

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 403) {
        const errorCode = err.error?.errorCode || (err.error?.title?.includes('suspended') ? 'COMPANY_SUSPENDED' : 'PERMISSION_DENIED');
        if (errorCode === 'COMPANY_SUSPENDED') {
          toast.show('Your company account is currently suspended. Access has been locked.', 'danger');
        } else {
          toast.show(err.error?.message || 'Access Denied: You do not have permission for this action.', 'danger');
        }
      }
      return throwError(() => err);
    })
  );
};

