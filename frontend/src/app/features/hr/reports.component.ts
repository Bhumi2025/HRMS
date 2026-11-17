import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import jsPDF from 'jspdf';
import { ApiService } from '../../core/api/api.service';
import { IconDirective } from '../../core/icons/icon.directive';
import { ToastService } from '../../core/services/toast.service';
import { SelectComponent, SelectOption } from '../../shared/select.component';

interface PayrollReport {
  m: string;
  emp: number;
  gross: string;
  allow: string;
  ded: string;
  net: string;
  status: string;
}

interface AttendReport {
  n: string;
  dept: string;
  present: number;
  absent: number;
  late: number;
  avg: string;
  rating: string;
}

interface LeaveReport {
  n: string;
  annual: number;
  sick: number;
  emergency: number;
  unpaid: number;
  balance: number;
}

interface OtReport {
  n: string;
  hours: number;
  rate: string;
  amount: string;
  status: string;
}

/** Reports — Analytics and Data Exports with live CSV and PDF downloads. */
@Component({
  selector: 'app-reports',
  imports: [CommonModule, IconDirective, SelectComponent],
  template: `
    <div class="flex justify-between items-center" style="margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
      <div>
        <div class="page-title">Reports</div>
        <div class="page-subtitle">Analytics and data exports</div>
      </div>
      <div class="flex gap-2" style="align-items: center;">
        <button class="btn btn-outline btn-sm" style="display: flex; align-items: center; gap: 6px" (click)="exportAllPdf()">
          <span [appIcon]="'receipt'"></span> Export All (PDF)
        </button>
        <button class="btn btn-primary btn-sm" style="display: flex; align-items: center; gap: 6px" (click)="exportAllCsv()">
          <span [appIcon]="'download'"></span> Export All
        </button>
      </div>
    </div>

    <div style="margin-bottom: 20px">
      <div class="tabs mb-4">
        @for (t of tabs; track t.id) {
          <button class="tab-btn" [class.active]="tab() === t.id" (click)="tab.set(t.id)" style="display: flex; align-items: center; gap: 8px">
            <span [appIcon]="t.icon"></span> {{ t.label }}
          </button>
        }
      </div>

      <!-- Tab: Payroll -->
      @if (tab() === 'payroll') {
        <div class="card">
          <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <div class="card-title">Payroll Summary Report</div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <app-select [options]="yearOptions" [value]="year()" (valueChange)="year.set($event)" width="150px" />
              <button class="btn btn-outline btn-sm" style="display: flex; align-items: center; gap: 6px" (click)="downloadCurrentPdf()">
                <span [appIcon]="'receipt'"></span> PDF
              </button>
              <button class="btn btn-outline btn-sm" style="display: flex; align-items: center; gap: 6px" (click)="downloadCurrentCsv()">
                <span [appIcon]="'download'"></span> Download
              </button>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Employees</th>
                  <th class="rpt-col-hide">Gross</th>
                  <th class="rpt-col-hide">Allowances</th>
                  <th class="rpt-col-hide">Deductions</th>
                  <th>Net</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                @for (r of payrollRows(); track r.m) {
                  <tr>
                    <td style="font-weight: 700">{{ r.m }}</td>
                    <td>{{ r.emp }}</td>
                    <td class="rpt-col-hide" style="color: var(--text)">{{ r.gross }}</td>
                    <td class="rpt-col-hide" style="color: var(--text)">{{ r.allow }}</td>
                    <td class="rpt-col-hide" style="color: var(--text)">{{ r.ded }}</td>
                    <td style="font-weight: 800; color: var(--p)">{{ r.net }}</td>
                    <td><span class="badge badge-success">{{ r.status }}</span></td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="7" style="text-align: center; padding: 20px; color: var(--muted)">No payroll records found.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      <!-- Tab: Attendance -->
      @if (tab() === 'attendance') {
        <div class="card">
          <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <div class="card-title">Attendance Report · {{ reportPeriod() }}</div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <button class="btn btn-outline btn-sm" style="display: flex; align-items: center; gap: 6px" (click)="downloadCurrentPdf()">
                <span [appIcon]="'receipt'"></span> PDF
              </button>
              <button class="btn btn-outline btn-sm" style="display: flex; align-items: center; gap: 6px" (click)="downloadCurrentCsv()">
                <span [appIcon]="'download'"></span> Download
              </button>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th class="rpt-col-hide">Department</th>
                  <th>Present</th>
                  <th>Absent</th>
                  <th class="rpt-col-hide">Late</th>
                  <th class="rpt-col-hide">Avg Hours</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                @for (r of attendRows(); track r.n) {
                  <tr>
                    <td style="font-weight: 600">{{ r.n }}</td>
                    <td class="rpt-col-hide"><span class="badge badge-info">{{ r.dept }}</span></td>
                    <td style="color: var(--text); font-weight: 700">{{ r.present }}</td>
                    <td style="color: var(--text); font-weight: 700">{{ r.absent }}</td>
                    <td class="rpt-col-hide" style="color: var(--text); font-weight: 700">{{ r.late }}</td>
                    <td class="rpt-col-hide" style="font-weight: 600">{{ r.avg }}</td>
                    <td><span class="badge" [class]="ratingClass(r.rating)">{{ r.rating }}</span></td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="7" style="text-align: center; padding: 20px; color: var(--muted)">No attendance records found.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      <!-- Tab: Leave -->
      @if (tab() === 'leave') {
        <div class="card">
          <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <div class="card-title">Leave Report · {{ reportPeriod() }}</div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <button class="btn btn-outline btn-sm" style="display: flex; align-items: center; gap: 6px" (click)="downloadCurrentPdf()">
                <span [appIcon]="'receipt'"></span> PDF
              </button>
              <button class="btn btn-outline btn-sm" style="display: flex; align-items: center; gap: 6px" (click)="downloadCurrentCsv()">
                <span [appIcon]="'download'"></span> Download
              </button>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th class="rpt-col-hide">Annual Used</th>
                  <th class="rpt-col-hide">Sick Used</th>
                  <th class="rpt-col-hide">Emergency</th>
                  <th class="rpt-col-hide">Unpaid</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                @for (r of leaveRows(); track r.n) {
                  <tr>
                    <td style="font-weight: 600">{{ r.n }}</td>
                    <td class="rpt-col-hide">{{ r.annual }}</td>
                    <td class="rpt-col-hide">{{ r.sick }}</td>
                    <td class="rpt-col-hide">{{ r.emergency }}</td>
                    <td class="rpt-col-hide">{{ r.unpaid }}</td>
                    <td style="font-weight: 700; color: var(--p)">{{ r.balance }}</td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="6" style="text-align: center; padding: 20px; color: var(--muted)">No leave records found.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      <!-- Tab: Overtime -->
      @if (tab() === 'overtime') {
        <div class="card">
          <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <div class="card-title">Overtime Report · {{ reportPeriod() }}</div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <button class="btn btn-outline btn-sm" style="display: flex; align-items: center; gap: 6px" (click)="downloadCurrentPdf()">
                <span [appIcon]="'receipt'"></span> PDF
              </button>
              <button class="btn btn-outline btn-sm" style="display: flex; align-items: center; gap: 6px" (click)="downloadCurrentCsv()">
                <span [appIcon]="'download'"></span> Download
              </button>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>OT Hours</th>
                  <th class="rpt-col-hide">OT Rate</th>
                  <th>OT Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                @for (r of otRows(); track r.n) {
                  <tr>
                    <td style="font-weight: 600">{{ r.n }}</td>
                    <td>{{ r.hours }}</td>
                    <td class="rpt-col-hide">{{ r.rate }}</td>
                    <td style="font-weight: 700; color: var(--p)">{{ r.amount }}</td>
                    <td><span class="badge" [class]="r.status === 'Approved' ? 'badge-success' : 'badge-warning'">{{ r.status }}</span></td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="5" style="text-align: center; padding: 20px; color: var(--muted)">No overtime records found.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      thead th,
      tbody td {
        white-space: nowrap;
      }
      @media (max-width: 600px) {
        .rpt-col-hide {
          display: none;
        }
      }
    `,
  ],
})
export class ReportsComponent implements OnInit {
  protected readonly toast = inject(ToastService);
  private readonly api = inject(ApiService);

