import { CommonModule, DatePipe } from '@angular/common';
import { Component, OnInit, OnDestroy, AfterViewInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { of, catchError } from 'rxjs';
import { ApiService } from '../../core/api/api.service';
import { SessionService } from '../../core/services/session.service';
import { CompanyListItem, CompanyDetail, CreateCompanyRequest, STANDARD_TIMEZONES } from '../../core/api/api.models';
import { IconDirective } from '../../core/icons/icon.directive';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-super-admin-dashboard',
  imports: [CommonModule, FormsModule, IconDirective, DatePipe],
  template: `
    <div class="super-admin-dashboard">
      <!-- 4 Top KPI Cards for Super Admin Platform -->
      <div class="kpi-cards-grid">
        <div class="kpi-card">
          <div class="kpi-card-header">
            <div class="kpi-icon-wrap icon-purple">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 21h18" />
                <path d="M5 21V7l8-4v18" />
                <path d="M19 21V11l-6-4" />
                <path d="M9 9v.01" /><path d="M9 12v.01" /><path d="M9 15v.01" /><path d="M9 18v.01" />
              </svg>
            </div>
            <span class="kpi-label">Total Tenants</span>
          </div>
          <div class="kpi-card-val">{{ totalCompanies() }}</div>
          <div class="kpi-card-meta">
            <span class="meta-pill neutral">Organizations</span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-card-header">
            <div class="kpi-icon-wrap icon-green">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <span class="kpi-label">Active Tenants</span>
          </div>
          <div class="kpi-card-val">{{ activeCompanies() }}</div>
          <div class="kpi-card-meta">
            <span class="meta-pill positive">Provisioned</span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-card-header">
            <div class="kpi-icon-wrap icon-coral">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <span class="kpi-label">Suspended</span>
          </div>
          <div class="kpi-card-val">{{ suspendedCompanies() }}</div>
          <div class="kpi-card-meta">
            <span class="meta-pill" [class.alert]="suspendedCompanies() > 0" [class.neutral]="suspendedCompanies() === 0">
              {{ suspendedCompanies() > 0 ? 'Action Required' : 'All Running' }}
            </span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-card-header">
            <div class="kpi-icon-wrap icon-amber">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <span class="kpi-label">Administrators</span>
          </div>
          <div class="kpi-card-val">{{ totalAdmins() }}</div>
          <div class="kpi-card-meta">
            <span class="meta-pill neutral">Tenant Admins</span>
          </div>
        </div>
      </div>

      <!-- Main Content: Tenant Organizations Full-Width Table -->
      <div class="content-panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">Tenant Organizations</h3>
            <p class="panel-desc">Manage tenant lifecycle, provisioning status, and administrator invitations</p>
          </div>
          <div class="panel-controls">
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

        <!-- Desktop Table View (visible > 768px) -->
        <div class="table-responsive desktop-table-wrap">
          <table class="modern-table">
            <thead>
              <tr>
                <th>Organization</th>
                <th>Tenant Code</th>
                <th>Administrator</th>
                <th>Database</th>
                <th style="text-align: right; min-width: 180px;">Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (c of filteredCompanies(); track c.id) {
                <tr class="table-row">
                  <td>
                    <div class="org-cell">
                      <div class="org-avatar" (click)="openCompanyDetails(c)" role="button" title="View {{ c.name }} details & employees" style="cursor: pointer;">
                        {{ c.name.charAt(0) }}
                      </div>
                      <div class="org-info">
                        <button type="button" class="org-name-btn" (click)="openCompanyDetails(c)" title="View {{ c.name }} details & employees">
                          {{ c.name }}
                        </button>
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
                  <td style="text-align: right;">
                    <div class="actions-group">
                      @if (!c.isDefault) {
                        <button
                          type="button"
                          class="btn-status-outline"
                          [class.status-active]="(c.status || '').toLowerCase() === 'active'"
                          [class.status-suspended]="(c.status || '').toLowerCase() === 'suspended'"
                          (click)="toggleCompanyStatus(c)"
                          [attr.data-tooltip]="(c.status || '').toLowerCase() === 'suspended' ? 'Click to Activate tenant' : 'Click to Suspend tenant'"
                        >
                          {{ (c.status || '').toLowerCase() === 'suspended' ? 'Suspended' : 'Active' }}
                        </button>
                      }

                      <button
                        class="action-btn btn-neutral"
                        (click)="openCompanyDetails(c)"
                        data-tooltip="View Details & Employees"
                        title="View {{ c.name }} Details & Employees"
                      >
                        <span [appIcon]="'eye'"></span>
                        Details
                      </button>

                      @if (!c.isDefault) {
                        <button
                          type="button"
                          class="action-btn"
                          style="color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.05);"
                          (click)="confirmDeleteCompany(c)"
                          data-tooltip="Delete Company & Drop Database"
                          title="Delete {{ c.name }} & Drop Database"
                        >
                          <span [appIcon]="'trash'"></span>
                          Delete
                        </button>
                      }
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5" class="empty-state">
                    <div class="empty-icon">🏢</div>
                    <div class="empty-title">No tenant organizations found</div>
                    <div class="empty-desc">Try clearing your search query or filter</div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <!-- Mobile Tenant Cards View (visible <= 768px) -->
        <div class="mobile-tenant-cards">
          @for (c of filteredCompanies(); track c.id) {
            <div class="m-tenant-card">
              <div class="m-card-header">
                <div class="org-cell">
                  <div class="org-avatar" (click)="openCompanyDetails(c)" role="button" title="View {{ c.name }} details & employees" style="cursor: pointer;">
                    {{ c.name.charAt(0) }}
                  </div>
                  <div class="org-info">
                    <button type="button" class="org-name-btn" (click)="openCompanyDetails(c)" title="View {{ c.name }} details & employees">
                      {{ c.name }}
                    </button>
                    @if (c.isDefault) {
                      <span class="badge badge-default">Primary Default</span>
                    }
                  </div>
                </div>
                <span
                  class="badge"
                  [style.background]="(c.status || '').toLowerCase() === 'active' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'"
                  [style.color]="(c.status || '').toLowerCase() === 'active' ? '#059669' : '#dc2626'"
                  style="font-weight: 700; font-size: 11px; padding: 3px 10px; border-radius: 12px;"
                >
                  {{ (c.status || '').toLowerCase() === 'suspended' ? 'Suspended' : 'Active' }}
                </span>
              </div>

              <div class="m-card-body">
                <div class="m-info-line">
                  <span class="m-info-label">Tenant Code</span>
                  <span class="code-badge">{{ c.code }}</span>
                </div>
                <div class="m-info-line">
                  <span class="m-info-label">Database</span>
                  <span class="db-badge"><span [appIcon]="'grid'"></span> {{ c.databaseName || 'HRMS (Default)' }}</span>
                </div>
                <div class="m-info-line">
                  <span class="m-info-label">Administrator</span>
                  <div class="m-admin-val">
                    <div class="admin-name">{{ c.adminFullName || 'Administrator' }}</div>
                    <div class="admin-email">{{ c.adminEmail }}</div>
                  </div>
                </div>
              </div>

              <div class="m-card-footer">
                @if (!c.isDefault) {
                  <button
                    type="button"
                    class="btn-status-outline"
                    [class.status-active]="(c.status || '').toLowerCase() === 'active'"
                    [class.status-suspended]="(c.status || '').toLowerCase() === 'suspended'"
                    (click)="toggleCompanyStatus(c)"
                  >
                    {{ (c.status || '').toLowerCase() === 'suspended' ? 'Activate Tenant' : 'Suspend Tenant' }}
                  </button>
                }
                <button
                  class="action-btn btn-neutral"
                  (click)="openCompanyDetails(c)"
                  title="View {{ c.name }} Details & Employees"
                >
                  <span [appIcon]="'eye'"></span> Details
                </button>
                @if (!c.isDefault) {
                  <button
                    type="button"
                    class="action-btn"
                    style="color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.05);"
                    (click)="confirmDeleteCompany(c)"
                  >
                    <span [appIcon]="'trash'"></span> Delete
                  </button>
                }
              </div>
            </div>
          } @empty {
            <div class="empty-state" style="padding: 32px 16px;">
              <div class="empty-icon">🏢</div>
              <div class="empty-title">No tenant organizations found</div>
              <div class="empty-desc">Try clearing your search query or filter</div>
            </div>
          }
        </div>
      </div>

      <!-- Company Details & Employees Modal (matching Image 2) -->
      @if (showDetailsModal()) {
        <div class="modal-overlay open" (click)="closeCompanyDetails()">
          <div class="modal modal-card" style="max-width: 860px; width: 100%;" (click)="$event.stopPropagation()">
            <!-- Modal Header -->
            <div class="modal-header">
              <div style="display: flex; align-items: center; gap: 10px;">
                <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: var(--text, #0f172a);">
                  {{ selectedCompanyDetail()?.name || selectedCompanyListItem()?.name }}
                </h3>
                <span class="code-badge" style="background: rgba(37, 99, 235, 0.08); color: #2563eb; border-color: rgba(37, 99, 235, 0.25);">
                  {{ selectedCompanyDetail()?.code || selectedCompanyListItem()?.code }}
                </span>
                @let st = (selectedCompanyDetail()?.status || selectedCompanyListItem()?.status || '').toLowerCase();
                <span
                  class="badge"
                  [style.background]="st === 'active' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'"
                  [style.color]="st === 'active' ? '#059669' : '#dc2626'"
                  style="font-weight: 700; font-size: 11px; padding: 3px 10px; border-radius: 12px;"
                >
                  {{ selectedCompanyDetail()?.status || selectedCompanyListItem()?.status || 'Active' }}
                </span>
                @if (selectedCompanyDetail()?.isDefault || selectedCompanyListItem()?.isDefault) {
                  <span class="badge badge-default">Primary Default</span>
                }
              </div>
              <button class="btn-icon" (click)="closeCompanyDetails()" type="button" title="Close"><span [appIcon]="'x'"></span></button>
            </div>

            <!-- Modal Body -->
            <div class="modal-body-scroll" style="max-height: 75vh; overflow-y: auto; padding: 20px 24px;">
              @if (loadingCompanyDetails()) {
                <div class="modal-loading-state" style="text-align: center; padding: 48px 16px;">
                  <span [appIcon]="'sync'" class="action-icon spin" style="font-size: 28px; color: var(--p, #2563eb);"></span>
                  <div style="font-weight: 700; margin-top: 12px;">Loading Company Details &amp; Employees...</div>
                  <div style="font-size: 12.5px; color: var(--muted, #64748b);">Querying dedicated tenant database</div>
                </div>
              } @else if (selectedCompanyDetail()) {
                @let d = selectedCompanyDetail()!;

                <!-- Company Details Grid Box (matches Image 2) -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px 24px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px 20px; margin-bottom: 22px;">
                  <div>
                    <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em;">COMPANY CODE</div>
                    <div style="font-weight: 700; font-size: 13.5px; color: #0f172a; margin-top: 2px;">{{ d.code }}</div>
                  </div>
                  <div>
                    <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em;">STATUS</div>
                    <div style="margin-top: 2px;">
                      <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #059669; font-weight: 700; font-size: 11px; padding: 2px 10px; border-radius: 12px;">
                        {{ d.status }}
                      </span>
                    </div>
                  </div>
                  <div>
                    <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em;">DEDICATED DATABASE</div>
                    <div style="font-family: monospace; font-size: 13px; font-weight: 600; color: #2563eb; margin-top: 2px;">{{ d.databaseName || '—' }}</div>
                  </div>
                  <div>
                    <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em;">TIME ZONE</div>
                    <div style="font-size: 13px; font-weight: 600; color: #0f172a; margin-top: 2px;">{{ d.timeZone || 'UTC' }}</div>
                  </div>
                  <div>
                    <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em;">ADMINISTRATOR</div>
                    <div style="font-size: 13px; font-weight: 600; color: #0f172a; margin-top: 2px;">{{ d.adminFullName }}</div>
                    <div style="font-size: 12px; color: #64748b;">{{ d.adminEmail }}</div>
                  </div>
                  <div>
                    <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em;">TOTAL STAFF</div>
                    <div style="font-size: 13px; font-weight: 700; color: #10b981; margin-top: 2px;">
                      {{ d.employees?.length || d.employeeCount || 0 }} Employees
                    </div>
                    <div style="font-size: 11.5px; color: #64748b;">Live From Tenant Schema</div>
                  </div>
                  @if (d.contactName || d.contactEmail) {
                    <div>
                      <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em;">CONTACT PERSON</div>
                      <div style="font-size: 13px; color: #0f172a; margin-top: 2px;">{{ d.contactName || '—' }} ({{ d.contactEmail || '—' }})</div>
                    </div>
                  }
                  <div>
                    <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em;">PROVISIONED AT</div>
                    <div style="font-size: 12.5px; color: #0f172a; margin-top: 2px;">
                      {{ d.provisionedAtUtc ? (d.provisionedAtUtc | date: 'medium') : '—' }}
                    </div>
                  </div>
                </div>

                <!-- Section: Company Employees (matches Image 2) -->
                <div>
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
                    <div style="font-weight: 700; font-size: 14px; color: #0f172a; display: flex; align-items: center; gap: 8px;">
                      <span [appIcon]="'user'"></span>
                      <span>Company Employees</span>
                      <span class="badge" style="background: rgba(37, 99, 235, 0.1); color: #2563eb; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px;">
                        {{ d.employees?.length || 0 }} Total
                      </span>
                    </div>
                    @if (d.employees && d.employees.length > 5) {
                      <div style="max-width: 220px;">
                        <input
                          type="text"
                          class="search-input-sm"
                          placeholder="Search employees..."
                          [ngModel]="empModalSearch()"
                          (ngModelChange)="onEmpModalSearchChange($event)"
                        />
                      </div>
                    }
                  </div>

                  @if (d.employees && d.employees.length > 0) {
                    @if (pagedModalEmployees().length > 0) {
                      <div class="table-responsive" style="border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                        <table class="employees-mini-table" style="width: 100%; border-collapse: collapse; font-size: 13px;">
                          <thead>
                            <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                              <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Code</th>
                              <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Employee Name</th>
                              <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Work Email</th>
                              <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Department</th>
                              <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Role</th>
                              <th style="padding: 10px 12px; text-align: center; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            @for (emp of pagedModalEmployees(); track emp.id) {
                              <tr style="border-bottom: 1px solid #f1f5f9;">
                                <td style="padding: 10px 12px; font-family: monospace; font-size: 12px; font-weight: 600;">
                                  {{ emp.employeeCode }}
                                </td>
                                <td style="padding: 10px 12px; font-weight: 600; color: #0f172a;">
                                  {{ emp.fullName }}
                                </td>
                                <td style="padding: 10px 12px; color: #64748b; font-size: 12px;">
                                  {{ emp.email }}
                                </td>
                                <td style="padding: 10px 12px;">
                                  @if (emp.department) {
                                    <span class="badge" style="background: rgba(100, 116, 139, 0.1); color: #0f172a; font-size: 11px;">{{ emp.department }}</span>
                                  } @else {
                                    <span style="color: #94a3b8;">—</span>
                                  }
                                </td>
                                <td style="padding: 10px 12px; color: #64748b; font-size: 12px;">
                                  {{ emp.designation || 'Staff' }}
                                </td>
                                <td style="padding: 10px 12px; text-align: center;">
                                  <span class="badge" [class.badge-success]="emp.status.toLowerCase() === 'active'" [class.badge-warning]="emp.status.toLowerCase() !== 'active'" style="font-size: 11px;">
                                    {{ emp.status }}
                                  </span>
                                </td>
                              </tr>
                            }
                          </tbody>
                        </table>
                      </div>

                      <!-- Pagination Controls -->
                      <div class="modal-pagination-bar" style="margin-top: 12px;">
                        <div class="pagination-info">
                          Showing {{ empModalStartIndex() }} to {{ empModalEndIndex() }} of {{ filteredModalEmployees().length }} employees
                        </div>
                        <div class="pagination-buttons">
                          <button
                            type="button"
                            class="page-nav-btn"
                            [disabled]="empModalPage() <= 1"
                            (click)="changeEmpModalPage(empModalPage() - 1)"
                            title="Previous Page"
                            aria-label="Previous Page"
                            style="display: inline-flex; align-items: center; justify-content: center; min-width: 32px; height: 32px; padding: 0 8px;"
                          >
                            <span [appIcon]="'chevron_left'"></span>
                          </button>
                          <span class="page-indicator">
                            Page {{ empModalPage() }} of {{ empModalTotalPages() }}
                          </span>
                          <button
                            type="button"
                            class="page-nav-btn"
                            [disabled]="empModalPage() >= empModalTotalPages()"
                            (click)="changeEmpModalPage(empModalPage() + 1)"
                            title="Next Page"
                            aria-label="Next Page"
                            style="display: inline-flex; align-items: center; justify-content: center; min-width: 32px; height: 32px; padding: 0 8px;"
                          >
                            <span [appIcon]="'chevron_right'"></span>
                          </button>
                        </div>
                      </div>
                    } @else {
                      <div style="text-align: center; padding: 24px; color: #64748b; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
                        No employees match "{{ empModalSearch() }}"
                      </div>
                    }
                  } @else {
                    <!-- Empty State matching Image 2 exactly -->
                    <div style="text-align: center; padding: 40px 20px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
                      <div style="font-size: 32px; color: #3b286d; margin-bottom: 8px;">👥</div>
                      <div style="font-weight: 700; color: #0f172a; font-size: 14px;">No Employees In This Company Yet</div>
                      <div style="font-size: 12.5px; color: #64748b; margin-top: 4px;">
                        Employees Created By The Company Admin Will Appear Here With Live Data From The Tenant Database.
                      </div>
                    </div>
                  }
                </div>
              }
            </div>

            <!-- Modal Footer -->
            <div class="modal-footer" style="padding: 16px 24px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
              @if (selectedCompanyListItem(); as item) {
                @if (!item.isDefault) {
                  <button
                    type="button"
                    class="action-btn"
                    style="color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.05); display: inline-flex; align-items: center; gap: 6px;"
                    (click)="closeCompanyDetails(); confirmDeleteCompany(item)"
                  >
                    <span [appIcon]="'trash'"></span> Delete Organization & Drop Database
                  </button>
                } @else {
                  <div></div>
                }
              } @else {
                <div></div>
              }
              <button class="btn-cancel" type="button" (click)="closeCompanyDetails()" style="min-width: 80px;">Close</button>
            </div>
          </div>
        </div>
      }

      <!-- Create Organization Modal -->
      @if (showCreateOrgModal()) {
        <div class="modal-overlay open" (click)="closeCreateOrgModal()">
          <div class="modal modal-card" style="max-width: 580px; width: 100%;" (click)="$event.stopPropagation()">
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
                  <select class="form-input" [(ngModel)]="createOrgForm.timeZone" style="width: 100%; height: 38px;">
                    @for (tz of standardTimezones; track tz.value) {
                      <option [value]="tz.value">{{ tz.label }}</option>
                    }
                  </select>
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

      <!-- Delete Company & Drop Database Confirmation Modal -->
      @if (showDeleteCompanyModal()) {
        @if (companyToDelete(); as c) {
          <div class="modal-overlay open" (click)="closeDeleteCompanyModal()">
            <div class="modal" style="max-width: 480px;" (click)="$event.stopPropagation()">
              <div class="modal-header" style="border-bottom: 1px solid var(--border); padding: 18px 24px;">
                <div style="font-size: 1.15rem; font-weight: 700; color: #dc2626; display: flex; align-items: center; gap: 8px;">
                  <span [appIcon]="'trash'"></span>
                  <span>Delete Company & Drop Database</span>
                </div>
                <button class="btn-cancel" style="padding: 4px 8px; font-size: 14px;" (click)="closeDeleteCompanyModal()" [disabled]="isDeletingCompany()">
                  <span [appIcon]="'x'"></span>
                </button>
              </div>
              <div class="modal-body" style="padding: 20px 24px;">
                <p style="font-size: 14px; margin-bottom: 12px; color: var(--text);">
                  Are you sure you want to delete organization <strong>{{ c.name }}</strong> (<code>{{ c.code }}</code>)?
                </p>
                <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 8px; padding: 12px 14px; font-size: 12.5px; color: #b91c1c; line-height: 1.45;">
                  <strong>Database Drop Warning:</strong> This will permanently delete the tenant registry and <strong>drop</strong> the dedicated SQL database <code>{{ c.databaseName || 'associated' }}</code> from the SQL Server. All data inside will be permanently erased.
                </div>
              </div>
              <div class="modal-footer" style="padding: 16px 24px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 12px;">
                <button class="btn-cancel" type="button" (click)="closeDeleteCompanyModal()" [disabled]="isDeletingCompany()">Cancel</button>
                <button
                  type="button"
                  class="btn-submit"
                  style="background: #dc2626; border-color: #dc2626; color: #fff;"
                  (click)="deleteCompanyConfirmed()"
                  [disabled]="isDeletingCompany()"
                >
                  {{ isDeletingCompany() ? 'Dropping Database & Deleting...' : 'Confirm & Delete Company' }}
                </button>
              </div>
            </div>
          </div>
        }
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
      .org-name-btn {
        background: none;
        border: none;
        padding: 0;
        font-weight: 700;
        color: var(--text, #0f172a);
        font-size: 13.5px;
        cursor: pointer;
        text-align: left;
        transition: color 0.15s;
        display: block;
      }
      .org-name-btn:hover {
        color: #2563eb;
        text-decoration: underline;
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

      .btn-status-outline {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 4px 14px;
        border-radius: 6px;
        font-size: 11.5px;
        font-weight: 700;
        cursor: pointer;
        background: #ffffff;
        transition: all 0.15s ease;
      }
      .btn-status-outline.status-active {
        border: 1.5px solid #10b981;
        color: #059669;
        background: rgba(16, 185, 129, 0.05);
      }
      .btn-status-outline.status-active:hover {
        background: #10b981;
        color: #ffffff;
      }
      .btn-status-outline.status-suspended {
        border: 1.5px solid #ef4444;
        color: #dc2626;
        background: rgba(239, 68, 68, 0.05);
      }
      .btn-status-outline.status-suspended:hover {
        background: #ef4444;
        color: #ffffff;
      }

      .modal-pagination-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 18px;
        border-top: 1px solid var(--border, #e2e8f0);
        background: var(--bg, #f8fafc);
        font-size: 12px;
        color: var(--muted, #64748b);
        flex-wrap: wrap;
        gap: 8px;
      }
      .pagination-buttons {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .page-nav-btn {
        padding: 4px 10px;
        border-radius: 6px;
        border: 1px solid var(--border, #cbd5e1);
        background: var(--surface, #ffffff);
        color: var(--text, #1e293b);
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
      }
      .page-nav-btn:hover:not(:disabled) {
        border-color: #2563eb;
        color: #2563eb;
      }
      .page-nav-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .page-indicator {
        font-weight: 700;
        color: var(--text, #0f172a);
        font-size: 12px;
      }
      .search-input-sm {
        padding: 5px 10px;
        border-radius: 6px;
        border: 1px solid var(--border, #cbd5e1);
        font-size: 12px;
        outline: none;
        width: 180px;
      }
      .search-input-sm:focus {
        border-color: #2563eb;
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
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease;
      }
      .modal-overlay.open {
        opacity: 1 !important;
        pointer-events: all !important;
        visibility: visible !important;
      }
      .modal-card {
        background: var(--surface, #ffffff);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: 16px;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        width: 100%;
        overflow: hidden;
        opacity: 1 !important;
        transform: scale(1) translateY(0) !important;
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

      /* Top 4 KPI Cards */
      .kpi-cards-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
      }
      .kpi-card {
        background: var(--surface, #ffffff);
        border: 1px solid var(--border, #e5e7eb);
        border-radius: 12px;
        padding: 10px 14px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
      }
      .kpi-card:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05);
      }
      .kpi-card-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
      }
      .kpi-label {
        font-size: 11px;
        font-weight: 600;
        color: var(--muted, #64748b);
        text-transform: uppercase;
        letter-spacing: 0.03em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .kpi-icon-wrap {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .kpi-icon-wrap.icon-purple { background: #f3e8ff; color: #9333ea; }
      .kpi-icon-wrap.icon-green { background: #dcfce7; color: #16a34a; }
      .kpi-icon-wrap.icon-coral { background: #fee2e2; color: #dc2626; }
      .kpi-icon-wrap.icon-amber { background: #fef3c7; color: #d97706; }
      .kpi-card-val {
        font-size: 1.35rem;
        font-weight: 800;
        line-height: 1.15;
        color: var(--text, #111827);
        margin-bottom: 2px;
        letter-spacing: -0.02em;
      }
      .kpi-card-meta {
        display: flex;
        align-items: center;
      }
      .meta-pill {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-size: 10px;
        font-weight: 600;
        padding: 2px 7px;
        border-radius: 10px;
      }
      .meta-pill.positive { background: #ecfdf5; color: #059669; }
      .meta-pill.neutral { background: #f1f5f9; color: #475569; }
      .meta-pill.alert { background: #fff1f2; color: #e11d48; }

      /* Mobile Tenant Cards */
      .desktop-table-wrap {
        display: block;
      }
      .mobile-tenant-cards {
        display: none;
      }

      @media (max-width: 768px) {
        .kpi-cards-grid {
          grid-template-columns: repeat(2, 1fr) !important;
          gap: 8px !important;
        }
        .desktop-table-wrap {
          display: none !important;
        }
        .mobile-tenant-cards {
          display: flex !important;
          flex-direction: column;
          gap: 12px;
          padding: 12px;
        }
        .m-tenant-card {
          background: var(--surface, #ffffff);
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 12px;
          padding: 14px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
        }
        .m-card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 8px;
          margin-bottom: 12px;
        }
        .m-card-body {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 10px 0;
          border-top: 1px solid var(--border, #f1f5f9);
          border-bottom: 1px solid var(--border, #f1f5f9);
        }
        .m-info-line {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          font-size: 12.5px;
        }
        .m-info-label {
          color: var(--muted, #64748b);
          font-weight: 600;
          font-size: 12px;
        }
        .m-admin-val {
          text-align: right;
        }
        .m-admin-val .admin-name {
          font-size: 12.5px;
        }
        .m-admin-val .admin-email {
          font-size: 11px;
        }
        .m-card-footer {
          display: flex;
          justify-content: flex-end;
          align-items: center;
          gap: 8px;
          margin-top: 12px;
          flex-wrap: wrap;
        }
        .m-card-footer button {
          flex: 1;
          justify-content: center;
          text-align: center;
        }
        .panel-header {
          flex-direction: column !important;
          align-items: stretch !important;
          gap: 12px !important;
          padding: 14px 16px !important;
        }
        .panel-controls {
          flex-direction: column !important;
          align-items: stretch !important;
          gap: 10px !important;
          width: 100% !important;
        }
        .filter-pills {
          width: 100% !important;
          box-sizing: border-box !important;
          justify-content: space-between !important;
        }
        .filter-pills .pill-btn {
          flex: 1 !important;
          text-align: center !important;
          padding: 6px 4px !important;
          font-size: 11.5px !important;
        }
        .search-wrap {
          width: 100% !important;
        }
        .search-input {
          width: 100% !important;
          box-sizing: border-box !important;
        }
        .search-input:focus {
          width: 100% !important;
        }
      }
    `,
  ],
})
export class SuperAdminDashboardComponent implements OnInit, OnDestroy, AfterViewInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionService);

  protected readonly standardTimezones = STANDARD_TIMEZONES;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  protected readonly isRefreshing = signal<boolean>(false);
  protected readonly showCreateOrgModal = signal<boolean>(false);
  protected readonly creatingOrg = signal<boolean>(false);
  protected readonly showDeleteCompanyModal = signal<boolean>(false);
  protected readonly companyToDelete = signal<CompanyListItem | null>(null);
  protected readonly isDeletingCompany = signal<boolean>(false);
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

  // Modal Employee Pagination
  protected readonly empModalPage = signal<number>(1);
  protected readonly empModalPageSize = signal<number>(5);
  protected readonly empModalSearch = signal<string>('');

  protected readonly filteredModalEmployees = computed(() => {
    const list = this.selectedCompanyDetail()?.employees || [];
    const q = this.empModalSearch().toLowerCase().trim();
    if (!q) return list;
    return list.filter(
      (e) =>
        e.fullName?.toLowerCase().includes(q) ||
        e.employeeCode?.toLowerCase().includes(q) ||
        e.email?.toLowerCase().includes(q) ||
        (e.department && e.department.toLowerCase().includes(q)) ||
        (e.designation && e.designation.toLowerCase().includes(q))
    );
  });

  protected readonly empModalTotalPages = computed(() => {
    const count = this.filteredModalEmployees().length;
    const size = this.empModalPageSize();
    return Math.max(1, Math.ceil(count / size));
  });

  protected readonly pagedModalEmployees = computed(() => {
    const list = this.filteredModalEmployees();
    const page = this.empModalPage();
    const size = this.empModalPageSize();
    const start = (page - 1) * size;
    return list.slice(start, start + size);
  });

  protected readonly empModalStartIndex = computed(() => {
    const total = this.filteredModalEmployees().length;
    if (total === 0) return 0;
    return (this.empModalPage() - 1) * this.empModalPageSize() + 1;
  });

  protected readonly empModalEndIndex = computed(() => {
    const total = this.filteredModalEmployees().length;
    return Math.min(this.empModalPage() * this.empModalPageSize(), total);
  });

  protected changeEmpModalPage(page: number): void {
    if (page >= 1 && page <= this.empModalTotalPages()) {
      this.empModalPage.set(page);
    }
  }

  protected onEmpModalSearchChange(val: string): void {
    this.empModalSearch.set(val);
    this.empModalPage.set(1);
  }

  protected toggleCompanyStatus(company: CompanyListItem): void {
    if (company.isDefault) {
      this.toast.show('The primary default company cannot be suspended', 'warning');
      return;
    }
    const isSuspended = (company.status || '').toLowerCase() === 'suspended';
    if (isSuspended) {
      this.activateCompany(company);
    } else {
      this.suspendCompany(company);
    }
  }

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

    // 1. Filter by status pill
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
    sessionStorage.removeItem('current_tenant');
    if (this.session.user()?.companyCode) {
      this.session.updateUser({ companyCode: undefined, companyName: undefined, companyId: undefined });
    }
    this.searchQuery.set('');
    this.refreshAll();

    // Dynamically update tenant organizations
    this.pollTimer = setInterval(() => {
      if (!this.showDetailsModal() && !this.showCreateOrgModal()) {
        this.api
          .tenantCompanies()
          .pipe(catchError(() => of([] as CompanyListItem[])))
          .subscribe({
            next: (list) => {
              this.companies.set(list || []);
            },
            error: () => {},
          });
      }
    }, 15000);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
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
    this.empModalPage.set(1);
    this.empModalSearch.set('');
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

  protected confirmDeleteCompany(company: CompanyListItem): void {
    if (company.isDefault) {
      this.toast.show('The primary default company cannot be deleted', 'danger');
      return;
    }
    this.companyToDelete.set(company);
    this.showDeleteCompanyModal.set(true);
  }

  protected closeDeleteCompanyModal(): void {
    if (this.isDeletingCompany()) return;
    this.showDeleteCompanyModal.set(false);
    this.companyToDelete.set(null);
  }

  protected deleteCompanyConfirmed(): void {
    const c = this.companyToDelete();
    if (!c) return;

    this.isDeletingCompany.set(true);
    this.api.deleteTenantCompany(c.id).subscribe({
      next: () => {
        this.isDeletingCompany.set(false);
        this.showDeleteCompanyModal.set(false);
        this.companyToDelete.set(null);
        this.toast.show(`Company '${c.name}' and its database were deleted successfully.`, 'success');
        this.refreshAll();
      },
      error: (err) => {
        this.isDeletingCompany.set(false);
        this.toast.show(err?.error?.message || 'Failed to delete company and drop database', 'danger');
      },
    });
  }
}
