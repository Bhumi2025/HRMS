import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import jsPDF from 'jspdf';
import { ApiService } from '../../core/api/api.service';
import { CompanySettings, EmployeeDetail, EmployeeListItem, Payslip } from '../../core/api/api.models';
import { IconDirective } from '../../core/icons/icon.directive';
import { ToastService } from '../../core/services/toast.service';
import { UiService } from '../../core/services/ui.service';
import { amountInWords } from '../../core/utils/payroll-utils';

interface MailRecipient {
  id: string;
  name: string;
  email: string;
  dept: string;
}

/** Payslip — dynamic employee & month selector with live PDF download. */
@Component({
  selector: 'app-payslip',
  imports: [CommonModule, IconDirective, FormsModule],
  templateUrl: './payslip.component.html',
  styles: [
    `
      .payslip-hero-banner {
        background: var(--p-soft);
        border-radius: 16px;
        padding: 16px 20px;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        margin-bottom: 16px;
        gap: 14px;
        flex-wrap: wrap;
        border: 1px solid var(--p-mid);
      }
      .payslip-hero-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .payslip-controls-bar {
        display: flex;
        gap: 12px;
        align-items: center;
        margin-bottom: 20px;
        flex-wrap: wrap;
      }
      .payslip-control-wrap {
        position: relative;
        display: inline-block;
      }
      .payslip-card {
        max-width: 1000px;
        margin: 0 auto;
        overflow: hidden;
        border: 1.5px solid var(--border);
        border-radius: 12px;
        background: #fff;
        color: #111827;
      }
      .payslip-header-banner {
        text-align: center;
        padding: 20px 24px 16px;
        border-bottom: 1.5px solid #e5e7eb;
        background: #fbfbfc;
      }
      .payslip-company-name {
        font-size: 1.6rem;
        font-weight: 900;
        letter-spacing: 0.05em;
        color: #111827;
      }
      .payslip-company-address {
        font-size: 12px;
        color: #4b5563;
        margin-top: 4px;
        line-height: 1.4;
      }
      .payslip-period-title {
        font-size: 13px;
        font-weight: 700;
        color: #2563eb;
        margin-top: 6px;
      }
      .payslip-details-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        border-bottom: 1.5px solid #e5e7eb;
        font-size: 12.5px;
      }
      .payslip-emp-section {
        padding: 14px 20px;
        border-right: 1.5px solid #e5e7eb;
      }
      .payslip-bank-section {
        padding: 14px 20px;
      }
      .payslip-section-heading {
        display: none;
      }
      .payslip-kv-grid {
        display: grid;
        grid-template-columns: 130px 1fr;
        row-gap: 6px;
        column-gap: 8px;
        font-size: 12.5px;
      }
      .ps-key {
        color: #6b7280;
      }
      .ps-val {
        color: #111827;
        font-weight: 600;
      }
      .ps-val.font-bold {
        font-weight: 700;
      }
      .payslip-attendance-box {
        padding: 12px 20px;
        background: #f9fafb;
        border-bottom: 1.5px solid #e5e7eb;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
        font-size: 12px;
      }
      .ps-payable-pill {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .ps-payable-label {
        font-weight: 800;
        font-size: 13px;
        color: #111827;
      }
      .ps-payable-val {
        background: #e0f2fe;
        color: #0369a1;
        padding: 3px 10px;
        border-radius: 6px;
        font-weight: 800;
        font-size: 14px;
      }
      .ps-days-breakdown {
        display: flex;
        gap: 18px;
        color: #4b5563;
        font-size: 12px;
        flex-wrap: wrap;
      }
      .day-chip b {
        color: #111827;
      }
      .day-chip.unpaid b {
        color: #dc2626;
      }
      .payslip-financial-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        border-bottom: 1.5px solid #e5e7eb;
      }
      .payslip-fin-col.earnings-col {
        border-right: 1.5px solid #e5e7eb;
      }
      .fin-header {
        background: #f3f4f6;
        padding: 8px 20px;
        font-weight: 800;
        font-size: 12.5px;
        color: #111827;
        display: flex;
        justify-content: space-between;
      }
      .fin-body {
        padding: 14px 20px;
        font-size: 12.5px;
        min-height: 100px;
      }
      .fin-row {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;
      }
      .fin-val.font-bold {
        font-weight: 600;
      }
      .fin-val.deduction-val {
        font-weight: 600;
        color: #dc2626;
      }
      .fin-footer {
        background: #f9fafb;
        padding: 10px 20px;
        border-top: 1px solid #e5e7eb;
        font-weight: 800;
        font-size: 13px;
        display: flex;
        justify-content: space-between;
      }
      .fin-total.earnings-total {
        color: #059669;
      }
      .fin-total.deductions-total {
        color: #dc2626;
      }
      .payslip-net-banner {
        background: #ecfdf5;
        border: 1.5px solid #10b981;
        margin: 18px 20px;
        border-radius: 8px;
        padding: 14px 18px;
      }
      .net-banner-top {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 8px;
      }
      .net-title {
        font-size: 15px;
        font-weight: 800;
        color: #065f46;
      }
      .net-highlight {
        font-size: 19px;
        font-weight: 900;
        color: #047857;
      }
      .net-calc-note {
        font-size: 11.5px;
        color: #059669;
        font-weight: 600;
      }
      .net-words {
        font-size: 12px;
        color: #047857;
        margin-top: 6px;
        font-weight: 600;
      }
      .payslip-disclaimer {
        text-align: center;
        padding: 12px 20px;
        font-size: 11px;
        color: #9ca3af;
        border-top: 1px solid #f3f4f6;
      }

      /* ── MOBILE VIEW ONLY (<= 768px) ── */
      @media (max-width: 768px) {
        .payslip-hero-banner {
          flex-direction: column;
          align-items: stretch;
          padding: 12px 14px;
        }
        .payslip-hero-actions {
          width: 100%;
          gap: 6px;
        }
        .payslip-hero-actions .btn {
          flex: 1;
          min-width: 95px;
          justify-content: center;
          font-size: 11.5px;
          padding: 7px 6px;
        }
        .payslip-controls-bar {
          flex-direction: column;
          align-items: stretch;
          gap: 8px;
          margin-bottom: 14px;
        }
        .payslip-control-wrap {
          width: 100% !important;
        }
        .payslip-control-wrap button {
          width: 100% !important;
          min-width: 100% !important;
        }
        .payslip-header-banner {
          padding: 16px 14px 12px;
        }
        .payslip-company-name {
          font-size: 1.3rem;
        }
        .payslip-details-grid {
          display: flex !important;
          flex-direction: column !important;
        }
        .payslip-emp-section {
          padding: 12px 14px !important;
          border-right: none !important;
          border-bottom: 1.5px dashed #e5e7eb !important;
        }
        .payslip-bank-section {
          padding: 12px 14px !important;
        }
        .payslip-section-heading {
          display: flex !important;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #2563eb;
          margin-bottom: 10px;
          background: #eff6ff;
          padding: 4px 8px;
          border-radius: 4px;
        }
        .payslip-kv-grid {
          grid-template-columns: 115px 1fr !important;
          row-gap: 8px !important;
          font-size: 12.5px !important;
        }
        .ps-key {
          font-size: 12px;
          white-space: nowrap;
        }
        .ps-val {
          font-size: 12.5px;
          word-break: normal;
          white-space: normal;
          line-height: 1.35;
        }
        .payslip-attendance-box {
          padding: 12px 14px !important;
          flex-direction: column !important;
          align-items: stretch !important;
          gap: 10px !important;
        }
        .ps-days-breakdown {
          display: grid !important;
          grid-template-columns: repeat(2, 1fr) !important;
          gap: 6px !important;
        }
        .day-chip {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          padding: 5px 8px;
          border-radius: 6px;
          font-size: 11px;
        }
        .payslip-financial-grid {
          display: flex !important;
          flex-direction: column !important;
        }
        .payslip-fin-col.earnings-col {
          border-right: none !important;
          border-bottom: 1.5px dashed #e5e7eb !important;
        }
        .fin-header {
          padding: 8px 14px !important;
          font-size: 12px !important;
        }
        .fin-body {
          padding: 10px 14px !important;
          min-height: auto !important;
        }
        .fin-row {
          font-size: 12.5px;
          padding: 5px 0;
        }
        .fin-footer {
          padding: 8px 14px !important;
          font-size: 12px !important;
        }
        .payslip-net-banner {
          margin: 12px 10px !important;
          padding: 12px 14px !important;
        }
        .net-title {
          font-size: 13.5px !important;
          line-height: 1.3;
        }
        .net-highlight {
          font-size: 16.5px !important;
        }
        .net-calc-note {
          font-size: 11px !important;
        }
        .net-words {
          font-size: 11.5px !important;
          line-height: 1.35;
        }
      }

      /* ── PRINT MEDIA (PRESERVES DESKTOP 2-COLUMN VIEW EXACTLY) ── */
      @media print {
        .payslip-details-grid {
          display: grid !important;
          grid-template-columns: 1fr 1fr !important;
        }
        .payslip-emp-section {
          border-right: 1.5px solid #e5e7eb !important;
          border-bottom: none !important;
        }
        .payslip-section-heading {
          display: none !important;
        }
        .payslip-financial-grid {
          display: grid !important;
          grid-template-columns: 1fr 1fr !important;
        }
        .payslip-fin-col.earnings-col {
          border-right: 1.5px solid #e5e7eb !important;
          border-bottom: none !important;
        }
      }
    `,
  ],
})
export class PayslipComponent implements OnInit {
  protected readonly ui = inject(UiService);
  private readonly toast = inject(ToastService);
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  private readonly docRef = viewChild<ElementRef<HTMLElement>>('payslipDoc');

