import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SessionService } from '../../core/services/session.service';
import { TemplateDashboardComponent } from './template-dashboard.component';
import { SuperAdminDashboardComponent } from './super-admin-dashboard.component';

/** Routes `/dashboard` based on role: Super Admin platform dashboard vs single-page HR workspace dashboard. */
@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, TemplateDashboardComponent, SuperAdminDashboardComponent],
  template: `
    @if (isSuperAdmin()) {
      <app-super-admin-dashboard />
    } @else {
      <app-template-dashboard class="workspace-wrapper" />
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: calc(100vh - 52px - 32px);
        max-height: calc(100vh - 52px - 32px);
        min-height: 0;
        overflow: hidden;
      }
      .workspace-wrapper {
        flex: 1;
        min-height: 0;
        height: 100%;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
    `,
  ],
})
export class DashboardComponent implements OnInit {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  protected readonly isSuperAdmin = computed(() => this.session.activeRole() === 'Super Admin');

  ngOnInit(): void {
    if (this.session.activeRole() === 'Employee') {
      void this.router.navigateByUrl('/me/dashboard', { replaceUrl: true });
    }
  }
}
