import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import jsPDF from 'jspdf';
import { ApiService } from '../../core/api/api.service';
import { CompanySettings, Payslip, PayrollRun } from '../../core/api/api.models';
import { IconDirective } from '../../core/icons/icon.directive';
import { PermissionService } from '../../core/services/permission.service';
import { ToastService } from '../../core/services/toast.service';
import { UiService } from '../../core/services/ui.service';
import { CurrencyService } from '../../core/services/currency.service';
import { amountInWords } from '../../core/utils/payroll-utils';

export interface ComprehensivePayrollRow {
  empId: string;
  fullEmpId?: string;
  name: string;
  department: string;
  designation: string;
  fullDay: number;
  halfDay: number;
  offDay: number;
  paidLeave: number;
  unpaidLeave: number;
  overtimeHours: number;
  loanAdvance: number;
  basicSalary: number;
  allowances: number;
  deductions: number;
  grossEarnings: number;
  netPay: number;
  status: 'Processed' | 'Pending' | 'On Hold';
  bankName?: string;
  accountNumber?: string;
  ifscCode?: string;
  reductionPercent?: number;
}

@Component({
  selector: 'app-payroll',
  imports: [CommonModule, FormsModule, IconDirective],
  template: `
    <div class="flex justify-end items-center" style="margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
      <div class="flex gap-2">
        <button class="btn btn-outline btn-sm" style="display: flex; align-items: center; gap: 6px;" (click)="exportCsv()">
          <span [appIcon]="'download'"></span> Export CSV
        </button>
        @if (perms.canCreate('Payroll')) {
          <button class="btn btn-primary btn-sm" style="display: flex; align-items: center; gap: 6px;" (click)="openRunModal()">
            <span [appIcon]="'arrow_right'"></span> Run Payroll
          </button>
        }
      </div>
    </div>

    <!-- KPIs (3-Card Summary: Gross, Deductions, Net) -->
    <div class="payroll-kpis-grid">
      @for (k of kpis(); track k.l) {
        <div class="kpi-card payroll-kpi-card">
          <div class="kpi-icon" [style.background]="k.c + '18'" [style.color]="k.c">
            <span [appIcon]="'money'"></span>
          </div>
          <div class="kpi-value payroll-kpi-val">{{ k.v }}</div>
          <div class="kpi-label payroll-kpi-lbl">{{ k.l }}</div>
        </div>
      }
    </div>

    <!-- Payroll Tabs -->
    <div class="tabs-nav-bar" style="display: flex; gap: 8px; border-bottom: 1px solid var(--border); margin-bottom: 20px;">
      <button 
        class="tab-btn" 
        [style.border-bottom]="activeTab() === 'monthly' ? '2.5px solid var(--p)' : 'none'"
        [style.color]="activeTab() === 'monthly' ? 'var(--p)' : 'var(--muted)'"
        [style.font-weight]="activeTab() === 'monthly' ? '700' : '500'"
        style="padding: 10px 18px; font-size: 13px; border: none; background: transparent; cursor: pointer;"
        (click)="activeTab.set('monthly')"
      >
        Monthly Payroll
      </button>
      <button 
        class="tab-btn" 
        [style.border-bottom]="activeTab() === 'history' ? '2.5px solid var(--p)' : 'none'"
        [style.color]="activeTab() === 'history' ? 'var(--p)' : 'var(--muted)'"
        [style.font-weight]="activeTab() === 'history' ? '700' : '500'"
        style="padding: 10px 18px; font-size: 13px; border: none; background: transparent; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;"
        (click)="activeTab.set('history')"
      >
        <span>Payroll History</span>
       
      </button>
    </div>

    @if (activeTab() === 'monthly') {
    <!-- Payroll Register Card -->
    <div class="card">
      <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div class="card-title">Payroll Register</div>
        
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <!-- Hidden anti-autofill decoys to trap password manager autofill -->
          <input type="text" style="display:none" aria-hidden="true" autocomplete="username" tabindex="-1" />
          <input type="password" style="display:none" aria-hidden="true" autocomplete="current-password" tabindex="-1" />

          <!-- Instant Search Input with Icon and Clear Button -->
          <div style="position: relative; display: flex; align-items: center;">
            <span style="position: absolute; left: 10px; color: var(--muted); pointer-events: none; display: flex;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </span>
            <input 
              #searchInput
              type="search" 
              id="payroll_search_filter_query"
              name="payroll_search_filter_query"
              class="form-control" 
              placeholder="Search employee or code..." 
              style="width: 220px; font-size: 12px; padding: 6px 28px 6px 30px;"
              [value]="searchKeyword()"
              [readOnly]="isSearchReadonly()"
              (focus)="enableSearchEdit()"
              (pointerdown)="enableSearchEdit()"
              (keydown)="onSearchKeydown()"
              (input)="onSearchInput($any($event.target).value, $event)"
              (change)="onSearchInput($any($event.target).value, $event)"
              (search)="onSearchInput($any($event.target).value, $event)"
              autocomplete="new-password"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
              data-lpignore="true"
              data-1p-ignore="true"
              data-bwignore="true"
              data-form-type="other"
              role="searchbox"
            />
            @if (searchKeyword()) {
              <button 
                type="button" 
                (click)="clearSearch()"
                style="position: absolute; right: 8px; background: none; border: none; font-size: 13px; cursor: pointer; color: var(--muted); padding: 2px 4px; display: flex; align-items: center;"
                title="Clear search"
              >
                ✕
              </button>
            }
          </div>

          <select 
            class="form-control" 
            style="width: 140px; font-size: 12px; padding: 6px 10px;"
            [value]="selectedDept()"
            (change)="selectedDept.set($any($event.target).value)"
          >
            <option value="">All Departments</option>
            <option value="Engineering">Engineering</option>
            <option value="Finance">Finance</option>
            <option value="HR">HR</option>
            <option value="Sales">Sales</option>
            <option value="Marketing">Marketing</option>
            <option value="Design">Design</option>
          </select>
          <input 
            type="month" 
            class="form-control" 
            style="width: 140px; font-size: 12px; padding: 6px 10px;"
            [value]="selectedMonth()" 
            (change)="onMonthChange($any($event.target).value)"
          />
        </div>
      </div>

      <div class="table-wrap payroll-scroll-container" style="max-height: 380px; overflow-y: auto; overflow-x: auto;">
        <table style="min-width: 1000px; width: 100%;">
          <thead style="position: sticky; top: 0; z-index: 5; background: var(--card-bg, #ffffff);">
            <tr>
              <th style="min-width: 180px; background: inherit;">Employee</th>
              <th style="background: inherit;">Department</th>
              <th style="background: inherit;">Designation</th>
              <th style="background: inherit;">Full Day</th>
              <th style="background: inherit;">Half Day</th>
              <th style="background: inherit;">Paid Leave</th>
              <th style="background: inherit;">Unpaid</th>
              <th style="background: inherit;">Gross</th>
              <th style="background: inherit;">Deductions</th>
              <th style="background: inherit;">Net Pay</th>
              <th style="background: inherit;">Status</th>
              <th style="background: inherit;">Action</th>
            </tr>
          </thead>
          <tbody>
            @for (r of filteredRows(); track (r.empId + '_' + r.name + '_' + $index)) {
              <tr>
                <td>
                  <div class="table-avatar">
                    <div class="avatar-placeholder avatar-sm" style="background: var(--p-soft); color: var(--p); font-weight: 700;">
                      {{ r.name.charAt(0) }}
                    </div>
                    <div>
                      <div style="font-weight: 700; font-size: 13px;">{{ r.name }}</div>
                      <div style="font-size: 11px; color: var(--muted);">{{ r.empId }}</div>
                    </div>
                  </div>
                </td>
                <td><span class="badge badge-primary">{{ r.department }}</span></td>
                <td style="font-size: 12px; color: var(--muted);">{{ r.designation }}</td>
                <td style="font-weight: 600;">
                  {{ r.fullDay }}
                  @if (isCurrentOngoingMonth() && daysLeftInMonth() > 0) {
                    <span style="font-size: 11px; font-weight: 600; color: #d97706; margin-left: 3px;" [attr.data-tooltip]="daysLeftInMonth() + ' working days remaining in ' + activeMonthLabel()">
                      ({{ daysLeftInMonth() }} days left)
                    </span>
                  }
                </td>
                <td style="color: var(--warning); font-weight: 600;">{{ r.halfDay }}</td>
                <td style="color: var(--success); font-weight: 600;">{{ r.paidLeave }}</td>
                <td style="color: var(--danger); font-weight: 600;">{{ r.unpaidLeave }}</td>
                <td style="font-weight: 700;">{{ currencySymbol() + r.grossEarnings.toLocaleString() }}</td>
                <td style="color: var(--danger); font-weight: 600;">
                  {{ '-' + currencySymbol() + r.deductions.toLocaleString() }}
                  @if (r.reductionPercent && r.reductionPercent > 0) {
                    <span style="font-size: 11px; font-weight: 700; color: #ef4444; margin-left: 3px;">({{ r.reductionPercent }}%)</span>
                  }
                </td>
                <td style="font-weight: 800; color: var(--p);">{{ currencySymbol() + r.netPay.toLocaleString() }}</td>
                <td>
                  <span class="badge" [class]="statusClass(r.status)">{{ r.status }}</span>
                </td>
                <td>
                  <button class="btn btn-ghost btn-sm" (click)="openPayslip(r)" data-tooltip="View Payslip">
                    <span [appIcon]="'receipt'"></span>
                  </button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="12" style="text-align: center; padding: 24px; color: var(--muted);">
                  No payroll records found for this period.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <!-- Table Footer Actions: View Payslips for Month button behind the table -->
      <div style="display: flex; justify-content: flex-end; align-items: center; padding: 14px 20px; border-top: 1px solid var(--border); background: #fafafa;">
        <button class="btn btn-primary" (click)="goToPayslipsForMonth()" style="display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px;">
          <span>View Payslips for {{ activeMonthLabel() }}</span>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14"></path>
            <path d="m12 5 7 7-7 7"></path>
          </svg>
        </button>
      </div>
    </div>
    }

    <!-- Payroll History Card -->
    @if (activeTab() === 'history') {
      <div class="card">
        <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
          <div>
            <div class="card-title">Payroll Cycle History</div>
            <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">
              All historical payroll runs processed. HR Managers can view records or remove cycles to recalculate.
            </div>
          </div>
    
        </div>

        <div class="table-responsive payroll-scroll-container" style="max-height: 380px; overflow-y: auto; overflow-x: auto;">
          <table class="table" style="width: 100%;">
            <thead style="position: sticky; top: 0; z-index: 5; background: var(--card-bg, #ffffff);">
              <tr>
                <th style="background: inherit;">Pay Period</th>
                <th style="background: inherit;">Disbursement Date</th>
                <th style="background: inherit;">Employees</th>
                <th style="background: inherit;">Gross Payroll</th>
                <th style="background: inherit;">Total Deductions</th>
                <th style="background: inherit;">Net Payable</th>
                <th style="background: inherit;">Status</th>
                <th style="text-align: right; background: inherit;">Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (r of payrollRuns(); track r.id) {
                <tr>
                  <td style="font-weight: 700; color: var(--p);">
                    {{ formatRunMonth(r) }}
                  </td>
                  <td>{{ r.payDate }}</td>
                  <td>
                    <span class="badge" style="background: var(--bg); border: 1px solid var(--border);">
                      {{ r.employeeCount }} Staff
                    </span>
                  </td>
                  <td style="font-weight: 600;">{{ currencySymbol() + r.totalGross.toLocaleString() }}</td>
                  <td style="color: var(--danger); font-weight: 600;">-{{ currencySymbol() + r.totalDeductions.toLocaleString() }}</td>
                  <td style="color: var(--success); font-weight: 700;">{{ currencySymbol() + r.totalNet.toLocaleString() }}</td>
                  <td>
                    <span class="badge badge-success">{{ r.status }}</span>
                  </td>
                  <td style="text-align: right;">
                    <div style="display: inline-flex; gap: 8px; align-items: center;">
                      <button class="btn btn-outline btn-sm" (click)="viewRunMonth(r)">
                        View Month
                      </button>
                      <button class="btn btn-outline-danger btn-sm" (click)="promptDeleteRun(r, $event)" title="Delete Payroll Run">
                        <span [appIcon]="'trash-2'"></span> Remove
                      </button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="8" style="text-align: center; padding: 32px; color: var(--muted);">
                    No completed payroll cycles recorded yet. Run a payroll cycle from the Monthly Payroll tab.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }

    <!-- Modal: Delete Payroll Run Confirmation -->
    @if (runToDelete()) {
      <div class="modal-overlay open" (click)="runToDelete.set(null)">
        <div class="modal" style="max-width: 440px;" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <div style="font-size: 1.1rem; font-weight: 700; color: #dc2626;">Delete Payroll Run</div>
            <button class="btn btn-ghost btn-sm" (click)="runToDelete.set(null)"><span [appIcon]="'x'"></span></button>
          </div>
          <div class="modal-body" style="padding: 16px 20px;">
            <p style="font-size: 13px; color: var(--text); margin-bottom: 12px;">
              Are you sure you want to remove the payroll run for <strong>{{ formatRunMonth(runToDelete()!) }}</strong>?
            </p>
            <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 12px; font-size: 12px; color: #991b1b;">
              ⚠️ This will delete all generated payslips for this month, reset employee statuses back to Pending, and allow HR to recalculate or re-run payroll.
            </div>
          </div>
          <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px;">
            <button class="btn btn-outline" (click)="runToDelete.set(null)" [disabled]="deletingRun()">Cancel</button>
            <button class="btn btn-danger" (click)="confirmDeleteRun()" [disabled]="deletingRun()">
              @if (deletingRun()) {
                Deleting...
              } @else {
                Yes, Delete Run
              }
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Modal: Run Payroll with Preflight Checks -->
    @if (showRunModal()) {
      <div class="modal-overlay open" (click)="showRunModal.set(false)">
        <div class="modal" style="max-width: 520px;" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <div>
              <div style="font-size: 1.15rem; font-weight: 800;">Run Payroll Cycle</div>
              <div style="font-size: 11.5px; color: var(--muted); margin-top: 2px;">Cycle Parameters &amp; HR Pre-Flight Verification</div>
            </div>
            <button class="btn btn-ghost btn-sm" (click)="showRunModal.set(false)"><span [appIcon]="'x'"></span></button>
          </div>
          <div class="modal-body">
            <div class="grid-2" style="gap: 12px; margin-bottom: 12px;">
              <div class="form-group" style="margin-bottom: 0;">
                <label class="form-label">Pay Period Month</label>
                <input class="form-control" type="month" [(ngModel)]="runForm.month" (ngModelChange)="checkPreflight()" />
              </div>
              <div class="form-group" style="margin-bottom: 0;">
                <label class="form-label"> Pay Date</label>
                <input class="form-control" type="date" [(ngModel)]="runForm.payDate" />
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Payment Transfer Method</label>
              <select class="form-control" [(ngModel)]="runForm.method">
                <option value="wps">Bank Direct Deposit (WPS)</option>
                <option value="bank">Direct Bank Transfer (NEFT/RTGS)</option>
                <option value="cheque">Corporate Cheque</option>
                <option value="cash">Petty Cash Disbursement</option>
              </select>
            </div>

            <!-- Optional Company-Wide Salary Reduction / Cut Filter -->
            <div class="form-group" style="margin-top: 12px;">
              <label class="form-label" style="font-weight: 700; font-size: 12px;">Salary Reduction / Deduction (% of Total)</label>
              <select class="form-control" [(ngModel)]="runForm.reductionPercent">
                <option [ngValue]="0">None (0% - Standard Full Salary)</option>
                <option [ngValue]="5">5% Salary Reduction</option>
                <option [ngValue]="10">10% Salary Reduction</option>
                <option [ngValue]="15">15% Salary Reduction</option>
                <option [ngValue]="20">20% Salary Reduction</option>
                <option [ngValue]="25">25% Salary Reduction</option>
              </select>
              <div style="font-size: 11px; color: var(--muted); margin-top: 3px;">
                Optional company-wide percentage deduction applied across all basic salaries for this cycle.
              </div>
            </div>

            <!-- Pre-Flight Verification Check Card -->
            <div style="border-radius: 10px; border: 1.5px solid var(--border); overflow: hidden; margin-top: 14px;">
              <div style="background: var(--bg); padding: 9px 14px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border);">
                <div style="font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 6px;">
                  <span [appIcon]="'check'" style="color: var(--p);"></span> HR Pre-Flight Work Check
                </div>
                @if (isCheckingPreflight()) {
                  <span style="font-size: 11px; color: var(--muted);">Auditing requests...</span>
                }
              </div>

              <div style="padding: 12px 14px;">
                @if (isCheckingPreflight()) {
                  <div style="display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); padding: 8px 0;">
                    <span class="spinner-sm"></span> Auditing pending leaves & compulsory bank details in {{ runForm.month }}...
                  </div>
                } @else if (preflightResult() && (preflightResult()!.pendingLeavesCount > 0 || (preflightResult()!.missingBankDetailsCount || 0) > 0)) {
                  <!-- Warning Box: Blocks Payroll Run -->
                  <div style="display: flex; flex-direction: column; gap: 10px;">
                    @if ((preflightResult()!.missingBankDetailsCount || 0) > 0) {
                      <div style="background: rgba(239,68,68,0.08); border: 1.5px solid rgba(239,68,68,0.3); border-radius: 8px; padding: 12px;">
                        <div style="display: flex; align-items: flex-start; gap: 10px;">
                          <span [appIcon]="'alert_triangle'" style="color: var(--danger); font-size: 1.3rem; flex-shrink: 0; margin-top: 1px;"></span>
                          <div style="flex: 1;">
                            <div style="font-weight: 800; color: var(--danger); font-size: 13px;">
                              Compulsory Action: {{ preflightResult()!.missingBankDetailsCount }} Active Employee(s) Missing Bank Details
                            </div>
                            <div style="font-size: 12px; color: var(--text); margin-top: 4px; line-height: 1.4;">
                              Missing Bank A/c No. or IFSC Code: <b>{{ preflightResult()!.missingBankEmployeeNames?.join(', ') }}</b>
                            </div>
                            <div style="font-size: 11.5px; color: var(--muted); margin-top: 4px; line-height: 1.4;">
                              ⚠️ Bank details (Bank A/c No. &amp; IFSC Code) are compulsory for payroll processing and disbursement. Please update their profile bank details before running payroll.
                            </div>
                          </div>
                        </div>
                      </div>
                    }

                    @if (preflightResult()!.pendingLeavesCount > 0) {
                      <div style="background: rgba(245,158,11,0.08); border: 1.5px solid rgba(245,158,11,0.3); border-radius: 8px; padding: 12px;">
                        <div style="display: flex; align-items: flex-start; gap: 10px;">
                          <span [appIcon]="'alert_triangle'" style="color: #d97706; font-size: 1.3rem; flex-shrink: 0; margin-top: 1px;"></span>
                          <div style="flex: 1;">
                            <div style="font-weight: 800; color: #b45309; font-size: 13px;">
                              Action Required: {{ preflightResult()!.pendingLeavesCount }} Pending Leave Request(s)
                            </div>
                            <div style="font-size: 12px; color: var(--text); margin-top: 4px; line-height: 1.4;">
                              Pending requests: <b>{{ preflightResult()!.pendingEmployeeNames.join(', ') }}</b>
                            </div>
                            <div style="font-size: 11px; color: var(--muted); margin-top: 4px; line-height: 1.4;">
                              ⚠️ Unresolved leaves directly skew Unpaid Leave (LOP) calculations. Please approve or reject pending requests first.
                            </div>
                          </div>
                        </div>
                      </div>
                    }
                  </div>
                } @else {
                  <!-- All Checks Passed -->
                  <div style="background: rgba(16,185,129,0.08); border: 1.5px solid rgba(16,185,129,0.3); border-radius: 8px; padding: 10px 12px; display: flex; align-items: center; gap: 10px;">
                    <div style="width: 24px; height: 24px; border-radius: 50%; background: #10b981; color: white; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 800; flex-shrink: 0;">✓</div>
                    <div>
                      <div style="font-weight: 700; color: #065f46; font-size: 12.5px;">All HR Pre-Flight Checks Passed</div>
                      <div style="font-size: 11px; color: #047857; margin-top: 1px;">All active employees have verified bank details and all leaves are resolved for {{ runForm.month }}. Ready for authorization.</div>
                    </div>
                  </div>
                }
              </div>
            </div>

            <div style="background: var(--p-soft); border-radius: 8px; padding: 10px 12px; margin-top: 12px; font-size: 12px; color: var(--text); line-height: 1.4;">
              ⚡ Running payroll executes automated salary calculation (1 unpaid leave = 1 day salary deduction), creates tenant disbursement records, and generates individual payslips for all active staff.
            </div>
          </div>
          <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">
            <button class="btn btn-outline" [disabled]="runningPayroll()" (click)="showRunModal.set(false)">Cancel</button>
            
            @if (preflightResult() && (preflightResult()!.missingBankDetailsCount || 0) > 0) {
              <button class="btn btn-danger" disabled style="opacity: 0.65; cursor: not-allowed;" title="Fill missing bank details first">
                Fill Missing Bank Details First
              </button>
            } @else if (preflightResult() && preflightResult()!.pendingLeavesCount > 0) {
              <button class="btn btn-danger" disabled style="opacity: 0.65; cursor: not-allowed;" title="Resolve all pending leaves first">
                Resolve Pending Leaves First
              </button>
            } @else {
              <button class="btn btn-primary" [disabled]="isCheckingPreflight() || runningPayroll()" (click)="executeRunPayroll()">
                Confirm &amp; Run Payroll
              </button>
            }
          </div>
        </div>
      </div>
    }

    <!-- Modal: Kautilyam-Style Payslip Preview -->
    @if (selectedRow()) {
      <div class="modal-overlay open" (click)="selectedRow.set(null)">
        <div class="modal" style="max-width: 680px;" (click)="$event.stopPropagation()">
          <div class="modal-header" style="border-bottom: none; padding-bottom: 6px;">
            <div style="font-size: 1.15rem; font-weight: 800;">Payslip Summary</div>
            <button class="btn btn-ghost btn-sm" (click)="selectedRow.set(null)"><span [appIcon]="'x'"></span></button>
          </div>
          
          <div class="modal-body" style="padding-top: 0;">
            <!-- Document Container (Matching Kautilyam Layout) -->
            <div style="border: 1.5px solid var(--border); border-radius: 12px; overflow: hidden; background: #fff; color: #1f2937; box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
              
              <!-- Payslip Top Header -->
              <div style="text-align: center; padding: 16px 20px; border-bottom: 1.5px solid #e5e7eb; background: #fbfbfc;">
                <div style="font-size: 1.45rem; font-weight: 900; letter-spacing: 0.04em; color: #111827;">{{ company()?.companyName || 'HRNexus Corp' }}</div>
                <div style="font-size: 11px; color: #4b5563; margin-top: 4px; line-height: 1.4;">
                  {{ companyAddress() }}
                </div>
                <div style="font-size: 12px; font-weight: 700; color: #2563eb; margin-top: 6px;">
                  Payslip for the period of {{ activeMonthLabel() }}
                </div>
              </div>

              <!-- Two-Column Employee & Bank Details -->
              <div style="display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1.5px solid #e5e7eb; font-size: 12px;">
                <!-- Left: Employee Details -->
                <div style="padding: 12px 16px; border-right: 1.5px solid #e5e7eb;">
                  <div style="display: grid; grid-template-columns: 120px 1fr; row-gap: 5px;">
                    <span style="color: #6b7280;">Employee Name</span>
                    <span style="font-weight: 700; color: #111827;">: {{ selectedRow()?.name }}</span>

                    <span style="color: #6b7280;">Employee Code</span>
                    <span style="font-weight: 600; color: #111827;">: {{ selectedRow()?.empId }}</span>

                    <span style="color: #6b7280;">Designation</span>
                    <span style="font-weight: 600; color: #111827;">: {{ selectedRow()?.designation }}</span>

                    <span style="color: #6b7280;">Department</span>
                    <span style="font-weight: 600; color: #111827;">: {{ selectedRow()?.department }}</span>

                    <span style="color: #6b7280;">Date of Joining</span>
                    <span style="font-weight: 600; color: #111827;">: —</span>

                    <span style="color: #6b7280;">Work Location</span>
                    <span style="font-weight: 600; color: #111827;">: {{ company()?.city || '—' }}</span>
                  </div>
                </div>

                <!-- Right: Bank Details -->
                <div style="padding: 12px 16px;">
                  <div style="display: grid; grid-template-columns: 110px 1fr; row-gap: 5px;">
                    <span style="color: #6b7280;">Bank Name</span>
                    <span style="font-weight: 600; color: #111827;">: {{ selectedRow()?.bankName || '—' }}</span>

                    <span style="color: #6b7280;">Bank A/c No.</span>
                    <span style="font-weight: 600; color: #111827;">: {{ selectedRow()?.accountNumber || '—' }}</span>

                    <span style="color: #6b7280;">IFSC Code</span>
                    <span style="font-weight: 600; color: #111827;">: {{ selectedRow()?.ifscCode || '—' }}</span>

                    <span style="color: #6b7280;">Branch Name</span>
                    <span style="font-weight: 600; color: #111827;">: —</span>

                    <span style="color: #6b7280;">PF No / UAN</span>
                    <span style="font-weight: 600; color: #111827;">: —</span>

                    <span style="color: #6b7280;">ESIC No</span>
                    <span style="font-weight: 600; color: #111827;">: —</span>
                  </div>
                </div>
              </div>

              <!-- Working Days & Attendance Summary Box -->
              <div style="padding: 10px 16px; background: #f9fafb; border-bottom: 1.5px solid #e5e7eb; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; font-size: 11.5px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-weight: 800; font-size: 12px; color: #111827;">Total Payable Days:</span>
                  <span style="background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 4px; font-weight: 800; font-size: 13px;">
                    {{ selectedRow()?.fullDay ?? 30 }}
                  </span>
                </div>
                <div style="display: flex; gap: 16px; color: #4b5563;">
                  <span>Worked Day: <b>{{ selectedRow()?.fullDay ?? 21 }}</b></span>
                  <span>Weekly Off: <b>{{ selectedRow()?.offDay ?? 8 }}</b></span>
                  <span>Holiday: <b>0</b></span>
                  <span>Unpaid (LOP): <b style="color: #dc2626;">{{ selectedRow()?.unpaidLeave ?? 0 }}</b></span>
                  <span>Paid Leaves: <b>{{ selectedRow()?.paidLeave ?? 0 }}</b></span>
                </div>
              </div>

              <!-- Side-by-Side Earnings & Deductions Tables -->
              <div style="display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1.5px solid #e5e7eb;">
                <!-- Earnings Column -->
                <div style="border-right: 1.5px solid #e5e7eb;">
                  <div style="background: #f3f4f6; padding: 7px 14px; font-weight: 800; font-size: 12px; color: #111827; display: flex; justify-content: space-between;">
                    <span>Earnings</span>
                    <span>Amount ({{ currencySymbol() }})</span>
                  </div>
                  <div style="padding: 10px 14px; font-size: 12px; min-height: 85px;">
                    <div style="display: flex; justify-content: space-between; padding: 4px 0;">
                      <span>Basic Salary</span>
                      <span style="font-weight: 600;">{{ currencySymbol() }}{{ selectedRow()?.basicSalary?.toLocaleString() ?? '0' }}.00</span>
                    </div>
                  </div>
                  <div style="background: #f9fafb; padding: 8px 14px; border-top: 1px solid #e5e7eb; font-weight: 800; font-size: 12px; display: flex; justify-content: space-between;">
                    <span>Total Gross Earnings</span>
                    <span style="color: #059669;">{{ currencySymbol() }}{{ selectedRow()?.grossEarnings?.toLocaleString() ?? '0' }}.00</span>
                  </div>
                </div>

                <!-- Deductions Column -->
                <div>
                  <div style="background: #f3f4f6; padding: 7px 14px; font-weight: 800; font-size: 12px; color: #111827; display: flex; justify-content: space-between;">
                    <span>Deductions</span>
                    <span>Amount ({{ currencySymbol() }})</span>
                  </div>
                  <div style="padding: 10px 14px; font-size: 12px; min-height: 85px;">
                    @if (selectedRow()?.unpaidLeave && selectedRow()!.unpaidLeave > 0) {
                      <div style="display: flex; justify-content: space-between; padding: 4px 0;">
                        <span>Unpaid Leave (LOP) ({{ selectedRow()?.unpaidLeave }} days)</span>
                        <span style="font-weight: 600; color: #dc2626;">
                          -{{ currencySymbol() }}{{ ((selectedRow()!.unpaidLeave * selectedRow()!.basicSalary) / (selectedRow()!.fullDay || 22)).toFixed(2) }}
                        </span>
                      </div>
                    }
                    @if (selectedRow()?.reductionPercent && selectedRow()!.reductionPercent! > 0) {
                      <div style="display: flex; justify-content: space-between; padding: 4px 0;">
                        <span>Salary Reduction ({{ selectedRow()?.reductionPercent }}%)</span>
                        <span style="font-weight: 600; color: #dc2626;">
                          -{{ currencySymbol() }}{{ (selectedRow()!.deductions - ((selectedRow()?.unpaidLeave || 0) * selectedRow()!.basicSalary) / (selectedRow()!.fullDay || 22)).toFixed(2) }}
                        </span>
                      </div>
                    }
                    @if (!selectedRow()?.unpaidLeave && (!selectedRow()?.reductionPercent || selectedRow()?.reductionPercent === 0)) {
                      <div style="display: flex; justify-content: space-between; padding: 4px 0; color: var(--muted);">
                        <span>No deductions applied</span>
                        <span>{{ currencySymbol() }}0.00</span>
                      </div>
                    }
                  </div>
                  <div style="background: #f9fafb; padding: 8px 14px; border-top: 1px solid #e5e7eb; font-weight: 800; font-size: 12px; display: flex; justify-content: space-between;">
                    <span>Total Deductions</span>
                    <span style="color: #dc2626;">
                      -{{ currencySymbol() }}{{ selectedRow()?.deductions?.toLocaleString() ?? '0' }}.00
                      @if (selectedRow()?.reductionPercent && selectedRow()!.reductionPercent! > 0) {
                        <span style="font-size: 11px; margin-left: 3px;">({{ selectedRow()?.reductionPercent }}% cut)</span>
                      }
                    </span>
                  </div>
                </div>
              </div>

              <!-- Total Net Payable Emerald Banner -->
              <div style="background: #ecfdf5; border: 1.5px solid #10b981; margin: 14px; border-radius: 8px; padding: 12px 16px;">
                <div style="display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px;">
                  <div style="font-size: 14px; font-weight: 800; color: #065f46;">
                    Total Net Payable: <span style="font-size: 17px; font-weight: 900; color: #047857;">{{ currencySymbol() }}{{ selectedRow()?.netPay?.toLocaleString() ?? '0' }}.00</span>
                  </div>
                  <div style="font-size: 11px; color: #059669; font-weight: 600;">
                    Total Net Payable = Gross Earnings - Total Deductions
                  </div>
                </div>
                <div style="font-size: 11.5px; color: #047857; margin-top: 6px; font-weight: 600;">
                  Amount in Words: <i>{{ getNetPayInWords(selectedRow()?.netPay ?? 0) }}</i>
                </div>
              </div>

              <!-- Disclaimer Footer -->
              <div style="text-align: center; padding: 10px; font-size: 10.5px; color: #9ca3af; border-top: 1px solid #f3f4f6;">
                This PDF is system-generated, no signature required.
              </div>
            </div>
          </div>

          <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <button class="btn btn-outline" (click)="selectedRow.set(null)">Close</button>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-outline" (click)="openFullPayslip(selectedRow()!)">View Full Payslip</button>
              <button class="btn btn-primary" (click)="downloadModalPayslip()">Download PDF</button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      input[type="search"]::-webkit-search-decoration,
      input[type="search"]::-webkit-search-cancel-button,
      input[type="search"]::-webkit-search-results-button,
      input[type="search"]::-webkit-search-results-decoration {
        -webkit-appearance: none;
        appearance: none;
        display: none !important;
      }
      input[type="search"]::-ms-clear,
      input[type="search"]::-ms-reveal {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
      }
      .payroll-scroll-container {
        scrollbar-width: thin;
        scrollbar-color: #cbd5e1 #f1f5f9;
      }
      .payroll-scroll-container::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }
      .payroll-scroll-container::-webkit-scrollbar-track {
        background: #f1f5f9;
        border-radius: 4px;
      }
      .payroll-scroll-container::-webkit-scrollbar-thumb {
        background: #cbd5e1;
        border-radius: 4px;
      }
      .payroll-scroll-container::-webkit-scrollbar-thumb:hover {
        background: #94a3b8;
      }
      .payroll-kpis-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 16px;
        margin-bottom: 20px;
      }
      .payroll-kpi-val {
        font-size: 1.35rem;
      }
      @media (max-width: 768px) {
        .payroll-kpis-grid {
          gap: 8px;
          margin-bottom: 14px;
        }
        .payroll-kpi-card {
          padding: 10px 8px !important;
          border-radius: 8px !important;
        }
        .payroll-kpi-card .kpi-icon {
          width: 30px !important;
          height: 30px !important;
          margin-bottom: 4px !important;
        }
        .payroll-kpi-val {
          font-size: 1.05rem !important;
          font-weight: 800 !important;
          line-height: 1.2 !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }
        .payroll-kpi-lbl {
          font-size: 11px !important;
          line-height: 1.2 !important;
          margin-top: 2px !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }
      }
      @media (max-width: 440px) {
        .payroll-kpis-grid {
          gap: 6px;
        }
        .payroll-kpi-card {
          padding: 8px 6px !important;
        }
        .payroll-kpi-card .kpi-icon {
          width: 26px !important;
          height: 26px !important;
        }
        .payroll-kpi-val {
          font-size: 0.92rem !important;
          letter-spacing: -0.02em !important;
        }
        .payroll-kpi-lbl {
          font-size: 10px !important;
        }
      }
    `,
  ],
})
export class PayrollComponent implements OnInit, AfterViewInit {
  protected readonly ui = inject(UiService);
  protected readonly toast = inject(ToastService);
  protected readonly perms = inject(PermissionService);
  protected readonly currencyService = inject(CurrencyService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  protected readonly tab = signal<'monthly'>('monthly');
  protected readonly activeTab = signal<'monthly' | 'history'>('monthly');
  protected readonly payrollRuns = signal<PayrollRun[]>([]);
  protected readonly runToDelete = signal<PayrollRun | null>(null);
  protected readonly deletingRun = signal(false);
  protected readonly showRunModal = signal(false);
  protected readonly runningPayroll = signal(false);
  protected readonly selectedRow = signal<ComprehensivePayrollRow | null>(null);

  protected readonly isCheckingPreflight = signal(false);
  protected readonly preflightResult = signal<{
    canRun: boolean;
    pendingLeavesCount: number;
    message: string;
    pendingEmployeeNames: string[];
    missingBankDetailsCount?: number;
    missingBankEmployeeNames?: string[];
  } | null>(null);

  protected readonly isSearchReadonly = signal(true);
  private userInteracted = false;

  @ViewChild('searchInput') set searchInputSetter(ref: ElementRef<HTMLInputElement> | undefined) {
    this.searchInputRef = ref;
    if (ref?.nativeElement && !this.userInteracted) {
      ref.nativeElement.value = '';
    }
  }
  private searchInputRef?: ElementRef<HTMLInputElement>;

  protected readonly searchKeyword = signal('');
  protected readonly selectedDept = signal('');
  protected readonly selectedMonth = signal(new Date().toISOString().slice(0, 7));

  protected runForm = {
    month: new Date().toISOString().slice(0, 7),
    payDate: new Date().toISOString().slice(0, 10),
    method: 'wps',
    reductionPercent: 0,
  };

  protected readonly company = signal<CompanySettings | null>(null);
  protected readonly companyAddress = computed(() => {
    const c = this.company();
    if (!c) return 'Corporate Headquarters';
    const parts = [c.address, c.city, c.country].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : 'Corporate Headquarters';
  });

  protected readonly currencySymbol = computed(() => {
    return this.currencyService.currencySymbol();
  });

  protected readonly kpis = signal([
    { l: 'Gross Payroll', v: '0', c: 'var(--p)' },
    { l: 'Total Deductions', v: '0', c: 'var(--danger)' },
    { l: 'Net Payable', v: '0', c: 'var(--success)' },
  ]);

  protected readonly rows = signal<ComprehensivePayrollRow[]>([]);

  protected readonly activeMonthLabel = computed(() => {
    const parts = this.selectedMonth().split('-');
    const year = parts[0];
    const month = parseInt(parts[1], 10) || 1;
    const name = new Date(parseInt(year, 10), month - 1, 1).toLocaleDateString('en-US', { month: 'long' });
    return `${name} ${year}`;
  });

  protected readonly isCurrentOngoingMonth = computed(() => {
    const [yearStr, monthStr] = this.selectedMonth().split('-');
    const selYear = parseInt(yearStr, 10);
    const selMonth = parseInt(monthStr, 10);
    const now = new Date();
    return selYear === now.getFullYear() && selMonth === (now.getMonth() + 1);
  });

  protected readonly daysLeftInMonth = computed(() => {
    if (!this.isCurrentOngoingMonth()) return 0;
    const [yearStr, monthStr] = this.selectedMonth().split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const now = new Date();
    const today = now.getDate();
    const daysInMonth = new Date(year, month, 0).getDate();

    // Remaining working days in the month from tomorrow to end of month
    let remaining = 0;
    for (let day = today + 1; day <= daysInMonth; day++) {
      const d = new Date(year, month - 1, day);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) {
        remaining++;
      }
    }
    return remaining;
  });

