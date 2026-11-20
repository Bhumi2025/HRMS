import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import jsPDF from 'jspdf';
import { ApiService } from '../../core/api/api.service';
import { CompanySettings, EmployeeDetail, Payslip as ApiPayslip } from '../../core/api/api.models';
import { IconDirective } from '../../core/icons/icon.directive';
import { ToastService } from '../../core/services/toast.service';
import { UiService } from '../../core/services/ui.service';
import { SelectComponent, SelectOption } from '../../shared/select.component';

interface PayslipRow {
  id: string;
  m: string;
  net: string;
  gross: string;
  ded: string;
  days: number;
  status: string;
  date: string;
}

/** My Payslips — ported from pages/emp-payslips.html. */
@Component({
  selector: 'app-emp-payslips',
  imports: [CommonModule, IconDirective, SelectComponent],
  template: `
    <div style="display: flex; justify-content: flex-end; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 12px">
      <button class="btn btn-primary btn-sm" style="display: flex; align-items: center; gap: 6px" (click)="downloadLatest()">
        <span [appIcon]="'download'"></span> Download Latest
      </button>
    </div>

    <div class="card">
      <div class="card-header" style="margin-bottom: 12px">
        <div class="card-title">Payslip History</div>
        <app-select [options]="yearOptions()" [value]="year()" (valueChange)="year.set($event)" width="130px" />
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th>Pay Date</th>
              <th>Working Days</th>
              <th>Gross</th>
              <th>Deductions</th>
              <th>Net Pay</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (p of filtered(); track p.id) {
              <tr>
                <td style="font-weight: 600">{{ p.m }}</td>
                <td style="color: var(--muted)">{{ p.date }}</td>
                <td>{{ p.days }}</td>
                <td style="font-weight: 600">{{ p.gross }}</td>
                <td style="font-weight: 600; color: var(--danger)">{{ p.ded }}</td>
                <td style="font-weight: 800; color: var(--p)">{{ p.net }}</td>
                <td><span class="badge badge-success">{{ p.status }}</span></td>
                <td>
                  <div style="display: flex; gap: 4px">
                    <button class="btn btn-ghost btn-sm" data-tooltip="View" (click)="view(p)"><span [appIcon]="'eye'"></span></button>
                    <button class="btn btn-ghost btn-sm" data-tooltip="Download" (click)="downloadPayslip(p)">
                      <span [appIcon]="'download'"></span>
                    </button>
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>

    <div class="modal-overlay" [class.open]="ui.isOpen('viewModal')" (click)="ui.onOverlayClick($event, 'viewModal')">
      <div class="modal" style="max-width: 600px">
        <div class="modal-header">
          <div style="font-size: 1.1rem; font-weight: 700">{{ viewTarget()?.m }} Payslip</div>
          <button class="btn btn-ghost btn-sm" (click)="ui.close('viewModal')"><span [appIcon]="'x'"></span></button>
        </div>
        @if (viewTarget(); as p) {
          <div class="modal-body">
            <div style="background: var(--p-soft); border-radius: 10px; padding: 15px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap">
              <div>
                <div style="font-size: 13px; color: var(--muted); margin-bottom: 3px">Employee</div>
                <div style="font-weight: 700">{{ employee()?.fullName ?? '—' }}</div>
                <div style="font-size: 13px; color: var(--muted); margin-top: 2px">{{ employee()?.employeeCode ?? '—' }} - {{ employee()?.department ?? '—' }}</div>
              </div>
              <div>
                <div style="font-size: 13px; color: var(--muted); margin-bottom: 3px">Pay Period</div>
                <div style="font-weight: 700">{{ p.m }}</div>
                <div style="font-size: 13px; color: var(--muted); margin-top: 2px">Pay Date: {{ p.date }}</div>
              </div>
            </div>

            @for (r of breakdown(); track r[0]) {
              <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border)">
                <span style="font-size: 13px; font-weight: 600; color: var(--muted)">{{ r[0] }}</span>
                <span style="font-size: 13px; font-weight: 600" [style.color]="r[2] || 'var(--text)'">{{ r[1] }}</span>
              </div>
            }

            <div style="background: var(--p-soft); border: 2px solid rgba(37,99,235,.2); border-radius: 12px; padding: 15px 10px; display: flex; justify-content: space-between; align-items: center; margin-top: 16px">
              <div style="font-size: 14px; font-weight: 700">Net Pay</div>
              <div style="font-size: 1.3rem; font-weight: 700; color: var(--p)">{{ p.net }}</div>
            </div>
          </div>
        }
        <div class="modal-footer">
          <button class="btn btn-outline" (click)="ui.close('viewModal')">Close</button>
          <button class="btn btn-primary" style="display: flex; align-items: center; gap: 6px" (click)="downloadModal()">
            <span [appIcon]="'download'"></span> Download PDF
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      thead th,
      tbody td {
        white-space: nowrap;
      }
    `,
  ],
})
export class EmpPayslipsComponent implements OnInit {
  protected readonly ui = inject(UiService);
  protected readonly toast = inject(ToastService);
  private readonly api = inject(ApiService);

