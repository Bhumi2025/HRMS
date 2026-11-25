import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api/api.service';
import { SetPasswordInfo } from '../../core/api/api.models';
import { IconDirective } from '../../core/icons/icon.directive';
import { SessionService } from '../../core/services/session.service';
import { ToastService } from '../../core/services/toast.service';

/**
 * Employee Set Password screen. Reached via the Set Password button in the
 * onboarding welcome email (/set-password?token=...), using the reset-password card layout.
 */
@Component({
  selector: 'app-set-password',
  imports: [CommonModule, FormsModule, RouterLink, IconDirective],
  styles: [
    `
      .sp-meta {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 12px 14px;
        margin-bottom: 22px;
        text-align: left;
        font-size: 12.5px;
        color: #475569;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .sp-meta strong {
        color: #1e293b;
      }
      .sp-iw {
        position: relative;
      }
      .sp-iw input {
        padding-right: 42px;
      }
      .sp-eye {
        position: absolute;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        background: none;
        border: none;
        color: #94a3b8;
        cursor: pointer;
        padding: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .sp-eye:hover {
        color: var(--p);
      }
    `,
  ],
  template: `
    <div class="auth-forgot">
      <div class="card">
        @if (loading()) {
          <div class="icon-wrap" [appIcon]="'lock'"></div>
          <h1>Checking Your Link…</h1>
          <p>Please wait while we verify your set-password link.</p>
        } @else if (completed()) {
          <div class="success-state show">
            <div
              class="icon-wrap"
              [appIcon]="'check'"
              style="background: linear-gradient(135deg, rgba(16,185,129,.12), rgba(5,150,105,.12)); color: #059669"
            ></div>
            <h1>Password Set!</h1>
            <p>
              Your password for <strong>{{ info()?.email }}</strong> has been saved. You can now access the
              <strong>{{ info()?.companyName || 'HRMS Portal' }}</strong>.
            </p>
            <button type="button" class="btn" (click)="continueToPortal()">Continue to Portal</button>
            <a routerLink="/login" class="back">← Go to Sign In</a>
          </div>
        } @else if (info(); as i) {
          @if (!i.valid) {
            <div class="icon-wrap" [appIcon]="'x'" style="background: rgba(239,68,68,.1); color: var(--danger)"></div>
            <h1>Link Unavailable</h1>
            <p>{{ i.reason || 'This set-password link is invalid or has expired.' }}</p>
            <a routerLink="/login" class="back">← Back to Sign In</a>
          } @else {
            <div class="icon-wrap" [appIcon]="'key'"></div>
            <h1>Set Your Password</h1>
            <p>Create your own password to access your account at <strong>{{ i.companyName }}</strong>.</p>

            <div class="sp-meta">
              @if (i.employeeName || i.employeeCode) {
                <div>
                  Employee: <strong>{{ i.employeeName }}</strong>
                  @if (i.employeeCode) {
                    <span> ({{ i.employeeCode }})</span>
                  }
                </div>
              }
              @if (i.email) {
                <div>
                  Email: <strong>{{ i.email }}</strong>
                </div>
              }
            </div>

            <label>New Password</label>
            <div class="iw sp-iw">
              <span [appIcon]="'lock'"></span>
              <input
                [type]="showNew() ? 'text' : 'password'"
                placeholder="At least 6 characters"
                [(ngModel)]="newPassword"
              />
              <button
                type="button"
                class="sp-eye"
                (click)="showNew.set(!showNew())"
                [title]="showNew() ? 'Hide password' : 'Show password'"
              >
                <span [appIcon]="showNew() ? 'eye' : 'lock'" style="position: static; transform: none"></span>
              </button>
            </div>

            <label>Confirm Password</label>
            <div class="iw sp-iw">
              <span [appIcon]="'lock'"></span>
              <input
                [type]="showConfirm() ? 'text' : 'password'"
                placeholder="Re-enter your password"
                [(ngModel)]="confirmPassword"
              />
              <button
                type="button"
                class="sp-eye"
                (click)="showConfirm.set(!showConfirm())"
                [title]="showConfirm() ? 'Hide password' : 'Show password'"
              >
                <span [appIcon]="showConfirm() ? 'eye' : 'lock'" style="position: static; transform: none"></span>
              </button>
            </div>

            <button type="button" class="btn" [disabled]="submitting()" (click)="submit()">
              {{ submitting() ? 'Saving Password…' : 'Set Password' }}
            </button>
            <a routerLink="/login" class="back">← Back to Sign In</a>
          }
        }
      </div>
    </div>
  `,
})
export class SetPasswordComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);

  protected readonly loading = signal(true);
  protected readonly info = signal<SetPasswordInfo | null>(null);
  protected readonly submitting = signal(false);
  protected readonly completed = signal(false);
  protected readonly showNew = signal(false);
  protected readonly showConfirm = signal(false);

  protected newPassword = '';
  protected confirmPassword = '';

  private token = '';
  private landingRoute = '/me/dashboard';

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token') ?? '';

    if (!this.token) {
      this.info.set({ valid: false, reason: 'This set-password link is missing its token.' });
      this.loading.set(false);
      return;
    }

    this.api.validateSetPassword(this.token).subscribe({
      next: (info) => {
        this.info.set(info);
        this.loading.set(false);
      },
      error: () => {
        this.info.set({ valid: false, reason: 'We could not validate this set-password link.' });
        this.loading.set(false);
      },
    });
  }

  protected submit(): void {
    if (this.submitting()) return;

    if (this.newPassword.length < 6) {
      this.toast.show('Password must be at least 6 characters.', 'warning');
      return;
    }

    if (this.newPassword !== this.confirmPassword) {
      this.toast.show('Passwords do not match.', 'warning');
      return;
    }

    this.submitting.set(true);
    this.api.setPassword(this.token, this.newPassword).subscribe({
      next: (response) => {
        this.landingRoute = this.session.setSession(response.accessToken, response.user);
        this.completed.set(true);
        this.submitting.set(false);
        this.toast.show('Your password has been set!', 'success');
      },
      error: (error) => {
        this.submitting.set(false);
        this.toast.show(
          error?.error?.detail ?? error?.error?.message ?? error?.error?.title ?? 'Failed to set password. Please try again.',
          'danger',
        );
      },
    });
  }

  protected continueToPortal(): void {
    void this.router.navigateByUrl(this.landingRoute);
  }
}
