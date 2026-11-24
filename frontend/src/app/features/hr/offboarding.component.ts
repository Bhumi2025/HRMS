import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api/api.service';
import { EmployeeListItem, OffboardingRecord, OffboardingSummary } from '../../core/api/api.models';
import { IconDirective } from '../../core/icons/icon.directive';
import { ToastService } from '../../core/services/toast.service';
import { UiService } from '../../core/services/ui.service';
import { NotificationStateService } from '../../core/services/notification-state.service';
import { SelectComponent, SelectOption } from '../../shared/select.component';

@Component({
  selector: 'app-offboarding',
  standalone: true,
  imports: [CommonModule, FormsModule, IconDirective, SelectComponent],
  template: `
    <!-- KPI Summary Row -->
    <div class="grid-5" style="margin-bottom: 20px;">
      <div class="kpi-card">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
          <span style="font-size: 13px; font-weight: 600; color: var(--muted);">Total Offboarding</span>
          <div style="width: 34px; height: 34px; border-radius: 8px; background: rgba(59,130,246,0.12); color: var(--p); display: flex; align-items: center; justify-content: center;">
            <span [appIcon]="'employees'"></span>
          </div>
        </div>
        <div style="font-size: 26px; font-weight: 800; color: var(--text);">{{ summary().total }}</div>
        <div style="font-size: 12px; color: var(--muted); margin-top: 4px;">Total exit cases recorded</div>
      </div>

      <div class="kpi-card">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
          <span style="font-size: 13px; font-weight: 600; color: var(--muted);">Pending Initiation</span>
          <div style="width: 34px; height: 34px; border-radius: 8px; background: rgba(245,158,11,0.12); color: var(--warning); display: flex; align-items: center; justify-content: center;">
            <span [appIcon]="'clock'"></span>
          </div>
        </div>
        <div style="font-size: 26px; font-weight: 800; color: var(--warning);">{{ summary().pending }}</div>
        <div style="font-size: 12px; color: var(--muted); margin-top: 4px;">Notice period ongoing</div>
      </div>

      <div class="kpi-card">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
          <span style="font-size: 13px; font-weight: 600; color: var(--muted);">In Progress</span>
          <div style="width: 34px; height: 34px; border-radius: 8px; background: rgba(99,102,241,0.12); color: #6366f1; display: flex; align-items: center; justify-content: center;">
            <span [appIcon]="'settings'"></span>
          </div>
        </div>
        <div style="font-size: 26px; font-weight: 800; color: #6366f1;">{{ summary().inProgress }}</div>
        <div style="font-size: 12px; color: var(--muted); margin-top: 4px;">Clearance in progress</div>
      </div>

      <div class="kpi-card">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
          <span style="font-size: 13px; font-weight: 600; color: var(--muted);">Completed Exits</span>
          <div style="width: 34px; height: 34px; border-radius: 8px; background: rgba(16,185,129,0.12); color: var(--success); display: flex; align-items: center; justify-content: center;">
            <span [appIcon]="'check'"></span>
          </div>
        </div>
        <div style="font-size: 26px; font-weight: 800; color: var(--success);">{{ summary().completed }}</div>
        <div style="font-size: 12px; color: var(--muted); margin-top: 4px;">Fully settled &amp; archived</div>
      </div>

      <div class="kpi-card">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
          <span style="font-size: 13px; font-weight: 600; color: var(--muted);">Assets Pending</span>
          <div style="width: 34px; height: 34px; border-radius: 8px; background: rgba(239,68,68,0.12); color: var(--danger); display: flex; align-items: center; justify-content: center;">
            <span [appIcon]="'documents'"></span>
          </div>
        </div>
        <div style="font-size: 26px; font-weight: 800; color: var(--danger);">{{ summary().assetsPending }}</div>
        <div style="font-size: 12px; color: var(--muted); margin-top: 4px;">Hardware awaiting return</div>
      </div>
    </div>

    <!-- Main Table Card -->
    <div class="card" style="overflow: hidden; display: flex; flex-direction: column;">
      <div class="card-header" style="flex-wrap: wrap; gap: 10px; overflow: visible; padding-bottom: 12px; border-bottom: 1px solid var(--border);">
        <div class="card-title" style="display: flex; align-items: center; gap: 8px;">
          <span [appIcon]="'employees'" style="color: var(--p);"></span>
          Employee Offboarding &amp; Exit Management
        </div>

        <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
          <!-- Search Box -->
          <div style="position: relative; display: flex; align-items: center;">
            <span style="position: absolute; left: 10px; color: var(--muted); pointer-events: none; display: flex;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </span>
            <input 
              type="search" 
              class="form-control" 
              placeholder="Search employee, reason..." 
              style="width: 240px; font-size: 12px; padding: 6px 28px 6px 30px;"
              [value]="searchQuery()"
              (input)="searchQuery.set($any($event.target).value)"
            />
          </div>

          <!-- Status Filter -->
          <div style="width: 150px;">
            <app-select 
              [options]="statusFilterOptions" 
              [value]="statusFilter()" 
              (valueChange)="statusFilter.set($event)" 
              width="100%" 
            />
          </div>

          <!-- Initiate Offboarding Button -->
          <button class="btn btn-primary btn-sm" (click)="openInitiateModal()" style="display: flex; align-items: center; gap: 6px;">
            <span [appIcon]="'plus'"></span> Initiate Offboarding
          </button>
        </div>
      </div>

      <!-- Offboarding Table -->
      <div class="table-wrap" style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Department &amp; Role</th>
              <th>Resignation Date</th>
              <th>Final Working Date</th>
              <th>Reason</th>
              <th>Clearance Checklist</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (rec of filteredRecords(); track rec.id) {
              <tr>
                <td>
                  <div class="table-avatar">
                    <div class="avatar-placeholder avatar">{{ initials(rec.employeeName) }}</div>
                    <div>
                      <div style="font-weight: 600; font-size: 13px;">{{ rec.employeeName }}</div>
                      <div style="font-size: 11px; color: var(--muted);">{{ rec.employeeCode }}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div style="font-weight: 600; font-size: 13px;">{{ rec.department }}</div>
                  <div style="font-size: 11px; color: var(--muted);">{{ rec.jobTitle }}</div>
                </td>
                <td style="font-size: 13px;">{{ rec.resignationDate }}</td>
                <td style="font-size: 13px; font-weight: 600;">{{ rec.finalWorkingDate }}</td>
                <td style="font-size: 13px; color: var(--text); max-width: 180px;">{{ rec.reason }}</td>
                <td>
                  <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                    <span 
                      class="badge" 
                      [class]="rec.isAssetReturned ? 'badge-success' : 'badge-warning'" 
                      [title]="rec.isAssetReturned ? 'Assets Returned' : 'Assets Pending'"
                    >
                      {{ rec.isAssetReturned ? '✓ Assets' : '⏳ Assets' }}
                    </span>
                    <span 
                      class="badge" 
                      [class]="rec.isAccessRevoked ? 'badge-success' : 'badge-warning'" 
                      [title]="rec.isAccessRevoked ? 'Access Revoked' : 'Access Active'"
                    >
                      {{ rec.isAccessRevoked ? '✓ Access' : '⏳ Access' }}
                    </span>
                    <span 
                      class="badge" 
                      [class]="rec.isFinalSettlementDone ? 'badge-success' : 'badge-warning'" 
                      [title]="rec.isFinalSettlementDone ? 'Settled' : 'Settlement Pending'"
                    >
                      {{ rec.isFinalSettlementDone ? '✓ Settled' : '⏳ Settlement' }}
                    </span>
                  </div>
                </td>
                <td>
                  <span class="badge" [class]="statusClass(rec.status)">{{ formatStatus(rec.status) }}</span>
                </td>
                <td>
                  <button class="btn btn-outline btn-sm" (click)="openManageModal(rec)" style="display: inline-flex; align-items: center; gap: 4px;">
                    <span [appIcon]="'settings'"></span> Manage Exit
                  </button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="8" style="text-align: center; padding: 36px 20px; color: var(--muted);">
                  <div style="font-size: 13px; font-weight: 500;">
                    {{ records().length === 0 ? 'No offboarding records found. Click "+ Initiate Offboarding" to begin.' : 'No records match your search filters.' }}
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal: Initiate Offboarding -->
    <div class="modal-overlay" [class.open]="ui.isOpen('initiateOffboardingModal')" (click)="ui.onOverlayClick($event, 'initiateOffboardingModal')">
      <div class="modal" style="max-width: 520px; width: 100%;">
        <div class="modal-header">
          <div style="font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 8px;">
            <span [appIcon]="'plus'" style="color: var(--p);"></span> Initiate Employee Offboarding
          </div>
          <button class="btn btn-ghost btn-sm" (click)="ui.close('initiateOffboardingModal')"><span [appIcon]="'x'"></span></button>
        </div>
        <div class="modal-body">
          @if (initiateError()) {
            <div style="background: rgba(239,68,68,0.1); border: 1px solid var(--danger); color: var(--danger); border-radius: 6px; padding: 8px 12px; font-size: 12px; margin-bottom: 12px; font-weight: 500;">
              {{ initiateError() }}
            </div>
          }

          <div class="form-group">
            <label class="form-label">Select Employee<span class="req">*</span></label>
            <app-select 
              [options]="employeeOptions()" 
              [value]="initiateForm.employeeId" 
              (valueChange)="initiateForm.employeeId = $event; initiateError.set('')" 
              width="100%" 
            />
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div class="form-group">
              <label class="form-label">Resignation Date<span class="req">*</span></label>
              <input 
                class="form-control" 
                type="date" 
                [value]="initiateForm.resignationDate" 
                (input)="initiateForm.resignationDate = $any($event.target).value; initiateError.set('')" 
              />
            </div>
            <div class="form-group">
              <label class="form-label">Final Working Date<span class="req">*</span></label>
              <input 
                class="form-control" 
                type="date" 
                [value]="initiateForm.finalWorkingDate" 
                (input)="initiateForm.finalWorkingDate = $any($event.target).value; initiateError.set('')" 
              />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Reason for Leaving<span class="req">*</span></label>
            <app-select 
              [options]="reasonOptions" 
              [value]="initiateForm.reason" 
              (valueChange)="initiateForm.reason = $event; initiateError.set('')" 
              width="100%" 
            />
          </div>

          <div class="form-group">
            <label class="form-label">Handover / Exit Notes</label>
            <textarea 
              class="form-control" 
              rows="3" 
              placeholder="Enter handover details, project transition notes, asset checklist..." 
              [value]="initiateForm.notes" 
              (input)="initiateForm.notes = $any($event.target).value"
            ></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" [disabled]="isSubmitting()" (click)="ui.close('initiateOffboardingModal')">Cancel</button>
          <button class="btn btn-primary" [disabled]="isSubmitting()" (click)="submitInitiate()">
            {{ isSubmitting() ? 'Initiating...' : 'Initiate Offboarding' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Modal: Manage / Complete Offboarding -->
    <div class="modal-overlay" [class.open]="ui.isOpen('manageOffboardingModal')" (click)="ui.onOverlayClick($event, 'manageOffboardingModal')">
      <div class="modal" style="max-width: 580px; width: 100%;">
        <div class="modal-header">
          <div>
            <div style="font-size: 15px; font-weight: 700;">Manage Exit Clearance</div>
            <div class="card-subtitle" style="margin-top: 2px;">
              {{ activeRecord()?.employeeName }} ({{ activeRecord()?.employeeCode }}) · {{ activeRecord()?.department }}
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" (click)="ui.close('manageOffboardingModal')"><span [appIcon]="'x'"></span></button>
        </div>
        <div class="modal-body">
          @if (manageError()) {
            <div style="background: rgba(239,68,68,0.1); border: 1px solid var(--danger); color: var(--danger); border-radius: 6px; padding: 8px 12px; font-size: 12px; margin-bottom: 12px; font-weight: 500;">
              {{ manageError() }}
            </div>
          }

          <!-- Timeline Details -->
          <div style="background: var(--bg); border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 12.5px;">
            <div>
              <span style="color: var(--muted); font-size: 11.5px; text-transform: uppercase; font-weight: 600; display: block;">Resignation Date</span>
              <span style="font-weight: 600; color: var(--text);">{{ activeRecord()?.resignationDate }}</span>
            </div>
            <div>
              <span style="color: var(--muted); font-size: 11.5px; text-transform: uppercase; font-weight: 600; display: block;">Final Working Date</span>
              <span style="font-weight: 700; color: var(--danger);">{{ activeRecord()?.finalWorkingDate }}</span>
            </div>
            <div style="grid-column: 1 / -1;">
              <span style="color: var(--muted); font-size: 11.5px; text-transform: uppercase; font-weight: 600; display: block;">Reason for Departure</span>
              <span style="font-weight: 600; color: var(--text);">{{ activeRecord()?.reason }}</span>
            </div>
          </div>

          <!-- Clearance Checklist Section -->
          <div style="margin-bottom: 16px;">
            <div style="font-size: 13px; font-weight: 700; color: var(--text); margin-bottom: 8px;">
              Exit Formalities Checklist
            </div>

            <div style="display: flex; flex-direction: column; gap: 8px;">
              <label style="display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; cursor: pointer;">
                <input 
                  type="checkbox" 
                  style="width: 18px; height: 18px; accent-color: var(--p); cursor: pointer;"
                  [checked]="manageForm.isAssetReturned"
                  (change)="manageForm.isAssetReturned = $any($event.target).checked"
                />
                <div>
                  <div style="font-size: 13px; font-weight: 600; color: var(--text);">Company Assets Returned</div>
                  <div style="font-size: 11px; color: var(--muted);">Laptop, monitor, ID badge, keycard, hardware</div>
                </div>
              </label>

              <label style="display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; cursor: pointer;">
                <input 
                  type="checkbox" 
                  style="width: 18px; height: 18px; accent-color: var(--p); cursor: pointer;"
                  [checked]="manageForm.isAccessRevoked"
                  (change)="manageForm.isAccessRevoked = $any($event.target).checked"
                />
                <div>
                  <div style="font-size: 13px; font-weight: 600; color: var(--text);">System Access Revoked</div>
                  <div style="font-size: 11px; color: var(--muted);">HRMS login disabled, company email deactivated, VPN access closed</div>
                </div>
              </label>

              <label style="display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; cursor: pointer;">
                <input 
                  type="checkbox" 
                  style="width: 18px; height: 18px; accent-color: var(--p); cursor: pointer;"
                  [checked]="manageForm.isFinalSettlementDone"
                  (change)="manageForm.isFinalSettlementDone = $any($event.target).checked"
                />
                <div>
                  <div style="font-size: 13px; font-weight: 600; color: var(--text);">Final Settlement &amp; Payroll Clearance</div>
                  <div style="font-size: 11px; color: var(--muted);">Gratuity, encashed leaves, final month pay slip finalized</div>
                </div>
              </label>
            </div>
          </div>

          <!-- Notes -->
          <div class="form-group">
            <label class="form-label">Clearance Notes</label>
            <textarea 
              class="form-control" 
              rows="2" 
              placeholder="Additional handover details or exit feedback..." 
              [value]="manageForm.notes" 
              (input)="manageForm.notes = $any($event.target).value"
            ></textarea>
          </div>
        </div>
        <div class="modal-footer" style="display: flex; justify-content: space-between; gap: 10px;">
          <button class="btn btn-outline" [disabled]="isSubmitting()" (click)="ui.close('manageOffboardingModal')">Cancel</button>

          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline" [disabled]="isSubmitting()" (click)="saveProgress()">
              {{ isSubmitting() ? 'Saving...' : 'Save Progress' }}
            </button>
            <button class="btn btn-success" [disabled]="isSubmitting()" (click)="completeExit()">
              <span [appIcon]="'check'"></span> Complete Offboarding
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .grid-5 {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 14px;
      }
      @media (max-width: 1200px) {
        .grid-5 {
          grid-template-columns: repeat(3, 1fr);
        }
      }
      @media (max-width: 768px) {
        .grid-5 {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class OffboardingComponent implements OnInit {
  protected readonly api = inject(ApiService);
  protected readonly ui = inject(UiService);
  protected readonly toast = inject(ToastService);
  protected readonly notifState = inject(NotificationStateService);

  protected readonly records = signal<OffboardingRecord[]>([]);
  protected readonly summary = signal<OffboardingSummary>({
    total: 0,
    pending: 0,
    inProgress: 0,
    completed: 0,
    assetsPending: 0,
  });

  protected readonly employees = signal<EmployeeListItem[]>([]);
  protected readonly searchQuery = signal('');
  protected readonly statusFilter = signal('');

  protected readonly activeRecord = signal<OffboardingRecord | null>(null);
  protected readonly isSubmitting = signal(false);
  protected readonly initiateError = signal('');
  protected readonly manageError = signal('');

  protected readonly initiateForm = {
    employeeId: '',
    resignationDate: new Date().toISOString().slice(0, 10),
    finalWorkingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    reason: 'Better Opportunity',
    notes: '',
  };

  protected readonly manageForm = {
    isAssetReturned: false,
    isAccessRevoked: false,
    isFinalSettlementDone: false,
    notes: '',
  };

  protected readonly statusFilterOptions: SelectOption[] = [
    { v: '', l: 'All Status' },
    { v: 'Pending', l: 'Pending' },
    { v: 'InProgress', l: 'In Progress' },
    { v: 'Completed', l: 'Completed' },
    { v: 'Cancelled', l: 'Cancelled' },
  ];

  protected readonly reasonOptions: SelectOption[] = [
    { v: 'Better Opportunity', l: 'Better Opportunity / Higher Compensation' },
    { v: 'Relocation', l: 'Relocation / Family Relocation' },
    { v: 'Career Growth', l: 'Career Growth & Skill Development' },
    { v: 'Personal Reasons', l: 'Personal Reasons / Health' },
    { v: 'Retirement', l: 'Retirement' },
    { v: 'Contract Expiry', l: 'Contract Expiration' },
    { v: 'Other', l: 'Other' },
  ];

  protected readonly employeeOptions = computed<SelectOption[]>(() =>
    this.employees().map((e) => ({
      v: e.id,
      l: `${e.fullName} (${e.employeeCode}) - ${e.department}`,
    })),
  );

  protected readonly filteredRecords = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const s = this.statusFilter();

    return this.records().filter((r) => {
      const matchSearch =
        !q ||
        r.employeeName.toLowerCase().includes(q) ||
        r.employeeCode.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q) ||
        r.reason.toLowerCase().includes(q);

      const matchStatus = !s || r.status.toLowerCase() === s.toLowerCase();
      return matchSearch && matchStatus;
    });
  });

  ngOnInit(): void {
    this.loadData();
    this.loadEmployees();
  }

  protected loadData(): void {
    this.api.offboardings().subscribe({
      next: (list) => this.records.set(list || []),
      error: () => this.records.set([]),
    });

    this.api.offboardingSummary().subscribe({
      next: (s) => this.summary.set(s),
      error: () => {},
    });
  }

  private loadEmployees(): void {
    this.api.employees({ page: 1, pageSize: 200 }).subscribe({
      next: (res) => {
        const items = res.items || [];
        this.employees.set(items);
        if (items.length > 0 && !this.initiateForm.employeeId) {
          this.initiateForm.employeeId = items[0].id;
        }
      },
      error: () => this.employees.set([]),
    });
  }

  protected openInitiateModal(): void {
    this.initiateError.set('');
    this.initiateForm.resignationDate = new Date().toISOString().slice(0, 10);
    this.initiateForm.finalWorkingDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    this.initiateForm.reason = 'Better Opportunity';
    this.initiateForm.notes = '';
    if (this.employees().length > 0) {
      this.initiateForm.employeeId = this.employees()[0].id;
    }
    this.ui.open('initiateOffboardingModal');
  }

  protected submitInitiate(): void {
    if (!this.initiateForm.employeeId) {
      this.initiateError.set('Please select an employee.');
      return;
    }
    if (!this.initiateForm.resignationDate) {
      this.initiateError.set('Please enter resignation date.');
      return;
    }
    if (!this.initiateForm.finalWorkingDate) {
      this.initiateError.set('Please enter final working date.');
      return;
    }
    if (!this.initiateForm.reason) {
      this.initiateError.set('Please select a reason for leaving.');
      return;
    }

    this.isSubmitting.set(true);
    this.initiateError.set('');

    this.api
      .initiateOffboarding({
        employeeId: this.initiateForm.employeeId,
        resignationDate: this.initiateForm.resignationDate,
        finalWorkingDate: this.initiateForm.finalWorkingDate,
        reason: this.initiateForm.reason,
        notes: this.initiateForm.notes || undefined,
      })
      .subscribe({
        next: () => {
          this.isSubmitting.set(false);
          this.ui.close('initiateOffboardingModal');
          this.toast.show('Offboarding process initiated successfully.', 'success');
          this.loadData();
          this.notifState.refresh();
        },
        error: (err) => {
          this.isSubmitting.set(false);
          const msg = err?.error?.detail || err?.error?.message || err?.error?.title || 'Could not initiate offboarding.';
          this.initiateError.set(msg);
        },
      });
  }

  protected openManageModal(rec: OffboardingRecord): void {
    this.activeRecord.set(rec);
    this.manageError.set('');
    this.manageForm.isAssetReturned = rec.isAssetReturned;
    this.manageForm.isAccessRevoked = rec.isAccessRevoked;
    this.manageForm.isFinalSettlementDone = rec.isFinalSettlementDone;
    this.manageForm.notes = rec.notes || '';
    this.ui.open('manageOffboardingModal');
  }

  protected saveProgress(): void {
    const rec = this.activeRecord();
    if (!rec) return;

    this.isSubmitting.set(true);
    this.manageError.set('');

    this.api
      .updateOffboarding(rec.id, {
        isAssetReturned: this.manageForm.isAssetReturned,
        isAccessRevoked: this.manageForm.isAccessRevoked,
        isFinalSettlementDone: this.manageForm.isFinalSettlementDone,
        notes: this.manageForm.notes,
        status: rec.status === 'Pending' ? 'InProgress' : rec.status,
      })
      .subscribe({
        next: () => {
          this.isSubmitting.set(false);
          this.ui.close('manageOffboardingModal');
          this.toast.show('Exit clearance progress saved.', 'success');
          this.loadData();
        },
        error: (err) => {
          this.isSubmitting.set(false);
          const msg = err?.error?.detail || err?.error?.message || err?.error?.title || 'Could not save exit progress.';
          this.manageError.set(msg);
        },
      });
  }

  protected completeExit(): void {
    const rec = this.activeRecord();
    if (!rec) return;

    this.isSubmitting.set(true);
    this.manageError.set('');

    this.api
      .completeOffboarding(rec.id, {
        isAssetReturned: this.manageForm.isAssetReturned,
        isAccessRevoked: this.manageForm.isAccessRevoked,
        isFinalSettlementDone: this.manageForm.isFinalSettlementDone,
        notes: this.manageForm.notes,
      })
      .subscribe({
        next: () => {
          this.isSubmitting.set(false);
          this.ui.close('manageOffboardingModal');
          this.toast.show(`Offboarding completed for ${rec.employeeName}. Account deactivated while historical records are preserved.`, 'success');
          this.loadData();
          this.notifState.refresh();
        },
        error: (err) => {
          this.isSubmitting.set(false);
          const msg = err?.error?.detail || err?.error?.message || err?.error?.title || 'Could not complete offboarding.';
          this.manageError.set(msg);
        },
      });
  }

  protected initials(name: string): string {
    return (name || '')
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  protected statusClass(status: string): string {
    switch ((status || '').toLowerCase()) {
      case 'completed':
        return 'badge-success';
      case 'inprogress':
        return 'badge-primary';
      case 'pending':
        return 'badge-warning';
      case 'cancelled':
        return 'badge-danger';
      default:
        return 'badge-warning';
    }
  }

  protected formatStatus(status: string): string {
    if (status === 'InProgress') return 'In Progress';
    return status;
  }
}