  protected readonly filteredRows = computed(() => {
    const q = this.searchKeyword().toLowerCase().trim();
    const d = this.selectedDept();
    return this.rows().filter((r) => {
      const matchQ =
        !q ||
        r.name.toLowerCase().includes(q) ||
        r.empId.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q) ||
        r.designation.toLowerCase().includes(q);
      const matchD = !d || r.department === d;
      return matchQ && matchD;
    });
  });

  protected enableSearchEdit(): void {
    this.isSearchReadonly.set(false);
    this.userInteracted = true;
  }

  protected onSearchKeydown(): void {
    this.isSearchReadonly.set(false);
    this.userInteracted = true;
  }

  protected onSearchInput(val: string, event?: Event): void {
    // If browser autofills an email or credential without user interaction
    if (!this.userInteracted && (val.includes('@') || !event?.isTrusted)) {
      this.searchKeyword.set('');
      if (this.searchInputRef?.nativeElement) {
        this.searchInputRef.nativeElement.value = '';
      }
      return;
    }
    this.userInteracted = true;
    this.searchKeyword.set(val || '');
  }

  protected clearSearch(): void {
    this.searchKeyword.set('');
    if (this.searchInputRef?.nativeElement) {
      this.searchInputRef.nativeElement.value = '';
    }
  }

  ngOnInit(): void {
    this.api.company().subscribe({
      next: (c) => this.company.set(c),
      error: () => { },
    });
    this.loadBackendPayroll();
  }

  ngAfterViewInit(): void {
    const clearIfAutofilled = () => {
      if (this.searchInputRef?.nativeElement && !this.userInteracted) {
        this.searchInputRef.nativeElement.value = '';
        this.searchKeyword.set('');
      }
    };
    setTimeout(clearIfAutofilled, 50);
    setTimeout(clearIfAutofilled, 150);
    setTimeout(clearIfAutofilled, 300);
    setTimeout(clearIfAutofilled, 600);
    setTimeout(clearIfAutofilled, 1200);
  }

  protected onMonthChange(newMonth: string): void {
    this.selectedMonth.set(newMonth);
    this.loadBackendPayroll();
    this.toast.show(`Loaded payroll register for ${this.activeMonthLabel()}`);
  }

  protected formatRunMonth(r: PayrollRun): string {
    const d = new Date(r.year, r.month - 1, 1);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  protected viewRunMonth(r: PayrollRun): void {
    const m = `${r.year}-${String(r.month).padStart(2, '0')}`;
    this.selectedMonth.set(m);
    this.activeTab.set('monthly');
    this.loadBackendPayroll();
    this.toast.show(`Switched to payroll register for ${this.formatRunMonth(r)}`);
  }

  protected promptDeleteRun(run: PayrollRun, event?: Event): void {
    event?.stopPropagation();
    this.runToDelete.set(run);
  }

  protected confirmDeleteRun(): void {
    const run = this.runToDelete();
    if (!run) return;
    this.deletingRun.set(true);
    this.api.deletePayrollRun(run.id).subscribe({
      next: () => {
        this.deletingRun.set(false);
        const monthLabel = this.formatRunMonth(run);
        this.runToDelete.set(null);
        this.toast.show(`Payroll run for ${monthLabel} removed successfully.`, 'success');
        try {
          localStorage.removeItem('hrms_payroll_' + `${run.year}-${String(run.month).padStart(2, '0')}`);
        } catch { }
        this.loadPayrollRuns();
        this.loadBackendPayroll();
      },
      error: () => {
        this.deletingRun.set(false);
        this.toast.show('Failed to remove payroll run.', 'danger');
      }
    });
  }

  protected loadPayrollRuns(): void {
    this.api.payrollRuns().subscribe({
      next: (runs) => this.payrollRuns.set(runs || []),
      error: () => { }
    });
  }

  protected goToPayslipsForMonth(): void {
    this.router.navigate(['/payslips'], { queryParams: { month: this.selectedMonth() } });
  }

  private loadBackendPayroll(): void {
    const [yearStr, monthStr] = this.selectedMonth().split('-');
    const year = parseInt(yearStr, 10) || new Date().getFullYear();
    const month = parseInt(monthStr, 10) || (new Date().getMonth() + 1);

    // Check if payroll runs exist for this selected month
    this.api.payrollRuns().subscribe({
      next: (runs) => {
        this.payrollRuns.set(runs || []);
        const match = runs.find((r) => r.year === year && r.month === month);
        if (match) {
          this.api.payslipsForRun(match.id).subscribe({
            next: (payslips) => {
              if (payslips && payslips.length > 0) {
                this.applyPayslips(payslips);
              } else {
                this.loadEmployeesOrFallback('Processed');
              }
            },
            error: () => this.loadEmployeesOrFallback('Processed'),
          });
        } else {
          // Check localStorage for offline processed run
          const local = localStorage.getItem('hrms_payroll_' + this.selectedMonth());
          if (local) {
            try {
              const parsed = JSON.parse(local);
              if (Array.isArray(parsed) && parsed.length > 0) {
                this.rows.set(parsed);
                this.updateKpisFromRows(parsed);
                return;
              }
            } catch { }
          }
          // Not processed yet -> show active employees with status 'Pending' for this month
          this.loadEmployeesOrFallback('Pending');
        }
      },
      error: () => {
        const local = localStorage.getItem('hrms_payroll_' + this.selectedMonth());
        if (local) {
          try {
            const parsed = JSON.parse(local);
            if (Array.isArray(parsed) && parsed.length > 0) {
              this.rows.set(parsed);
              this.updateKpisFromRows(parsed);
              return;
            }
          } catch { }
        }
        this.loadEmployeesOrFallback('Pending');
      },
    });
  }

  private applyPayslips(payslips: Payslip[]): void {
    const daysInMonth = payslips[0]?.workingDays || 22;
    const mapped: ComprehensivePayrollRow[] = payslips.map((p, idx) => {
      const basic = p.basicSalary;
      const unpaidLeave = p.unpaidDays !== undefined ? p.unpaidDays : 0;
      const paidLeave = p.paidLeaveDays !== undefined ? p.paidLeaveDays : 0;
      const fullDay = p.workingDays || daysInMonth; // Standard monthly working days (not minus leaves taken)
      const deductions = p.deductions;
      const netPay = Math.round((basic - deductions) * 100) / 100;
      return {
        empId: p.employeeCode || (p.employeeId ? p.employeeId.slice(0, 8).toUpperCase() : `EMP-10${idx + 1}`),
        fullEmpId: p.employeeId,
        name: p.employeeName || 'Employee',
        department: p.department || 'Operations',
        designation: p.designation || 'Specialist',
        fullDay,
        halfDay: 0,
        offDay: 8,
        paidLeave,
        unpaidLeave,
        overtimeHours: 0,
        loanAdvance: 0,
        basicSalary: basic,
        allowances: 0,
        deductions,
        grossEarnings: basic,
        netPay,
        status: 'Processed',
        bankName: p.bankName,
        accountNumber: p.accountNumber,
        ifscCode: p.ifscCode,
        reductionPercent: p.reductionPercent || 0,
      };
    });
    this.rows.set(mapped);
    this.updateKpisFromRows(mapped);
  }

  private loadEmployeesOrFallback(status: 'Pending' | 'Processed'): void {
    const [yearStr, monthStr] = this.selectedMonth().split('-');
    const year = parseInt(yearStr, 10) || new Date().getFullYear();
    const month = parseInt(monthStr, 10) || (new Date().getMonth() + 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
    const endStr = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    forkJoin({
      empRes: this.api.employees({ pageSize: 50 }).pipe(catchError(() => of({ items: [], total: 0 }))),
      leavesRes: this.api.leaveRequests({ pageSize: 100 }).pipe(catchError(() => of({ items: [], total: 0 }))),
      typesRes: this.api.leaveTypes().pipe(catchError(() => of([]))),
      holidaysRes: this.api.holidays().pipe(catchError(() => of([]))),
      companyRes: this.api.company().pipe(catchError(() => of(null))),
    }).subscribe({
      next: ({ empRes, leavesRes, typesRes, holidaysRes, companyRes }) => {
        if (empRes?.items && empRes.items.length > 0) {
          const wpw = companyRes?.workingDaysPerWeek ?? 5.0;

          // Calculate monthly working days minus holidays
          const holidayDates = new Set((holidaysRes || []).map((h) => h.date));
          let monthlyWorkingDays = 0;
          for (let d = 1; d <= daysInMonth; d++) {
            const dt = new Date(year, month - 1, d);
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            if (holidayDates.has(dateStr)) continue; // Minus holiday in month!

            const dow = dt.getDay();
            if (dow >= 1 && dow <= 5) monthlyWorkingDays += 1;
            else if (dow === 6) {
              if (wpw >= 6.0) monthlyWorkingDays += 1;
              else if (wpw >= 5.5) monthlyWorkingDays += 0.5;
            } else if (dow === 0) {
              if (wpw >= 7.0) monthlyWorkingDays += 1;
            }
          }
          if (monthlyWorkingDays <= 0) monthlyWorkingDays = 21;

          const typePaidMap = new Map((typesRes || []).map((t) => [t.name.toLowerCase(), t.isPaid]));
          const approvedLeaves = (leavesRes?.items || []).filter(
            (l) => l.status === 'Approved' && l.fromDate <= endStr && l.toDate >= startStr
          );

          const mapped: ComprehensivePayrollRow[] = empRes.items.map((e, idx) => {
            const basic = e.salary || (5000 + (idx % 5) * 800);
            const dailyRate = monthlyWorkingDays > 0 ? basic / monthlyWorkingDays : 0;

            // Calculate paid and unpaid leaves for this employee
            const empLeaves = approvedLeaves.filter((l) => l.employeeId === e.id);
            let paidLeave = 0;
            let unpaidLeave = 0;

            for (const l of empLeaves) {
              const isUnpaid =
                (typePaidMap.has(l.leaveType.toLowerCase()) && !typePaidMap.get(l.leaveType.toLowerCase())) ||
                (l.leaveType && l.leaveType.toLowerCase().includes('unpaid')) ||
                (l.reason && l.reason.toLowerCase().includes('unpaid'));
              const fromD = l.fromDate > startStr ? l.fromDate : startStr;
              const toD = l.toDate < endStr ? l.toDate : endStr;
              const d1 = new Date(fromD).getTime();
              const d2 = new Date(toD).getTime();
              const days = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
              if (days > 0) {
                if (isUnpaid) unpaidLeave += days;
                else paidLeave += days;
              }
            }

            const fullDay = Math.round(monthlyWorkingDays); // Standard monthly working days (not minus leaves taken)
            const deductions = Math.round(unpaidLeave * dailyRate * 100) / 100;
            const netPay = Math.round((basic - deductions) * 100) / 100;

            return {
              empId: e.employeeCode || `EMP-10${idx + 1}`,
              fullEmpId: e.id,
              name: e.fullName,
              department: e.department || 'Engineering',
              designation: e.jobTitle || 'Software Engineer',
              fullDay,
              halfDay: 0,
              offDay: 8,
              paidLeave,
              unpaidLeave,
              overtimeHours: (idx % 3) * 2,
              loanAdvance: idx === 2 ? 150 : 0,
              basicSalary: basic,
              allowances: 0,
              deductions,
              grossEarnings: basic,
              netPay,
              status,
              bankName: '—',
              accountNumber: '—',
              ifscCode: '—',
              reductionPercent: 0,
            };
          });
          this.rows.set(mapped);
          this.updateKpisFromRows(mapped);
        } else {
          this.loadDefaultDemoRows(status);
        }
      },
      error: () => this.loadDefaultDemoRows(status),
    });
  }

  private loadDefaultDemoRows(status: 'Pending' | 'Processed'): void {
    const demo: ComprehensivePayrollRow[] = [
      { empId: 'EMP-001', name: 'Sarah Jenkins', department: 'Engineering', designation: 'Senior Fullstack Engineer', fullDay: 22, halfDay: 0, offDay: 8, paidLeave: 1, unpaidLeave: 0, overtimeHours: 4, loanAdvance: 0, basicSalary: 8500, allowances: 0, deductions: 0, grossEarnings: 8500, netPay: 8500, status },
      { empId: 'EMP-002', name: 'Alex Rivera', department: 'Engineering', designation: 'DevOps Lead', fullDay: 21, halfDay: 1, offDay: 8, paidLeave: 0, unpaidLeave: 0, overtimeHours: 6, loanAdvance: 0, basicSalary: 7800, allowances: 0, deductions: 0, grossEarnings: 7800, netPay: 7800, status },
      { empId: 'EMP-003', name: 'James Wilson', department: 'Marketing', designation: 'Growth Director', fullDay: 22, halfDay: 0, offDay: 8, paidLeave: 1, unpaidLeave: 0, overtimeHours: 0, loanAdvance: 0, basicSalary: 7200, allowances: 0, deductions: 0, grossEarnings: 7200, netPay: 7200, status },
      { empId: 'EMP-004', name: 'Elena Rostova', department: 'Design', designation: 'Product Designer', fullDay: 20, halfDay: 0, offDay: 8, paidLeave: 2, unpaidLeave: 0, overtimeHours: 2, loanAdvance: 0, basicSalary: 6900, allowances: 0, deductions: 0, grossEarnings: 6900, netPay: 6900, status },
      { empId: 'EMP-005', name: 'David Chen', department: 'Finance', designation: 'Senior Financial Analyst', fullDay: 22, halfDay: 0, offDay: 8, paidLeave: 0, unpaidLeave: 0, overtimeHours: 0, loanAdvance: 0, basicSalary: 7400, allowances: 0, deductions: 0, grossEarnings: 7400, netPay: 7400, status },
      { empId: 'EMP-006', name: 'Priya Patel', department: 'HR', designation: 'People Operations Manager', fullDay: 22, halfDay: 0, offDay: 8, paidLeave: 1, unpaidLeave: 0, overtimeHours: 0, loanAdvance: 0, basicSalary: 6500, allowances: 0, deductions: 0, grossEarnings: 6500, netPay: 6500, status },
    ];
    this.rows.set(demo);
    this.updateKpisFromRows(demo);
  }

  private updateKpisFromRows(rows: ComprehensivePayrollRow[]): void {
    const gross = rows.reduce((s, r) => s + r.basicSalary, 0);
    const deductions = rows.reduce((s, r) => s + r.deductions, 0);
    const net = rows.reduce((s, r) => s + r.netPay, 0);
    const sym = this.currencySymbol();

    this.kpis.set([
      { l: 'Gross Payroll', v: `${sym}${gross.toLocaleString()}`, c: 'var(--p)' },
      { l: 'Total Deductions', v: `-${sym}${deductions.toLocaleString()}`, c: 'var(--danger)' },
      { l: 'Net Payable', v: `${sym}${net.toLocaleString()}`, c: 'var(--success)' },
    ]);
  }

  protected statusClass(s: ComprehensivePayrollRow['status']): string {
    return s === 'Processed' ? 'badge-success' : s === 'Pending' ? 'badge-warning' : 'badge-danger';
  }

  protected openRunModal(): void {
    this.showRunModal.set(true);
    this.checkPreflight();
  }

  protected checkPreflight(): void {
    this.isCheckingPreflight.set(true);
    const [yearStr, monthStr] = this.runForm.month.split('-');
    const year = parseInt(yearStr, 10) || new Date().getFullYear();
    const month = parseInt(monthStr, 10) || (new Date().getMonth() + 1);

    this.api.payrollPreflightCheck(month, year).subscribe({
      next: (res) => {
        this.isCheckingPreflight.set(false);
        this.preflightResult.set(res);
      },
      error: () => {
        this.isCheckingPreflight.set(false);
        this.preflightResult.set({ canRun: true, pendingLeavesCount: 0, message: 'All checks clear.', pendingEmployeeNames: [] });
      },
    });
  }

  protected getNetPayInWords(amount: number): string {
    return amountInWords(amount, 'Rupees');
  }

  protected openPayslip(r: ComprehensivePayrollRow): void {
    this.selectedRow.set(r);
  }

  protected openFullPayslip(r: ComprehensivePayrollRow): void {
    const targetId = r.fullEmpId || r.empId;
    this.selectedRow.set(null);
    this.router.navigate(['/payslips'], { queryParams: { employeeId: targetId } });
  }

  protected downloadModalPayslip(): void {
    const r = this.selectedRow();
    if (!r) return;

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // Header Background Bar (Navy / Dark Slate)
    doc.setFillColor(15, 23, 42); // #0f172a
    doc.rect(0, 0, 210, 30, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(this.company()?.companyName || 'HRNexus Corp', 14, 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(this.companyAddress(), 14, 20);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('PAYSLIP', 196, 13, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(`Period: ${this.activeMonthLabel()}`, 196, 20, { align: 'right' });
    doc.text(`Status: ${r.status}`, 196, 25, { align: 'right' });

    // Employee & Bank Details in 2 Columns
    doc.setDrawColor(229, 231, 235);
    doc.setFillColor(249, 250, 251);
    doc.roundedRect(14, 35, 182, 38, 2, 2, 'FD');

    doc.setTextColor(17, 24, 39);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('EMPLOYEE DETAILS', 18, 41);
    doc.text('PAYMENT DETAILS', 110, 41);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.text('Employee Name:', 18, 48);
    doc.text('Employee Code:', 18, 54);
    doc.text('Designation:', 18, 60);
    doc.text('Department:', 18, 66);

    doc.text('Bank Name:', 110, 48);
    doc.text('Bank A/c No:', 110, 54);
    doc.text('IFSC Code:', 110, 60);
    doc.text('Work Location:', 110, 66);

    doc.setTextColor(17, 24, 39);
    doc.setFont('helvetica', 'bold');
    doc.text(r.name, 48, 48);
    doc.text(r.empId, 48, 54);
    doc.text(r.designation, 48, 60);
    doc.text(r.department, 48, 66);

    doc.text(r.bankName || '—', 138, 48);
    doc.text(r.accountNumber || '—', 138, 54);
    doc.text(r.ifscCode || '—', 138, 60);
    doc.text(this.company()?.city || '—', 138, 66);

    // Attendance & Working Days Summary Box
    doc.setFillColor(243, 244, 246);
    doc.roundedRect(14, 76, 182, 14, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(17, 24, 39);
    doc.text(`Total Payable Days: ${r.fullDay}`, 18, 84.5);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(75, 85, 99);
    doc.text(`Worked: ${r.fullDay}  |  Weekly Off: ${r.offDay}  |  Holiday: 0  |  Unpaid: ${r.unpaidLeave}  |  Paid Leave: ${r.paidLeave}`, 75, 84.5);

    // Earnings & Deductions Tables (Side by Side)
    let y = 94;
    doc.setFillColor(243, 244, 246);
    doc.rect(14, y, 91, 8, 'F');
    doc.rect(105, y, 91, 8, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(31, 41, 55);
    doc.text('EARNINGS', 18, y + 5.5);
    doc.text('AMOUNT (INR)', 101, y + 5.5, { align: 'right' });
    doc.text('DEDUCTIONS', 109, y + 5.5);
    doc.text('AMOUNT (INR)', 192, y + 5.5, { align: 'right' });

    y += 13;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(75, 85, 99);

    const pdfSym = this.currencyService.currencyPdfSymbol();

    // Row 1
    doc.text('Basic Salary', 18, y);
    doc.text(`${pdfSym}${r.basicSalary.toLocaleString()}.00`, 101, y, { align: 'right' });
    doc.text('Unpaid Leave (LOP) Deduction', 109, y);
    doc.text(`${pdfSym}${r.deductions.toLocaleString()}.00`, 192, y, { align: 'right' });

    // Totals Box
    y += 14;
    doc.setFillColor(249, 250, 251);
    doc.rect(14, y, 91, 8, 'F');
    doc.rect(105, y, 91, 8, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(17, 24, 39);
    doc.text('Total Gross Earnings', 18, y + 5.5);
    doc.text(`${pdfSym}${r.grossEarnings.toLocaleString()}.00`, 101, y + 5.5, { align: 'right' });
    doc.text('Total Deductions', 109, y + 5.5);
    doc.text(`${pdfSym}${r.deductions.toLocaleString()}.00`, 192, y + 5.5, { align: 'right' });

    // Net Pay Callout (Emerald Green)
    y += 18;
    doc.setFillColor(236, 253, 245); // #ecfdf5
    doc.setDrawColor(16, 185, 129); // #10b981
    doc.roundedRect(14, y, 182, 22, 2, 2, 'FD');

    doc.setTextColor(6, 95, 70); // #065f46
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('TOTAL NET PAYABLE:', 20, y + 8);
    doc.setFontSize(13);
    doc.text(`${pdfSym}${r.netPay.toLocaleString()}.00`, 190, y + 8, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(4, 120, 87);
    doc.text(`Amount in Words: ${this.getNetPayInWords(r.netPay)}`, 20, y + 15);
    doc.text('Total Net Payable = Gross Earnings - Total Deductions', 190, y + 19, { align: 'right' });

    // Disclaimer
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(156, 163, 175);
    doc.text('This PDF is system-generated, no signature required.', 105, 275, { align: 'center' });

    // Save and download file
    const safeName = r.name.replace(/[^a-zA-Z0-9]/g, '_');
    doc.save(`Payslip_${safeName}_${this.selectedMonth()}.pdf`);
    this.toast.show(`Payslip downloaded for ${r.name}!`, 'success');
  }

  protected executeRunPayroll(): void {
    if (this.preflightResult() && (this.preflightResult()!.missingBankDetailsCount || 0) > 0) {
      this.toast.show(
        `Cannot run payroll: Compulsory bank details (Bank A/c No. & IFSC Code) are missing for: ${this.preflightResult()!.missingBankEmployeeNames?.join(', ')}. Please fill them first.`,
        'danger'
      );
      return;
    }

    if (this.preflightResult() && this.preflightResult()!.pendingLeavesCount > 0) {
      this.toast.show(
        `Cannot run payroll: Please approve or reject pending leaves for: ${this.preflightResult()!.pendingEmployeeNames.join(', ')} first.`,
        'danger'
      );
      return;
    }

    this.runningPayroll.set(true);
    const [yearStr, monthStr] = this.runForm.month.split('-');
    const year = parseInt(yearStr, 10) || new Date().getFullYear();
    const month = parseInt(monthStr, 10) || (new Date().getMonth() + 1);

    const modeMap: Record<string, string> = {
      wps: 'Wps',
      bank: 'BankTransfer',
      cheque: 'Cheque',
      cash: 'Cash',
    };
    const paymentMethod = modeMap[this.runForm.method.toLowerCase()] || 'Wps';

    this.api.runPayroll({
      month,
      year,
      payDate: this.runForm.payDate,
      paymentMethod,
      reductionPercent: Number(this.runForm.reductionPercent) || 0,
    }).subscribe({
      next: (run) => {
        this.runningPayroll.set(false);
        this.showRunModal.set(false);
        this.selectedMonth.set(this.runForm.month);
        this.toast.show(`Payroll for ${this.runForm.month} processed successfully!`, 'success');

        this.api.payslipsForRun(run.id).subscribe({
          next: (slips) => {
            if (slips && slips.length > 0) {
              this.applyPayslips(slips);
            } else {
              this.markCurrentRowsProcessed();
            }
          },
          error: () => this.markCurrentRowsProcessed(),
        });
        this.loadPayrollRuns();
      },
      error: (err) => {
        this.runningPayroll.set(false);
        this.showRunModal.set(false);
        this.selectedMonth.set(this.runForm.month);

        if (err?.status === 409) {
          this.toast.show(`Payroll for ${this.runForm.month} was already recorded in database.`, 'info');
          this.loadBackendPayroll();
        } else {
          const errObj = err?.error;
          let msg = 'Failed to execute payroll.';
          if (errObj?.detail) msg = errObj.detail;
          else if (errObj?.message) msg = errObj.message;
          else if (errObj?.title) msg = errObj.title;
          this.toast.show(msg, 'danger');
        }
        this.loadPayrollRuns();
      },
    });
  }

  private markCurrentRowsProcessed(): void {
    const updated = this.rows().map((r) => ({ ...r, status: 'Processed' as const }));
    this.rows.set(updated);
    this.updateKpisFromRows(updated);
    try {
      localStorage.setItem('hrms_payroll_' + this.selectedMonth(), JSON.stringify(updated));
    } catch { }
  }

  protected exportCsv(): void {
    const headers = [
      'Emp ID',
      'Name',
      'Department',
      'Designation',
      'Full Day',
      'Half Day',
      'Paid Leave',
      'Unpaid Leave',
      'Basic Salary',
      'Deductions',
      'Net Pay',
      'Status',
    ];
    const rows = this.filteredRows().map((r) =>
      [
        r.empId,
        `"${r.name}"`,
        `"${r.department}"`,
        `"${r.designation}"`,
        r.fullDay,
        r.halfDay,
        r.paidLeave,
        r.unpaidLeave,
        r.basicSalary,
        r.deductions,
        r.netPay,
        r.status,
      ].join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Payroll_${this.selectedMonth()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast.show('Payroll Register exported to CSV');
  }
}