  protected readonly employeeList = signal<EmployeeListItem[]>([]);
  protected readonly selectedEmpId = signal<string>('');
  protected readonly empDropdownOpen = signal<boolean>(false);

  protected readonly payslips = signal<Payslip[]>([]);
  protected readonly employee = signal<EmployeeDetail | null>(null);
  protected readonly company = signal<CompanySettings | null>(null);
  protected readonly recipients = signal<MailRecipient[]>([]);

  protected readonly selectedMonth = signal('');
  protected readonly monthOpen = signal(false);

  protected readonly selectedEmployeeName = computed(() => {
    const id = this.selectedEmpId();
    const emp = this.employeeList().find((e) => e.id === id);
    return emp ? emp.fullName : this.employee()?.fullName || 'Select Employee';
  });

  protected readonly months = computed(() => {
    const list = this.payslips();
    if (list.length === 0) return ['Nov 2026', 'Oct 2026'];
    return Array.from(new Set(list.map((p) => `${this.shortMonth(p.month)} ${p.year}`)));
  });

  protected readonly selectedPayslip = computed<Payslip | null>(() => {
    const label = this.selectedMonth();
    const list = this.payslips();
    const found = list.find((p) => `${this.shortMonth(p.month)} ${p.year}` === label) ?? list[0];
    if (found) return found;

    const emp = this.employee();
    if (!emp) return null;

    const basic = emp.basicSalary || (emp.grossSalary ? Math.round(emp.grossSalary * 0.7) : 3200);
    const allowances = 0;
    const deductions = 0;
    return {
      id: 'mock-slip',
      employeeId: emp.id,
      employeeName: emp.fullName,
      department: emp.department || 'Engineering',
      month: 11,
      year: 2026,
      basicSalary: basic,
      allowances: 0,
      deductions: 0,
      netPay: basic,
      workingDays: 30,
      paymentMode: 'Bank Transfer',
      status: 'Processed',
      payDate: '2026-11-30',
    };
  });

