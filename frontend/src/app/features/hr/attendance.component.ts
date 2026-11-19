import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ApiService } from '../../core/api/api.service';
import { AttendanceRecord, EmployeeListItem, MonthlyMusterDay, TodayAttendanceOverview } from '../../core/api/api.models';
import { IconDirective } from '../../core/icons/icon.directive';
import { PermissionService } from '../../core/services/permission.service';
import { SessionService } from '../../core/services/session.service';
import { ToastService } from '../../core/services/toast.service';
import { UiService } from '../../core/services/ui.service';

interface Regularization {
  id: string;
  employeeId?: string;
  employeeName: string;
  n?: string;
  date: string;
  inTime: string;
  outTime: string;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected' | string;
}

interface DynamicAttendanceRow {
  id: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  date: string;
  checkIn: string;
  checkOut: string;
  workHours: number;
  status: string;
  device?: string;
  dayStatusBadge: 'FD' | 'HD' | 'WK' | 'AB' | 'LV' | 'HL' | 'OD' | '—';
  dayStatusColor: string;
  dayStatusBg: string;
}

interface MusterDay {
  day: number;
  dateStr: string;
  dateFormatted: string;
  dayOfWeek: string;
  isWeekend: boolean;
  isToday: boolean;
  isFuture: boolean;
  dayStatusBadge: 'FD' | 'HD' | 'WK' | 'AB' | 'LV' | 'HL' | 'OD' | '—';
  dayStatusColor: string;
  dayStatusBg: string;
  attendanceIcon: 'P' | 'A' | 'L' | '⚠️' | '—';
  attendanceIconClass: string;
  actionStatus: string;
  inTime: string;
  inTimeRaw: string;
  outTime: string;
  outTimeRaw: string;
  isEarlyOut: boolean;
  isLateIn: boolean;
  totalTimeStr: string;
  breakHoursStr: string;
  productiveHoursStr: string;
  extraTimeStr: string;
  shiftName: string;
  locationName: string;
  jobRole: string;
  workHoursRaw: number;
  status: string;
  color: string;
  hours: string;
}

