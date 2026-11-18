import { CommonModule, DatePipe } from '@angular/common';
import { Component, OnInit, AfterViewInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { of, catchError } from 'rxjs';
import { ApiService } from '../../core/api/api.service';
import { SessionService } from '../../core/services/session.service';
import { CompanyListItem, CompanyDetail, CreateCompanyRequest } from '../../core/api/api.models';
import { IconDirective } from '../../core/icons/icon.directive';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-super-admin-dashboard',
  imports: [CommonModule, FormsModule, IconDirective, DatePipe],
  template: `
    <div class="super-admin-dashboard">
      <!-- Main Content: Tenant Organizations Full-Width Table -->
      <div class="content-panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">Tenant Organizations</h3>
            <p class="panel-desc">Manage tenant lifecycle, provisioning status, and administrator invitations</p>
          </div>
          <div class="panel-controls">
            <!-- Header Tenant Switcher Filter Indicator -->
            @if (selectedTenantCode()) {
              <div class="active-tenant-chip">
                <span>Tenant: <strong>{{ selectedTenantName() }}</strong></span>
                <button type="button" class="chip-clear-btn" (click)="clearTenantFilter()" title="Show All Organizations">✕ Show All</button>
              </div>
            }

            <!-- Filter pills -->
            <div class="filter-pills">
              <button
                type="button"
                class="pill-btn"
                [class.active]="statusFilter() === 'all'"
                (click)="setStatusFilter('all')"
              >
                All ({{ companies().length }})
              </button>
              <button
                type="button"
                class="pill-btn"
                [class.active]="statusFilter() === 'Active'"
                (click)="setStatusFilter('Active')"
              >
                Active ({{ activeCompanies() }})
              </button>
              <button
                type="button"
                class="pill-btn"
                [class.active]="statusFilter() === 'Suspended'"
                (click)="setStatusFilter('Suspended')"
              >
                Suspended ({{ suspendedCompanies() }})
              </button>
            </div>

            <!-- Search (Chrome autofill protected) -->
            <div class="search-wrap">
              <!-- Off-screen Chrome Autofill Sink -->
              <div style="position: absolute; width: 0; height: 0; overflow: hidden; opacity: 0; pointer-events: none;" aria-hidden="true">
                <input type="text" name="chrome_sink_username" tabindex="-1" autocomplete="username" />
                <input type="password" name="chrome_sink_password" tabindex="-1" autocomplete="current-password" />
              </div>
              <span [appIcon]="'search'" class="search-icon"></span>
              <input
                type="search"
                name="search_tenant_no_autofill"
                id="tenantFilterSearchBox"
                autocomplete="off"
                autocorrect="off"
                autocapitalize="off"
                spellcheck="false"
                class="search-input"
                placeholder="Search tenant or code..."
                [value]="searchQuery()"
                (input)="onSearchInput($event)"
              />
              @if (searchQuery()) {
                <button class="clear-search-btn" (click)="clearSearch()" type="button" title="Clear search">✕</button>
              }
            </div>
          </div>
        </div>

        <div class="table-responsive">
          <table class="modern-table">
            <thead>
              <tr>
                <th>Organization</th>
                <th>Tenant Code</th>
                <th>Administrator</th>
                <th>Database</th>
                <th style="text-align: center;">Status</th>
                <th style="text-align: right; min-width: 180px;">Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (c of filteredCompanies(); track c.id) {
                <tr class="table-row">
                  <td>
                    <div class="org-cell">
                      <div class="org-avatar">
                        {{ c.name.charAt(0) }}
                      </div>
                      <div class="org-info">
                        <div class="org-name">{{ c.name }}</div>
                        @if (c.isDefault) {
                          <span class="badge badge-default">Primary Default</span>
                        }
                      </div>
                    </div>
                  </td>
                  <td>
                    <span class="code-badge">
                      {{ c.code }}
                    </span>
                  </td>
                  <td>
                    <div class="admin-name">{{ c.adminFullName || 'Administrator' }}</div>
                    <div class="admin-email">{{ c.adminEmail }}</div>
                  </td>
                  <td>
                    <span class="db-badge">
                      <span [appIcon]="'grid'"></span>
                      {{ c.databaseName || 'HRMS (Default)' }}
                    </span>
                  </td>
                  <td style="text-align: center;">
                    @if ((c.status || '').toLowerCase() === 'active') {
                      <span class="status-badge status-active">
                        <span class="dot"></span> Active
                      </span>
                    } @else if ((c.status || '').toLowerCase() === 'suspended') {
                      <span class="status-badge status-suspended">
                        <span class="dot"></span> Suspended
                      </span>
                    } @else {
                      <span class="status-badge status-provisioning">
                        <span class="dot"></span> Provisioning
                      </span>
                    }
                  </td>
                  <td style="text-align: right;">
                    <div class="actions-group">
                      @if ((c.status || '').toLowerCase() === 'active') {
                        <button
                          class="action-btn btn-danger-soft"
                          (click)="suspendCompany(c)"
                          [disabled]="c.isDefault"
                          [attr.data-tooltip]="c.isDefault ? 'Primary tenant cannot be suspended' : 'Suspend Tenant'"
                        >
                          Suspend
                        </button>
                      } @else {
                        <button
                          class="action-btn btn-success-soft"
                          (click)="activateCompany(c)"
                          data-tooltip="Activate Tenant"
                        >
                          Activate
                        </button>
                      }

                      @if (c.invitationStatus !== 'Accepted') {
                        <button
                          class="action-btn btn-neutral"
                          (click)="resendInvitation(c)"
                          data-tooltip="Resend Admin Invitation Email"
                        >
                          <span [appIcon]="'mail'"></span>
                          Invite
                        </button>
                      } @else {
                        <span class="status-badge status-active" style="padding: 4px 8px; font-size: 11px;" data-tooltip="Invitation Accepted">
                          <span class="dot"></span> Accepted
                        </span>
                      }

                      <button
                        class="action-btn btn-manage"
                        (click)="openCompanyDetails(c)"
                        [attr.data-tooltip]="'View details & employees for ' + c.name"
                        title="View {{ c.name }} Details & Employees"
                      >
                        <span [appIcon]="'arrow_right'"></span>
                      </button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" class="empty-state">
                    <div class="empty-icon">🏢</div>
                    <div class="empty-title">No tenant organizations found</div>
                    <div class="empty-desc">Try clearing your search query or filter</div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      <!-- Company Details & Employees Modal -->
      @if (showDetailsModal()) {
        <div class="modal-overlay" (click)="closeCompanyDetails()">
          <div class="modal-card modal-large" (click)="$event.stopPropagation()">
            <!-- Modal Header -->
            <div class="modal-header">
              <div class="detail-header-left">
                <div class="detail-avatar">
                  {{ selectedCompanyListItem()?.name?.charAt(0) || 'C' }}
                </div>
                <div>
                  <div class="detail-title-row">
                    <h3 class="detail-title">{{ selectedCompanyDetail()?.name || selectedCompanyListItem()?.name }}</h3>
                    <span class="code-badge">{{ selectedCompanyDetail()?.code || selectedCompanyListItem()?.code }}</span>
                    @if ((selectedCompanyDetail()?.status || selectedCompanyListItem()?.status || '').toLowerCase() === 'active') {
                      <span class="status-badge status-active"><span class="dot"></span> Active</span>
                    } @else {
                      <span class="status-badge status-suspended"><span class="dot"></span> Suspended</span>
                    }
                    @if (selectedCompanyDetail()?.isDefault || selectedCompanyListItem()?.isDefault) {
                      <span class="badge badge-default">Primary Default</span>
                    }
                  </div>
                  <p class="modal-desc">
                    Tenant details, dedicated database provisioning, administrator credentials, and active staff directory.
                  </p>
                </div>
              </div>
              <button class="btn-icon" (click)="closeCompanyDetails()" type="button" title="Close"><span [appIcon]="'x'"></span></button>
            </div>

            <!-- Modal Body -->
            <div class="modal-body-scroll">
              @if (loadingCompanyDetails()) {
                <div class="modal-loading-state">
                  <span [appIcon]="'sync'" class="action-icon spin" style="font-size: 28px; color: var(--p, #2563eb);"></span>
                  <div style="font-weight: 700; margin-top: 12px;">Loading Company Details &amp; Employees...</div>
                  <div style="font-size: 12.5px; color: var(--muted, #64748b);">Querying dedicated tenant database</div>
                </div>
              } @else if (selectedCompanyDetail()) {
                @let d = selectedCompanyDetail()!;
                
                <!-- Quick Stats Cards Row -->
                <div class="details-stats-grid">
                  <div class="detail-stat-box">
                    <div class="stat-label">Dedicated Database</div>
                    <div class="stat-value text-blue">
                      <span [appIcon]="'grid'"></span>
                      {{ d.databaseName || 'HRMS (Default)' }}
                    </div>
                    <div class="stat-meta">Isolated SQL Database</div>
                  </div>
                  <div class="detail-stat-box">
                    <div class="stat-label">Total Provisioned Staff</div>
                    <div class="stat-value text-emerald">
                      <span [appIcon]="'user'"></span>
                      {{ d.employeeCount || d.employees?.length || 0 }} Employees
                    </div>
                    <div class="stat-meta">Live from tenant schema</div>
                  </div>
                  <div class="detail-stat-box">
                    <div class="stat-label">Administrator</div>
                    <div class="stat-value text-slate">
                      {{ d.adminFullName }}
                    </div>
                    <div class="stat-meta">{{ d.adminEmail }}</div>
                  </div>
                  <div class="detail-stat-box">
                    <div class="stat-label">Time Zone</div>
                    <div class="stat-value text-slate">
                      {{ d.timeZone || 'UTC' }}
                    </div>
                    <div class="stat-meta">Provisioned: {{ d.provisionedAtUtc ? (d.provisionedAtUtc | date:'shortDate') : 'Pending' }}</div>
                  </div>
                </div>

                <!-- Section: Admin & HR Credentials -->
                <div class="section-card">
                  <div class="section-header">
                    <div class="section-title">
                      <span [appIcon]="'user'"></span>
                      <span>Administrator &amp; HR Credentials</span>
                    </div>
                    <div class="section-badge">
                      @if (d.invitationStatus === 'Accepted') {
                        <span class="status-badge status-active"><span class="dot"></span> Invitation Accepted</span>
                      } @else {
                        <span class="status-badge status-provisioning"><span class="dot"></span> Invitation Sent (Pending Login)</span>
                      }
                    </div>
                  </div>
                  <div class="credentials-grid">
                    <div class="credential-item">
                      <div class="cred-label">Full Name</div>
                      <div class="cred-value">{{ d.adminFullName }}</div>
                    </div>
                    <div class="credential-item">
                      <div class="cred-label">Admin Email / Username</div>
                      <div class="cred-value email-highlight">{{ d.adminEmail }}</div>
                    </div>
                    <div class="credential-item">
                      <div class="cred-label">Platform Role</div>
                      <div class="cred-value">Company Administrator / HR Lead</div>
                    </div>
                    <div class="credential-item">
                      <div class="cred-label">Invitation Status</div>
                      <div class="cred-value">
                        <strong>{{ d.invitationStatus || 'Pending' }}</strong>
                        @if (d.invitationSentAtUtc) {
                          <span class="cred-sub"> (Sent {{ d.invitationSentAtUtc | date:'short' }})</span>
                        }
                      </div>
                    </div>
                    @if (d.contactName || d.contactEmail) {
                      <div class="credential-item">
                        <div class="cred-label">Contact Person</div>
                        <div class="cred-value">{{ d.contactName || '—' }} ({{ d.contactEmail || '—' }})</div>
                      </div>
                    }
                  </div>
                </div>

                <!-- Section: Provisioned Employees Directory -->
                <div class="section-card">
                  <div class="section-header">
                    <div class="section-title">
                      <span [appIcon]="'company'"></span>
                      <span>Provisioned Employees Directory</span>
                      <span class="count-pill">{{ d.employees?.length || 0 }} Total</span>
                    </div>
                    <div class="section-desc">Employees registered and active inside <strong>{{ d.databaseName }}</strong></div>
                  </div>

                  @if (d.employees && d.employees.length > 0) {
                    <div class="table-responsive">
                      <table class="employees-mini-table">
                        <thead>
                          <tr>
                            <th>Code</th>
                            <th>Employee Name</th>
                            <th>Work Email</th>
                            <th>Department</th>
                            <th>Designation / Role</th>
                            <th style="text-align: center;">Status</th>
                            <th>Date of Joining</th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (emp of d.employees; track emp.id) {
                            <tr>
                              <td>
                                <span class="code-badge">{{ emp.employeeCode }}</span>
                              </td>
                              <td>
                                <div class="emp-name-cell">
                                  <div class="emp-avatar-sm">
                                    {{ emp.fullName.charAt(0) }}
                                  </div>
                                  <span class="emp-name">{{ emp.fullName }}</span>
                                </div>
                              </td>
                              <td class="emp-email">{{ emp.email }}</td>
                              <td>
                                @if (emp.department) {
                                  <span class="dept-badge">{{ emp.department }}</span>
                                } @else {
                                  <span class="text-muted">—</span>
                                }
                              </td>
                              <td>{{ emp.designation || 'Staff' }}</td>
                              <td style="text-align: center;">
                                @if (emp.status.toLowerCase() === 'active') {
                                  <span class="status-badge status-active"><span class="dot"></span> Active</span>
                                } @else if (emp.status.toLowerCase() === 'onleave') {
                                  <span class="status-badge status-provisioning"><span class="dot"></span> On Leave</span>
                                } @else {
                                  <span class="status-badge status-suspended"><span class="dot"></span> {{ emp.status }}</span>
                                }
                              </td>
                              <td>
                                {{ emp.joinedDate ? (emp.joinedDate | date:'mediumDate') : '—' }}
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  } @else {
                    <div class="empty-employees-box">
                      <div class="empty-icon">👥</div>
                      <div style="font-weight: 700; color: var(--text, #0f172a);">No employees created yet</div>
                      <div style="font-size: 12.5px; color: var(--muted, #64748b); margin-top: 4px;">
                        This tenant database currently has 0 employee records. The Company Admin can add staff via the HR Manager portal.
                      </div>
                    </div>
                  }
                </div>
              }
            </div>

            <!-- Modal Footer -->
            <div class="modal-footer">
              <div class="footer-left">
                @if (selectedCompanyDetail()) {
                  @let d = selectedCompanyDetail()!;
                  @if (d.invitationStatus !== 'Accepted') {
                    <button class="action-btn btn-neutral" (click)="resendInvitationFromModal(d)" type="button">
                      <span [appIcon]="'mail'"></span> Resend Admin Invite
                    </button>
                  }
                  @if (!d.isDefault) {
                    @if (d.status === 'Active') {
                      <button class="action-btn btn-danger-soft" (click)="suspendCompanyFromModal(d)" type="button">
                        Suspend Company
                      </button>
                    } @else {
                      <button class="action-btn btn-success-soft" (click)="activateCompanyFromModal(d)" type="button">
                        Activate Company
                      </button>
                    }
                  }
                }
              </div>
              <button class="btn-cancel" type="button" (click)="closeCompanyDetails()">Close</button>
            </div>
          </div>
        </div>
      }

      <!-- Create Organization Modal -->
      @if (showCreateOrgModal()) {
        <div class="modal-overlay" (click)="closeCreateOrgModal()">
          <div class="modal-card" style="max-width: 580px;" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <div>
                <h3 class="modal-title" style="margin: 0; font-size: 18px; font-weight: 800;">New Organization &amp; Tenant Provisioning</h3>
                <p class="modal-desc" style="margin: 4px 0 0 0; font-size: 13px; color: var(--muted);">Provision a dedicated organization tenant with isolated database schema</p>
              </div>
              <button class="btn-icon" (click)="closeCreateOrgModal()" type="button"><span [appIcon]="'x'"></span></button>
            </div>
            <div class="modal-body" style="padding: 20px 24px; display: flex; flex-direction: column; gap: 14px;">
              <div class="form-group">
                <label class="form-label" style="display: block; font-size: 12.5px; font-weight: 700; margin-bottom: 6px;">Organization Name <span style="color: #ef4444;">*</span></label>
                <input class="form-input" type="text" [(ngModel)]="createOrgForm.name" placeholder="e.g. Acme Global Industries" />
              </div>

              <div class="form-row-2" style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
                <div class="form-group">
                  <label class="form-label" style="display: block; font-size: 12.5px; font-weight: 700; margin-bottom: 6px;">Tenant Code (Auto if blank)</label>
                  <input class="form-input" type="text" [(ngModel)]="createOrgForm.code" placeholder="e.g. ACME" />
                </div>
                <div class="form-group">
                  <label class="form-label" style="display: block; font-size: 12.5px; font-weight: 700; margin-bottom: 6px;">Time Zone</label>
                  <input class="form-input" type="text" [(ngModel)]="createOrgForm.timeZone" placeholder="e.g. Asia/Dubai" />
                </div>
              </div>

              <div class="form-row-2" style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
                <div class="form-group">
                  <label class="form-label" style="display: block; font-size: 12.5px; font-weight: 700; margin-bottom: 6px;">Admin Full Name <span style="color: #ef4444;">*</span></label>
                  <input class="form-input" type="text" [(ngModel)]="createOrgForm.adminFullName" placeholder="e.g. Alex Johnson" />
                </div>
                <div class="form-group">
                  <label class="form-label" style="display: block; font-size: 12.5px; font-weight: 700; margin-bottom: 6px;">Admin Email <span style="color: #ef4444;">*</span></label>
                  <input class="form-input" type="email" [(ngModel)]="createOrgForm.adminEmail" placeholder="admin@acme.com" />
                </div>
              </div>

              <div class="form-row-2" style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
                <div class="form-group">
                  <label class="form-label" style="display: block; font-size: 12.5px; font-weight: 700; margin-bottom: 6px;">Contact Person</label>
                  <input class="form-input" type="text" [(ngModel)]="createOrgForm.contactName" placeholder="Optional" />
                </div>
                <div class="form-group">
                  <label class="form-label" style="display: block; font-size: 12.5px; font-weight: 700; margin-bottom: 6px;">Contact Email</label>
                  <input class="form-input" type="email" [(ngModel)]="createOrgForm.contactEmail" placeholder="Optional" />
                </div>
              </div>

              <div style="background: rgba(37, 99, 235, 0.08); border: 1px solid rgba(37, 99, 235, 0.2); border-radius: 8px; padding: 12px 14px; font-size: 12.5px; color: #1e40af; display: flex; align-items: center; gap: 10px;">
                <span [appIcon]="'info'" style="font-size: 18px; flex-shrink: 0;"></span>
                <div>
                  <strong>Database Provisioning:</strong> A dedicated, isolated tenant database and initial admin user will automatically be created and registered in <code>HRMS_Dummy_Master</code>.
                </div>
              </div>
            </div>
            <div class="modal-footer" style="padding: 16px 24px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 12px;">
              <button class="btn-cancel" type="button" (click)="closeCreateOrgModal()" [disabled]="creatingOrg()">Cancel</button>
              <button class="btn-submit" type="button" (click)="submitCreateOrg()" [disabled]="creatingOrg()">
                {{ creatingOrg() ? 'Provisioning Database...' : 'Create & Provision Organization' }}
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .super-admin-dashboard {
        padding-bottom: 40px;
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      /* Content Panels */
      .content-panel {
        background: var(--surface, #ffffff);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
      }
      .panel-header {
        padding: 20px 24px;
        border-bottom: 1px solid var(--border, #e2e8f0);
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 16px;
      }
      .panel-title {
        font-size: 17px;
        font-weight: 800;
        color: var(--text, #0f172a);
        margin: 0;
      }
      .panel-desc {
        font-size: 12.5px;
        color: var(--muted, #64748b);
        margin: 3px 0 0 0;
      }

      /* Panel controls: filters and search */
      .panel-controls {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }
      .filter-pills {
        display: flex;
        background: #f1f5f9;
        border: 1px solid #e2e8f0;
        padding: 4px;
        border-radius: 10px;
        gap: 4px;
      }
      .pill-btn {
        border: none;
        background: transparent;
        font-size: 12px;
        font-weight: 600;
        padding: 6px 14px;
        border-radius: 7px;
        color: #64748b;
        cursor: pointer;
        transition: all 0.15s ease-in-out;
      }
      .pill-btn:hover:not(.active) {
        color: #0f172a;
        background: rgba(255, 255, 255, 0.6);
      }
      .pill-btn.active {
        background: #2563eb;
        color: #ffffff;
        font-weight: 700;
        box-shadow: 0 2px 6px rgba(37, 99, 235, 0.28);
      }

      .search-wrap {
        position: relative;
        display: flex;
        align-items: center;
      }
      .search-icon {
        position: absolute;
        left: 11px;
        color: var(--muted, #94a3b8);
        pointer-events: none;
        font-size: 14px;
      }
      .search-input {
        padding: 8px 30px 8px 34px;
        border: 1px solid var(--border, #cbd5e1);
        border-radius: 8px;
        font-size: 12.5px;
        background: var(--surface, #ffffff);
        color: var(--text, #0f172a);
        width: 210px;
        transition: all 0.2s;
      }
      .search-input:focus {
        outline: none;
        border-color: #2563eb;
        width: 250px;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
      }
      .clear-search-btn {
        position: absolute;
        right: 9px;
        background: none;
        border: none;
        color: var(--muted, #94a3b8);
        cursor: pointer;
        font-size: 12px;
        padding: 2px 4px;
      }
      .clear-search-btn:hover {
        color: #0f172a;
      }

      .active-tenant-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        background: rgba(37, 99, 235, 0.08);
        border: 1px solid rgba(37, 99, 235, 0.25);
        color: #1d4ed8;
        padding: 5px 12px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
      }
      .chip-clear-btn {
        background: #2563eb;
        color: #ffffff;
        border: none;
        border-radius: 4px;
        padding: 2px 7px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        transition: background 0.15s;
      }
      .chip-clear-btn:hover {
        background: #1d4ed8;
      }

      /* Modern Table */
      .table-responsive {
        overflow-x: auto;
      }
      .modern-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      .modern-table th {
        background: var(--bg, #f8fafc);
        padding: 13px 20px;
        text-align: left;
        font-size: 11.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--muted, #64748b);
        border-bottom: 1px solid var(--border, #e2e8f0);
      }
      .modern-table td {
        padding: 15px 20px;
        border-bottom: 1px solid var(--border, #f1f5f9);
        vertical-align: middle;
      }
      .table-row:hover {
        background: rgba(37, 99, 235, 0.02);
      }

      .org-cell {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .org-avatar {
        width: 38px;
        height: 38px;
        border-radius: 10px;
        background: linear-gradient(135deg, #2563eb, #60a5fa);
        color: #ffffff;
        font-weight: 800;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14.5px;
        flex-shrink: 0;
      }
      .org-name {
        font-weight: 700;
        color: var(--text, #0f172a);
        font-size: 13.5px;
      }
      .badge-default {
        display: inline-block;
        font-size: 10px;
        font-weight: 700;
        background: rgba(37, 99, 235, 0.1);
        color: #2563eb;
        padding: 2px 7px;
        border-radius: 4px;
        margin-top: 3px;
      }

      .code-badge {
        display: inline-block;
        padding: 3px 8px;
        background: var(--bg, #f1f5f9);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: 6px;
        font-weight: 700;
        font-size: 11px;
        letter-spacing: 0.04em;
        color: var(--text, #334155);
      }

      .admin-name {
        font-weight: 700;
        color: var(--text, #0f172a);
        font-size: 13px;
      }
      .admin-email {
        font-size: 11.5px;
        color: var(--muted, #64748b);
        margin-top: 1px;
      }

      .db-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        background: rgba(15, 23, 42, 0.04);
        border: 1px solid var(--border, #cbd5e1);
        border-radius: 6px;
        font-size: 11.5px;
        font-weight: 600;
        color: var(--text, #334155);
        font-family: monospace;
      }

      .status-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 10px;
        border-radius: 20px;
        font-size: 11.5px;
        font-weight: 700;
      }
      .status-badge .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
      }
      .status-active {
        background: rgba(16, 185, 129, 0.12);
        color: #059669;
      }
      .status-active .dot { background: #10b981; }

      .status-suspended {
        background: rgba(239, 68, 68, 0.12);
        color: #dc2626;
      }
      .status-suspended .dot { background: #ef4444; }

      .status-provisioning {
        background: rgba(245, 158, 11, 0.12);
        color: #d97706;
      }
      .status-provisioning .dot { background: #f59e0b; }

      .actions-group {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .action-btn {
        padding: 5px 11px;
        border-radius: 6px;
        font-size: 11.5px;
        font-weight: 700;
        border: none;
        cursor: pointer;
        transition: all 0.15s;
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .btn-danger-soft {
        background: rgba(239, 68, 68, 0.1);
        color: #dc2626;
        border: 1px solid rgba(239, 68, 68, 0.2);
      }
      .btn-danger-soft:hover:not(:disabled) {
        background: rgba(239, 68, 68, 0.18);
      }
      .btn-danger-soft:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .btn-success-soft {
        background: rgba(16, 185, 129, 0.1);
        color: #059669;
        border: 1px solid rgba(16, 185, 129, 0.2);
      }
      .btn-success-soft:hover {
        background: rgba(16, 185, 129, 0.18);
      }

      .btn-neutral {
        background: var(--bg, #f1f5f9);
        color: var(--text, #334155);
        border: 1px solid var(--border, #cbd5e1);
      }
      .btn-neutral:hover {
        background: var(--border, #e2e8f0);
      }

      .btn-manage {
        background: transparent;
        color: var(--p, #2563eb);
        border: 1px solid rgba(37, 99, 235, 0.3);
        padding: 5px 9px;
      }
      .btn-manage:hover {
        background: #2563eb;
        color: #ffffff;
      }

      .empty-state {
        text-align: center;
        padding: 48px 20px;
      }
      .empty-icon { font-size: 32px; margin-bottom: 8px; }
      .empty-title { font-weight: 700; font-size: 14px; color: var(--text, #0f172a); }
      .empty-desc { font-size: 12px; color: var(--muted, #64748b); margin-top: 3px; }

      /* Spin Animation */
      .action-icon.spin {
        animation: spin 1s linear infinite;
        display: inline-block;
      }
      @keyframes spin {
        100% { transform: rotate(360deg); }
      }

      /* Modal Dialog Styles */
      .modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.65);
        backdrop-filter: blur(5px);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      .modal-card {
        background: var(--surface, #ffffff);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: 16px;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        width: 100%;
        overflow: hidden;
        animation: modalIn 0.2s ease-out;
      }
      .modal-large {
        max-width: 900px;
        max-height: 88vh;
        display: flex;
        flex-direction: column;
      }
      @keyframes modalIn {
        from { opacity: 0; transform: scale(0.96); }
        to { opacity: 1; transform: scale(1); }
      }
      .modal-header {
        padding: 18px 24px;
        border-bottom: 1px solid var(--border, #e2e8f0);
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: var(--surface, #ffffff);
      }
      .btn-icon {
        background: transparent;
        border: none;
        color: var(--muted, #64748b);
        cursor: pointer;
        padding: 6px;
        border-radius: 6px;
      }
      .btn-icon:hover {
        background: var(--p-soft, #eff6ff);
        color: var(--text, #0f172a);
      }

      .detail-header-left {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .detail-avatar {
        width: 44px;
        height: 44px;
        border-radius: 12px;
        background: linear-gradient(135deg, #2563eb, #3b82f6);
        color: #ffffff;
        font-weight: 800;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        flex-shrink: 0;
      }
      .detail-title-row {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .detail-title {
        margin: 0;
        font-size: 18px;
        font-weight: 800;
        color: var(--text, #0f172a);
      }

      .modal-body-scroll {
        padding: 20px 24px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 18px;
        background: var(--bg, #f8fafc);
      }

      .modal-loading-state {
        text-align: center;
        padding: 60px 20px;
      }

      /* Quick Stats Grid */
      .details-stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
      }
      .detail-stat-box {
        background: var(--surface, #ffffff);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: 12px;
        padding: 14px 16px;
      }
      .stat-label {
        font-size: 11px;
        font-weight: 700;
        color: var(--muted, #64748b);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .stat-value {
        font-size: 15px;
        font-weight: 800;
        margin: 4px 0 2px 0;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .stat-value.text-blue { color: #2563eb; }
      .stat-value.text-emerald { color: #059669; }
      .stat-value.text-slate { color: #1e293b; }
      .stat-meta {
        font-size: 11px;
        color: var(--muted, #94a3b8);
      }

      /* Section Card */
      .section-card {
        background: var(--surface, #ffffff);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: 12px;
        overflow: hidden;
      }
      .section-header {
        padding: 14px 18px;
        border-bottom: 1px solid var(--border, #e2e8f0);
        background: #fafbfc;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
      }
      .section-title {
        font-size: 13.5px;
        font-weight: 800;
        color: var(--text, #0f172a);
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .section-desc {
        font-size: 12px;
        color: var(--muted, #64748b);
      }
      .count-pill {
        background: rgba(37, 99, 235, 0.1);
        color: #2563eb;
        font-size: 11px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 12px;
      }

      .credentials-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 16px;
        padding: 16px 18px;
      }
      .cred-label {
        font-size: 11.5px;
        font-weight: 600;
        color: var(--muted, #64748b);
      }
      .cred-value {
        font-size: 13px;
        font-weight: 700;
        color: var(--text, #0f172a);
        margin-top: 3px;
      }
      .cred-sub {
        font-weight: 400;
        font-size: 11px;
        color: var(--muted, #64748b);
      }
      .email-highlight {
        color: #2563eb;
      }

      /* Mini Table for employees */
      .employees-mini-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12.5px;
      }
      .employees-mini-table th {
        background: #fafbfc;
        padding: 10px 14px;
        text-align: left;
        font-size: 11px;
        font-weight: 700;
        color: var(--muted, #64748b);
        border-bottom: 1px solid var(--border, #e2e8f0);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .employees-mini-table td {
        padding: 10px 14px;
        border-bottom: 1px solid var(--border, #f1f5f9);
        vertical-align: middle;
      }
      .emp-name-cell {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .emp-avatar-sm {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        background: #e0e7ff;
        color: #3730a3;
        font-weight: 700;
        font-size: 11px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .emp-name {
        font-weight: 700;
        color: var(--text, #0f172a);
      }
      .emp-email {
        color: var(--muted, #64748b);
        font-size: 12px;
      }
      .dept-badge {
        display: inline-block;
        padding: 2px 7px;
        background: #f1f5f9;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        color: #334155;
      }

      .empty-employees-box {
        text-align: center;
        padding: 36px 16px;
      }

      .modal-footer {
        padding: 14px 24px;
        border-top: 1px solid var(--border, #e2e8f0);
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: var(--surface, #ffffff);
      }
      .footer-left {
        display: flex;
        gap: 10px;
      }

      .form-input {
        width: 100%;
        padding: 10px 14px;
        border-radius: 8px;
        border: 1px solid var(--border, #cbd5e1);
        background: var(--surface, #ffffff);
        color: var(--text, #0f172a);
        font-size: 13.5px;
        box-sizing: border-box;
      }
      .form-input:focus {
        outline: none;
        border-color: #2563eb;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
      }
      .btn-cancel {
        padding: 8px 18px;
        border-radius: 8px;
        border: 1px solid var(--border, #cbd5e1);
        background: transparent;
        color: var(--text, #334155);
        font-weight: 600;
        font-size: 13px;
        cursor: pointer;
      }
      .btn-cancel:hover {
        background: var(--bg, #f1f5f9);
      }
      .btn-submit {
        padding: 9px 20px;
        border-radius: 8px;
        border: none;
        background: #2563eb;
        color: #ffffff;
        font-weight: 700;
        font-size: 13px;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(37, 99, 235, 0.35);
      }
      .btn-submit:hover:not(:disabled) {
        background: #1d4ed8;
      }
      .btn-submit:disabled,
      .btn-cancel:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    `,
  ],
})
export class SuperAdminDashboardComponent implements OnInit, AfterViewInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionService);

  protected readonly isRefreshing = signal<boolean>(false);
  protected readonly showCreateOrgModal = signal<boolean>(false);
  protected readonly creatingOrg = signal<boolean>(false);
  protected createOrgForm: CreateCompanyRequest = {
    name: '',
    code: '',
    adminFullName: '',
    adminEmail: '',
    contactName: '',
    contactEmail: '',
    timeZone: 'Asia/Dubai',
  };

  protected readonly companies = signal<CompanyListItem[]>([]);
  protected readonly searchQuery = signal<string>('');
  protected readonly statusFilter = signal<'all' | 'Active' | 'Suspended'>('all');

  // Company Details Modal
  protected readonly showDetailsModal = signal<boolean>(false);
  protected readonly loadingCompanyDetails = signal<boolean>(false);
  protected readonly selectedCompanyListItem = signal<CompanyListItem | null>(null);
  protected readonly selectedCompanyDetail = signal<CompanyDetail | null>(null);

  protected readonly selectedTenantCode = computed(() => {
    const code = this.session.user()?.companyCode;
    return code && code !== 'ALL' ? code.toUpperCase() : null;
  });

  protected readonly selectedTenantName = computed(() => {
    const code = this.selectedTenantCode();
    if (!code) return null;
    const match = this.companies().find((c) => (c.code || '').toUpperCase() === code);
    return match ? match.name : this.session.user()?.companyName || code;
  });

  protected readonly totalCompanies = computed(() => this.companies().length);
  protected readonly activeCompanies = computed(
    () => this.companies().filter((c) => (c.status || '').toLowerCase() === 'active').length
  );
  protected readonly suspendedCompanies = computed(
    () => this.companies().filter((c) => (c.status || '').toLowerCase() === 'suspended').length
  );
  protected readonly totalAdmins = computed(() => {
    const list = this.companies();
    return list.filter((c) => !!c.adminEmail || !!c.adminFullName).length;
  });

  protected readonly filteredCompanies = computed(() => {
    let list = this.companies();

    // 1. Filter by header tenant switcher if a specific tenant is active
    const tCode = this.selectedTenantCode();
    if (tCode) {
      const match = list.filter((c) => (c.code || '').toUpperCase() === tCode);
      if (match.length > 0) {
        list = match;
      }
    }

    // 2. Filter by status pill
    const filter = this.statusFilter();
    if (filter === 'Active') {
      list = list.filter((c) => (c.status || '').toLowerCase() === 'active');
    } else if (filter === 'Suspended') {
      list = list.filter((c) => (c.status || '').toLowerCase() === 'suspended');
    }

    // 3. Filter by search input
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.code && c.code.toLowerCase().includes(q)) ||
        (c.adminEmail && c.adminEmail.toLowerCase().includes(q)) ||
        (c.adminFullName && c.adminFullName.toLowerCase().includes(q)) ||
        (c.databaseName && c.databaseName.toLowerCase().includes(q))
    );
  });

  ngOnInit(): void {
    this.searchQuery.set('');
    this.refreshAll();
  }

  ngAfterViewInit(): void {
    // Clear any unwanted browser autofill from search field
    setTimeout(() => {
      const el = document.getElementById('tenantFilterSearchBox') as HTMLInputElement | null;
      if (el && !this.searchQuery()) {
        el.value = '';
      }
    }, 150);
  }

  protected setStatusFilter(filter: 'all' | 'Active' | 'Suspended'): void {
    this.statusFilter.set(filter);
  }

  protected clearTenantFilter(): void {
    const allOption = { id: 'all', name: 'All Organizations', location: 'ALL', logo: 'assets/images/shape-logo.png' };
    sessionStorage.setItem('current_tenant', JSON.stringify(allOption));
    this.session.updateUser({
      companyId: undefined,
      companyCode: undefined,
      companyName: 'All Organizations',
    });
    this.toast.show('Switched to Platform View: All Organizations', 'success');
  }

  protected refreshAll(): void {
    this.isRefreshing.set(true);
    this.api
      .tenantCompanies()
      .pipe(catchError(() => of([] as CompanyListItem[])))
      .subscribe({
        next: (list) => {
          this.companies.set(list || []);
          this.isRefreshing.set(false);
          this.toast.show('Telemetry synchronized with database.', 'success');
        },
        error: () => {
          this.isRefreshing.set(false);
          this.toast.show('Failed to refresh telemetry.', 'danger');
        },
      });
  }

  protected onSearchInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value || '';
    this.searchQuery.set(val);
  }

  protected clearSearch(): void {
    this.searchQuery.set('');
    const el = document.getElementById('tenantFilterSearchBox') as HTMLInputElement | null;
    if (el) {
      el.value = '';
    }
  }

  protected openCompanyDetails(company: CompanyListItem): void {
    this.selectedCompanyListItem.set(company);
    this.selectedCompanyDetail.set(null);
    this.showDetailsModal.set(true);
    this.loadingCompanyDetails.set(true);

    this.api.tenantCompany(company.id).subscribe({
      next: (detail) => {
        this.selectedCompanyDetail.set(detail);
        this.loadingCompanyDetails.set(false);
      },
      error: (err) => {
        this.loadingCompanyDetails.set(false);
        this.toast.show(err?.error?.message || 'Failed to load company details and employees.', 'danger');
      },
    });
  }

  protected closeCompanyDetails(): void {
    this.showDetailsModal.set(false);
    this.selectedCompanyDetail.set(null);
    this.selectedCompanyListItem.set(null);
  }

  protected resendInvitationFromModal(detail: CompanyDetail): void {
    this.api.resendInvitation(detail.id).subscribe({
      next: () => {
        this.toast.show(`Invitation resent to ${detail.adminEmail}`, 'success');
        this.openCompanyDetails({ ...detail });
      },
      error: (err) => {
        this.toast.show(err?.error?.message || 'Failed to resend invitation', 'danger');
      },
    });
  }

  protected suspendCompanyFromModal(detail: CompanyDetail): void {
    if (detail.isDefault) {
      this.toast.show('The primary default company cannot be suspended', 'danger');
      return;
    }
    if (!confirm(`Are you sure you want to suspend company '${detail.name}'?`)) {
      return;
    }
    this.api.suspendTenantCompany(detail.id).subscribe({
      next: () => {
        this.toast.show(`Company '${detail.name}' has been suspended`, 'warning');
        this.refreshAll();
        this.openCompanyDetails({ ...detail, status: 'Suspended' });
      },
      error: (err) => {
        this.toast.show(err?.error?.message || 'Failed to suspend company', 'danger');
      },
    });
  }

  protected activateCompanyFromModal(detail: CompanyDetail): void {
    this.api.activateTenantCompany(detail.id).subscribe({
      next: () => {
        this.toast.show(`Company '${detail.name}' activated successfully`, 'success');
        this.refreshAll();
        this.openCompanyDetails({ ...detail, status: 'Active' });
      },
      error: (err) => {
        this.toast.show(err?.error?.message || 'Failed to activate company', 'danger');
      },
    });
  }

  protected openCreateOrgModal(): void {
    this.createOrgForm = {
      name: '',
      code: '',
      adminFullName: '',
      adminEmail: '',
      contactName: '',
      contactEmail: '',
      timeZone: 'Asia/Dubai',
    };
    this.showCreateOrgModal.set(true);
  }

  protected closeCreateOrgModal(): void {
    this.showCreateOrgModal.set(false);
  }

  protected submitCreateOrg(): void {
    if (
      !this.createOrgForm.name?.trim() ||
      !this.createOrgForm.adminFullName?.trim() ||
      !this.createOrgForm.adminEmail?.trim()
    ) {
      this.toast.show('Organization name, admin name, and admin email are required.', 'warning');
      return;
    }

    const payload: CreateCompanyRequest = {
      name: this.createOrgForm.name.trim(),
      code: this.createOrgForm.code?.trim() || undefined,
      adminFullName: this.createOrgForm.adminFullName.trim(),
      adminEmail: this.createOrgForm.adminEmail.trim(),
      contactName: this.createOrgForm.contactName?.trim() || undefined,
      contactEmail: this.createOrgForm.contactEmail?.trim() || undefined,
      timeZone: this.createOrgForm.timeZone?.trim() || 'UTC',
    };

    this.creatingOrg.set(true);
    this.api.createTenantCompany(payload).subscribe({
      next: () => {
        this.creatingOrg.set(false);
        this.showCreateOrgModal.set(false);
        this.toast.show(`Organization '${payload.name}' provisioned successfully!`, 'success');
        this.refreshAll();
      },
      error: (err) => {
        this.creatingOrg.set(false);
        const errObj = err?.error;
        let msg = 'Failed to create organization.';
        if (errObj?.errors && typeof errObj.errors === 'object') {
          const details = Object.values(errObj.errors).flat().join(' ');
          if (details) msg = details;
        } else if (errObj?.message) {
          msg = errObj.message;
        } else if (errObj?.title) {
          msg = errObj.title;
        }
        this.toast.show(msg, 'danger');
      },
    });
  }

  protected suspendCompany(company: CompanyListItem): void {
    if (company.isDefault) {
      this.toast.show('The primary default company cannot be suspended', 'danger');
      return;
    }
    if (!confirm(`Are you sure you want to suspend company '${company.name}'?`)) {
      return;
    }

    this.api.suspendTenantCompany(company.id).subscribe({
      next: () => {
        this.toast.show(`Company '${company.name}' has been suspended`, 'warning');
        this.refreshAll();
      },
      error: (err) => {
        this.toast.show(err?.error?.message || 'Failed to suspend company', 'danger');
      },
    });
  }

  protected activateCompany(company: CompanyListItem): void {
    this.api.activateTenantCompany(company.id).subscribe({
      next: () => {
        this.toast.show(`Company '${company.name}' activated successfully`, 'success');
        this.refreshAll();
      },
      error: (err) => {
        this.toast.show(err?.error?.message || 'Failed to activate company', 'danger');
      },
    });
  }

  protected resendInvitation(company: CompanyListItem): void {
    this.api.resendInvitation(company.id).subscribe({
      next: () => {
        this.toast.show(`Invitation resent to ${company.adminEmail}`, 'success');
        this.refreshAll();
      },
      error: (err) => {
        this.toast.show(err?.error?.message || 'Failed to resend invitation', 'danger');
      },
    });
  }
}
