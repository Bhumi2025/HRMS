import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/api/api.service';
import { IconDirective } from '../../core/icons/icon.directive';
import { SessionService } from '../../core/services/session.service';
import { ToastService } from '../../core/services/toast.service';
import { UiService } from '../../core/services/ui.service';
import { NotificationStateService } from '../../core/services/notification-state.service';

interface Approval {
  apiId?: string;
  n: string;
  t: string;
  type: 'leave' | 'overtime' | 'reg';
  d: string;
  sub: string;
  p: 'High' | 'Medium' | 'Low';
  date?: string;
  inTime?: string;
  outTime?: string;
  reason?: string;
}

/** HR Approvals — ported from pages/approvals.html. */
@Component({
  selector: 'app-approvals',
  imports: [CommonModule, IconDirective],
  template: `
    <div class="flex justify-between items-center" style="margin-bottom: 15px">
      <div>
        <div class="page-title">HR Approvals</div>
        <div class="page-subtitle">Manage all pending approval requests</div>
      </div>
      <div class="flex gap-2">
        <button class="btn btn-primary btn-sm" style="display: flex; align-items: center; gap: 6px" (click)="approveAll()">
          <span [appIcon]="'check'"></span> Approve All
        </button>
      </div>
    </div>

    <div class="approvals-kpi-grid">
      @for (k of kpis(); track k.l) {
        <div class="kpi-card">
          <div class="kpi-icon" [style.background]="k.c + '20'" [style.color]="k.c"><span [appIcon]="'approvals'"></span></div>
          <div class="kpi-value">{{ k.v }}</div>
          <div class="kpi-label">{{ k.l }}</div>
        </div>
      }
    </div>

    <div>
      <div class="tabs">
        <button class="tab-btn" [class.active]="tab() === 'all'" (click)="tab.set('all')">All ({{ combined().length }})</button>
        <button class="tab-btn" [class.active]="tab() === 'leave'" (click)="tab.set('leave')">Leave ({{ leaveData().length }})</button>
        <button class="tab-btn" [class.active]="tab() === 'ot'" (click)="tab.set('ot')">Overtime ({{ overtimeData().length }})</button>
        @if (canReg()) {
          <button class="tab-btn" [class.active]="tab() === 'reg'" (click)="tab.set('reg')">Regularization ({{ regData().length }})</button>
        }
      </div>

      <div style="margin-top: 20px">
        @if (tab() === 'reg' && canReg()) {
          <div class="card">
            <div class="table-wrap">
              <table class="approvals-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Date</th>
                    <th>In Time</th>
                    <th>Out Time</th>
                    <th>Reason</th>
                    <th>Submitted</th>
                    <th>Priority</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  @if (regData().length === 0) {
                    <tr>
                      <td colspan="8">
                        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 48px 24px; gap: 12px">
                          <div style="font-weight: 600; font-size: 1rem; color: var(--text)">No Records Found</div>
                          <div style="font-size: 0.85rem; color: var(--muted)">There are no pending regularization requests.</div>
                        </div>
                      </td>
                    </tr>
                  }
                  @for (r of regData(); track r.apiId ?? r.n + r.date) {
                    <tr>
                      <td>
                        <div class="table-avatar">
                          <div class="avatar-placeholder avatar-sm" style="background: var(--p-soft); color: var(--p)">{{ initials(r.n) }}</div>
                          <span style="font-weight: 600">{{ r.n }}</span>
                        </div>
                      </td>
                      <td style="font-size: 13px">{{ r.date }}</td>
                      <td style="font-size: 13px; font-weight: 600">{{ r.inTime }}</td>
                      <td style="font-size: 13px; font-weight: 600">{{ r.outTime }}</td>
                      <td style="font-size: 13px; color: var(--muted)">{{ r.reason }}</td>
                      <td style="color: var(--muted)">{{ r.sub }}</td>
                      <td><span class="badge" [class]="priorityClass(r.p)">{{ r.p }}</span></td>
                      <td>
                        <div style="display: flex; gap: 6px">
                          <button class="btn btn-success btn-sm" data-tooltip="Approve" (click)="decide(r, true)"><span [appIcon]="'check'"></span></button>
                          <button class="btn btn-danger btn-sm" data-tooltip="Reject" (click)="promptReject(r)"><span [appIcon]="'x'"></span></button>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        } @else {
          <div class="card">
            <div class="table-wrap">
              <table class="approvals-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Type</th>
                    <th>Details</th>
                    <th>Submitted</th>
                    <th>Priority</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  @if (currentRows().length === 0) {
                    <tr>
                      <td colspan="6">
                        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 48px 24px; gap: 12px">
                          <svg width="120" height="120" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="100" cy="100" r="80" fill="#F1F5F9" />
                            <rect x="55" y="65" width="90" height="110" rx="8" fill="#E2E8F0" />
                            <rect x="65" y="80" width="50" height="6" rx="3" fill="#CBD5E1" />
                            <rect x="65" y="95" width="70" height="6" rx="3" fill="#CBD5E1" />
                            <rect x="65" y="110" width="60" height="6" rx="3" fill="#CBD5E1" />
                            <rect x="65" y="125" width="40" height="6" rx="3" fill="#CBD5E1" />
                            <circle cx="140" cy="60" r="22" fill="#DBEAFE" stroke="#93C5FD" stroke-width="2" />
                            <line x1="133" y1="60" x2="147" y2="60" stroke="#3B82F6" stroke-width="2.5" stroke-linecap="round" />
                            <line x1="140" y1="53" x2="140" y2="67" stroke="#3B82F6" stroke-width="2.5" stroke-linecap="round" />
                          </svg>
                          <div style="font-weight: 600; font-size: 1rem; color: var(--text); margin-top: 8px">No Records Found</div>
                          <div style="font-size: 0.85rem; color: var(--muted)">There are no pending approval requests here.</div>
                        </div>
                      </td>
                    </tr>
                  }
                  @for (r of currentRows(); track r.apiId ?? r.n + r.t + r.d) {
                    <tr>
                      <td>
                        <div class="table-avatar">
                          <div class="avatar-placeholder avatar-sm" style="background: var(--p-soft); color: var(--p)">{{ initials(r.n) }}</div>
                          <span style="font-weight: 600">{{ r.n }}</span>
                        </div>
                      </td>
                      <td><span class="badge badge-primary">{{ r.t }}</span></td>
                      <td style="color: var(--muted)">{{ r.d }}</td>
                      <td style="color: var(--muted)">{{ r.sub }}</td>
                      <td><span class="badge" [class]="priorityClass(r.p)">{{ r.p }}</span></td>
                      <td>
                        <div style="display: flex; gap: 6px">
                          <button class="btn btn-success btn-sm" data-tooltip="Approve" (click)="decide(r, true)"><span [appIcon]="'check'"></span></button>
                          <button class="btn btn-danger btn-sm" data-tooltip="Reject" (click)="promptReject(r)"><span [appIcon]="'x'"></span></button>
                          <button class="btn btn-ghost btn-sm" data-tooltip="View" (click)="view(r)"><span [appIcon]="'eye'"></span></button>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }
      </div>
    </div>

    <!-- Approval Modal -->
    <div class="modal-overlay" [class.open]="ui.isOpen('approvalModal')" (click)="ui.onOverlayClick($event, 'approvalModal')">
      <div class="modal" style="max-width: 600px">
        <div class="modal-header">
          <div>
            <div class="card-title" style="font-size: 14px">{{ viewTarget()?.n }} — Approval Request</div>
            <div class="card-subtitle">{{ viewTarget()?.t }}</div>
          </div>
          <button class="btn btn-ghost btn-sm" (click)="ui.close('approvalModal')"><span [appIcon]="'x'"></span></button>
        </div>
        @if (viewTarget(); as r) {
          <div class="modal-body">
            <div style="padding: 12px; background: var(--p-soft); border-radius: 10px; margin-bottom: 14px">
              <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px">{{ r.n }}</div>
              <div style="font-size: 12px; color: var(--muted)">
                {{ r.t }} &middot; <span class="badge" [class]="priorityClass(r.p)">{{ r.p }}</span>
              </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px">
              @for (f of viewFields(r); track f[0]) {
                <div style="background: var(--bg); border-radius: 8px; padding: 10px">
                  <div style="font-size: 13px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px">
                    {{ f[0] }}
                  </div>
                  <div style="font-size: 13px; font-weight: 400; color: var(--text)">{{ f[1] }}</div>
                </div>
              }
            </div>
          </div>
        }
        <div class="modal-footer">
          <button class="btn btn-outline" (click)="ui.close('approvalModal')">Close</button>
          <button class="btn btn-danger" (click)="promptRejectFromModal()"><span [appIcon]="'x'"></span> Reject</button>
          <button class="btn btn-success" (click)="decideFromModal(true)"><span [appIcon]="'check'"></span> Approve</button>
        </div>
      </div>
    </div>

    <!-- Reject Reason Modal (matches Leave Request rejection dialog) -->
    <div class="modal-overlay" [class.open]="ui.isOpen('approvalRejectModal')" (click)="ui.onOverlayClick($event, 'approvalRejectModal')">
      <div class="modal" style="max-width: 480px; width: 100%">
        <div class="modal-header">
          <div>
            <div class="card-title" style="font-size: 15px; color: #dc2626; font-weight: 700;">
              Reject {{ rejectTarget()?.type === 'leave' || (rejectTarget()?.t?.toLowerCase()?.includes('leave') ?? false) ? 'Leave Request' : 'Approval Request' }}
            </div>
            <div class="card-subtitle" style="font-size: 13px; color: var(--muted, #64748b); margin-top: 2px;">
              {{ rejectTarget()?.n }} · {{ rejectTarget()?.t }}
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" (click)="ui.close('approvalRejectModal')"><span [appIcon]="'x'"></span></button>
        </div>
        <div class="modal-body" style="padding: 20px 24px;">
          <div style="background: var(--bg-card, #f8fafc); border: 1px solid var(--border, #e2e8f0); border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; font-size: 13px">
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px">
              <span style="color: var(--muted, #64748b)">Dates:</span>
              <span style="font-weight: 600; color: var(--text, #0f172a)">{{ getRejectDates(rejectTarget()?.d) }}</span>
            </div>
            <div style="display: flex; justify-content: space-between">
              <span style="color: var(--muted, #64748b)">Employee Reason:</span>
              <span style="font-weight: 600; color: var(--text, #0f172a)">{{ getRejectReason(rejectTarget()) }}</span>
            </div>
          </div>

          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" style="display: block; font-size: 13px; font-weight: 700; margin-bottom: 6px; color: var(--text, #0f172a);">
              Reason For Rejection <span style="color: #dc2626">*</span>
            </label>
            <textarea
              class="form-control"
              [class.is-invalid]="!!rejectionReasonError()"
              style="width: 100%; min-height: 90px; padding: 10px 12px; border-radius: 6px; border: 1px solid var(--border, #cbd5e1); font-size: 13px; font-family: inherit; resize: vertical; box-sizing: border-box;"
              rows="3"
              placeholder="State the mandatory reason for rejecting this leave request..."
              [value]="rejectionReason()"
              (input)="rejectionReason.set($any($event.target).value); rejectionReasonError.set('')"
            ></textarea>
            @if (rejectionReasonError()) {
              <div style="font-size: 11.5px; color: #dc2626; margin-top: 4px; font-weight: 500">
                {{ rejectionReasonError() }}
              </div>
            }
            <div style="font-size: 11.5px; color: var(--muted, #64748b); margin-top: 6px">
              This Rejection Reason Will Be Saved In The Database And Visible To The Employee.
            </div>
          </div>
        </div>
        <div class="modal-footer" style="padding: 16px 24px; border-top: 1px solid var(--border, #e2e8f0); display: flex; justify-content: flex-end; gap: 10px;">
          <button class="btn btn-outline" [disabled]="isRejecting()" (click)="ui.close('approvalRejectModal')">Cancel</button>
          <button
            class="btn"
            style="color: #dc2626; border: 1px solid #dc2626; background: #ffffff; font-weight: 600;"
            [disabled]="isRejecting()"
            (click)="confirmReject()"
          >
            {{ isRejecting() ? 'Rejecting...' : 'Confirm Rejection' }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .approvals-kpi-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        margin-bottom: 15px;
      }
      thead th,
      .approvals-table .table-avatar span,
      .approvals-table .badge,
      .approvals-table td {
        white-space: nowrap;
      }
      @media (max-width: 768px) {
        .approvals-kpi-grid {
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
          margin-bottom: 12px;
        }
        .approvals-kpi-grid .kpi-card {
          padding: 10px 12px;
        }
        .approvals-kpi-grid .kpi-value {
          font-size: 1.25rem;
        }
        .approvals-kpi-grid .kpi-label {
          font-size: 11px;
        }
        .approvals-table th,
        .approvals-table td {
          padding: 10px 8px;
        }
        .approvals-table th:nth-child(3),
        .approvals-table td:nth-child(3),
        .approvals-table th:nth-child(4),
        .approvals-table td:nth-child(4),
        .approvals-table th:nth-child(5),
        .approvals-table td:nth-child(5) {
          display: none;
        }
      }
    `,
  ],
})
export class ApprovalsComponent implements OnInit {
  protected readonly ui = inject(UiService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionService);
  private readonly api = inject(ApiService);
  private readonly notifState = inject(NotificationStateService);