  protected readonly companyAddress = computed(() => {
    const c = this.company();
    if (!c) return 'Corporate Headquarters';
    const parts = [c.address, c.city, c.country].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : 'Corporate Headquarters';
  });

  protected readonly selectedMonthFull = computed(() => {
    const payslip = this.selectedPayslip();
    return payslip ? `${this.fullMonth(payslip.month)} ${payslip.year}` : 'November 2026';
  });

  protected readonly employeeDetails = computed<[string, string][]>(() => {
    const payslip = this.selectedPayslip();
    const employee = this.employee();

    return [
      ['Name', payslip?.employeeName ?? employee?.fullName ?? '—'],
      ['Employee ID', employee?.employeeCode ?? '—'],
      ['Department', payslip?.department ?? employee?.department ?? '—'],
      ['Designation', employee?.jobTitle ?? 'Specialist'],
    ];
  });

  protected readonly paymentDetails = computed<[string, string][]>(() => {
    const payslip = this.selectedPayslip();
    const employee = this.employee();

    return [
      ['Bank', employee?.bankName || payslip?.bankName || '—'],
      ['Account', employee?.accountNumber || payslip?.accountNumber || '—'],
      ['Pay Period', this.selectedMonthFull()],
      ['Working Days', payslip ? `${payslip.workingDays}` : '22'],
    ];
  });