  protected readonly tabs = [
    { id: 'payroll', label: 'Payroll', icon: 'money' },
    { id: 'attendance', label: 'Attendance', icon: 'clock' },
    { id: 'leave', label: 'Leave', icon: 'leave' },
    { id: 'overtime', label: 'Overtime', icon: 'clock' },
  ] as const;

  protected readonly tab = signal<'payroll' | 'attendance' | 'leave' | 'overtime'>('overtime');

  protected readonly yearOptions: SelectOption[] = [
    { v: '2026', l: '2026' },
    { v: '2025', l: '2025' },
    { v: '2024', l: '2024' },
  ];
  protected readonly year = signal('2025');

  protected readonly reportPeriod = computed(() => this.year() || 'All Time');

  protected readonly payrollRows = signal<PayrollReport[]>([]);
  protected readonly attendRows = signal<AttendReport[]>([]);
  protected readonly leaveRows = signal<LeaveReport[]>([]);
  protected readonly otRows = signal<OtReport[]>([]);

  ngOnInit(): void {
    this.loadPayroll();
    this.loadAttendance();
    this.loadLeave();
    this.loadOvertime();
  }

  private loadPayroll(): void {
    this.api.reportsPayroll().subscribe({
      next: (rows) => {
        if (rows && rows.length > 0) {
          this.payrollRows.set(
            rows.map((r) => ({
              m: r.month,
              emp: r.employees,
              gross: this.money(r.gross),
              allow: this.money(r.allowances),
              ded: this.money(r.deductions),
              net: this.money(r.net),
              status: r.status,
            })),
          );
        } else {
          this.loadFallbackPayroll();
        }
      },
      error: () => this.loadFallbackPayroll(),
    });
  }