  private readonly role = this.session.activeRole();
  protected readonly canReg = signal(this.role === 'Super Admin' || this.role === 'Company Admin' || this.role === 'HR Manager');

  protected readonly tab = signal<'all' | 'leave' | 'ot' | 'reg'>('all');
  protected readonly viewTarget = signal<Approval | null>(null);
  protected readonly rejectTarget = signal<Approval | null>(null);
  protected readonly rejectionReason = signal<string>('');
  protected readonly rejectionReasonError = signal<string>('');
  protected readonly isRejecting = signal<boolean>(false);

  protected readonly allData = signal<Approval[]>([]);

  protected readonly regData = signal<Approval[]>([]);

  protected readonly leaveData = computed(() => this.allData().filter((r) => r.type === 'leave'));

  protected readonly overtimeData = computed(() => this.allData().filter((r) => r.type === 'overtime'));

  ngOnInit(): void {
    this.loadApprovals();
    this.loadRegularizations();
  }

  private loadApprovals(): void {
    this.api.approvals({ status: 'Pending' }).subscribe({
      next: (rows) =>
        this.allData.set(
          rows.map((a) => ({
            apiId: a.id,
            n: a.employeeName,
            t: a.title,
            type: (a.type === 'Overtime' ? 'overtime' : a.type === 'Regularization' ? 'reg' : 'leave') as Approval['type'],
            d: a.details,
            sub: a.submittedLabel,
            p: a.priority as Approval['p'],
          })),
        ),
      error: () => {
        /* API offline — keep the demo approvals. */
      },
    });
  }