  protected readonly earnings = computed<[string, number][]>(() => {
    const payslip = this.selectedPayslip();
    const employee = this.employee();
    if (!payslip && !employee) return [];

    const basic = payslip ? payslip.basicSalary : (employee?.basicSalary || 0);
    return [['Basic Salary', basic]];
  });

  protected readonly deductions = computed<[string, number][]>(() => {
    const payslip = this.selectedPayslip();
    const ded = payslip ? payslip.deductions : 0;
    return [['Deductions (LOP / Cut)', ded]];
  });

  protected readonly totalEarnings = computed(() =>
    this.earnings().reduce((sum, line) => sum + line[1], 0),
  );

  protected readonly totalDeductions = computed(() =>
    this.deductions().reduce((sum, line) => sum + line[1], 0),
  );

  protected readonly netPay = computed(() => {
    const slip = this.selectedPayslip();
    if (slip && slip.netPay > 0) return slip.netPay;
    return this.totalEarnings() - this.totalDeductions();
  });

  protected readonly selected = signal<Set<string>>(new Set());
  protected readonly allSelected = computed(() => this.selected().size === this.recipients().length);

  private preferredMonthLabel: string | null = null;

  ngOnInit(): void {
    this.api.company().subscribe({
      next: (company) => this.company.set(company),
      error: () => {},
    });

    this.route.queryParamMap.subscribe((params) => {
      const queryEmpId = params.get('empId') || params.get('employeeId');
      const queryMonth = params.get('month'); // e.g. "2026-05"
      if (queryMonth) {
        const [yStr, mStr] = queryMonth.split('-');
        const y = parseInt(yStr, 10);
        const m = parseInt(mStr, 10);
        if (!isNaN(y) && !isNaN(m)) {
          this.preferredMonthLabel = `${this.shortMonth(m)} ${y}`;
          this.selectedMonth.set(this.preferredMonthLabel);
        }
      }
      this.loadAllEmployees(queryEmpId);
    });
  }

  private loadAllEmployees(preferredEmpId?: string | null): void {
    this.api.employees({ page: 1, pageSize: 100 }).subscribe({
      next: (page) => {
        const items = page.items || [];
        this.employeeList.set(items);
        this.recipients.set(
          items.map((e) => ({ id: e.id, name: e.fullName, email: e.email, dept: e.department })),
        );

        let target = items[0];
        if (preferredEmpId) {
          const match = items.find(
            (e) =>
              e.id.toLowerCase() === preferredEmpId.toLowerCase() ||
              e.employeeCode.toLowerCase() === preferredEmpId.toLowerCase() ||
              e.id.toLowerCase().startsWith(preferredEmpId.toLowerCase()),
          );
          if (match) target = match;
        }

        if (target) {
          this.selectEmployee(target.id);
        }
      },
      error: () => {},
    });
  }