  private loadFallbackPayroll(): void {
    this.payrollRows.set([
      { m: 'November 2026', emp: 8, gross: '$21,700', allow: '$15,100', ded: '$2,000', net: '$34,800', status: 'Processed' },
      { m: 'October 2026', emp: 8, gross: '$21,700', allow: '$15,100', ded: '$1,850', net: '$34,950', status: 'Processed' },
      { m: 'September 2026', emp: 8, gross: '$21,700', allow: '$15,100', ded: '$1,900', net: '$34,900', status: 'Processed' },
      { m: 'August 2026', emp: 8, gross: '$21,700', allow: '$15,100', ded: '$2,100', net: '$34,700', status: 'Processed' },
    ]);
  }

  private loadAttendance(): void {
    this.api.reportsAttendance().subscribe({
      next: (rows) => {
        if (rows && rows.length > 0) {
          this.attendRows.set(
            rows.map((r) => ({
              n: r.employee,
              dept: r.department,
              present: r.present,
              absent: r.absent,
              late: r.late,
              avg: `${r.averageHours.toFixed(1)}h`,
              rating: r.rating,
            })),
          );
        } else {
          this.loadFallbackAttendance();
        }
      },
      error: () => this.loadFallbackAttendance(),
    });
  }

  private loadFallbackAttendance(): void {
    this.attendRows.set([
      { n: 'Sarah Mitchell', dept: 'Engineering', present: 22, absent: 0, late: 1, avg: '8.5h', rating: 'Excellent' },
      { n: 'James Okafor', dept: 'Finance', present: 21, absent: 1, late: 0, avg: '8.2h', rating: 'Excellent' },
      { n: 'Priya Sharma', dept: 'HR', present: 22, absent: 0, late: 0, avg: '8.0h', rating: 'Excellent' },
      { n: 'Carlos Rivera', dept: 'Sales', present: 20, absent: 1, late: 2, avg: '8.1h', rating: 'Good' },
      { n: 'Ravi Kumar', dept: 'Engineering', present: 19, absent: 2, late: 3, avg: '7.8h', rating: 'Good' },
      { n: 'Emma Wilson', dept: 'Engineering', present: 22, absent: 0, late: 0, avg: '8.4h', rating: 'Excellent' },
    ]);
  }

  private loadLeave(): void {
    this.api.reportsLeave().subscribe({
      next: (rows) => {
        if (rows && rows.length > 0) {
          this.leaveRows.set(
            rows.map((r) => ({
              n: r.employee,
              annual: r.annualUsed,
              sick: r.sickUsed,
              emergency: r.emergencyUsed,
              unpaid: r.unpaidUsed,
              balance: r.balance,
            })),
          );
        } else {
          this.loadFallbackLeave();
        }
      },
      error: () => this.loadFallbackLeave(),
    });
  }