  private loadRegularizations(): void {
    this.api.regularizations().subscribe({
      next: (rows) =>
        this.regData.set(
          rows
            .filter((r) => r.status === 'Pending')
            .map((r) => ({
              apiId: r.id,
              n: r.employeeName,
              t: 'Regularization',
              type: 'reg' as const,
              d: [r.date, r.inTime && r.outTime ? `${r.inTime} – ${r.outTime}` : '', r.reason]
                .filter((part) => !!part)
                .join(' · '),
              sub: r.submittedLabel,
              p: 'Medium' as const,
              date: r.date,
              inTime: r.inTime,
              outTime: r.outTime,
              reason: r.reason,
            })),
        ),
      error: () => {
        /* API offline — keep the demo regularizations. */
      },
    });
  }

  protected readonly kpis = computed(() => {
    const base = [
      { l: 'Total Pending', v: `${this.allData().length + (this.canReg() ? this.regData().length : 0)}`, c: '#F59E0B' },
      { l: 'Leave Requests', v: `${this.leaveData().length}`, c: '#2563eb' },
      { l: 'Overtime', v: `${this.overtimeData().length}`, c: '#0D9488' },
    ];
    if (this.canReg()) base.push({ l: 'Regularization', v: `${this.regData().length}`, c: '#7c3aed' });
    return base;
  });