  protected readonly employee = signal<EmployeeDetail | null>(null);
  protected readonly company = signal<CompanySettings | null>(null);
  protected readonly yearOptions = signal<SelectOption[]>([{ v: '', l: 'All Years' }]);
  protected readonly year = signal('');
  protected readonly viewTarget = signal<PayslipRow | null>(null);
  protected readonly breakdown = signal<[string, string, string?][]>([]);

  private readonly payslips = signal<ApiPayslip[]>([]);

  protected readonly allPayslips = computed<PayslipRow[]>(() =>
    this.payslips().map((p) => ({
      id: p.id,
      m: `${this.monthName(p.month)} ${p.year}`,
      date: p.payDate,
      days: p.workingDays,
      gross: this.money(p.basicSalary + p.allowances),
      ded: this.money(p.deductions),
      net: this.money(p.netPay),
      status: p.status,
    })),
  );

  protected readonly filtered = computed(() => {
    const y = this.year();
    const rows = this.allPayslips();
    return y ? rows.filter((p) => p.m.includes(y)) : rows;
  });

  ngOnInit(): void {
    this.api.myPayslips().subscribe({
      next: (payslips) => {
        this.payslips.set(payslips);
        const years = [...new Set(payslips.map((p) => String(p.year)))].sort().reverse();
        this.yearOptions.set([{ v: '', l: 'All Years' }, ...years.map((y) => ({ v: y, l: y }))]);
      },
      error: () => this.toast.show('Could not load your payslips.', 'danger'),
    });

    this.api.employeeMe().subscribe({
      next: (employee) => this.employee.set(employee),
      error: () => {
        /* API offline — employee block stays blank. */
      },
    });

    this.api.company().subscribe({
      next: (settings) => this.company.set(settings),
      error: () => {
        /* Optional company info fallback */
      },
    });
  }

  protected view(row: PayslipRow): void {
    const payslip = this.payslips().find((p) => p.id === row.id);
    if (payslip) {
      this.breakdown.set([
        ['Basic Salary', this.money(payslip.basicSalary)],
        ['Allowances', this.money(payslip.allowances)],
        ['Deductions', `-${this.money(payslip.deductions)}`, 'var(--danger)'],
        ['Net Pay', this.money(payslip.netPay), 'var(--p)'],
      ]);
    }

    this.viewTarget.set(row);
    this.ui.open('viewModal');
  }

  protected downloadLatest(): void {
    const list = this.filtered();
    if (!list.length) {
      this.toast.show('No payslips available to download.', 'warning');
      return;
    }
    this.downloadPayslip(list[0]);
  }

  protected downloadPayslip(row: PayslipRow): void {
    const p = this.payslips().find((x) => x.id === row.id);
    if (!p) {
      this.toast.show('Payslip details not found.', 'danger');
      return;
    }
    this.createAndSavePdf(p, row.m);
  }

  protected downloadModal(): void {
    const target = this.viewTarget();
    if (!target) return;
    this.downloadPayslip(target);
    this.ui.close('viewModal');
  }