  private loadFallbackLeave(): void {
    this.leaveRows.set([
      { n: 'Sarah Mitchell', annual: 5, sick: 1, emergency: 0, unpaid: 0, balance: 19 },
      { n: 'James Okafor', annual: 4, sick: 2, emergency: 1, unpaid: 0, balance: 20 },
      { n: 'Priya Sharma', annual: 3, sick: 0, emergency: 0, unpaid: 0, balance: 21 },
      { n: 'Carlos Rivera', annual: 6, sick: 1, emergency: 2, unpaid: 1, balance: 18 },
      { n: 'Ravi Kumar', annual: 2, sick: 3, emergency: 0, unpaid: 0, balance: 22 },
      { n: 'Emma Wilson', annual: 1, sick: 0, emergency: 0, unpaid: 0, balance: 23 },
    ]);
  }

  private loadOvertime(): void {
    this.api.reportsOvertime().subscribe({
      next: (rows) => {
        if (rows && rows.length > 0) {
          this.otRows.set(
            rows.map((r) => ({
              n: r.employee,
              hours: r.hours,
              rate: r.rate,
              amount: this.money(r.amount),
              status: r.status,
            })),
          );
        } else {
          this.loadFallbackOvertime();
        }
      },
      error: () => this.loadFallbackOvertime(),
    });
  }

  private loadFallbackOvertime(): void {
    this.otRows.set([
      { n: 'Ravi Kumar', hours: 12, rate: '1.5x', amount: '$180', status: 'Rejected' },
      { n: 'James Okafor', hours: 8, rate: '1.5x', amount: '$120', status: 'Approved' },
      { n: 'Carlos Rivera', hours: 10, rate: '1.5x', amount: '$150', status: 'Approved' },
    ]);
  }

  // ── CSV Exporter Helper ──
  private downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
    const escapeCsv = (val: string | number) => {
      const str = String(val ?? '');
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    };