  /** Leave and overtime from ApprovalRequests, plus pending regularizations. */
  protected readonly combined = computed(() =>
    this.canReg() ? [...this.allData(), ...this.regData()] : [...this.allData()],
  );

  protected readonly currentRows = computed(() => {
    switch (this.tab()) {
      case 'leave':
        return this.leaveData();
      case 'ot':
        return this.overtimeData();
      default:
        return this.combined();
    }
  });

  protected initials(name: string): string {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('');
  }

  protected priorityClass(p: Approval['p']): string {
    return `badge-${p === 'High' ? 'danger' : p === 'Medium' ? 'warning' : 'info'}`;
  }

  protected viewFields(r: Approval): [string, string][] {
    return [
      ['Request Type', r.t],
      ['Details', r.d],
      ['Submitted', r.sub],
      ['Priority', r.p],
    ];
  }

  private drop(r: Approval): void {
    if (r.type === 'reg') {
      this.regData.update((list) => list.filter((x) => x.apiId !== r.apiId));
      return;
    }
    this.allData.update((list) => list.filter((x) => x.apiId !== r.apiId));
  }

  protected promptReject(r: Approval): void {
    this.rejectTarget.set(r);
    this.rejectionReason.set('');
    this.rejectionReasonError.set('');
    this.ui.open('approvalRejectModal');
  }

