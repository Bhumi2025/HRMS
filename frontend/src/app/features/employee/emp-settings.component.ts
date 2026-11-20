import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api/api.service';
import { IconDirective } from '../../core/icons/icon.directive';
import { ToastService } from '../../core/services/toast.service';

/** Settings — Employee Settings */
@Component({
  selector: 'app-emp-settings',
  imports: [CommonModule, FormsModule, IconDirective],
  template: `
    <div style="margin-bottom: 24px">
      <div class="page-title">Settings</div>
      <div class="page-subtitle">Manage your account preferences</div>
    </div>

    <div class="card" style="width: 100%;">
      <div class="card-header">
        <div class="card-title">Change Password</div>
      </div>
      <div class="card-body" style="padding: 24px 28px;">
        <div class="form-group" style="margin-bottom: 20px;">
          <label class="form-label" style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--text);">Current Password</label>
          <input
            class="form-control"
            type="password"
            placeholder="Enter current password"
            style="width: 100%; height: 42px;"
            [(ngModel)]="currentPassword"
          />
        </div>
        <div class="form-group" style="margin-bottom: 20px;">
          <label class="form-label" style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--text);">New Password</label>
          <input
            class="form-control"
            type="password"
            placeholder="Enter new password"
            style="width: 100%; height: 42px;"
            [(ngModel)]="newPassword"
          />
        </div>
        <div class="form-group" style="margin-bottom: 24px;">
          <label class="form-label" style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--text);">Confirm Password</label>
          <input
            class="form-control"
            type="password"
            placeholder="Confirm new password"
            style="width: 100%; height: 42px;"
            [(ngModel)]="confirmPassword"
          />
        </div>

        <div style="margin-top: 36px; padding-top: 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end;">
          <button
            class="btn btn-primary"
            style="display: inline-flex; align-items: center; gap: 8px; padding: 10px 24px; font-weight: 600;"
            [disabled]="isUpdating()"
            (click)="onUpdatePassword()"
          >
            <span [appIcon]="'check'"></span>
            <span>{{ isUpdating() ? 'Updating...' : 'Update Password' }}</span>
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [],
})
export class EmpSettingsComponent {
  private readonly toast = inject(ToastService);
  private readonly api = inject(ApiService);

  protected currentPassword = '';
  protected newPassword = '';
  protected confirmPassword = '';
  protected readonly isUpdating = signal(false);

  protected onUpdatePassword(): void {
    const cur = this.currentPassword.trim();
    const next = this.newPassword.trim();
    const conf = this.confirmPassword.trim();

    if (!cur) {
      this.toast.show('Please enter your current password.', 'danger');
      return;
    }
    if (!next) {
      this.toast.show('Please enter a new password.', 'danger');
      return;
    }
    if (next.length < 6) {
      this.toast.show('New password must be at least 6 characters long.', 'danger');
      return;
    }
    if (next !== conf) {
      this.toast.show('New password and confirmation do not match.', 'danger');
      return;
    }

    this.isUpdating.set(true);
    this.api.changePassword(cur, next).subscribe({
      next: () => {
        this.isUpdating.set(false);
        this.currentPassword = '';
        this.newPassword = '';
        this.confirmPassword = '';
        this.toast.show('Password changed successfully!', 'success');
      },
      error: (err) => {
        this.isUpdating.set(false);
        const msg = err?.error?.detail || err?.error?.title || err?.error?.message || 'Could not change password.';
        this.toast.show(msg, 'danger');
      },
    });
  }
}