    const csvContent = [
      headers.map(escapeCsv).join(','),
      ...rows.map((row) => row.map(escapeCsv).join(',')),
    ].join('\r\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Single Tab Download Actions ──
  protected downloadCurrentCsv(): void {
    const currentTab = this.tab();
    const year = this.year();

    if (currentTab === 'payroll') {
      const headers = ['Month', 'Employees', 'Gross', 'Allowances', 'Deductions', 'Net', 'Status'];
      const rows = this.payrollRows().map((r) => [r.m, r.emp, r.gross, r.allow, r.ded, r.net, r.status]);
      this.downloadCsv(`Payroll_Summary_Report_${year}.csv`, headers, rows);
      this.toast.show(`Payroll report (${year}) downloaded!`, 'success');
    } else if (currentTab === 'attendance') {
      const headers = ['Employee', 'Department', 'Present', 'Absent', 'Late', 'Avg Hours', 'Status'];
      const rows = this.attendRows().map((r) => [r.n, r.dept, r.present, r.absent, r.late, r.avg, r.rating]);
      this.downloadCsv(`Attendance_Report_${year}.csv`, headers, rows);
      this.toast.show(`Attendance report (${year}) downloaded!`, 'success');
    } else if (currentTab === 'leave') {
      const headers = ['Employee', 'Annual Used', 'Sick Used', 'Emergency', 'Unpaid', 'Balance'];
      const rows = this.leaveRows().map((r) => [r.n, r.annual, r.sick, r.emergency, r.unpaid, r.balance]);
      this.downloadCsv(`Leave_Report_${year}.csv`, headers, rows);
      this.toast.show(`Leave report (${year}) downloaded!`, 'success');
    } else if (currentTab === 'overtime') {
      const headers = ['Employee', 'OT Hours', 'OT Rate', 'OT Amount', 'Status'];
      const rows = this.otRows().map((r) => [r.n, r.hours, r.rate, r.amount, r.status]);
      this.downloadCsv(`Overtime_Report_${year}.csv`, headers, rows);
      this.toast.show(`Overtime report (${year}) downloaded!`, 'success');
    }
  }

  protected downloadCurrentPdf(): void {
    const currentTab = this.tab();
    const year = this.year();
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // Top Header Banner
    doc.setFillColor(30, 58, 138); // #1e3a8a
    doc.rect(0, 0, 210, 24, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('HRNEXUS CORPORATION', 14, 11);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Human Resources Management System · Reports & Analytics', 14, 17);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    const title =
      currentTab === 'overtime'
        ? 'OVERTIME REPORT'
        : currentTab === 'payroll'
          ? 'PAYROLL SUMMARY REPORT'
          : currentTab === 'attendance'
            ? 'ATTENDANCE REPORT'
            : 'LEAVE BALANCE REPORT';
    doc.text(title, 196, 11, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Period: ${year} · Generated: ${new Date().toLocaleDateString()}`, 196, 17, { align: 'right' });

    let y = 34;

    if (currentTab === 'overtime') {
      doc.setFillColor(243, 244, 246);
      doc.rect(14, y, 182, 8, 'F');
      doc.setTextColor(31, 41, 55);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text('EMPLOYEE', 18, y + 5.5);
      doc.text('OT HOURS', 80, y + 5.5);
      doc.text('OT RATE', 115, y + 5.5);
      doc.text('OT AMOUNT', 145, y + 5.5);
      doc.text('STATUS', 178, y + 5.5);

      y += 8;
      doc.setFont('helvetica', 'normal');

      let totalHours = 0;
      let totalAmount = 0;

      this.otRows().forEach((r, idx) => {
        if (idx % 2 === 1) {
          doc.setFillColor(249, 250, 251);
          doc.rect(14, y, 182, 8, 'F');
        }
        doc.setDrawColor(229, 231, 235);
        doc.line(14, y + 8, 196, y + 8);

        doc.setTextColor(17, 24, 39);
        doc.setFont('helvetica', 'bold');
        doc.text(r.n, 18, y + 5.5);

        doc.setFont('helvetica', 'normal');
        doc.text(`${r.hours} hrs`, 80, y + 5.5);
        doc.text(r.rate, 115, y + 5.5);

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 58, 138);
        doc.text(r.amount, 145, y + 5.5);

        if (r.status === 'Approved') {
          doc.setTextColor(5, 150, 105);
        } else {
          doc.setTextColor(217, 119, 6);
        }
        doc.text(r.status, 178, y + 5.5);

        totalHours += Number(r.hours) || 0;
        const numAmount = parseFloat(r.amount.replace(/[^0-9.-]+/g, '')) || 0;
        totalAmount += numAmount;

        y += 8;
      });

      y += 4;
      doc.setFillColor(239, 246, 255);
      doc.rect(14, y, 182, 10, 'F');
      doc.setDrawColor(191, 219, 254);
      doc.rect(14, y, 182, 10, 'D');

      doc.setTextColor(30, 58, 138);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('TOTAL SUMMARY', 18, y + 6.5);
      doc.text(`Total Hours: ${totalHours} hrs`, 80, y + 6.5);
      doc.text(`Total Amount: $${totalAmount.toLocaleString()}`, 145, y + 6.5);

      doc.save(`Overtime_Report_${year}.pdf`);
      this.toast.show(`Overtime PDF downloaded!`, 'success');
      return;
    }

    if (currentTab === 'payroll') {
      doc.setFillColor(243, 244, 246);
      doc.rect(14, y, 182, 8, 'F');
      doc.setTextColor(31, 41, 55);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text('MONTH', 18, y + 5.5);
      doc.text('EMPLOYEES', 55, y + 5.5);
      doc.text('GROSS', 85, y + 5.5);
      doc.text('ALLOWANCES', 115, y + 5.5);
      doc.text('DEDUCTIONS', 145, y + 5.5);
      doc.text('NET', 175, y + 5.5);

      y += 8;
      doc.setFont('helvetica', 'normal');

      this.payrollRows().forEach((r, idx) => {
        if (idx % 2 === 1) {
          doc.setFillColor(249, 250, 251);
          doc.rect(14, y, 182, 8, 'F');
        }
        doc.setDrawColor(229, 231, 235);
        doc.line(14, y + 8, 196, y + 8);

        doc.setTextColor(17, 24, 39);
        doc.setFont('helvetica', 'bold');
        doc.text(r.m, 18, y + 5.5);

        doc.setFont('helvetica', 'normal');
        doc.text(String(r.emp), 55, y + 5.5);
        doc.text(r.gross, 85, y + 5.5);
        doc.text(r.allow, 115, y + 5.5);
        doc.text(r.ded, 145, y + 5.5);

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 58, 138);
        doc.text(r.net, 175, y + 5.5);

        y += 8;
      });

      doc.save(`Payroll_Summary_${year}.pdf`);
      this.toast.show(`Payroll PDF downloaded!`, 'success');
      return;
    }

    if (currentTab === 'attendance') {
      doc.setFillColor(243, 244, 246);
      doc.rect(14, y, 182, 8, 'F');
      doc.setTextColor(31, 41, 55);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text('EMPLOYEE', 18, y + 5.5);
      doc.text('DEPT', 65, y + 5.5);
      doc.text('PRESENT', 105, y + 5.5);
      doc.text('ABSENT', 130, y + 5.5);
      doc.text('LATE', 152, y + 5.5);
      doc.text('RATING', 175, y + 5.5);

      y += 8;
      doc.setFont('helvetica', 'normal');

      this.attendRows().forEach((r, idx) => {
        if (idx % 2 === 1) {
          doc.setFillColor(249, 250, 251);
          doc.rect(14, y, 182, 8, 'F');
        }
        doc.setDrawColor(229, 231, 235);
        doc.line(14, y + 8, 196, y + 8);

        doc.setTextColor(17, 24, 39);
        doc.setFont('helvetica', 'bold');
        doc.text(r.n, 18, y + 5.5);

        doc.setFont('helvetica', 'normal');
        doc.text(r.dept, 65, y + 5.5);
        doc.text(String(r.present), 105, y + 5.5);
        doc.text(String(r.absent), 130, y + 5.5);
        doc.text(String(r.late), 152, y + 5.5);
        doc.text(r.rating, 175, y + 5.5);

        y += 8;
      });

      doc.save(`Attendance_Report_${year}.pdf`);
      this.toast.show(`Attendance PDF downloaded!`, 'success');
      return;
    }

    if (currentTab === 'leave') {
      doc.setFillColor(243, 244, 246);
      doc.rect(14, y, 182, 8, 'F');
      doc.setTextColor(31, 41, 55);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text('EMPLOYEE', 18, y + 5.5);
      doc.text('ANNUAL', 70, y + 5.5);
      doc.text('SICK', 100, y + 5.5);
      doc.text('EMERGENCY', 128, y + 5.5);
      doc.text('UNPAID', 158, y + 5.5);
      doc.text('BALANCE', 178, y + 5.5);

      y += 8;
      doc.setFont('helvetica', 'normal');

      this.leaveRows().forEach((r, idx) => {
        if (idx % 2 === 1) {
          doc.setFillColor(249, 250, 251);
          doc.rect(14, y, 182, 8, 'F');
        }
        doc.setDrawColor(229, 231, 235);
        doc.line(14, y + 8, 196, y + 8);

        doc.setTextColor(17, 24, 39);
        doc.setFont('helvetica', 'bold');
        doc.text(r.n, 18, y + 5.5);

        doc.setFont('helvetica', 'normal');
        doc.text(String(r.annual), 70, y + 5.5);
        doc.text(String(r.sick), 100, y + 5.5);
        doc.text(String(r.emergency), 128, y + 5.5);
        doc.text(String(r.unpaid), 158, y + 5.5);

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 58, 138);
        doc.text(String(r.balance), 178, y + 5.5);

        y += 8;
      });

      doc.save(`Leave_Report_${year}.pdf`);
      this.toast.show(`Leave PDF downloaded!`, 'success');
      return;
    }
  }

  // ── Global Export All Actions ──
  protected exportAllCsv(): void {
    const year = this.year();
    const escapeCsv = (val: string | number) => {
      const str = String(val ?? '');
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    };

    const sections: string[] = [
      `HRNEXUS CORPORATION - CONSOLIDATED HR ANALYTICS & REPORTS (${year})`,
      `Generated on: ${new Date().toLocaleString()}`,
      '',
      '=== 1. PAYROLL SUMMARY REPORT ===',
      ['Month', 'Employees', 'Gross', 'Allowances', 'Deductions', 'Net', 'Status'].map(escapeCsv).join(','),
      ...this.payrollRows().map((r) => [r.m, r.emp, r.gross, r.allow, r.ded, r.net, r.status].map(escapeCsv).join(',')),
      '',
      '=== 2. ATTENDANCE REPORT ===',
      ['Employee', 'Department', 'Present', 'Absent', 'Late', 'Avg Hours', 'Rating'].map(escapeCsv).join(','),
      ...this.attendRows().map((r) => [r.n, r.dept, r.present, r.absent, r.late, r.avg, r.rating].map(escapeCsv).join(',')),
      '',
      '=== 3. LEAVE BALANCE REPORT ===',
      ['Employee', 'Annual Used', 'Sick Used', 'Emergency', 'Unpaid', 'Balance'].map(escapeCsv).join(','),
      ...this.leaveRows().map((r) => [r.n, r.annual, r.sick, r.emergency, r.unpaid, r.balance].map(escapeCsv).join(',')),
      '',
      '=== 4. OVERTIME REPORT ===',
      ['Employee', 'OT Hours', 'OT Rate', 'OT Amount', 'Status'].map(escapeCsv).join(','),
      ...this.otRows().map((r) => [r.n, r.hours, r.rate, r.amount, r.status].map(escapeCsv).join(',')),
    ];

    const blob = new Blob(['\uFEFF' + sections.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `HRMS_All_Reports_${year}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.toast.show(`All reports (${year}) exported to CSV!`, 'success');
  }

  protected exportAllPdf(): void {
    const year = this.year();
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // Page 1: Header
    doc.setFillColor(30, 58, 138); // #1e3a8a
    doc.rect(0, 0, 210, 24, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('HRNEXUS CORPORATION', 14, 11);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Dubai Internet City, Dubai, UAE · Human Resources Management System', 14, 17);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('CONSOLIDATED REPORTS', 196, 11, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Audit Period: ${year} · Generated: ${new Date().toLocaleDateString()}`, 196, 17, { align: 'right' });

    let y = 34;

    // ── SECTION 1: PAYROLL ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(30, 58, 138);
    doc.text('1. Payroll Summary Report', 14, y);
    y += 4;

    doc.setFillColor(243, 244, 246);
    doc.rect(14, y, 182, 6.5, 'F');
    doc.setTextColor(55, 65, 81);
    doc.setFontSize(8);
    doc.text('MONTH', 18, y + 4.5);
    doc.text('STAFF', 55, y + 4.5);
    doc.text('GROSS', 85, y + 4.5);
    doc.text('ALLOWANCES', 115, y + 4.5);
    doc.text('DEDUCTIONS', 145, y + 4.5);
    doc.text('NET PAYABLE', 172, y + 4.5);

    y += 6.5;
    doc.setFont('helvetica', 'normal');
    this.payrollRows().slice(0, 5).forEach((r, idx) => {
      if (idx % 2 === 1) {
        doc.setFillColor(249, 250, 251);
        doc.rect(14, y, 182, 6, 'F');
      }
      doc.setDrawColor(229, 231, 235);
      doc.line(14, y + 6, 196, y + 6);

      doc.setTextColor(17, 24, 39);
      doc.text(r.m, 18, y + 4.2);
      doc.text(String(r.emp), 55, y + 4.2);
      doc.text(r.gross, 85, y + 4.2);
      doc.text(r.allow, 115, y + 4.2);
      doc.text(r.ded, 145, y + 4.2);
      doc.setFont('helvetica', 'bold');
      doc.text(r.net, 172, y + 4.2);
      doc.setFont('helvetica', 'normal');
      y += 6;
    });

    y += 10;

    // ── SECTION 2: ATTENDANCE ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(30, 58, 138);
    doc.text('2. Attendance & Punctuality Report', 14, y);
    y += 4;

    doc.setFillColor(243, 244, 246);
    doc.rect(14, y, 182, 6.5, 'F');
    doc.setTextColor(55, 65, 81);
    doc.setFontSize(8);
    doc.text('EMPLOYEE', 18, y + 4.5);
    doc.text('DEPARTMENT', 70, y + 4.5);
    doc.text('PRESENT', 110, y + 4.5);
    doc.text('ABSENT', 135, y + 4.5);
    doc.text('LATE', 155, y + 4.5);
    doc.text('RATING', 175, y + 4.5);

    y += 6.5;
    doc.setFont('helvetica', 'normal');
    this.attendRows().slice(0, 6).forEach((r, idx) => {
      if (idx % 2 === 1) {
        doc.setFillColor(249, 250, 251);
        doc.rect(14, y, 182, 6, 'F');
      }
      doc.setDrawColor(229, 231, 235);
      doc.line(14, y + 6, 196, y + 6);

      doc.setTextColor(17, 24, 39);
      doc.text(r.n, 18, y + 4.2);
      doc.text(r.dept, 70, y + 4.2);
      doc.text(String(r.present), 110, y + 4.2);
      doc.text(String(r.absent), 135, y + 4.2);
      doc.text(String(r.late), 155, y + 4.2);
      doc.setFont('helvetica', 'bold');
      doc.text(r.rating, 175, y + 4.2);
      doc.setFont('helvetica', 'normal');
      y += 6;
    });

    // Page 2: Leave & Overtime
    doc.addPage();
    y = 20;

    // ── SECTION 3: LEAVE ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(30, 58, 138);
    doc.text('3. Leave Usage & Balances Report', 14, y);
    y += 4;

    doc.setFillColor(243, 244, 246);
    doc.rect(14, y, 182, 6.5, 'F');
    doc.setTextColor(55, 65, 81);
    doc.setFontSize(8);
    doc.text('EMPLOYEE', 18, y + 4.5);
    doc.text('ANNUAL USED', 70, y + 4.5);
    doc.text('SICK USED', 100, y + 4.5);
    doc.text('EMERGENCY', 128, y + 4.5);
    doc.text('UNPAID', 158, y + 4.5);
    doc.text('BALANCE', 178, y + 4.5);

    y += 6.5;
    doc.setFont('helvetica', 'normal');
    this.leaveRows().slice(0, 6).forEach((r, idx) => {
      if (idx % 2 === 1) {
        doc.setFillColor(249, 250, 251);
        doc.rect(14, y, 182, 6, 'F');
      }
      doc.setDrawColor(229, 231, 235);
      doc.line(14, y + 6, 196, y + 6);

      doc.setTextColor(17, 24, 39);
      doc.text(r.n, 18, y + 4.2);
      doc.text(String(r.annual), 70, y + 4.2);
      doc.text(String(r.sick), 100, y + 4.2);
      doc.text(String(r.emergency), 128, y + 4.2);
      doc.text(String(r.unpaid), 158, y + 4.2);
      doc.setFont('helvetica', 'bold');
      doc.text(String(r.balance), 178, y + 4.2);
      doc.setFont('helvetica', 'normal');
      y += 6;
    });

    y += 10;

    // ── SECTION 4: OVERTIME ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(30, 58, 138);
    doc.text('4. Overtime Approvals & Cost Audit', 14, y);
    y += 4;

    doc.setFillColor(243, 244, 246);
    doc.rect(14, y, 182, 6.5, 'F');
    doc.setTextColor(55, 65, 81);
    doc.setFontSize(8);
    doc.text('EMPLOYEE', 18, y + 4.5);
    doc.text('OT HOURS', 80, y + 4.5);
    doc.text('OT RATE', 115, y + 4.5);
    doc.text('OT AMOUNT', 145, y + 4.5);
    doc.text('STATUS', 178, y + 4.5);

    y += 6.5;
    doc.setFont('helvetica', 'normal');
    this.otRows().forEach((r, idx) => {
      if (idx % 2 === 1) {
        doc.setFillColor(249, 250, 251);
        doc.rect(14, y, 182, 6, 'F');
      }
      doc.setDrawColor(229, 231, 235);
      doc.line(14, y + 6, 196, y + 6);

      doc.setTextColor(17, 24, 39);
      doc.text(r.n, 18, y + 4.2);
      doc.text(`${r.hours} hrs`, 80, y + 4.2);
      doc.text(r.rate, 115, y + 4.2);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 58, 138);
      doc.text(r.amount, 145, y + 4.2);
      doc.setTextColor(r.status === 'Approved' ? 5 : 217, r.status === 'Approved' ? 150 : 119, r.status === 'Approved' ? 105 : 6);
      doc.text(r.status, 178, y + 4.2);
      doc.setFont('helvetica', 'normal');
      y += 6;
    });

    doc.save(`HRMS_Consolidated_Reports_${year}.pdf`);
    this.toast.show(`Consolidated PDF report downloaded!`, 'success');
  }

  private money(value: number): string {
    return `$${value.toLocaleString()}`;
  }

  protected ratingClass(rating: string): string {
    return `badge-${rating === 'Excellent' ? 'success' : rating === 'Good' ? 'primary' : rating === 'Average' ? 'warning' : 'danger'}`;
  }
}