  protected promptRejectFromModal(): void {
    const r = this.viewTarget();
    this.ui.close('approvalModal');
    if (r) this.promptReject(r);
  }

  protected confirmReject(): void {
    const r = this.rejectTarget();
    if (!r) return;

    const reason = this.rejectionReason().trim();
    if (!reason) {
      this.rejectionReasonError.set('Rejection reason is mandatory.');
      return;
    }

    this.isRejecting.set(true);

    const finish = () => {
      this.isRejecting.set(false);
      this.ui.close('approvalRejectModal');
      this.drop(r);
      this.notifState.refresh();
      this.toast.show('Request Rejected', 'danger');
    };

    if (!r.apiId) {
      finish();
      return;
    }

    if (r.type === 'reg') {
      this.api.rejectRegularization(r.apiId).subscribe({
        next: finish,
        error: (error) => {
          this.isRejecting.set(false);
          this.toast.show(error?.error?.title ?? 'Could not reject request.', 'danger');
        },
      });
      return;
    }

    this.api.rejectApproval(r.apiId, reason).subscribe({
      next: finish,
      error: (error) => {
        this.isRejecting.set(false);
        this.toast.show(error?.error?.title ?? error?.error?.message ?? 'Could not reject request.', 'danger');
      },
    });
  }

  protected getRejectDates(d?: string): string {
    if (!d) return '—';
    const match = d.match(/(\d{2}[-/.]\d{2}[-/.]\d{4}\s*[-–]\s*\d{2}[-/.]\d{2}[-/.]\d{4})/);
    if (match) return match[1];
    const singleDate = d.match(/(\d{2}[-/.]\d{2}[-/.]\d{4})/);
    if (singleDate) return singleDate[1];
    const parts = d.split('·');
    return parts.length > 1 ? parts[1].trim() : d;
  }

  protected getRejectReason(r?: Approval | null): string {
    if (!r) return '—';
    if (r.reason) return r.reason;
    if (!r.d) return '—';
    const bracketMatch = r.d.match(/\[(.*?)\]/) || r.d.match(/\((.*?)\)/);
    if (bracketMatch) return bracketMatch[1];
    const parts = r.d.split('·');
    return parts.length > 2 ? parts.slice(2).join('·').trim() : '—';
  }

  protected decide(r: Approval, approved: boolean): void {
    if (!approved) {
      this.promptReject(r);
      return;
    }

    const finish = () => {
      this.drop(r);
      this.notifState.refresh();
      this.toast.show('Approved!', 'success');
    };

    if (!r.apiId) {
      finish();
      return;
    }

    if (r.type === 'reg') {
      const request = this.api.approveRegularization(r.apiId);
      request.subscribe({
        next: finish,
        error: (error) => this.toast.show(error?.error?.title ?? 'Could not update the request.', 'danger'),
      });
      return;
    }

    const request = this.api.approveApproval(r.apiId);
    request.subscribe({
      next: finish,
      error: (error) => this.toast.show(error?.error?.title ?? 'Could not update the request.', 'danger'),
    });
  }

  protected view(r: Approval): void {
    this.viewTarget.set(r);
    this.ui.open('approvalModal');
  }

  protected decideFromModal(approved: boolean): void {
    const r = this.viewTarget();
    this.ui.close('approvalModal');
    if (r) this.decide(r, approved);
  }

  protected approveAll(): void {
    const regCalls = this.canReg()
      ? this.regData()
          .filter((r) => !!r.apiId)
          .map((r) => this.api.approveRegularization(r.apiId!))
      : [];

    forkJoin([this.api.approveAllApprovals(), ...regCalls]).subscribe({
      next: () => {
        this.allData.set([]);
        this.regData.set([]);
        this.notifState.refresh();
        this.toast.show('All approved!');
      },
      error: (error) => {
        this.toast.show(error?.error?.title ?? 'Could not approve all requests.', 'danger');
        this.loadApprovals();
        this.loadRegularizations();
      },
    });
  }
}