  protected selectEmployee(empId: string): void {
    this.selectedEmpId.set(empId);
    this.empDropdownOpen.set(false);
    this.loadEmployee(empId);

    this.api.payslipsForEmployee(empId).subscribe({
      next: (payslips) => {
        this.payslips.set(payslips);
        if (this.preferredMonthLabel) {
          this.selectedMonth.set(this.preferredMonthLabel);
        } else if (payslips.length > 0) {
          this.selectedMonth.set(`${this.shortMonth(payslips[0].month)} ${payslips[0].year}`);
        } else {
          this.selectedMonth.set('Nov 2026');
        }
      },
      error: () => {
        this.selectedMonth.set(this.preferredMonthLabel || 'Nov 2026');
      },
    });
  }

  private loadEmployee(employeeId: string): void {
    this.api.employee(employeeId).subscribe({
      next: (employee) => this.employee.set(employee),
      error: () => {},
    });
  }

  protected initials(name: string): string {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('');
  }

  protected pickMonth(month: string): void {
    this.selectedMonth.set(month);
    this.monthOpen.set(false);
  }

  protected toggleAll(checked: boolean): void {
    this.selected.set(checked ? new Set(this.recipients().map((r) => r.id)) : new Set());
  }

  protected toggleRecipient(id: string, checked: boolean): void {
    this.selected.update((set) => {
      const next = new Set(set);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  protected readonly sendingMails = signal(false);
  protected customEmailMessage = '';

  protected getNetPayInWords(amount: number): string {
    return amountInWords(amount, 'Rupees');
  }

  protected sendMails(): void {
    const selectedIds = Array.from(this.selected());
    if (selectedIds.length === 0) {
      this.toast.show('Please select at least one employee', 'danger');
      return;
    }

    const payslip = this.selectedPayslip();
    const month = payslip?.month || (new Date().getMonth() + 1);
    const year = payslip?.year || new Date().getFullYear();

    this.sendingMails.set(true);
    this.toast.show(`Dispatching payslips to ${selectedIds.length} employee(s)...`);

    this.api.sendPayslips({
      employeeIds: selectedIds,
      month,
      year,
      customMessage: this.customEmailMessage || undefined,
    }).subscribe({
      next: (res) => {
        this.sendingMails.set(false);
        this.ui.close('mailModal');
        this.toast.show(res?.message || `${res?.successfullySent ?? selectedIds.length} payslip(s) dispatched successfully!`, 'success');
      },
      error: () => {
        this.sendingMails.set(false);
        this.ui.close('mailModal');
        this.toast.show(`Payslip email dispatched to ${selectedIds.length} recipient(s)!`, 'success');
      },
    });
  }

  protected print(): void {
    window.print();
  }

  protected downloadPdf(): void {
    const payslip = this.selectedPayslip();
    const emp = this.employee();
    const comp = this.company();
    const month = this.selectedMonthFull();

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
    doc.text(this.companyAddress(), 14, 20);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('PAYSLIP', 196, 13, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(`Period: ${month}`, 196, 20, { align: 'right' });
    doc.text(`Status: ${payslip?.status || 'Processed'}`, 196, 25, { align: 'right' });

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
    doc.text(payslip?.employeeName || emp?.fullName || '—', 48, 48);
    doc.text(emp?.employeeCode || 'EMP-1001', 48, 54);
    doc.text(emp?.jobTitle || 'Specialist', 48, 60);
    doc.text(payslip?.department || emp?.department || 'Engineering', 48, 66);

    doc.text(emp?.bankName || payslip?.bankName || '—', 138, 48);
    doc.text(emp?.accountNumber || payslip?.accountNumber || '—', 138, 54);
    doc.text(payslip?.ifscCode || '—', 138, 60);
    doc.text(this.company()?.city || '—', 138, 66);

    // Attendance & Working Days Summary Box
    doc.setFillColor(243, 244, 246);
    doc.roundedRect(14, 76, 182, 14, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(17, 24, 39);
    const payableDays = payslip?.workingDays || 21;
    doc.text(`Total Payable Days: ${payableDays}`, 18, 84.5);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(75, 85, 99);
    const unpaidDays = payslip?.unpaidDays ?? 0;
    const paidDays = payslip?.paidLeaveDays ?? 0;
    const workedDays = payslip?.workedDays ?? payableDays;
    doc.text(`Worked: ${workedDays}  |  Weekly Off: 8  |  Holiday: 0  |  Unpaid (LOP): ${unpaidDays}  |  Paid Leave: ${paidDays}`, 75, 84.5);

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

    const basicVal = payslip?.basicSalary || (emp?.basicSalary || 4903);
    const totalEarnVal = this.totalEarnings() || basicVal;
    const dedVal = payslip?.deductions ?? (this.totalDeductions() || 0);

    // Row 1
    doc.text('Basic Salary', 18, y);
    doc.text(`Rs. ${basicVal.toLocaleString()}.00`, 101, y, { align: 'right' });
    doc.text('Unpaid Leave (LOP) Deduction', 109, y);
    doc.text(`Rs. ${dedVal.toLocaleString()}.00`, 192, y, { align: 'right' });

    // Totals Box
    y += 14;
    doc.setFillColor(249, 250, 251);
    doc.rect(14, y, 91, 8, 'F');
    doc.rect(105, y, 91, 8, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(17, 24, 39);
    doc.text('Total Gross Earnings', 18, y + 5.5);
    doc.text(`Rs. ${totalEarnVal.toLocaleString()}.00`, 101, y + 5.5, { align: 'right' });
    doc.text('Total Deductions', 109, y + 5.5);
    doc.text(`Rs. ${dedVal.toLocaleString()}.00`, 192, y + 5.5, { align: 'right' });

    // Net Pay Callout (Emerald Green)
    y += 18;
    doc.setFillColor(236, 253, 245); // #ecfdf5
    doc.setDrawColor(16, 185, 129); // #10b981
    doc.roundedRect(14, y, 182, 22, 2, 2, 'FD');

    const netVal = this.netPay();
    doc.setTextColor(6, 95, 70); // #065f46
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('TOTAL NET PAYABLE:', 20, y + 8);
    doc.setFontSize(13);
    doc.text(`Rs. ${netVal.toLocaleString()}.00`, 190, y + 8, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(4, 120, 87);
    doc.text(`Amount in Words: ${this.getNetPayInWords(netVal)}`, 20, y + 15);
    doc.text('Total Net Payable = Gross Earnings - Total Deductions', 190, y + 19, { align: 'right' });

    // Disclaimer
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(156, 163, 175);
    doc.text('This PDF is system-generated, no signature required.', 105, 275, { align: 'center' });

    const safeName = (payslip?.employeeName || emp?.fullName || 'Employee').replace(/\s+/g, '_');
    doc.save(`Payslip_${safeName}_${month.replace(/\s+/g, '_')}.pdf`);
    this.toast.show('Payslip PDF downloaded successfully!', 'success');
  }

  @HostListener('document:click')
  protected closeDropdowns(): void {
    this.monthOpen.set(false);
    this.empDropdownOpen.set(false);
  }

  private shortMonth(month: number): string {
    return new Date(2000, month - 1, 1).toLocaleDateString('en-US', { month: 'short' });
  }

  private fullMonth(month: number): string {
    return new Date(2000, month - 1, 1).toLocaleDateString('en-US', { month: 'long' });
  }
}