@Component({
  selector: 'app-attendance',
  imports: [CommonModule, FormsModule, IconDirective, RouterModule],
  template: `
    <!-- Top Action Header -->
    <div class="flex justify-end items-center" style="margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
      <div class="flex gap-2">
        <button class="btn btn-outline btn-sm" style="display: flex; align-items: center; gap: 6px;" (click)="exportCsv()">
          <span [appIcon]="'download'"></span> Export CSV
        </button>
        @if (perms.canCreate('Attendance')) {
          <button class="btn btn-primary btn-sm" style="display: flex; align-items: center; gap: 6px;" (click)="openQuickPunchModal()">
            <span [appIcon]="'clock'"></span> + Record Punch
          </button>
          <a class="btn btn-outline btn-sm" routerLink="/kiosk" target="_blank" style="display: flex; align-items: center; gap: 6px; border-color: #38bdf8; color: #0284c7; font-weight: 700;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
            Face Kiosk ⛶
          </a>
        }
      </div>
    </div>

    <!-- Daily KPIs (when on daily or reg tab) -->
    @if (tab() !== 'muster') {
      <div class="grid-4" style="margin-bottom: 20px;">
        @for (k of kpis(); track k.l) {
          <div class="kpi-card">
            <div class="kpi-icon" [style.background]="k.c + '18'" [style.color]="k.c">
              <span [appIcon]="'clock'"></span>
            </div>
            <div class="kpi-value">{{ k.v }}</div>
            <div class="kpi-label">{{ k.l }}</div>
          </div>
        }
      </div>
    }

    <!-- Main Navigation Tabs -->
    <div class="tabs-nav-bar" style="display: flex; gap: 8px; border-bottom: 1px solid var(--border); margin-bottom: 20px;">
      <button 
        class="tab-btn" 
        [class.active]="tab() === 'daily'" 
        (click)="tab.set('daily')"
        style="padding: 10px 18px; font-weight: 700; font-size: 13px; border: none; background: transparent; cursor: pointer; border-bottom: 2.5px solid transparent;"
        [style.border-bottom-color]="tab() === 'daily' ? 'var(--p)' : 'transparent'"
        [style.color]="tab() === 'daily' ? 'var(--p)' : 'var(--muted)'"
      >
        Daily Punch Log
      </button>
      <button 
        class="tab-btn" 
        [class.active]="tab() === 'muster'" 
        (click)="tab.set('muster')"
        style="padding: 10px 18px; font-weight: 700; font-size: 13px; border: none; background: transparent; cursor: pointer; border-bottom: 2.5px solid transparent;"
        [style.border-bottom-color]="tab() === 'muster' ? 'var(--p)' : 'transparent'"
        [style.color]="tab() === 'muster' ? 'var(--p)' : 'var(--muted)'"
      >
        Monthly Muster Register
      </button>
      @if (canReg()) {
        <button 
          class="tab-btn" 
          [class.active]="tab() === 'reg'" 
          (click)="tab.set('reg')"
          style="padding: 10px 18px; font-weight: 700; font-size: 13px; border: none; background: transparent; cursor: pointer; border-bottom: 2.5px solid transparent;"
          [style.border-bottom-color]="tab() === 'reg' ? 'var(--p)' : 'transparent'"
          [style.color]="tab() === 'reg' ? 'var(--p)' : 'var(--muted)'"
        >
          Regularization Requests
          <span style="background: var(--p); color: #fff; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 20px; margin-left: 6px;">
            {{ pendingCount() }}
          </span>
        </button>
      }
    </div>

    <!-- TAB 1: DAILY PUNCH LOG -->
    @if (tab() === 'daily') {
      <div class="card">
        <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div class="card-title">Daily Punch Records</div>
            <span class="badge badge-success" style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px;">
              <span class="pulse-indicator"></span>
              Live Records
            </span>
          </div>

          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <!-- Instant Search Input with Icon and Clear Button -->
            <div style="position: relative; display: flex; align-items: center;">
              <span style="position: absolute; left: 10px; color: var(--muted); pointer-events: none; display: flex;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              </span>
              <input 
                #searchInput
                type="search" 
                id="attendance_search_filter_query"
                name="attendance_search_filter_query"
                class="form-control" 
                placeholder="Search employee, ID, dept..." 
                style="width: 220px; font-size: 12px; padding: 6px 28px 6px 30px;"
                [value]="searchKeyword()"
                (input)="onSearchInput($any($event.target).value)"
                (change)="onSearchInput($any($event.target).value)"
                (search)="onSearchInput($any($event.target).value)"
                autocomplete="off"
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

            <!-- Date Picker Filter -->
            <input 
              type="date" 
              class="form-control" 
              style="width: 140px; font-size: 12px; padding: 6px 10px;"
              [(ngModel)]="filterDate"
              (change)="onFilterDateChange()"
            />

            <!-- Status Dropdown Filter -->
            <select 
              class="form-control" 
              style="width: 130px; font-size: 12px; padding: 6px 10px;"
              [ngModel]="filterStatus()"
              (ngModelChange)="filterStatus.set($event)"
            >
              <option value="">All Statuses</option>
              <option value="Present">Present</option>
              <option value="Late">Late</option>
              <option value="HalfDay">Half Day</option>
              <option value="Absent">Absent</option>
              <option value="OnLeave">On Leave</option>
            </select>

            <!-- Refresh Button -->
            <button 
              class="btn btn-outline btn-sm" 
              style="display: flex; align-items: center; gap: 5px; padding: 6px 12px;"
              (click)="refreshDailyAttendance()"
              title="Refresh live attendance"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>
              Refresh
            </button>
          </div>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>Date</th>
                <th>Day Status</th>
                <th>Check In</th>
                <th>Check Out</th>
                <th>Work Hours</th>
                <th>Status</th>
                <th>Device/Method</th>
                <th style="text-align: right;">Action</th>
              </tr>
            </thead>
            <tbody>
              @for (row of filteredDailyRows(); track row.id) {
                <tr>
                  <td>
                    <div class="table-avatar" style="cursor: pointer;" (click)="viewEmployeeMuster(row.id)">
                      <div class="avatar-placeholder avatar-sm" style="background: var(--p-soft); color: var(--p); font-weight: 700;">
                        {{ row.employeeName.charAt(0) }}
                      </div>
                      <div>
                        <div style="font-weight: 700; font-size: 13px; color: var(--p);">{{ row.employeeName }}</div>
                        <div style="font-size: 11px; color: var(--muted);">{{ row.employeeCode }}</div>
                      </div>
                    </div>
                  </td>
                  <td style="font-size: 13px; color: var(--muted);">{{ row.department }}</td>
                  <td style="font-size: 13px; font-weight: 600;">{{ row.date }}</td>
                  <td>
                    <span class="day-status-pill" [style.background]="row.dayStatusBg" [style.color]="row.dayStatusColor">
                      {{ row.dayStatusBadge }}
                    </span>
                  </td>
                  <td style="font-size: 13px; font-weight: 700; color: var(--text);">
                    {{ row.checkIn || '—' }}
                  </td>
                  <td style="font-size: 13px; font-weight: 700; color: var(--text);">
                    {{ row.checkOut || '—' }}
                  </td>
                  <td style="font-size: 13px; font-weight: 600;">
                    {{ row.workHours ? (row.workHours + ' hrs') : '—' }}
                  </td>
                  <td>
                    <span class="badge" [class]="statusClass(row.status)">
                      {{ row.status }}
                    </span>
                  </td>
                  <td>
                    <span style="display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--muted); background: var(--bg); padding: 3px 8px; border-radius: 4px; border: 1px solid var(--border);">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--p)" stroke-width="2"><path d="M12 12c0-3 2.5-5.5 5.5-5.5.7 0 1.4.1 2 .4"/><path d="M12 12c0 3-2.5 5.5-5.5 5.5-.7 0-1.4-.1-2-.4"/><path d="M12 7c-2.8 0-5 2.2-5 5 0 3.9 3.1 7 7 7 1.9 0 3.7-.8 5-2.1"/><path d="M12 2C6.5 2 2 6.5 2 12c0 3.3 1.6 6.2 4.1 8"/><path d="M22 12c0-5.5-4.5-10-10-10"/></svg>
                      {{ row.device || 'Face Terminal' }}
                    </span>
                  </td>
                  <td style="text-align: right;">
                    <button class="btn btn-ghost btn-sm" style="color: var(--p); font-size: 12px; font-weight: 700;" (click)="viewEmployeeMuster(row.id)">
                      View Muster ›
                    </button>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="10" style="text-align: center; padding: 36px 20px; color: var(--muted);">
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;">
                      <div style="font-size: 13px; font-weight: 500;">
                        @if (searchKeyword() || filterStatus()) {
                          No attendance records found matching filters: "{{ searchKeyword() || filterStatus() }}".
                        } @else {
                          No attendance records found for {{ filterDate }}.
                        }
                      </div>
                      @if (searchKeyword() || filterStatus()) {
                        <button 
                          type="button" 
                          class="btn btn-outline btn-sm btn-auto" 
                          style="width: auto !important; height: auto !important; padding: 6px 14px !important; font-size: 12px; margin-top: 4px; display: inline-flex; align-items: center; gap: 6px;"
                          (click)="clearFilters()"
                        >
                          <span [appIcon]="'x'"></span> Clear Filters
                        </button>
                      }
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }

    <!-- TAB 2: MONTHLY MUSTER REGISTER (IMAGE 2 DESIGN & LOGIC) -->
    @if (tab() === 'muster') {
      <div class="muster-container">
        <!-- 1. Header & Context Control Strip -->
        <div class="muster-top-bar">
          <div class="breadcrumb-container">
            <button class="back-link-btn" (click)="tab.set('daily')" title="Back to Daily Punch Log">
              ‹ Employee Attendance
            </button>
            <span class="breadcrumb-separator">/</span>
            <span class="employee-title">
              {{ selectedEmployee()?.fullName || 'Employee' }} - {{ selectedEmployee()?.employeeCode || 'EMP-1001' }}
            </span>
          </div>

          <div class="muster-controls">
            <!-- Employee Selector Dropdown -->
            <div class="selector-wrapper">
              <span class="selector-icon">👤</span>
              <select class="muster-emp-select" [(ngModel)]="selectedMusterEmpId" (change)="onEmployeeSelectChange()">
                @for (emp of employees(); track emp.id) {
                  <option [value]="emp.id">{{ emp.fullName }} ({{ emp.employeeCode }})</option>
                }
              </select>
            </div>

            <!-- Date / Month Range Picker with Next / Prev buttons -->
            <div class="date-picker-wrapper">
              <button class="month-nav-btn" (click)="prevMonth()" title="Previous Month">‹</button>
              <span class="selector-icon">📅</span>
              <input type="month" class="muster-month-input" [(ngModel)]="selectedMusterMonth" (change)="generateMuster()" />
              <button class="month-nav-btn" (click)="nextMonth()" title="Next Month">›</button>
            </div>

            <!-- Export Button -->
            <button class="btn btn-outline btn-sm muster-btn" (click)="exportCsv()" title="Export Muster CSV">
              <span [appIcon]="'download'"></span>
            </button>

            <!-- Quick Punch Button -->
            @if (perms.canCreate('Attendance')) {
              <button class="btn btn-primary btn-sm muster-add-btn" (click)="openQuickPunchModal()" title="Record Live Punch">
                +
              </button>
            }
          </div>
        </div>

        <!-- 2. The 16-Metric Ribbon (KPI Summary Bar matching Image 2) -->
        <div class="muster-kpi-card">
          <div class="kpi-ribbon-scroll">
            <div class="kpi-ribbon-item">
              <div class="kpi-val">{{ musterKpis().workingHours }}</div>
              <div class="kpi-lbl">Working Hours</div>
            </div>
            <div class="kpi-ribbon-item">
              <div class="kpi-val">
                {{ musterKpis().actualWorkingTime }}
                <span class="info-tip" title="Total hours clocked by employee this month">ℹ</span>
              </div>
              <div class="kpi-lbl">Actual Working Time</div>
            </div>
            <div class="kpi-ribbon-item">
              <div class="kpi-val">{{ musterKpis().trackedHours }}</div>
              <div class="kpi-lbl">Tracked Hours</div>
            </div>
            <div class="kpi-ribbon-item">
              <div class="kpi-val" [class.val-green]="musterKpis().diffPositive" [class.val-danger]="!musterKpis().diffPositive">
                {{ musterKpis().timeDifference }}
                <span class="info-tip" title="Variance between actual and expected shift hours">ℹ</span>
              </div>
              <div class="kpi-lbl">Time Difference</div>
            </div>
            <div class="kpi-ribbon-item">
              <div class="kpi-val val-green">{{ musterKpis().clockInDays }}</div>
              <div class="kpi-lbl">Clock In Days</div>
            </div>
            <div class="kpi-ribbon-item">
              <div class="kpi-val">{{ musterKpis().payrollPresentDays }}</div>
              <div class="kpi-lbl">Payroll Present Days</div>
            </div>
            <div class="kpi-ribbon-item">
              <div class="kpi-val">{{ musterKpis().odRemoteWork }}</div>
              <div class="kpi-lbl">OD/Remote work</div>
            </div>
            <div class="kpi-ribbon-item">
              <div class="kpi-val val-danger">{{ musterKpis().absentDays }}</div>
              <div class="kpi-lbl">Absent</div>
            </div>
            <div class="kpi-ribbon-item">
              <div class="kpi-val">{{ musterKpis().shiftNotStart }}</div>
              <div class="kpi-lbl">Shift Not Start</div>
            </div>
            <div class="kpi-ribbon-item">
              <div class="kpi-val">{{ musterKpis().onLeaveDays }}</div>
              <div class="kpi-lbl">On Leave</div>
            </div>
            <div class="kpi-ribbon-item">
              <div class="kpi-val val-warning">{{ musterKpis().lateIn }}</div>
              <div class="kpi-lbl">Late IN</div>
            </div>
            <div class="kpi-ribbon-item">
              <div class="kpi-val val-warning">{{ musterKpis().earlyOut }}</div>
              <div class="kpi-lbl">Early OUT</div>
            </div>
            <div class="kpi-ribbon-item">
              <div class="kpi-val">{{ musterKpis().paidLeave }}</div>
              <div class="kpi-lbl">Paid Leave</div>
            </div>
            <div class="kpi-ribbon-item">
              <div class="kpi-val">{{ musterKpis().unpaidLeave }}</div>
              <div class="kpi-lbl">Unpaid Leave</div>
            </div>
            <div class="kpi-ribbon-item">
              <div class="kpi-val">{{ musterKpis().odHourlyRemote }}</div>
              <div class="kpi-lbl">OD/Hourly Remote work</div>
            </div>
            <div class="kpi-ribbon-item">
              <div class="kpi-val">{{ musterKpis().hourlyPaidLeave }}</div>
              <div class="kpi-lbl">Hourly Paid Leave</div>
            </div>
          </div>
        </div>

        <!-- 3. The Rich Data Table matching Image 2 -->
        <div class="muster-table-card">
          <div class="table-wrap" style="overflow-x: auto;">
            <table class="muster-data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Display Name</th>
                  <th>Day Status</th>
                  <th>Attendance Status</th>
                  <th>Attendance Action</th>
                  <th>Clock IN</th>
                  <th>Clock OUT</th>
                  <th>Total Time</th>
                  <th>Break Hours</th>
                  <th>Productive Hours</th>
                  <th>Extra Time</th>
                  <th>Shift</th>
                  <th>Location</th>
                  <th>Job</th>
                  <th style="text-align: center;">Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (day of musterDays(); track day.dateStr) {
                  <tr [class.row-weekend]="day.isWeekend" [class.row-today]="day.isToday">
                    <!-- 1. Date -->
                    <td class="cell-date">
                      {{ day.dateFormatted }}
                    </td>

                    <!-- 2. Display Name -->
                    <td class="cell-name">
                      <span class="name-text">{{ selectedEmployee()?.fullName || '—' }}</span>
                    </td>

                    <!-- 3. Day Status -->
                    <td class="cell-day-status">
                      <span class="day-status-pill" [style.background]="day.dayStatusBg" [style.color]="day.dayStatusColor">
                        {{ day.dayStatusBadge }}
                      </span>
                    </td>

                    <!-- 4. Attendance Status -->
                    <td class="cell-att-status">
                      @if (day.attendanceIcon === '⚠️') {
                        <span class="status-icon-box warn" title="Ongoing or Incomplete Punch">⚠️</span>
                      } @else if (day.attendanceIcon === 'P') {
                        <span class="status-icon-box success" title="Present">P</span>
                      } @else if (day.attendanceIcon === 'A') {
                        <span class="status-icon-box danger" title="Absent">A</span>
                      } @else if (day.attendanceIcon === 'L') {
                        <span class="status-icon-box warn" title="Late Arrival">L</span>
                      } @else {
                        <span class="status-icon-dash">—</span>
                      }
                    </td>

                    <!-- 5. Attendance Action -->
                    <td class="cell-action">
                      <div class="action-select-box">
                        <span class="action-bullet" 
                          [class.bullet-ongoing]="day.actionStatus === 'On Going'" 
                          [class.bullet-present]="day.actionStatus === 'Present (P)'" 
                          [class.bullet-weekend]="day.actionStatus === 'Weekend'" 
                          [class.bullet-absent]="day.actionStatus === 'Absent (A)'"
                        ></span>
                        <select class="action-dropdown" [ngModel]="day.actionStatus" (ngModelChange)="onAttendanceActionChange(day, $event)">
                          <option value="Present (P)">Present (P)</option>
                          <option value="On Going">On Going</option>
                          <option value="Weekend">Weekend</option>
                          <option value="Absent (A)">Absent (A)</option>
                          <option value="Half Day">Half Day</option>
                          <option value="On Leave">On Leave</option>
                        </select>
                      </div>
                    </td>

                    <!-- 6. Clock IN -->
                    <td class="cell-clock-in">
                      @if (day.inTime !== '—') {
                        <span class="time-with-icon">
                          {{ day.inTime }}
                          <span class="punch-device-badge" title="Web / Biometric Punch">💻</span>
                        </span>
                      } @else {
                        <span class="dash">—</span>
                      }
                    </td>

                    <!-- 7. Clock OUT -->
                    <td class="cell-clock-out">
                      @if (day.outTime !== '—') {
                        <span class="time-with-icon" [class.early-out-text]="day.isEarlyOut" [title]="day.isEarlyOut ? 'Early Out (Departed before 05:00 PM)' : 'Normal Out'">
                          {{ day.outTime }}
                          <span class="punch-device-badge">💻</span>
                        </span>
                      } @else {
                        <span class="dash">—</span>
                      }
                    </td>

                    <!-- 8. Total Time -->
                    <td class="cell-total-time" [class.time-short]="day.workHoursRaw > 0 && day.workHoursRaw < 8" [class.time-good]="day.workHoursRaw >= 8">
                      {{ day.totalTimeStr }}
                    </td>

                    <!-- 9. Break Hours -->
                    <td class="cell-break-hours">
                      {{ day.breakHoursStr }}
                    </td>

                    <!-- 10. Productive Hours -->
                    <td class="cell-productive">
                      {{ day.productiveHoursStr }}
                    </td>

                    <!-- 11. Extra Time -->
                    <td class="cell-extra-time" [class.extra-positive]="day.extraTimeStr !== '—'">
                      {{ day.extraTimeStr }}
                    </td>

                    <!-- 12. Shift -->
                    <td class="cell-shift">
                      <span class="shift-badge-link" title="Shift Roster: 09:00 AM - 06:00 PM">{{ day.shiftName }}</span>
                    </td>

                    <!-- 13. Location -->
                    <td class="cell-location">
                      {{ day.locationName }}
                    </td>

                    <!-- 14. Job -->
                    <td class="cell-job">
                      {{ day.jobRole }}
                    </td>

                    <!-- 15. Actions -->
                    <td class="cell-actions" style="text-align: center;">
                      <div class="row-actions-group">
                        <button class="action-icon-btn" (click)="openDayDetails(day)" title="View Punch Timeline">
                          👁️
                        </button>
                        <button class="action-icon-btn" (click)="openRegularizeForDay(day)" title="Regularize / Edit Punch">
                          ✏️
                        </button>
                      </div>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="15" style="text-align: center; padding: 40px; color: var(--muted);">
                      No muster records found for this employee and period.
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    }

    <!-- TAB 3: REGULARIZATION REQUESTS -->
    @if (canReg() && tab() === 'reg') {
      <div class="card">
        <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
          <div class="card-title">Regularization Requests</div>
          <button class="btn btn-primary btn-sm" (click)="openRegModal()">+ New Request</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Date</th>
                <th>In Time</th>
                <th>Out Time</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (r of regData(); track r.id) {
                <tr>
                  <td>
                    <div class="table-avatar">
                      <div class="avatar-placeholder avatar-sm" style="background: var(--p-soft); color: var(--p); font-weight: 700;">
                        {{ (r.employeeName || r.n || 'E').charAt(0) }}
                      </div>
                      <span style="font-weight: 700; font-size: 13px;">{{ r.employeeName || r.n }}</span>
                    </div>
                  </td>
                  <td style="font-size: 13px; font-weight: 600;">{{ r.date }}</td>
                  <td style="font-size: 13px; font-weight: 700;">{{ r.inTime }}</td>
                  <td style="font-size: 13px; font-weight: 700;">{{ r.outTime }}</td>
                  <td style="font-size: 13px; color: var(--muted);">{{ r.reason }}</td>
                  <td>
                    <span class="badge" [class]="regClass(r.status)">
                      {{ r.status }}
                    </span>
                  </td>
                  <td>
                    @if (r.status === 'Pending') {
                      <div class="flex gap-1">
                        <button class="btn btn-outline btn-xs" style="color: var(--success); border-color: var(--success);" (click)="regAction(r, 'Approved')">Approve</button>
                        <button class="btn btn-outline btn-xs" style="color: var(--danger); border-color: var(--danger);" (click)="regAction(r, 'Rejected')">Reject</button>
                      </div>
                    } @else {
                      <span style="font-size: 12px; color: var(--muted);">—</span>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="7" style="text-align: center; padding: 24px; color: var(--muted);">No regularization requests found.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }

    <!-- Modal: Day Punch Details -->
    @if (showDayDetailModal() && selectedDetailDay()) {
      <div class="modal-overlay open" (click)="showDayDetailModal.set(false)">
        <div class="modal" style="max-width: 500px;" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <div style="font-size: 1.1rem; font-weight: 700;">Attendance Day Details</div>
            <button class="btn btn-ghost btn-sm" (click)="showDayDetailModal.set(false)"><span [appIcon]="'x'"></span></button>
          </div>
          <div class="modal-body">
            <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--bg); border-radius: 8px; margin-bottom: 16px;">
              <div class="avatar-placeholder avatar-md" style="background: var(--p-soft); color: var(--p); font-weight: 800; font-size: 16px;">
                {{ selectedEmployee()?.fullName?.charAt(0) || 'E' }}
              </div>
              <div>
                <div style="font-weight: 800; font-size: 14px;">{{ selectedEmployee()?.fullName }}</div>
                <div style="font-size: 12px; color: var(--muted);">{{ selectedEmployee()?.employeeCode }} · {{ selectedEmployee()?.department }}</div>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 13px;">
              <div style="padding: 10px; border: 1px solid var(--border); border-radius: 8px;">
                <div style="font-size: 11px; color: var(--muted); font-weight: 600; text-transform: uppercase;">Date</div>
                <div style="font-weight: 700; margin-top: 3px;">{{ selectedDetailDay()?.dateFormatted }}</div>
              </div>
              <div style="padding: 10px; border: 1px solid var(--border); border-radius: 8px;">
                <div style="font-size: 11px; color: var(--muted); font-weight: 600; text-transform: uppercase;">Shift &amp; Location</div>
                <div style="font-weight: 700; margin-top: 3px;">{{ selectedDetailDay()?.shiftName }} · {{ selectedDetailDay()?.locationName }}</div>
              </div>
              <div style="padding: 10px; border: 1px solid var(--border); border-radius: 8px;">
                <div style="font-size: 11px; color: var(--muted); font-weight: 600; text-transform: uppercase;">Clock IN</div>
                <div style="font-weight: 800; color: #16a34a; margin-top: 3px;">{{ selectedDetailDay()?.inTime }}</div>
              </div>
              <div style="padding: 10px; border: 1px solid var(--border); border-radius: 8px;">
                <div style="font-size: 11px; color: var(--muted); font-weight: 600; text-transform: uppercase;">Clock OUT</div>
                <div style="font-weight: 800; margin-top: 3px;" [class.early-out-text]="selectedDetailDay()?.isEarlyOut">
                  {{ selectedDetailDay()?.outTime }}
                  @if (selectedDetailDay()?.isEarlyOut) { <span style="font-size: 10px; font-weight: 700;">(Early Out)</span> }
                </div>
              </div>
              <div style="padding: 10px; border: 1px solid var(--border); border-radius: 8px;">
                <div style="font-size: 11px; color: var(--muted); font-weight: 600; text-transform: uppercase;">Total Hours</div>
                <div style="font-weight: 800; color: #0284c7; margin-top: 3px;">{{ selectedDetailDay()?.totalTimeStr }}</div>
              </div>
              <div style="padding: 10px; border: 1px solid var(--border); border-radius: 8px;">
                <div style="font-size: 11px; color: var(--muted); font-weight: 600; text-transform: uppercase;">Productive Hours</div>
                <div style="font-weight: 800; margin-top: 3px;">{{ selectedDetailDay()?.productiveHoursStr }}</div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-outline" (click)="showDayDetailModal.set(false)">Close</button>
            <button class="btn btn-primary" (click)="showDayDetailModal.set(false); openRegularizeForDay(selectedDetailDay()!)">
              ✏️ Regularize This Day
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Modal: Regularization Request -->
    @if (showRegModal()) {
      <div class="modal-overlay open" (click)="showRegModal.set(false)">
        <div class="modal" style="max-width: 480px;" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <div style="font-size: 1.1rem; font-weight: 700;">Request Attendance Regularization</div>
            <button class="btn btn-ghost btn-sm" (click)="showRegModal.set(false)"><span [appIcon]="'x'"></span></button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Employee <span style="color: var(--danger)">*</span></label>
              <select class="form-control" [(ngModel)]="newReg.employeeId" (ngModelChange)="onRegEmpChange($event)">
                @for (e of employees(); track e.id) {
                  <option [value]="e.id">{{ e.fullName }} ({{ e.department }})</option>
                }
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Date <span style="color: var(--danger)">*</span></label>
              <input class="form-control" type="date" [(ngModel)]="newReg.date" />
            </div>
            <div class="grid-2" style="gap: 12px;">
              <div class="form-group">
                <label class="form-label">Check-In Time <span style="color: var(--danger)">*</span></label>
                <input class="form-control" type="time" [(ngModel)]="newReg.inTime" />
              </div>
              <div class="form-group">
                <label class="form-label">Check-Out Time <span style="color: var(--danger)">*</span></label>
                <input class="form-control" type="time" [(ngModel)]="newReg.outTime" />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Reason <span style="color: var(--danger)">*</span></label>
              <textarea class="form-control" rows="3" [(ngModel)]="newReg.reason" placeholder="Reason for missed punch or regularization..."></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-outline" (click)="showRegModal.set(false)">Cancel</button>
            <button class="btn btn-primary" (click)="submitNewReg()">Submit Request</button>
          </div>
        </div>
      </div>
    }

    <!-- Modal: Quick Live Punch -->
    @if (showPunchModal()) {
      <div class="modal-overlay open" (click)="showPunchModal.set(false)">
        <div class="modal" style="max-width: 450px;" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <div style="font-size: 1.1rem; font-weight: 700;">Record Live Punch</div>
            <button class="btn btn-ghost btn-sm" (click)="showPunchModal.set(false)"><span [appIcon]="'x'"></span></button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Employee <span style="color: var(--danger)">*</span></label>
              <select class="form-control" [(ngModel)]="punchForm.employeeId">
                @for (e of employees(); track e.id) {
                  <option [value]="e.id">{{ e.fullName }} ({{ e.department }})</option>
                }
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Punch Type <span style="color: var(--danger)">*</span></label>
              <div style="display: flex; gap: 12px; margin-top: 4px;">
                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-weight: 600;">
                  <input type="radio" [(ngModel)]="punchForm.punchType" value="ClockIn" name="punchType" />
                  Clock In
                </label>
                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-weight: 600;">
                  <input type="radio" [(ngModel)]="punchForm.punchType" value="ClockOut" name="punchType" />
                  Clock Out
                </label>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Note / Reason</label>
              <input class="form-control" type="text" [(ngModel)]="punchForm.note" placeholder="Optional punch note..." />
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-outline" (click)="showPunchModal.set(false)">Cancel</button>
            <button class="btn btn-primary" (click)="submitQuickPunch()">Record Punch</button>
          </div>
        </div>
      </div>
    }

    <style>
      .pulse-indicator {
        width: 8px;
        height: 8px;
        background: #16a34a;
        border-radius: 50%;
        display: inline-block;
        box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.7);
        animation: pulseLive 2s infinite;
      }
      @keyframes pulseLive {
        0% {
          box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.7);
        }
        70% {
          box-shadow: 0 0 0 6px rgba(22, 163, 74, 0);
        }
        100% {
          box-shadow: 0 0 0 0 rgba(22, 163, 74, 0);
        }
      }

      /* ── Image 2 Muster Layout & Components ── */
      .muster-container {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .muster-top-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 12px;
        background: var(--surface);
        border: 1px solid var(--border);
        padding: 12px 18px;
        border-radius: 10px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.03);
      }
      .breadcrumb-container {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .back-link-btn {
        background: none;
        border: none;
        font-size: 14px;
        font-weight: 700;
        color: var(--muted);
        cursor: pointer;
        padding: 0;
        transition: color 0.15s ease;
      }
      .back-link-btn:hover {
        color: var(--p);
      }
      .breadcrumb-separator {
        color: var(--muted);
        font-weight: 600;
      }
      .employee-title {
        font-size: 14px;
        font-weight: 800;
        color: var(--text);
      }
      .muster-controls {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .selector-wrapper, .date-picker-wrapper {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 4px 10px;
      }
      .selector-icon {
        font-size: 13px;
        opacity: 0.8;
      }
      .muster-emp-select, .muster-month-input {
        border: none;
        background: transparent;
        font-size: 12px;
        font-weight: 600;
        color: var(--text);
        cursor: pointer;
        outline: none;
      }
      .month-nav-btn {
        background: none;
        border: none;
        font-size: 16px;
        font-weight: 800;
        color: var(--muted);
        cursor: pointer;
        padding: 0 4px;
        line-height: 1;
        transition: color 0.15s ease;
      }
      .month-nav-btn:hover {
        color: var(--p);
      }
      .muster-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 6px 12px;
      }
      .muster-add-btn {
        width: 32px;
        height: 32px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        font-weight: 700;
        border-radius: 8px;
      }

      /* 16-Metric Horizontal Ribbon (Image 2) */
      .muster-kpi-card {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 10px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.03);
        overflow: hidden;
      }
      .kpi-ribbon-scroll {
        display: flex;
        overflow-x: auto;
        scrollbar-width: thin;
      }
      .kpi-ribbon-item {
        flex: 1;
        min-width: 120px;
        padding: 12px 14px;
        border-right: 1px solid var(--border);
        display: flex;
        flex-direction: column;
        justify-content: center;
      }
      .kpi-ribbon-item:last-child {
        border-right: none;
      }
      .kpi-val {
        font-size: 13px;
        font-weight: 800;
        color: var(--text);
        display: flex;
        align-items: center;
        gap: 5px;
        white-space: nowrap;
      }
      .kpi-lbl {
        font-size: 10px;
        font-weight: 600;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.3px;
        margin-top: 4px;
        white-space: nowrap;
      }
      .val-green {
        color: #16a34a !important;
      }
      .val-danger {
        color: #dc2626 !important;
      }
      .val-warning {
        color: #ea580c !important;
      }
      .info-tip {
        font-size: 10px;
        color: var(--muted);
        cursor: help;
        border-radius: 50%;
        display: inline-flex;
        width: 13px;
        height: 13px;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--border);
      }

      /* Data Table */
      .muster-table-card {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 10px;
        overflow: hidden;
        box-shadow: 0 1px 3px rgba(0,0,0,0.03);
      }
      .muster-data-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      .muster-data-table th {
        background: var(--bg);
        color: var(--muted);
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        padding: 11px 12px;
        border-bottom: 1px solid var(--border);
        text-align: left;
        white-space: nowrap;
      }
      .muster-data-table td {
        padding: 9px 12px;
        border-bottom: 1px solid var(--border);
        vertical-align: middle;
        white-space: nowrap;
      }
      .muster-data-table tr:hover td {
        background: rgba(0, 0, 0, 0.015);
      }
      .row-weekend td {
        background: rgba(241, 245, 249, 0.4);
      }
      .row-today td {
        background: rgba(59, 130, 246, 0.04);
      }

      .cell-date {
        font-weight: 700;
        color: var(--text);
      }
      .name-text {
        color: var(--muted);
        font-weight: 500;
      }
      .day-status-pill {
        display: inline-block;
        font-size: 11px;
        font-weight: 800;
        padding: 2px 8px;
        border-radius: 6px;
        text-align: center;
        min-width: 28px;
      }
      .status-icon-box {
        width: 22px;
        height: 22px;
        border-radius: 5px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 800;
      }
      .status-icon-box.success {
        background: #dcfce7;
        color: #16a34a;
      }
      .status-icon-box.danger {
        background: #fee2e2;
        color: #dc2626;
      }
      .status-icon-box.warn {
        background: #fef3c7;
        color: #d97706;
      }
      .status-icon-dash {
        color: var(--muted);
        font-weight: 700;
      }

      .action-select-box {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 2px 8px;
      }
      .action-bullet {
        width: 6px;
        height: 6px;
        border-radius: 50%;
      }
      .bullet-present {
        background: #16a34a;
      }
      .bullet-ongoing {
        background: #0284c7;
        box-shadow: 0 0 0 2px rgba(2, 132, 199, 0.2);
      }
      .bullet-weekend {
        background: #94a3b8;
      }
      .bullet-absent {
        background: #dc2626;
      }
      .action-dropdown {
        border: none;
        background: transparent;
        font-size: 11px;
        font-weight: 600;
        color: var(--text);
        outline: none;
        cursor: pointer;
      }

      .time-with-icon {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-weight: 700;
      }
      .punch-device-badge {
        font-size: 10px;
        opacity: 0.7;
      }
      .early-out-text {
        color: #dc2626 !important;
        font-weight: 800;
      }
      .cell-total-time {
        font-weight: 700;
      }
      .time-short {
        color: #0284c7;
      }
      .time-good {
        color: var(--text);
      }
      .extra-positive {
        color: #16a34a;
        font-weight: 700;
      }
      .shift-badge-link {
        color: #0284c7;
        font-weight: 700;
        font-size: 11px;
        cursor: pointer;
        text-decoration: underline;
        text-decoration-style: dotted;
      }
      .row-actions-group {
        display: inline-flex;
        gap: 6px;
        align-items: center;
      }
      .action-icon-btn {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 13px;
        padding: 2px 4px;
        border-radius: 4px;
        transition: background 0.15s ease;
      }
      .action-icon-btn:hover {
        background: var(--bg);
      }
      .dash {
        color: var(--muted);
      }

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
    </style>
  `
})
export class AttendanceComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('searchInput') set searchInputSetter(ref: ElementRef<HTMLInputElement> | undefined) {
    this.searchInputRef = ref;
    if (ref?.nativeElement && !this.searchKeyword()) {
      ref.nativeElement.value = '';
      setTimeout(() => {
        if (ref?.nativeElement && !this.searchKeyword()) {
          ref.nativeElement.value = '';
        }
      }, 50);
      setTimeout(() => {
        if (ref?.nativeElement && !this.searchKeyword()) {
          ref.nativeElement.value = '';
        }
      }, 250);
    }
  }
  searchInputRef?: ElementRef<HTMLInputElement>;

  protected readonly ui = inject(UiService);
  protected readonly toast = inject(ToastService);
  protected readonly perms = inject(PermissionService);
  private readonly session = inject(SessionService);
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  protected readonly tab = signal<'daily' | 'muster' | 'reg'>('daily');
  protected readonly canReg = signal(this.session.activeRole() !== 'Employee');

  // Reactive signals for instant search & filtering
  protected readonly searchKeyword = signal('');
  protected readonly filterStatus = signal('');
  protected filterDate = new Date().toISOString().slice(0, 10);

  protected selectedMusterEmpId = '';
  protected selectedMusterMonth = new Date().toISOString().slice(0, 7);

  protected readonly employees = signal<EmployeeListItem[]>([]);
  protected readonly dailyRows = signal<DynamicAttendanceRow[]>([]);
  protected readonly musterDays = signal<MusterDay[]>([]);
  protected readonly showRegModal = signal(false);
  protected readonly showPunchModal = signal(false);
  protected readonly showDayDetailModal = signal(false);
  protected readonly selectedDetailDay = signal<MusterDay | null>(null);

  private pollInterval: any = null;

  protected newReg = {
    employeeId: '',
    employeeName: '',
    date: new Date().toISOString().slice(0, 10),
    inTime: '09:00',
    outTime: '18:00',
    reason: '',
  };

  protected punchForm = {
    employeeId: '',
    punchType: 'ClockIn',
    note: '',
  };

  protected readonly kpis = signal([
    { l: 'Present Today', v: '0', c: 'var(--success)' },
    { l: 'Absent', v: '0', c: 'var(--danger)' },
    { l: 'Late Arrivals', v: '0', c: 'var(--warning)' },
    { l: 'On Leave', v: '0', c: 'var(--p)' },
  ]);

  protected readonly regData = signal<Regularization[]>([]);

  protected readonly pendingCount = computed(() => this.regData().filter((r) => r.status === 'Pending').length);

  // Selected Employee object computed
  protected readonly selectedEmployee = computed(() => {
    const id = this.selectedMusterEmpId;
    return this.employees().find((e) => e.id === id) || this.employees()[0] || null;
  });

  // 16-Metric Horizontal Ribbon computed for selected employee and month
  protected readonly musterKpis = computed(() => {
    const days = this.musterDays();
    const todayStr = new Date().toISOString().slice(0, 10);

    let workingDaysCount = 0;
    let clockedInDays = 0;
    let presentDays = 0;
    let halfDays = 0;
    let absentDays = 0;
    let scheduledDays = 0;
    let onLeaveDays = 0;
    let lateInCount = 0;
    let earlyOutCount = 0;
    let paidLeaveDays = 0;
    let unpaidLeaveDays = 0;
    let totalWorkMinutes = 0;

    for (const d of days) {
      if (!d.isWeekend && !d.isFuture) {
        workingDaysCount++;
      }
      if (d.inTime && d.inTime !== '—') {
        clockedInDays++;
      }
      if (d.status === 'Present') {
        presentDays++;
      } else if (d.status === 'HalfDay') {
        halfDays++;
      } else if (d.status === 'Absent') {
        absentDays++;
      } else if (d.status === 'OnLeave') {
        onLeaveDays++;
        paidLeaveDays++;
      } else if (d.status === 'Scheduled' || d.isFuture) {
        scheduledDays++;
      }

      if (d.isLateIn) lateInCount++;
      if (d.isEarlyOut) earlyOutCount++;

      totalWorkMinutes += Math.round((d.workHoursRaw || 0) * 60);
    }

    // Expected working hours = working days * 8 hours
    const expectedTotalMinutes = Math.max(workingDaysCount * 8 * 60, 0);
    const expH = Math.floor(expectedTotalMinutes / 60);
    const expM = expectedTotalMinutes % 60;
    const workingHoursStr = `${String(expH).padStart(2, '0')} H : ${String(expM).padStart(2, '0')} M : 00 S`;

    // Actual working hours
    const actH = Math.floor(totalWorkMinutes / 60);
    const actM = totalWorkMinutes % 60;
    const actualWorkingStr = `${String(actH).padStart(2, '0')} H : ${String(actM).padStart(2, '0')} M : 00 S`;

    // Tracked hours
    const trackedHoursStr = actualWorkingStr;

    // Time difference
    const diffMinutes = totalWorkMinutes - expectedTotalMinutes;
    const sign = diffMinutes >= 0 ? '+' : '-';
    const absDiff = Math.abs(diffMinutes);
    const diffH = Math.floor(absDiff / 60);
    const diffM = absDiff % 60;
    const timeDiffStr = `${sign}${String(diffH).padStart(2, '0')} H : ${String(diffM).padStart(2, '0')} M : 00 S`;

    const payrollPresent = presentDays + halfDays * 0.5 + paidLeaveDays;

    return {
      workingHours: workingHoursStr,
      actualWorkingTime: actualWorkingStr,
      trackedHours: trackedHoursStr,
      timeDifference: timeDiffStr,
      diffPositive: diffMinutes >= 0,
      clockInDays: clockedInDays,
      payrollPresentDays: payrollPresent,
      odRemoteWork: 0,
      absentDays: absentDays,
      shiftNotStart: scheduledDays,
      onLeaveDays: onLeaveDays,
      lateIn: lateInCount,
      earlyOut: earlyOutCount,
      paidLeave: paidLeaveDays,
      unpaidLeave: unpaidLeaveDays,
      odHourlyRemote: '00H : 00M',
      hourlyPaidLeave: '00H : 00M',
    };
  });

  // Reactive computed for instant filter & search matching
  protected readonly filteredDailyRows = computed(() => {
    const q = this.searchKeyword().toLowerCase().trim();
    const st = this.filterStatus().toLowerCase().replace(/\s+/g, '');

    return this.dailyRows().filter((r) => {
      const matchQ =
        !q ||
        r.employeeName.toLowerCase().includes(q) ||
        r.employeeCode.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q);

      const rowSt = r.status.toLowerCase().replace(/\s+/g, '');
      const matchSt = !st || rowSt === st;

      return matchQ && matchSt;
    });
  });

  ngOnInit(): void {
    this.route.queryParams.subscribe((params) => {
      if (params['tab'] === 'muster') {
        this.tab.set('muster');
        if (params['month']) {
          this.selectedMusterMonth = params['month'];
        }
        if (params['employeeId']) {
          this.selectedMusterEmpId = params['employeeId'];
        }
        if (this.selectedMusterEmpId) {
          this.generateMuster();
        }
      } else if (params['tab'] === 'reg') {
        this.tab.set('reg');
      } else if (params['tab'] === 'daily') {
        this.tab.set('daily');
      }
    });

    this.loadEmployees();
    this.loadDailyAttendance();
    this.loadRegularizations();
    this.startLivePolling();
  }

  ngAfterViewInit(): void {
    const wipeAutofill = () => {
      if (this.searchInputRef?.nativeElement && !this.searchKeyword()) {
        this.searchInputRef.nativeElement.value = '';
      }
    };
    setTimeout(wipeAutofill, 50);
    setTimeout(wipeAutofill, 150);
    setTimeout(wipeAutofill, 300);
    setTimeout(wipeAutofill, 600);
    setTimeout(wipeAutofill, 1200);
  }

  ngOnDestroy(): void {
    this.stopLivePolling();
  }

  private startLivePolling(): void {
    this.pollInterval = setInterval(() => {
      const todayStr = new Date().toISOString().slice(0, 10);
      if (this.tab() === 'daily' && this.filterDate === todayStr) {
        this.loadDailyAttendance(true);
      }
    }, 10000);
  }

  private stopLivePolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  protected onSearchInput(val: string): void {
    this.searchKeyword.set(val || '');
  }

  protected onSearchChange(val: string): void {
    this.searchKeyword.set(val || '');
  }

  protected clearSearch(): void {
    this.searchKeyword.set('');
    if (this.searchInputRef?.nativeElement) {
      this.searchInputRef.nativeElement.value = '';
    }
  }

  protected clearFilters(): void {
    this.searchKeyword.set('');
    this.filterStatus.set('');
    if (this.searchInputRef?.nativeElement) {
      this.searchInputRef.nativeElement.value = '';
    }
  }

  protected refreshDailyAttendance(): void {
    this.loadDailyAttendance(false);
    this.toast.show('Attendance records refreshed');
  }

  private loadEmployees(): void {
    this.api.employees({ page: 1, pageSize: 100 }).subscribe({
      next: (res) => {
        this.employees.set(res.items);
        if (res.items.length > 0 && !this.selectedMusterEmpId) {
          this.selectedMusterEmpId = res.items[0].id;
          this.newReg.employeeId = res.items[0].id;
          this.newReg.employeeName = res.items[0].fullName;
          this.punchForm.employeeId = res.items[0].id;
          this.generateMuster();
        }
      },
      error: () => {},
    });
  }

  protected loadDailyAttendance(silent: boolean = false): void {
    this.api.todayAttendanceOverview(this.filterDate).subscribe({
      next: (res: TodayAttendanceOverview) => {
        if (res) {
          const presentCount = res.presentCount ?? 0;
          const absentCount = res.absentCount ?? 0;
          const lateCount = res.lateCount ?? 0;
          const onLeaveCount = res.onLeaveCount ?? 0;
          this.kpis.set([
            { l: 'Present Today', v: `${presentCount}`, c: 'var(--success)' },
            { l: 'Absent', v: `${absentCount}`, c: 'var(--danger)' },
            { l: 'Late Arrivals', v: `${lateCount}`, c: 'var(--warning)' },
            { l: 'On Leave', v: `${onLeaveCount}`, c: 'var(--p)' },
          ]);

          const rows: DynamicAttendanceRow[] = [];

          // 1. Present employees
          for (const p of res.present || []) {
            const isLate = p.status === 'Late';
            rows.push({
              id: p.employeeId,
              employeeCode: p.employeeCode,
              employeeName: p.employeeName,
              department: p.department,
              date: this.filterDate,
              checkIn: p.checkInTime || '—',
              checkOut: p.checkOutTime || '—',
              workHours: p.workHours ?? 0,
              status: p.status || 'Present',
              device: 'Face Terminal / Web',
              dayStatusBadge: isLate ? 'HD' : 'FD',
              dayStatusColor: isLate ? '#ea580c' : '#15803d',
              dayStatusBg: isLate ? '#ffedd5' : '#dcfce7',
            });
          }

          // 2. OnLeave employees
          for (const p of res.onLeave || []) {
            rows.push({
              id: p.employeeId,
              employeeCode: p.employeeCode,
              employeeName: p.employeeName,
              department: p.department,
              date: this.filterDate,
              checkIn: '—',
              checkOut: '—',
              workHours: 0,
              status: 'On Leave',
              device: p.leaveReason ? `Leave: ${p.leaveReason}` : 'Approved Leave',
              dayStatusBadge: 'LV',
              dayStatusColor: '#9333ea',
              dayStatusBg: '#f3e8ff',
            });
          }

          // 3. Absent employees
          for (const p of res.absent || []) {
            rows.push({
              id: p.employeeId,
              employeeCode: p.employeeCode,
              employeeName: p.employeeName,
              department: p.department,
              date: this.filterDate,
              checkIn: '—',
              checkOut: '—',
              workHours: 0,
              status: 'Absent',
              device: '—',
              dayStatusBadge: 'AB',
              dayStatusColor: '#dc2626',
              dayStatusBg: '#fee2e2',
            });
          }

          this.dailyRows.set(rows);
        } else {
          this.dailyRows.set([]);
        }
      },
      error: () => {
        if (!silent) {
          this.dailyRows.set([]);
        }
      },
    });
  }

  protected onFilterDateChange(): void {
    this.loadDailyAttendance();
  }

  protected viewEmployeeMuster(employeeId: string): void {
    this.selectedMusterEmpId = employeeId;
    this.tab.set('muster');
    this.generateMuster();
  }

  protected onEmployeeSelectChange(): void {
    const emp = this.selectedEmployee();
    if (emp) {
      this.newReg.employeeId = emp.id;
      this.newReg.employeeName = emp.fullName;
      this.punchForm.employeeId = emp.id;
    }
    this.generateMuster();
  }

  protected prevMonth(): void {
    const [y, m] = this.selectedMusterMonth.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    this.selectedMusterMonth = d.toISOString().slice(0, 7);
    this.generateMuster();
  }

  protected nextMonth(): void {
    const [y, m] = this.selectedMusterMonth.split('-').map(Number);
    const d = new Date(y, m, 1);
    this.selectedMusterMonth = d.toISOString().slice(0, 7);
    this.generateMuster();
  }

  protected generateMuster(): void {
    if (!this.selectedMusterEmpId) return;

    const parts = this.selectedMusterMonth.split('-');
    const year = parseInt(parts[0], 10) || new Date().getFullYear();
    const month = parseInt(parts[1], 10) || new Date().getMonth() + 1;
    const emp = this.selectedEmployee();
    const todayStr = new Date().toISOString().slice(0, 10);

    this.api.muster(this.selectedMusterEmpId, year, month).subscribe({
      next: (data: MonthlyMusterDay[]) => {
        const mapped: MusterDay[] = (data || []).map((d) => {
          const dateObj = new Date(d.date + 'T00:00:00');
          const dayNum = dateObj.getDate();
          const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
          const dateFormatted = `${dayOfWeek} ${String(dayNum).padStart(2, '0')} ${dateObj.toLocaleDateString('en-US', { month: 'short' })}, ${dateObj.getFullYear()}`;
          const isWeekend = d.status === 'Weekend' || dateObj.getDay() === 0 || dateObj.getDay() === 6;
          const isToday = d.date === todayStr;
          const isFuture = d.date > todayStr;

          const inTime12 = this.formatTime12(d.checkIn);
          const outTime12 = this.formatTime12(d.checkOut);

          const workHours = d.workHours || 0;
          const isLateIn = !!(d.checkIn && this.isLateCheckIn(d.checkIn));
          const isEarlyOut = !!(d.checkOut && this.isEarlyCheckOut(d.checkOut));

          let dayStatusBadge: 'FD' | 'HD' | 'WK' | 'AB' | 'LV' | 'HL' | 'OD' | '—' = 'FD';
          let dayStatusColor = '#15803d';
          let dayStatusBg = '#dcfce7';

          if (d.status === 'Weekend') {
            dayStatusBadge = 'WK';
            dayStatusColor = '#0284c7';
            dayStatusBg = '#e0f2fe';
          } else if (d.status === 'OnLeave') {
            dayStatusBadge = 'LV';
            dayStatusColor = '#9333ea';
            dayStatusBg = '#f3e8ff';
          } else if (d.status === 'Absent') {
            dayStatusBadge = 'AB';
            dayStatusColor = '#dc2626';
            dayStatusBg = '#fee2e2';
          } else if (d.status === 'HalfDay') {
            dayStatusBadge = 'HD';
            dayStatusColor = '#ea580c';
            dayStatusBg = '#ffedd5';
          } else if (d.status === 'Scheduled' || isFuture) {
            dayStatusBadge = '—';
            dayStatusColor = '#94a3b8';
            dayStatusBg = '#f1f5f9';
          }

          // Attendance Status Icon
          let attendanceIcon: 'P' | 'A' | 'L' | '⚠️' | '—' = '—';
          let attendanceIconClass = 'status-box-gray';
          if (d.status === 'Present' && (!d.checkOut || d.checkOut === '—')) {
            attendanceIcon = '⚠️';
            attendanceIconClass = 'status-box-warn';
          } else if (d.status === 'Present') {
            attendanceIcon = isLateIn ? 'L' : 'P';
            attendanceIconClass = isLateIn ? 'status-box-warn' : 'status-box-success';
          } else if (d.status === 'Absent') {
            attendanceIcon = 'A';
            attendanceIconClass = 'status-box-danger';
          } else if (d.status === 'Late') {
            attendanceIcon = 'L';
            attendanceIconClass = 'status-box-warn';
          }

          // Action Status
          let actionStatus = 'Present (P)';
          if (d.status === 'Present' && (!d.checkOut || d.checkOut === '—')) {
            actionStatus = 'On Going';
          } else if (d.status === 'Present') {
            actionStatus = 'Present (P)';
          } else if (d.status === 'Weekend') {
            actionStatus = 'Weekend';
          } else if (d.status === 'Absent') {
            actionStatus = 'Absent (A)';
          } else if (d.status === 'HalfDay') {
            actionStatus = 'Half Day';
          } else if (d.status === 'OnLeave') {
            actionStatus = 'On Leave';
          } else if (isFuture) {
            actionStatus = 'Scheduled';
          }

          // Durations
          const totalTimeStr = workHours > 0 ? this.formatDuration(workHours) : '—';
          const breakHoursStr = workHours >= 5 ? '01 H : 00 M' : '—';
          const productiveHoursStr = workHours > 0 ? this.formatDuration(workHours >= 5 ? workHours - 1 : workHours) : '—';
          const extraTimeStr = this.formatExtraTime(workHours);

          return {
            day: dayNum,
            dateStr: d.date,
            dateFormatted,
            dayOfWeek,
            isWeekend,
            isToday,
            isFuture,
            dayStatusBadge,
            dayStatusColor,
            dayStatusBg,
            attendanceIcon,
            attendanceIconClass,
            actionStatus,
            inTime: inTime12,
            inTimeRaw: d.checkIn || '',
            outTime: outTime12,
            outTimeRaw: d.checkOut || '',
            isEarlyOut,
            isLateIn,
            totalTimeStr,
            breakHoursStr,
            productiveHoursStr,
            extraTimeStr,
            shiftName: 'DEFAULT',
            locationName: 'Surat',
            jobRole: emp?.jobTitle || emp?.department || 'Executive',
            workHoursRaw: workHours,
            status: d.status,
            color: dayStatusColor,
            hours: totalTimeStr,
          };
        });
        this.musterDays.set(mapped);
      },
      error: () => {
        this.musterDays.set([]);
      },
    });
  }

  private formatTime12(timeStr?: string | null): string {
    if (!timeStr || timeStr === '—') return '—';
    if (timeStr.includes('T')) {
      const d = new Date(timeStr);
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    }
    const parts = timeStr.split(':');
    if (parts.length >= 2) {
      let h = parseInt(parts[0], 10);
      const m = parts[1].padStart(2, '0');
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12;
      h = h ? h : 12;
      return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
    }
    return timeStr;
  }

  private formatDuration(hoursDecimal: number): string {
    if (!hoursDecimal || hoursDecimal <= 0) return '—';
    const totalMin = Math.round(hoursDecimal * 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${String(h).padStart(2, '0')} H : ${String(m).padStart(2, '0')} M`;
  }

  private formatExtraTime(hoursDecimal: number): string {
    if (!hoursDecimal || hoursDecimal <= 8) return '—';
    const extraMin = Math.round((hoursDecimal - 8) * 60);
    const h = Math.floor(extraMin / 60);
    const m = extraMin % 60;
    return `${String(h).padStart(2, '0')} H : ${String(m).padStart(2, '0')} M`;
  }

  private isLateCheckIn(timeStr: string): boolean {
    if (!timeStr) return false;
    const parts = timeStr.split(':');
    if (parts.length >= 2) {
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      return h > 9 || (h === 9 && m > 30);
    }
    return false;
  }

  private isEarlyCheckOut(timeStr: string): boolean {
    if (!timeStr) return false;
    const parts = timeStr.split(':');
    if (parts.length >= 2) {
      const h = parseInt(parts[0], 10);
      return h < 17;
    }
    return false;
  }

  protected openDayDetails(day: MusterDay): void {
    this.selectedDetailDay.set(day);
    this.showDayDetailModal.set(true);
  }

  protected openRegularizeForDay(day: MusterDay): void {
    const emp = this.selectedEmployee();
    this.newReg.employeeId = emp?.id || this.selectedMusterEmpId;
    this.newReg.employeeName = emp?.fullName || '';
    this.newReg.date = day.dateStr;
    this.newReg.inTime = day.inTimeRaw || '09:30';
    this.newReg.outTime = day.outTimeRaw || '18:00';
    this.newReg.reason = 'Attendance Regularization';
    this.showRegModal.set(true);
  }

  protected onAttendanceActionChange(day: MusterDay, newAction: string): void {
    if (newAction === day.actionStatus) return;
    this.openRegularizeForDay(day);
  }

  protected openQuickPunchModal(): void {
    if (this.employees().length > 0 && !this.punchForm.employeeId) {
      this.punchForm.employeeId = this.employees()[0].id;
    }
    this.showPunchModal.set(true);
  }

  protected submitQuickPunch(): void {
    if (!this.punchForm.employeeId) {
      this.toast.show('Please select an employee', 'danger');
      return;
    }

    this.api
      .recordPunch({
        employeeId: this.punchForm.employeeId,
        punchType: this.punchForm.punchType,
        note: this.punchForm.note || 'Manual Punch (HR Console)',
        device: 'HR Console',
      })
      .subscribe({
        next: (p) => {
          this.showPunchModal.set(false);
          this.punchForm.note = '';
          this.toast.show(`Recorded ${p.punchType} for ${p.employeeName}!`);
          this.loadDailyAttendance();
          if (this.tab() === 'muster') {
            this.generateMuster();
          }
        },
        error: (err) => {
          this.toast.show(err?.error?.message || 'Failed to record punch', 'danger');
        },
      });
  }

  protected loadRegularizations(): void {
    this.api.regularizations().subscribe({
      next: (res: any[]) => {
        this.regData.set(
          (res || []).map((item) => ({
            id: item.id,
            employeeId: item.employeeId,
            employeeName: item.employeeName || item.n || '—',
            n: item.employeeName || item.n || '—',
            date: item.date,
            inTime: item.inTime,
            outTime: item.outTime,
            reason: item.reason,
            status: item.status,
          }))
        );
      },
      error: () => {},
    });
  }

  protected statusClass(s: string): string {
    const l = s.toLowerCase().replace(/\s+/g, '');
    if (l === 'present') return 'badge-success';
    if (l === 'late') return 'badge-warning';
    if (l === 'absent') return 'badge-danger';
    if (l === 'halfday') return 'badge-warning';
    if (l === 'onleave') return 'badge-primary';
    return 'badge-primary';
  }

  protected regClass(s: string): string {
    return s === 'Approved' ? 'badge-success' : s === 'Rejected' ? 'badge-danger' : 'badge-warning';
  }

  protected exportCsv(): void {
    if (this.tab() === 'muster') {
      const emp = this.selectedEmployee();
      const headers = ['Date', 'Day', 'Day Status', 'Status', 'In Time', 'Out Time', 'Total Hours', 'Break Hours', 'Productive Hours', 'Extra Time', 'Shift', 'Location'];
      const rows = this.musterDays().map((d) =>
        [
          `"${d.dateFormatted}"`,
          d.dayOfWeek,
          d.dayStatusBadge,
          d.status,
          d.inTime,
          d.outTime,
          `"${d.totalTimeStr}"`,
          `"${d.breakHoursStr}"`,
          `"${d.productiveHoursStr}"`,
          `"${d.extraTimeStr}"`,
          d.shiftName,
          d.locationName,
        ].join(',')
      );
      const csv = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Muster_${emp?.employeeCode || 'EMP'}_${this.selectedMusterMonth}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      this.toast.show(`Monthly muster for ${emp?.fullName || 'employee'} exported to CSV`);
      return;
    }

    const headers = ['Employee Code', 'Employee Name', 'Department', 'Date', 'Day Status', 'Check In', 'Check Out', 'Hours', 'Status'];
    const rows = this.filteredDailyRows().map((r) =>
      [r.employeeCode, `"${r.employeeName}"`, `"${r.department}"`, r.date, r.dayStatusBadge, r.checkIn, r.checkOut, r.workHours, r.status].join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Attendance_${this.filterDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast.show('Attendance exported to CSV');
  }

  protected onRegEmpChange(empId: string): void {
    const e = this.employees().find((x) => x.id === empId);
    if (e) {
      this.newReg.employeeName = e.fullName;
    }
  }

  protected openRegModal(): void {
    if (this.employees().length > 0 && !this.newReg.employeeId) {
      this.newReg.employeeId = this.employees()[0].id;
      this.newReg.employeeName = this.employees()[0].fullName;
    }
    this.showRegModal.set(true);
  }

  protected submitNewReg(): void {
    if (!this.newReg.employeeId || !this.newReg.reason) {
      this.toast.show('Please fill in required fields', 'danger');
      return;
    }

    this.api
      .createRegularization({
        employeeId: this.newReg.employeeId,
        date: this.newReg.date,
        inTime: this.newReg.inTime,
        outTime: this.newReg.outTime,
        reason: this.newReg.reason,
      })
      .subscribe({
        next: () => {
          this.showRegModal.set(false);
          this.newReg.reason = '';
          this.toast.show('Regularization request submitted successfully!');
          this.loadRegularizations();
          this.loadDailyAttendance();
          if (this.tab() === 'muster') {
            this.generateMuster();
          }
        },
        error: (err) => {
          this.toast.show(err?.error?.message || 'Failed to submit regularization request', 'danger');
        },
      });
  }

  protected regAction(r: Regularization, newStatus: 'Approved' | 'Rejected'): void {
    const action$ =
      newStatus === 'Approved'
        ? this.api.approveRegularization(r.id)
        : this.api.rejectRegularization(r.id);

    action$.subscribe({
      next: () => {
        r.status = newStatus;
        this.regData.update((list) => [...list]);
        this.toast.show(`Regularization request ${newStatus.toLowerCase()} successfully`);
        this.loadDailyAttendance();
        this.generateMuster();
      },
      error: (err) => {
        this.toast.show(err?.error?.message || `Failed to ${newStatus.toLowerCase()} request`, 'danger');
      },
    });
  }
}