  private createAndSavePdf(payslip: ApiPayslip, month: string): void {
    const emp = this.employee();
    const comp = this.company();

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // Top Header Background Bar
    doc.setFillColor(15, 23, 42); // #0f172a
    doc.rect(0, 0, 210, 30, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(comp?.companyName || 'HRNexus Corp', 14, 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const addr = [comp?.address, comp?.city, comp?.country].filter(Boolean).join(', ') || 'Corporate Headquarters';
    doc.text(addr, 14, 20);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('PAYSLIP', 196, 13, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(`Period: ${month}`, 196, 20, { align: 'right' });
    doc.text(`Status: ${payslip.status || 'Processed'}`, 196, 25, { align: 'right' });

    // Employee & Payment Details Box
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
    doc.text('Payment Mode:', 110, 60);
    doc.text('Pay Date:', 110, 66);

    doc.setTextColor(17, 24, 39);
    doc.setFont('helvetica', 'bold');
    doc.text(payslip.employeeName || emp?.fullName || '—', 48, 48);
    doc.text(emp?.employeeCode || '—', 48, 54);
    doc.text(emp?.jobTitle || 'Specialist', 48, 60);
    doc.text(payslip.department || emp?.department || '—', 48, 66);

    doc.text(emp?.bankName || payslip.bankName || '—', 138, 48);
    doc.text(emp?.accountNumber || payslip.accountNumber || '—', 138, 54);
    doc.text(emp?.paymentMode || 'Bank Transfer', 138, 60);
    doc.text(payslip.payDate || '—', 138, 66);

    // Attendance & Working Days Summary Box
    doc.setFillColor(243, 244, 246);
    doc.roundedRect(14, 76, 182, 14, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(17, 24, 39);
    const payableDays = payslip.workingDays || 21;
    doc.text(`Total Payable Days: ${payableDays}`, 18, 84.5);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(75, 85, 99);
    const unpaidDays = payslip.unpaidDays ?? 0;
    const paidDays = payslip.paidLeaveDays ?? 0;
    const workedDays = payslip.workedDays ?? payableDays;
    doc.text(`Worked: ${workedDays}  |  Unpaid (LOP): ${unpaidDays}  |  Paid Leave: ${paidDays}`, 85, 84.5);

    // Earnings & Deductions Tables (Side by Side)
    let y = 94;
    doc.setFillColor(243, 244, 246);
    doc.rect(14, y, 91, 8, 'F');
    doc.rect(105, y, 91, 8, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(31, 41, 55);
    doc.text('EARNINGS', 18, y + 5.5);
    doc.text(`AMOUNT (${emp?.currency || 'USD'})`, 101, y + 5.5, { align: 'right' });
    doc.text('DEDUCTIONS', 109, y + 5.5);
    doc.text(`AMOUNT (${emp?.currency || 'USD'})`, 192, y + 5.5, { align: 'right' });

    y += 13;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(75, 85, 99);

    const basicVal = payslip.basicSalary || 0;
    const allowVal = payslip.allowances || 0;
    const grossVal = basicVal + allowVal;
    const dedVal = payslip.deductions || 0;

    // Row 1: Basic Salary
    doc.text('Basic Salary', 18, y);
    doc.text(this.money(basicVal), 101, y, { align: 'right' });
    doc.text('Loss of Pay (LOP) / Deductions', 109, y);
    doc.text(this.money(dedVal), 192, y, { align: 'right' });

    // Row 2: Allowances
    y += 8;
    doc.text('Allowances', 18, y);
    doc.text(this.money(allowVal), 101, y, { align: 'right' });

    // Totals Box
    y += 10;
    doc.setFillColor(249, 250, 251);
    doc.rect(14, y, 91, 8, 'F');
    doc.rect(105, y, 91, 8, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(17, 24, 39);
    doc.text('Total Gross Earnings', 18, y + 5.5);
    doc.text(this.money(grossVal), 101, y + 5.5, { align: 'right' });
    doc.text('Total Deductions', 109, y + 5.5);
    doc.text(this.money(dedVal), 192, y + 5.5, { align: 'right' });

    // Net Pay Callout
    y += 18;
    doc.setFillColor(236, 253, 245); // #ecfdf5
    doc.setDrawColor(16, 185, 129); // #10b981
    doc.roundedRect(14, y, 182, 18, 2, 2, 'FD');

    const netVal = payslip.netPay || (grossVal - dedVal);
    doc.setTextColor(6, 95, 70); // #065f46
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('TOTAL NET PAYABLE:', 20, y + 8);
    doc.setFontSize(13);
    doc.text(this.money(netVal), 190, y + 8, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(4, 120, 87);
    doc.text('Total Net Payable = Gross Earnings - Total Deductions', 190, y + 14, { align: 'right' });

    // Disclaimer
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(156, 163, 175);
    doc.text('This PDF is system-generated, no signature required.', 105, 275, { align: 'center' });

    const safeName = (payslip.employeeName || emp?.fullName || 'Employee').replace(/\s+/g, '_');
    const safeMonth = month.replace(/\s+/g, '_');
    doc.save(`Payslip_${safeName}_${safeMonth}.pdf`);
    this.toast.show(`Downloaded ${month} payslip successfully!`, 'success');
  }

  private money(value: number): string {
    return `$${value.toLocaleString()}`;
  }

  private monthName(month: number): string {
    return new Date(2000, month - 1, 1).toLocaleDateString('en-US', { month: 'long' });
  }
}
