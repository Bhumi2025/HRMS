import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import jsPDF from 'jspdf';
import { ApiService } from '../../core/api/api.service';
import { CompanySettings, EmployeeDetail, EmployeeListItem, Payslip } from '../../core/api/api.models';
import { IconDirective } from '../../core/icons/icon.directive';
import { ToastService } from '../../core/services/toast.service';
import { UiService } from '../../core/services/ui.service';

interface MailRecipient {
  id: string;
  name: string;
  email: string;
  dept: string;
}

/** Payslip — dynamic employee & month selector with live PDF download. */
@Component({
  selector: 'app-payslip',
  imports: [CommonModule, IconDirective],
  templateUrl: './payslip.component.html',
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
    const allowances = (emp.housingAllowance || 800) + (emp.transportAllowance || 400) + (emp.mobileAllowance || 150) + (emp.otherAllowances || 100);
    const deductions = 250;
    return {
      id: 'mock-slip',
      employeeId: emp.id,
      employeeName: emp.fullName,
      department: emp.department || 'Engineering',
      month: 11,
      year: 2026,
      basicSalary: basic,
      allowances: allowances,
      deductions: deductions,
      netPay: basic + allowances - deductions,
      workingDays: 30,
      paymentMode: 'Bank Transfer',
      status: 'Processed',
      payDate: '2026-11-30',
    };
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
      ['Bank', employee?.bankName || 'Emirates NBD'],
      ['Account', employee?.accountNumber || 'AE030330000000000123456'],
      ['Pay Period', this.selectedMonthFull()],
      ['Working Days', payslip ? `${payslip.workingDays}` : '30'],
    ];
  });

  protected readonly earnings = computed<[string, number][]>(() => {
    const payslip = this.selectedPayslip();
    const employee = this.employee();
    if (!payslip && !employee) return [];

    if (!employee && payslip) {
      return [['Basic Salary', payslip.basicSalary], ['Allowances', payslip.allowances]];
    }

    if (employee) {
      const basic = employee.basicSalary || (payslip ? payslip.basicSalary : 3200);
      const housing = employee.housingAllowance || 800;
      const transport = employee.transportAllowance || 400;
      const mobile = employee.mobileAllowance || 150;
      const other = employee.otherAllowances || 100;
      return [
        ['Basic Salary', basic],
        ['Housing Allowance', housing],
        ['Transport Allowance', transport],
        ['Mobile Allowance', mobile],
        ['Other Allowances', other],
      ];
    }

    return [];
  });

  protected readonly deductions = computed<[string, number][]>(() => {
    const payslip = this.selectedPayslip();
    return payslip ? [['Deductions', payslip.deductions]] : [['Standard Deductions / LOP', 250]];
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

  ngOnInit(): void {
    this.api.company().subscribe({
      next: (company) => this.company.set(company),
      error: () => {},
    });

    this.route.queryParamMap.subscribe((params) => {
      const queryEmpId = params.get('empId') || params.get('employeeId');
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
        if (payslips.length > 0) {
          this.selectedMonth.set(`${this.shortMonth(payslips[0].month)} ${payslips[0].year}`);
        } else {
          this.selectedMonth.set('Nov 2026');
        }
      },
      error: () => {
        this.selectedMonth.set('Nov 2026');
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

  protected sendMails(): void {
    const count = this.selected().size;
    if (!count) {
      this.toast.show('Please select at least one employee', 'danger');
      return;
    }
    this.ui.close('mailModal');
    this.toast.show('Sending payslips...');
    setTimeout(() => {
      this.toast.show(`${count} payslip${count > 1 ? 's' : ''} sent successfully for ${this.selectedMonthFull()}!`);
    }, 1200);
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

    // Header background bar
    doc.setFillColor(30, 58, 138); // Navy blue #1e3a8a
    doc.rect(0, 0, 210, 28, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(comp?.companyName || 'HRNEXUS CORP', 14, 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(`${comp?.address || 'Dubai Internet City, Dubai, UAE'} · TRN: ${comp?.trn || '100-2495-9201'}`, 14, 18);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('PAYSLIP', 196, 12, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(`Period: ${month}`, 196, 18, { align: 'right' });
    doc.text(`Pay Date: ${payslip?.payDate || '2026-11-30'}`, 196, 23, { align: 'right' });

    // Employee Details Box
    doc.setDrawColor(229, 231, 235);
    doc.setFillColor(249, 250, 251);
    doc.roundedRect(14, 34, 182, 32, 2, 2, 'FD');

    doc.setTextColor(31, 41, 55);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('EMPLOYEE DETAILS', 18, 40);
    doc.text('PAYMENT DETAILS', 110, 40);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(107, 114, 128);
    doc.text('Employee Name:', 18, 47);
    doc.text('Employee ID:', 18, 53);
    doc.text('Department:', 18, 59);

    doc.text('Bank Name:', 110, 47);
    doc.text('Account No:', 110, 53);
    doc.text('Days Worked:', 110, 59);

    doc.setTextColor(17, 24, 39);
    doc.setFont('helvetica', 'bold');
    doc.text(payslip?.employeeName || emp?.fullName || '—', 50, 47);
    doc.text(emp?.employeeCode || '—', 50, 53);
    doc.text(payslip?.department || emp?.department || '—', 50, 59);

    doc.text(emp?.bankName || 'Emirates NBD', 142, 47);
    doc.text(emp?.accountNumber || 'AE030330000000000123456', 142, 53);
    doc.text(`${payslip?.workingDays || 30} Days`, 142, 59);

    // Earnings & Deductions Tables
    let y = 74;
    doc.setFillColor(243, 244, 246);
    doc.rect(14, y, 91, 8, 'F');
    doc.rect(105, y, 91, 8, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(22, 101, 52); // green
    doc.text('EARNINGS', 18, y + 5.5);
    doc.text('AMOUNT ($)', 101, y + 5.5, { align: 'right' });

    doc.setTextColor(185, 28, 28); // red
    doc.text('DEDUCTIONS', 109, y + 5.5);
    doc.text('AMOUNT ($)', 192, y + 5.5, { align: 'right' });

    y += 8;
    const earningsList: [string, number][] = this.earnings().length > 0 
      ? this.earnings() 
      : [['Basic Salary', 3200], ['Housing Allowance', 800], ['Transport Allowance', 400], ['Other Allowances', 450]];
    const deductionsList: [string, number][] = this.deductions().length > 0
      ? this.deductions()
      : [['Tax & Social Security', 250], ['Insurance', 100]];

    const maxRows = Math.max(earningsList.length, deductionsList.length);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);

    for (let i = 0; i < maxRows; i++) {
      const earn = earningsList[i];
      const ded = deductionsList[i];

      doc.setDrawColor(243, 244, 246);
      doc.line(14, y + 7, 196, y + 7);

      if (earn) {
        doc.setTextColor(55, 65, 81);
        doc.text(earn[0], 18, y + 5);
        doc.setFont('helvetica', 'bold');
        doc.text(`$${earn[1].toLocaleString()}`, 101, y + 5, { align: 'right' });
        doc.setFont('helvetica', 'normal');
      }

      if (ded) {
        doc.setTextColor(55, 65, 81);
        doc.text(ded[0], 109, y + 5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(185, 28, 28);
        doc.text(`-$${ded[1].toLocaleString()}`, 192, y + 5, { align: 'right' });
        doc.setFont('helvetica', 'normal');
      }

      y += 7.5;
    }

    // Subtotal Row
    doc.setFillColor(249, 250, 251);
    doc.rect(14, y, 91, 8, 'F');
    doc.rect(105, y, 91, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(22, 101, 52);
    doc.text('Total Earnings', 18, y + 5.5);
    doc.text(`$${this.totalEarnings().toLocaleString()}`, 101, y + 5.5, { align: 'right' });

    doc.setTextColor(185, 28, 28);
    doc.text('Total Deductions', 109, y + 5.5);
    doc.text(`-$${this.totalDeductions().toLocaleString()}`, 192, y + 5.5, { align: 'right' });

    // Net Pay Banner
    y += 14;
    doc.setFillColor(238, 242, 255);
    doc.setDrawColor(199, 210, 254);
    doc.roundedRect(14, y, 182, 18, 2, 2, 'FD');

    doc.setTextColor(67, 56, 202);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('NET SALARY TAKE-HOME', 20, y + 8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.text('Paid via WPS Bank Direct Deposit', 20, y + 14);

    doc.setTextColor(30, 58, 138);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(`$${this.netPay().toLocaleString()}`, 190, y + 12, { align: 'right' });

    // Signatures
    y += 34;
    doc.setDrawColor(209, 213, 219);
    doc.line(20, y, 70, y);
    doc.line(140, y, 190, y);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.text('Employee Signature', 45, y + 5, { align: 'center' });
    doc.text('Authorized Signatory / HR', 165, y + 5, { align: 'center' });

    doc.text(
      'This document is an electronically verified payslip generated by HRMS Enterprise System.',
      105,
      285,
      { align: 'center' }
    );

    const safeName = (payslip?.employeeName || emp?.fullName || 'Employee').replace(/\s+/g, '_');
    doc.save(`Payslip-${safeName}-${month.replace(/\s+/g, '_')}.pdf`);
    this.toast.show('Payslip PDF downloaded successfully!');
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
