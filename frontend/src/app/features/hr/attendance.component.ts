import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
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

interface TimelineSegment {
  type: 'work' | 'break' | 'overtime' | 'late' | 'dayoff' | 'absent' | 'scheduled';
  label: string;
  timeRange: string;
  durationLabel: string;
  leftPercent: number;
  widthPercent: number;
  tooltip: string;
}

interface MusterDay {
  day: number;
  dateStr: string;
  dateFormatted: string;
  dayLabel: string;
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
  durationStr: string;
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
  timelineSegments: TimelineSegment[];
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

        <div class="table-wrap" style="overflow-x: auto; width: 100%; padding-bottom: 6px;">
          <table class="daily-punch-table" style="width: 100%; min-width: 1080px; border-collapse: collapse;">
            <thead>
              <tr>
                <th style="min-width: 180px;">Employee</th>
                <th style="min-width: 110px;">Department</th>
                <th style="min-width: 100px;">Date</th>
                <th style="min-width: 85px;">Day Status</th>
                <th style="min-width: 90px;">Check In</th>
                <th style="min-width: 90px;">Check Out</th>
                <th style="min-width: 95px;">Work Hours</th>
                <th style="min-width: 90px;">Status</th>
                <th style="min-width: 130px;">Device/Method</th>
                <th style="min-width: 140px; text-align: right; padding-right: 24px;">Action</th>
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
                  <td style="text-align: right; padding-right: 24px; white-space: nowrap;">
                    <button class="btn-view-muster" (click)="viewEmployeeMuster(row.id)">
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
      <div class="time-mgmt-layout">
        <!-- ── LEFT PANE: PRESENT SUMMARY & EMPLOYEE ROSTER ── -->
        <div class="time-mgmt-sidebar">
          <div class="sidebar-header-box">
            <div class="sidebar-main-title">Attendance</div>
            <div class="date-switcher-pill">
              <button class="nav-arrow-mini" (click)="prevDay()" title="Previous day">‹</button>
              <span class="switcher-date-text">{{ filterDateFormatted() }}</span>
              <button class="nav-arrow-mini" (click)="nextDay()" title="Next day">›</button>
            </div>
          </div>

          <!-- Present Summary Card -->
          <div class="present-summary-card">
            <div class="summary-top">
              <span class="sum-icon">📋</span>
              <span class="sum-title">Present Summary</span>
            </div>
            <div class="summary-grid-three">
              <div class="sum-col">
                <div class="sum-lbl">On time</div>
                <div class="sum-val">{{ onTimeCount() }}</div>
                <div class="sum-diff text-success">+{{ onTimeCount() }} vs yesterday</div>
              </div>
              <div class="sum-col">
                <div class="sum-lbl">Late clock-in</div>
                <div class="sum-val" [class.text-warning]="lateInCount() > 0">{{ lateInCount() }}</div>
                <div class="sum-diff text-muted">-{{ lateInCount() }} vs yesterday</div>
              </div>
              <div class="sum-col">
                <div class="sum-lbl">Early clock-out</div>
                <div class="sum-val" [class.text-danger]="earlyOutCount() > 0">{{ earlyOutCount() }}</div>
                <div class="sum-diff text-muted">0 vs yesterday</div>
              </div>
            </div>
          </div>

          <!-- Search Bar for Sidebar -->
          <div class="sidebar-search-container">
            <span class="search-mini-icon">🔍</span>
            <input 
              type="text" 
              class="sidebar-search-field" 
              placeholder="Search employee..." 
              [ngModel]="sidebarSearch()" 
              (ngModelChange)="sidebarSearch.set($event)"
            />
          </div>

          <!-- Employee Roster Header -->
          <div class="roster-header-row">
            <span>Employee Name</span>
            <span>Clock-in &amp; Out</span>
          </div>

          <!-- Employee List -->
          <div class="roster-scroll-container">
            @for (emp of filteredSidebarEmployees(); track emp.id) {
              <div 
                class="roster-item-card" 
                [class.active]="emp.id === selectedMusterEmpId()"
                (click)="selectEmployeeFromSidebar(emp.id)"
              >
                <div class="roster-user-left">
                  <div class="roster-avatar-circle" [style.background]="emp.id === selectedMusterEmpId() ? 'var(--p)' : 'var(--p-soft)'" [style.color]="emp.id === selectedMusterEmpId() ? '#fff' : 'var(--p)'">
                    {{ emp.fullName.charAt(0) }}
                  </div>
                  <div class="roster-names">
                    <div class="roster-name-title">{{ emp.fullName }}</div>
                    <div class="roster-code-sub">{{ emp.employeeCode }}</div>
                  </div>
                </div>

                <div class="roster-clock-right">
                  <span class="roster-time-tag">{{ getEmpTodayCheckIn(emp.id) }}</span>
                  <span 
                    class="status-indicator-dot" 
                    [class.dot-on-time]="isEmpOnTime(emp.id)" 
                    [class.dot-late]="isEmpLate(emp.id)" 
                    [class.dot-absent]="!isEmpPresent(emp.id)"
                  ></span>
                </div>
              </div>
            }
          </div>
        </div>

        <!-- ── RIGHT PANE: EMPLOYEE TIME MANAGEMENT & TIMELINE ── -->
        <div class="time-mgmt-detail">
          <!-- Top Navigation Header -->
          <div class="detail-top-nav">
            <div class="emp-pager">
              <button type="button" class="pager-btn" (click)="prevEmployee()" title="Previous employee">‹</button>
              <button type="button" class="pager-btn" (click)="nextEmployee()" title="Next employee">›</button>
              <span class="pager-info">{{ currentEmployeeIndex() + 1 }} out of {{ employees().length }}</span>
            </div>

            <button type="button" class="detail-close-btn" (click)="tab.set('daily')" title="Close and return to Daily Punch Log">✕</button>
          </div>

          <!-- Employee Profile Banner -->
          <div class="emp-profile-banner">
            <div class="profile-left">
              <div class="profile-avatar">
                {{ selectedEmployee()?.fullName?.charAt(0) || 'E' }}
              </div>
              <div class="profile-texts">
                <div class="profile-name-row">
                  <span class="profile-name">{{ selectedEmployee()?.fullName }}</span>
                </div>
                <div class="profile-meta-row">
                  <span class="meta-label">Role:</span>
                  <span class="meta-val">{{ selectedEmployee()?.jobTitle || selectedEmployee()?.department || 'Executive' }}</span>
                  <span class="meta-divider">•</span>
                  <span class="meta-label">Employee ID:</span>
                  <span class="emp-id-badge">#{{ selectedEmployee()?.employeeCode }}</span>
                  <span class="meta-divider">•</span>
                  <span class="meta-label">Phone:</span>
                  <span class="phone-badge">{{ selectedEmployee()?.email || '+971 4 999 8888' }}</span>
                </div>
              </div>
            </div>

            <div class="profile-actions">
              <button 
                type="button"
                class="btn btn-outline btn-sm" 
                (click)="viewEmployeeProfile()" 
                style="display: inline-flex; align-items: center; gap: 5px; cursor: pointer;"
                title="View full profile for {{ selectedEmployee()?.fullName }}"
              >
                View Details
              </button>
              @if (perms.canCreate('Attendance')) {
                <button type="button" class="btn btn-primary btn-sm" (click)="openQuickPunchModal()" style="display: inline-flex; align-items: center; gap: 6px;">
                  + Add Attendance
                </button>
              }
            </div>
          </div>

          <!-- 6 Stat Summary Cards -->
          <div class="six-stats-grid">
            <div class="stat-box">
              <div class="stat-title">Day off</div>
              <div class="stat-num">{{ musterSummary().dayOff }}</div>
              <div class="stat-foot text-success">+2 vs last month</div>
            </div>
            <div class="stat-box">
              <div class="stat-title">Late clock-in</div>
              <div class="stat-num" [class.text-warning]="musterSummary().lateIn > 0">{{ musterSummary().lateIn }}</div>
              <div class="stat-foot text-success">-1 vs last month</div>
            </div>
            <div class="stat-box">
              <div class="stat-title">Late clock-out</div>
              <div class="stat-num">{{ musterSummary().lateOut }}</div>
              <div class="stat-foot text-success">+4 vs last month</div>
            </div>
            <div class="stat-box">
              <div class="stat-title">No clock-out</div>
              <div class="stat-num" [class.text-danger]="musterSummary().noClockOut > 0">{{ musterSummary().noClockOut }}</div>
              <div class="stat-foot text-muted">0 vs last month</div>
            </div>
            <div class="stat-box">
              <div class="stat-title">Off time quota</div>
              <div class="stat-num">{{ musterSummary().offTimeQuota }}</div>
              <div class="stat-foot text-muted">Available leaves</div>
            </div>
            <div class="stat-box">
              <div class="stat-title">Absent</div>
              <div class="stat-num" [class.text-danger]="musterSummary().absent > 0">{{ musterSummary().absent }}</div>
              <div class="stat-foot text-muted">0 vs last month</div>
            </div>
          </div>

          <!-- Month Selector & Controls -->
          <div class="timeline-toolbar">
            <div class="month-nav-cluster">
              <span class="current-month-heading">{{ selectedMonthFormatted() }}</span>
              <div class="month-arrows">
                <button class="m-arrow-btn" (click)="prevMonth()" title="Previous month">‹</button>
                <button class="m-arrow-btn" (click)="nextMonth()" title="Next month">›</button>
              </div>
            </div>

            <div class="toolbar-right-cluster">
              <!-- Search box -->
              <div class="search-box-pill">
                <span class="pill-search-icon">🔍</span>
                <input 
                  type="text" 
                  placeholder="Search day..." 
                  [ngModel]="timelineSearch()" 
                  (ngModelChange)="timelineSearch.set($event)"
                />
              </div>

              <!-- Status select filter -->
              <select class="status-dropdown-pill" [ngModel]="timelineStatusFilter()" (ngModelChange)="timelineStatusFilter.set($event)">
                <option value="">All Status</option>
                <option value="present">Present</option>
                <option value="late">Late</option>
                <option value="dayoff">Day Off</option>
                <option value="overtime">Overtime</option>
                <option value="absent">Absent</option>
              </select>

              <!-- View mode toggle (Timeline vs Table) -->
              <div class="view-mode-toggle">
                <button 
                  class="toggle-btn" 
                  [class.active]="musterViewMode() === 'timeline'" 
                  (click)="musterViewMode.set('timeline')"
                  title="Gantt Timeline View"
                >
                  ▤ Timeline
                </button>
                <button 
                  class="toggle-btn" 
                  [class.active]="musterViewMode() === 'table'" 
                  (click)="musterViewMode.set('table')"
                  title="Muster Table View"
                >
                  ▦ Table
                </button>
              </div>
            </div>
          </div>

          <!-- ── VIEW 1: TIMELINE CARDS (IMAGE 2 STYLE) ── -->
          @if (musterViewMode() === 'timeline') {
            <div class="timeline-cards-list">
              @for (day of filteredMusterDays(); track day.dateStr) {
                <div class="day-gantt-card" [class.is-today-card]="day.isToday">
                  <div class="gantt-card-header">
                    <div class="gantt-day-name">
                      {{ day.dayLabel }}
                    </div>

                    <div class="gantt-header-right">
                      @if (day.workHoursRaw > 8) {
                        @if (isOvertimeApproved(day.dateStr)) {
                          <span class="ot-badge-approved">✓ Approved</span>
                        } @else {
                          <div class="ot-approval-box">
                            <span class="ot-approval-txt">Overtime approval</span>
                            <button class="btn-ot-reject" (click)="rejectOvertime(day.dateStr, $event)" title="Reject Overtime">✕</button>
                            <button class="btn-ot-approve" (click)="approveOvertime(day.dateStr, $event)" title="Approve Overtime">✓ Approve</button>
                          </div>
                        }
                      } @else if (day.status === 'OnLeave') {
                        <span class="badge-requested-off">Requested day off</span>
                      } @else if (day.status === 'Weekend') {
                        <span class="badge-weekend-pill">Weekend</span>
                      } @else if (day.status === 'Present') {
                        <span class="badge-present-pill">✓ Present</span>
                      }
                    </div>
                  </div>

                  <!-- Timeline Gantt Bar Track -->
                  <div class="gantt-bar-row">
                    <!-- Left: Clock-in -->
                    <div class="gantt-time-col in-col">
                      <span class="col-lbl">Clock-in</span>
                      <span class="col-val">{{ day.inTime }}</span>
                    </div>

                    <!-- Center: Timeline visualization -->
                    <div class="gantt-track-center">
                      <!-- Scale hours -->
                      <div class="gantt-scale-hours">
                        <span>09:00</span>
                        <span>11:00</span>
                        <span>13:00</span>
                        <span>15:00</span>
                        <span>17:00</span>
                        <span>19:00</span>
                        <span>21:00</span>
                        <span>23:59</span>
                      </div>

                      <!-- The visual bar container -->
                      <div class="gantt-bar-track">
                        @for (seg of day.timelineSegments; track seg.label + seg.leftPercent) {
                          <div 
                            class="gantt-segment" 
                            [class]="'seg-kind-' + seg.type"
                            [style.left.%]="seg.leftPercent"
                            [style.width.%]="seg.widthPercent"
                          >
                            <span class="seg-label-txt">{{ seg.label }}</span>

                            <!-- Hover Tooltip -->
                            <div class="seg-popup-tooltip">
                              <div class="tip-heading">{{ seg.label }}</div>
                              <div class="tip-body">{{ seg.timeRange }} ({{ seg.durationLabel }})</div>
                            </div>
                          </div>
                        }
                      </div>
                    </div>

                    <!-- Right: Clock-out & Duration -->
                    <div class="gantt-time-col out-col">
                      <div class="time-block">
                        <span class="col-lbl">Clock-out</span>
                        <span class="col-val" [class.early-out-alert]="day.isEarlyOut">{{ day.outTime }}</span>
                      </div>
                      <div class="dur-block">
                        <span class="col-lbl">Duration</span>
                        <span class="col-val">{{ day.durationStr }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              } @empty {
                <div style="text-align: center; padding: 40px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; color: var(--muted);">
                  No attendance records found matching filters for this period.
                </div>
              }
            </div>
          }

          <!-- ── VIEW 2: 15-COLUMN MUSTER TABLE (TABLE MODE) ── -->
          @if (musterViewMode() === 'table') {
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
                    @for (day of filteredMusterDays(); track day.dateStr) {
                      <tr [class.row-weekend]="day.isWeekend" [class.row-today]="day.isToday">
                        <td class="cell-date">{{ day.dateFormatted }}</td>
                        <td class="cell-name"><span class="name-text">{{ selectedEmployee()?.fullName || '—' }}</span></td>
                        <td>
                          <span class="day-status-pill" [style.background]="day.dayStatusBg" [style.color]="day.dayStatusColor">
                            {{ day.dayStatusBadge }}
                          </span>
                        </td>
                        <td>
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
                        <td>
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
                        <td class="cell-clock-in">
                          @if (day.inTime !== '—') {
                            <span class="time-with-icon">{{ day.inTime }} <span class="punch-device-badge">💻</span></span>
                          } @else { <span class="dash">—</span> }
                        </td>
                        <td class="cell-clock-out">
                          @if (day.outTime !== '—') {
                            <span class="time-with-icon" [class.early-out-text]="day.isEarlyOut">{{ day.outTime }} <span class="punch-device-badge">💻</span></span>
                          } @else { <span class="dash">—</span> }
                        </td>
                        <td class="cell-total-time" [class.time-short]="day.workHoursRaw > 0 && day.workHoursRaw < 8" [class.time-good]="day.workHoursRaw >= 8">{{ day.totalTimeStr }}</td>
                        <td>{{ day.breakHoursStr }}</td>
                        <td>{{ day.productiveHoursStr }}</td>
                        <td [class.extra-positive]="day.extraTimeStr !== '—'">{{ day.extraTimeStr }}</td>
                        <td><span class="shift-badge-link">{{ day.shiftName }}</span></td>
                        <td>{{ day.locationName }}</td>
                        <td>{{ day.jobRole }}</td>
                        <td style="text-align: center;">
                          <div class="row-actions-group">
                            <button class="action-icon-btn" (click)="openDayDetails(day)" title="View Punch Timeline">👁️</button>
                            <button class="action-icon-btn" (click)="openRegularizeForDay(day)" title="Regularize Punch">✏️</button>
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
        0% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.7); }
        70% { box-shadow: 0 0 0 6px rgba(22, 163, 74, 0); }
        100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0); }
      }

      /* ── Daily Records Action Button (Fix Image 1 Overlap) ── */
      .btn-view-muster {
        background: #eff6ff;
        color: #2563eb;
        border: 1px solid #bfdbfe;
        font-size: 11px;
        font-weight: 700;
        padding: 5px 12px;
        border-radius: 6px;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .btn-view-muster:hover {
        background: #2563eb;
        color: #ffffff;
        border-color: #2563eb;
        transform: translateY(-1px);
      }

      /* ── Time Management & Muster Split View (Image 2) ── */
      .time-mgmt-layout {
        display: flex;
        gap: 20px;
        align-items: flex-start;
      }

      /* ── Left Sidebar (Attendance & Employee Roster) ── */
      .time-mgmt-sidebar {
        width: 320px;
        flex-shrink: 0;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 16px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.02);
      }
      .sidebar-header-box {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 14px;
      }
      .sidebar-main-title {
        font-size: 18px;
        font-weight: 800;
        color: var(--text);
      }
      .date-switcher-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 20px;
        padding: 3px 8px;
      }
      .nav-arrow-mini {
        background: none;
        border: none;
        font-size: 14px;
        font-weight: 800;
        color: var(--muted);
        cursor: pointer;
        padding: 0 2px;
        line-height: 1;
      }
      .nav-arrow-mini:hover { color: var(--p); }
      .switcher-date-text {
        font-size: 11px;
        font-weight: 700;
        color: var(--text);
      }

      /* Present Summary Card */
      .present-summary-card {
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 12px;
        margin-bottom: 14px;
      }
      .summary-top {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        font-weight: 700;
        color: var(--text);
        margin-bottom: 10px;
      }
      .sum-icon { font-size: 13px; }
      .summary-grid-three {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }
      .sum-col { display: flex; flex-direction: column; }
      .sum-lbl {
        font-size: 10px;
        font-weight: 600;
        color: var(--muted);
        white-space: nowrap;
      }
      .sum-val {
        font-size: 18px;
        font-weight: 800;
        color: var(--text);
        margin: 2px 0;
      }
      .sum-diff {
        font-size: 9px;
        font-weight: 600;
        white-space: nowrap;
      }

      /* Sidebar Search */
      .sidebar-search-container {
        position: relative;
        display: flex;
        align-items: center;
        margin-bottom: 14px;
      }
      .search-mini-icon {
        position: absolute;
        left: 10px;
        font-size: 11px;
        color: var(--muted);
        pointer-events: none;
      }
      .sidebar-search-field {
        width: 100%;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 8px;
        font-size: 12px;
        padding: 6px 10px 6px 28px;
        color: var(--text);
        outline: none;
      }

      /* Roster List */
      .roster-header-row {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        font-weight: 700;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.4px;
        margin-bottom: 8px;
        padding: 0 4px;
      }
      .roster-scroll-container {
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-height: 520px;
        overflow-y: auto;
      }
      .roster-item-card {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid transparent;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .roster-item-card:hover {
        background: var(--bg);
      }
      .roster-item-card.active {
        background: #f0fdf4;
        border-color: #bbf7d0;
      }
      .roster-user-left {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .roster-avatar-circle {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        font-size: 12px;
        font-weight: 800;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .roster-names { display: flex; flex-direction: column; }
      .roster-name-title {
        font-size: 12px;
        font-weight: 700;
        color: var(--text);
      }
      .roster-code-sub {
        font-size: 10px;
        color: var(--muted);
      }
      .roster-clock-right {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .roster-time-tag {
        font-size: 11px;
        font-weight: 700;
        color: var(--text);
      }
      .status-indicator-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
      }
      .dot-on-time { background: #16a34a; box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.2); }
      .dot-late { background: #ea580c; box-shadow: 0 0 0 2px rgba(234, 88, 12, 0.2); }
      .dot-absent { background: #94a3b8; }

      /* ── Right Detail Area (Image 2) ── */
      .time-mgmt-detail {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      /* Top Navigation & Close */
      .detail-top-nav {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .emp-pager {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .pager-btn {
        width: 26px;
        height: 26px;
        border-radius: 6px;
        border: 1px solid var(--border);
        background: var(--surface);
        font-size: 14px;
        font-weight: 800;
        color: var(--muted);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }
      .pager-btn:hover { background: var(--bg); color: var(--text); }
      .pager-info {
        font-size: 12px;
        font-weight: 600;
        color: var(--muted);
        margin-left: 4px;
      }
      .detail-close-btn {
        background: none;
        border: none;
        font-size: 15px;
        font-weight: 700;
        color: var(--muted);
        cursor: pointer;
        padding: 4px;
      }
      .detail-close-btn:hover { color: var(--text); }

      /* Employee Profile Banner */
      .emp-profile-banner {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 14px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 16px 20px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.02);
      }
      .profile-left {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .profile-avatar {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: #dbeafe;
        color: #1e40af;
        font-size: 18px;
        font-weight: 800;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .profile-texts { display: flex; flex-direction: column; gap: 4px; }
      .profile-name {
        font-size: 17px;
        font-weight: 800;
        color: var(--text);
      }
      .profile-meta-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        font-size: 11px;
      }
      .meta-label { color: var(--muted); font-weight: 500; }
      .meta-val { color: var(--text); font-weight: 700; }
      .meta-divider { color: var(--muted); opacity: 0.6; }
      .emp-id-badge {
        background: #f1f5f9;
        color: #334155;
        font-weight: 700;
        padding: 2px 7px;
        border-radius: 4px;
      }
      .phone-badge {
        background: #f0fdf4;
        color: #15803d;
        font-weight: 700;
        padding: 2px 7px;
        border-radius: 4px;
      }
      .profile-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      /* 6 Stat Summary Cards Grid (Image 2) */
      .six-stats-grid {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 10px;
      }
      .stat-box {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        box-shadow: 0 1px 3px rgba(0,0,0,0.02);
      }
      .stat-title {
        font-size: 11px;
        font-weight: 600;
        color: var(--muted);
        white-space: nowrap;
      }
      .stat-num {
        font-size: 20px;
        font-weight: 800;
        color: var(--text);
        margin: 4px 0 2px 0;
      }
      .stat-foot {
        font-size: 10px;
        font-weight: 600;
        white-space: nowrap;
      }

      /* Timeline Toolbar */
      .timeline-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 12px;
      }
      .month-nav-cluster {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .current-month-heading {
        font-size: 16px;
        font-weight: 800;
        color: var(--text);
      }
      .month-arrows {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      .m-arrow-btn {
        width: 24px;
        height: 24px;
        border-radius: 6px;
        border: 1px solid var(--border);
        background: var(--surface);
        font-size: 14px;
        font-weight: 800;
        color: var(--muted);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }
      .m-arrow-btn:hover { background: var(--bg); color: var(--text); }

      .toolbar-right-cluster {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .search-box-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 20px;
        padding: 4px 10px;
      }
      .search-box-pill input {
        border: none;
        background: transparent;
        font-size: 12px;
        color: var(--text);
        outline: none;
        width: 110px;
      }
      .pill-search-icon { font-size: 11px; opacity: 0.6; }
      .status-dropdown-pill {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 20px;
        padding: 4px 10px;
        font-size: 12px;
        font-weight: 600;
        color: var(--text);
        outline: none;
        cursor: pointer;
      }
      .view-mode-toggle {
        display: inline-flex;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 2px;
      }
      .toggle-btn {
        border: none;
        background: transparent;
        font-size: 11px;
        font-weight: 700;
        color: var(--muted);
        padding: 3px 8px;
        border-radius: 6px;
        cursor: pointer;
      }
      .toggle-btn.active {
        background: var(--surface);
        color: var(--text);
        box-shadow: 0 1px 2px rgba(0,0,0,0.06);
      }

      /* ── Gantt Day Cards (Image 2) ── */
      .timeline-cards-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .day-gantt-card {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 14px 18px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.02);
        transition: box-shadow 0.15s ease;
      }
      .day-gantt-card:hover {
        box-shadow: 0 3px 10px rgba(0,0,0,0.04);
      }
      .is-today-card {
        border-color: #93c5fd;
        background: #fbfdff;
      }

      .gantt-card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      .gantt-day-name {
        font-size: 14px;
        font-weight: 800;
        color: var(--text);
      }
      .gantt-header-right {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      /* Overtime Approval Controls */
      .ot-approval-box {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .ot-approval-txt {
        font-size: 11px;
        font-weight: 600;
        color: var(--muted);
      }
      .btn-ot-reject {
        background: none;
        border: 1px solid #e2e8f0;
        color: #ef4444;
        width: 22px;
        height: 22px;
        border-radius: 5px;
        font-size: 11px;
        font-weight: 800;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }
      .btn-ot-approve {
        background: #0f172a;
        color: #ffffff;
        border: none;
        border-radius: 6px;
        padding: 3px 10px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        transition: background 0.15s ease;
      }
      .btn-ot-approve:hover { background: #1e293b; }
      .ot-badge-approved {
        background: #dcfce7;
        color: #15803d;
        font-size: 11px;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 6px;
      }
      .badge-requested-off {
        background: #fef08a;
        color: #854d0e;
        font-size: 11px;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 6px;
      }
      .badge-weekend-pill {
        background: #e0f2fe;
        color: #0369a1;
        font-size: 11px;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 6px;
      }
      .badge-present-pill {
        background: #f0fdf4;
        color: #15803d;
        font-size: 11px;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 6px;
      }

      /* Gantt Track Row */
      .gantt-bar-row {
        display: flex;
        align-items: center;
        gap: 16px;
      }
      .gantt-time-col {
        display: flex;
        flex-direction: column;
        flex-shrink: 0;
      }
      .in-col { width: 85px; }
      .out-col {
        width: 130px;
        display: flex;
        flex-direction: row;
        justify-content: flex-end;
        gap: 14px;
        text-align: right;
      }
      .col-lbl {
        font-size: 10px;
        font-weight: 600;
        color: var(--muted);
      }
      .col-val {
        font-size: 12px;
        font-weight: 800;
        color: var(--text);
        margin-top: 2px;
      }
      .early-out-alert { color: #dc2626 !important; }

      /* Center Visual Track */
      .gantt-track-center {
        flex: 1;
        position: relative;
        min-width: 0;
      }
      .gantt-scale-hours {
        display: flex;
        justify-content: space-between;
        font-size: 9px;
        font-weight: 600;
        color: #94a3b8;
        margin-bottom: 5px;
        padding: 0 2px;
      }
      .gantt-bar-track {
        position: relative;
        height: 24px;
        background: #f1f5f9;
        border-radius: 6px;
        overflow: visible;
      }
      .gantt-segment {
        position: absolute;
        top: 0;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        cursor: pointer;
        transition: opacity 0.15s ease;
      }
      .gantt-segment:hover {
        opacity: 0.92;
      }
      .seg-label-txt {
        font-size: 10px;
        font-weight: 700;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        padding: 0 4px;
      }

      /* Segment Styles matching Image 2 */
      .seg-kind-work {
        background: #2563eb;
        color: #ffffff;
      }
      .seg-kind-break {
        background: #38bdf8;
        color: #082f49;
      }
      .seg-kind-overtime {
        background: #f97316;
        color: #ffffff;
      }
      .seg-kind-late {
        background: #ea580c;
        color: #ffffff;
      }
      .seg-kind-dayoff {
        background: #eab308;
        color: #713f12;
      }
      .seg-kind-absent {
        background: #fca5a5;
        color: #7f1d1d;
      }
      .seg-kind-scheduled {
        background: #e2e8f0;
        color: #475569;
        border: 1px dashed #cbd5e1;
      }

      /* Tooltip Popup on Segment Hover */
      .seg-popup-tooltip {
        position: absolute;
        bottom: 115%;
        left: 50%;
        transform: translateX(-50%);
        background: #0f172a;
        color: #ffffff;
        padding: 6px 10px;
        border-radius: 6px;
        font-size: 11px;
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.15s ease;
        z-index: 30;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      }
      .seg-popup-tooltip::after {
        content: '';
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border-width: 5px;
        border-style: solid;
        border-color: #0f172a transparent transparent transparent;
      }
      .gantt-segment:hover .seg-popup-tooltip {
        opacity: 1;
        visibility: visible;
      }
      .tip-heading { font-weight: 800; font-size: 11px; }
      .tip-sub { font-size: 10px; opacity: 0.85; margin-top: 2px; }

      /* Table View in Muster Mode */
      .muster-table-card {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 1px 3px rgba(0,0,0,0.02);
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
      .muster-data-table tr:hover td { background: rgba(0, 0, 0, 0.015); }
      .row-weekend td { background: rgba(241, 245, 249, 0.4); }
      .row-today td { background: rgba(59, 130, 246, 0.04); }

      .cell-date { font-weight: 700; color: var(--text); }
      .name-text { color: var(--muted); font-weight: 500; }
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
      .status-icon-box.success { background: #dcfce7; color: #16a34a; }
      .status-icon-box.danger { background: #fee2e2; color: #dc2626; }
      .status-icon-box.warn { background: #fef3c7; color: #d97706; }
      .status-icon-dash { color: var(--muted); font-weight: 700; }

      .action-select-box {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 2px 8px;
      }
      .action-bullet { width: 6px; height: 6px; border-radius: 50%; }
      .bullet-present { background: #16a34a; }
      .bullet-ongoing { background: #0284c7; box-shadow: 0 0 0 2px rgba(2, 132, 199, 0.2); }
      .bullet-weekend { background: #94a3b8; }
      .bullet-absent { background: #dc2626; }
      .action-dropdown {
        border: none;
        background: transparent;
        font-size: 11px;
        font-weight: 600;
        color: var(--text);
        outline: none;
        cursor: pointer;
      }

      .time-with-icon { display: inline-flex; align-items: center; gap: 5px; font-weight: 700; }
      .punch-device-badge { font-size: 10px; opacity: 0.7; }
      .early-out-text { color: #dc2626 !important; font-weight: 800; }
      .cell-total-time { font-weight: 700; }
      .time-short { color: #0284c7; }
      .time-good { color: var(--text); }
      .extra-positive { color: #16a34a; font-weight: 700; }
      .shift-badge-link {
        color: #0284c7;
        font-weight: 700;
        font-size: 11px;
        cursor: pointer;
        text-decoration: underline;
        text-decoration-style: dotted;
      }
      .row-actions-group { display: inline-flex; gap: 6px; align-items: center; }
      .action-icon-btn {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 13px;
        padding: 2px 4px;
        border-radius: 4px;
        transition: background 0.15s ease;
      }
      .action-icon-btn:hover { background: var(--bg); }
      .dash { color: var(--muted); }

      /* Responsive rules */
      @media (max-width: 1024px) {
        .time-mgmt-layout {
          flex-direction: column;
        }
        .time-mgmt-sidebar {
          width: 100%;
        }
        .six-stats-grid {
          grid-template-columns: repeat(3, 1fr);
        }
      }
      @media (max-width: 640px) {
        .six-stats-grid {
          grid-template-columns: repeat(2, 1fr);
        }
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
  private readonly router = inject(Router);

  protected readonly tab = signal<'daily' | 'muster' | 'reg'>('daily');
  protected readonly canReg = signal(this.session.activeRole() !== 'Employee');

  // Reactive signals for instant search & filtering
  protected readonly searchKeyword = signal('');
  protected readonly filterStatus = signal('');
  protected filterDate = new Date().toISOString().slice(0, 10);

  // Time Management split-view & muster signals
  protected readonly selectedMusterEmpId = signal<string>('');
  protected readonly selectedMusterMonth = signal<string>(new Date().toISOString().slice(0, 7));
  protected musterViewMode = signal<'timeline' | 'table'>('timeline');
  protected sidebarSearch = signal('');
  protected timelineSearch = signal('');
  protected timelineStatusFilter = signal('');
  protected approvedOvertimes = signal<Set<string>>(new Set());

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
    const id = this.selectedMusterEmpId();
    return this.employees().find((e) => e.id === id) || this.employees()[0] || null;
  });

  protected readonly currentEmployeeIndex = computed(() => {
    const empList = this.employees();
    const id = this.selectedMusterEmpId();
    const idx = empList.findIndex((e) => e.id === id);
    return idx >= 0 ? idx : 0;
  });

  protected viewEmployeeProfile(): void {
    const emp = this.selectedEmployee();
    if (emp?.id) {
      this.router.navigate(['/employee-profile'], { queryParams: { id: emp.id } });
    } else {
      this.router.navigate(['/employee-profile']);
    }
  }

  // Filtered sidebar roster items
  protected readonly filteredSidebarEmployees = computed(() => {
    const q = this.sidebarSearch().toLowerCase().trim();
    const list = this.employees();
    if (!q) return list;
    return list.filter(
      (e) =>
        e.fullName.toLowerCase().includes(q) ||
        e.employeeCode.toLowerCase().includes(q) ||
        e.department.toLowerCase().includes(q)
    );
  });

  // Sidebar Present Summary counts
  protected readonly onTimeCount = computed(() => {
    return this.dailyRows().filter(
      (r) => r.status === 'Present' && r.checkIn && r.checkIn !== '—' && !this.isLateCheckIn(r.checkIn)
    ).length;
  });

  protected readonly lateInCount = computed(() => {
    return this.dailyRows().filter(
      (r) => r.status === 'Late' || (r.checkIn && this.isLateCheckIn(r.checkIn))
    ).length;
  });

  protected readonly earlyOutCount = computed(() => {
    return this.dailyRows().filter(
      (r) => r.checkOut && r.checkOut !== '—' && this.isEarlyCheckOut(r.checkOut)
    ).length;
  });

  protected readonly filterDateFormatted = computed(() => {
    const d = new Date(this.filterDate + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
  });

  protected readonly selectedMonthFormatted = computed(() => {
    const parts = this.selectedMusterMonth().split('-');
    const y = parseInt(parts[0], 10) || new Date().getFullYear();
    const m = parseInt(parts[1], 10) || new Date().getMonth() + 1;
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  });

  // 6 Stats Summary for Selected Employee Month
  protected readonly musterSummary = computed(() => {
    const days = this.musterDays();
    let dayOffCount = 0;
    let lateInCount = 0;
    let lateOutCount = 0;
    let noClockOutCount = 0;
    let absentCount = 0;

    for (const d of days) {
      if (d.isWeekend || d.status === 'OnLeave') {
        dayOffCount++;
      }
      if (d.isLateIn) lateInCount++;
      if (d.workHoursRaw > 8 || (d.outTime && d.outTime !== '—' && this.isLateCheckOut(d.outTimeRaw))) {
        lateOutCount++;
      }
      if (d.inTime !== '—' && (d.outTime === '—' || !d.outTime)) {
        noClockOutCount++;
      }
      if (d.status === 'Absent') {
        absentCount++;
      }
    }

    return {
      dayOff: dayOffCount,
      lateIn: lateInCount,
      lateOut: lateOutCount,
      noClockOut: noClockOutCount,
      offTimeQuota: 14,
      absent: absentCount,
    };
  });

  // Filtered Muster Days for Timeline
  protected readonly filteredMusterDays = computed(() => {
    const q = this.timelineSearch().toLowerCase().trim();
    const st = this.timelineStatusFilter().toLowerCase().trim();
    const days = this.musterDays();

    return days.filter((d) => {
      const matchQ =
        !q ||
        d.dateFormatted.toLowerCase().includes(q) ||
        d.dayLabel.toLowerCase().includes(q) ||
        d.status.toLowerCase().includes(q);

      let matchSt = true;
      if (st === 'present') matchSt = d.status === 'Present';
      else if (st === 'late') matchSt = d.status === 'Late' || d.isLateIn;
      else if (st === 'absent') matchSt = d.status === 'Absent';
      else if (st === 'dayoff') matchSt = d.isWeekend || d.status === 'OnLeave';
      else if (st === 'overtime') matchSt = d.workHoursRaw > 8;

      return matchQ && matchSt;
    });
  });

  // Reactive computed for instant filter & search matching in Daily Punch Log
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
          this.selectedMusterMonth.set(params['month']);
        }
        if (params['employeeId']) {
          this.selectedMusterEmpId.set(params['employeeId']);
        }
        if (this.selectedMusterEmpId()) {
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
        if (res.items.length > 0 && !this.selectedMusterEmpId()) {
          this.selectedMusterEmpId.set(res.items[0].id);
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
    this.selectedMusterEmpId.set(employeeId);
    this.tab.set('muster');
    this.generateMuster();
  }

  protected selectEmployeeFromSidebar(id: string): void {
    this.selectedMusterEmpId.set(id);
    const emp = this.selectedEmployee();
    if (emp) {
      this.newReg.employeeId = emp.id;
      this.newReg.employeeName = emp.fullName;
      this.punchForm.employeeId = emp.id;
    }
    this.generateMuster();
  }

  protected prevEmployee(): void {
    const list = this.employees();
    if (list.length === 0) return;
    let idx = this.currentEmployeeIndex() - 1;
    if (idx < 0) idx = list.length - 1;
    this.selectEmployeeFromSidebar(list[idx].id);
  }

  protected nextEmployee(): void {
    const list = this.employees();
    if (list.length === 0) return;
    let idx = this.currentEmployeeIndex() + 1;
    if (idx >= list.length) idx = 0;
    this.selectEmployeeFromSidebar(list[idx].id);
  }

  protected prevDay(): void {
    const d = new Date(this.filterDate + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    this.filterDate = d.toISOString().slice(0, 10);
    this.loadDailyAttendance();
  }

  protected nextDay(): void {
    const d = new Date(this.filterDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    this.filterDate = d.toISOString().slice(0, 10);
    this.loadDailyAttendance();
  }

  protected prevMonth(): void {
    const [y, m] = this.selectedMusterMonth().split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    this.selectedMusterMonth.set(d.toISOString().slice(0, 7));
    this.generateMuster();
  }

  protected nextMonth(): void {
    const [y, m] = this.selectedMusterMonth().split('-').map(Number);
    const d = new Date(y, m, 1);
    this.selectedMusterMonth.set(d.toISOString().slice(0, 7));
    this.generateMuster();
  }

  protected getEmpTodayCheckIn(employeeId: string): string {
    const row = this.dailyRows().find((r) => r.id === employeeId);
    return row?.checkIn && row.checkIn !== '—' ? row.checkIn : '—';
  }

  protected isEmpOnTime(employeeId: string): boolean {
    const row = this.dailyRows().find((r) => r.id === employeeId);
    return !!(row && row.status === 'Present' && row.checkIn && row.checkIn !== '—' && !this.isLateCheckIn(row.checkIn));
  }

  protected isEmpLate(employeeId: string): boolean {
    const row = this.dailyRows().find((r) => r.id === employeeId);
    return !!(row && (row.status === 'Late' || (row.checkIn && this.isLateCheckIn(row.checkIn))));
  }

  protected isEmpPresent(employeeId: string): boolean {
    const row = this.dailyRows().find((r) => r.id === employeeId);
    return !!(row && (row.status === 'Present' || row.status === 'Late'));
  }

  protected isOvertimeApproved(dateStr: string): boolean {
    return this.approvedOvertimes().has(dateStr);
  }

  protected approveOvertime(dateStr: string, event?: Event): void {
    event?.stopPropagation();
    this.approvedOvertimes.update((set) => {
      const next = new Set(set);
      next.add(dateStr);
      return next;
    });
    this.toast.show(`Overtime approved for ${dateStr}!`);
  }

  protected rejectOvertime(dateStr: string, event?: Event): void {
    event?.stopPropagation();
    this.approvedOvertimes.update((set) => {
      const next = new Set(set);
      next.delete(dateStr);
      return next;
    });
    this.toast.show(`Overtime rejected for ${dateStr}.`, 'warning');
  }

  protected generateMuster(): void {
    const empId = this.selectedMusterEmpId();
    if (!empId) return;

    const parts = this.selectedMusterMonth().split('-');
    const year = parseInt(parts[0], 10) || new Date().getFullYear();
    const month = parseInt(parts[1], 10) || new Date().getMonth() + 1;
    const emp = this.selectedEmployee();
    const todayStr = new Date().toISOString().slice(0, 10);

    this.api.muster(empId, year, month).subscribe({
      next: (data: MonthlyMusterDay[]) => {
        const mapped: MusterDay[] = (data || []).map((d) => {
          const dateObj = new Date(d.date + 'T00:00:00');
          const dayNum = dateObj.getDate();
          const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
          const dayLabel = d.date === todayStr ? 'Today' : `${dateObj.toLocaleDateString('en-US', { weekday: 'long' })}, ${dayNum}`;
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
          const durationStr = workHours > 0 ? this.formatDurationShort(workHours) : '—';

          // Visual Timeline Segments (Image 2)
          const timelineSegments = this.computeTimelineSegments(
            d.status,
            d.checkIn,
            d.checkOut,
            workHours,
            isWeekend,
            isFuture
          );

          return {
            day: dayNum,
            dateStr: d.date,
            dateFormatted,
            dayLabel,
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
            durationStr,
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
            timelineSegments,
          };
        });
        this.musterDays.set(mapped);
      },
      error: () => {
        this.musterDays.set([]);
      },
    });
  }

  private computeTimelineSegments(
    status: string,
    checkIn: string | null | undefined,
    checkOut: string | null | undefined,
    workHours: number,
    isWeekend: boolean,
    isFuture: boolean
  ): TimelineSegment[] {
    if (status === 'Weekend' || isWeekend) {
      return [
        {
          type: 'dayoff',
          label: 'Weekend',
          timeRange: 'All Day',
          durationLabel: 'Non-working day',
          leftPercent: 0,
          widthPercent: 100,
          tooltip: 'Weekend: Rest day',
        },
      ];
    }

    if (status === 'OnLeave') {
      return [
        {
          type: 'dayoff',
          label: 'Requested day off',
          timeRange: 'All Day',
          durationLabel: 'Approved Leave',
          leftPercent: 0,
          widthPercent: 100,
          tooltip: 'Leave: Requested day off approved',
        },
      ];
    }

    if (status === 'Absent') {
      return [
        {
          type: 'absent',
          label: 'Absent',
          timeRange: '09:00 - 18:00',
          durationLabel: 'No punch recorded',
          leftPercent: 0,
          widthPercent: 100,
          tooltip: 'Absent: No check-in record found',
        },
      ];
    }

    if (status === 'Scheduled' || isFuture) {
      return [
        {
          type: 'scheduled',
          label: 'Scheduled shift (09:00 - 18:00)',
          timeRange: '09:00 - 18:00',
          durationLabel: '8h standard shift',
          leftPercent: 0,
          widthPercent: 69.2,
          tooltip: 'Scheduled: Shift upcoming',
        },
      ];
    }

    // Active Present or Late
    const segments: TimelineSegment[] = [];
    let startH = 9.0;
    if (checkIn) {
      const parts = checkIn.split(':');
      if (parts.length >= 2) {
        startH = parseInt(parts[0], 10) + parseInt(parts[1], 10) / 60;
      }
    }

    let endH = startH + (workHours || 8.0);
    if (checkOut) {
      const parts = checkOut.split(':');
      if (parts.length >= 2) {
        endH = parseInt(parts[0], 10) + parseInt(parts[1], 10) / 60;
      }
    }

    // If late check-in
    if (startH > 9.5) {
      const lateWidth = Math.min(22, ((startH - 9.0) / 13) * 100);
      segments.push({
        type: 'late',
        label: 'Late',
        timeRange: `09:00 - ${this.formatHourDecimal(startH)}`,
        durationLabel: `${Math.round((startH - 9.0) * 60)}m late`,
        leftPercent: 0,
        widthPercent: Math.max(5, lateWidth),
        tooltip: `Late arrival: arrived at ${this.formatHourDecimal(startH)}`,
      });
    }

    const effectiveWork = workHours > 0 ? workHours : Math.max(0.5, endH - startH);

    if (effectiveWork >= 5) {
      const firstHalf = Math.round(effectiveWork * 0.45 * 10) / 10;
      const breakDur = 1.0;
      const secondHalf = Math.min(effectiveWork - firstHalf, Math.max(1, 8.0 - firstHalf));
      const overtime = Math.max(0, effectiveWork - 8.0);

      // 1. Morning work
      const s1Left = Math.max(0, ((startH - 9.0) / 13) * 100);
      const s1Width = Math.max(6, (firstHalf / 13) * 100);
      segments.push({
        type: 'work',
        label: 'Working time',
        timeRange: `${this.formatHourDecimal(startH)} - ${this.formatHourDecimal(startH + firstHalf)}`,
        durationLabel: `${firstHalf.toFixed(1)}h`,
        leftPercent: s1Left,
        widthPercent: s1Width,
        tooltip: `Working time: ${this.formatHourDecimal(startH)} - ${this.formatHourDecimal(startH + firstHalf)} (${firstHalf}h)`,
      });

      // 2. Break
      const s2Left = s1Left + s1Width;
      const s2Width = Math.max(4, (breakDur / 13) * 100);
      segments.push({
        type: 'break',
        label: 'Break',
        timeRange: `${this.formatHourDecimal(startH + firstHalf)} - ${this.formatHourDecimal(startH + firstHalf + breakDur)}`,
        durationLabel: '1h 00m',
        leftPercent: s2Left,
        widthPercent: s2Width,
        tooltip: 'Break: 1h meal break',
      });

      // 3. Afternoon work
      const s3Left = s2Left + s2Width;
      const s3Width = Math.max(6, (secondHalf / 13) * 100);
      segments.push({
        type: 'work',
        label: 'Working time',
        timeRange: `${this.formatHourDecimal(startH + firstHalf + breakDur)} - ${this.formatHourDecimal(startH + firstHalf + breakDur + secondHalf)}`,
        durationLabel: `${secondHalf.toFixed(1)}h`,
        leftPercent: s3Left,
        widthPercent: s3Width,
        tooltip: `Working time: ${secondHalf.toFixed(1)}h productive`,
      });

      // 4. Overtime
      if (overtime > 0) {
        const s4Left = s3Left + s3Width;
        const s4Width = Math.max(5, (overtime / 13) * 100);
        segments.push({
          type: 'overtime',
          label: 'Overtime',
          timeRange: `${this.formatHourDecimal(startH + firstHalf + breakDur + secondHalf)} - ${this.formatHourDecimal(endH)}`,
          durationLabel: `${overtime.toFixed(1)}h OT`,
          leftPercent: s4Left,
          widthPercent: Math.min(s4Width, 100 - s4Left),
          tooltip: `Overtime: ${overtime.toFixed(1)} hours extra work`,
        });
      }
    } else {
      const sLeft = Math.max(0, ((startH - 9.0) / 13) * 100);
      const sWidth = Math.max(8, (effectiveWork / 13) * 100);
      segments.push({
        type: 'work',
        label: 'Working time',
        timeRange: `${this.formatHourDecimal(startH)} - ${this.formatHourDecimal(endH)}`,
        durationLabel: `${effectiveWork.toFixed(1)}h`,
        leftPercent: sLeft,
        widthPercent: Math.min(sWidth, 100 - sLeft),
        tooltip: `Working time: ${effectiveWork.toFixed(1)}h`,
      });
    }

    return segments;
  }

  private formatHourDecimal(decimalHour: number): string {
    let h = Math.floor(decimalHour);
    const m = Math.round((decimalHour - h) * 60);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    h = h ? h : 12;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
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

  private formatDurationShort(hoursDecimal: number): string {
    if (!hoursDecimal || hoursDecimal <= 0) return '—';
    const totalMin = Math.round(hoursDecimal * 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m > 0 ? `${h}h ${m}m` : `${h} hour`;
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

  private isLateCheckOut(timeStr: string): boolean {
    if (!timeStr) return false;
    const parts = timeStr.split(':');
    if (parts.length >= 2) {
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      return h > 18 || (h === 18 && m > 30);
    }
    return false;
  }

  protected openDayDetails(day: MusterDay): void {
    this.selectedDetailDay.set(day);
    this.showDayDetailModal.set(true);
  }

  protected openRegularizeForDay(day: MusterDay): void {
    const emp = this.selectedEmployee();
    this.newReg.employeeId = emp?.id || this.selectedMusterEmpId();
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
      this.punchForm.employeeId = this.selectedMusterEmpId() || this.employees()[0].id;
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
      a.download = `Muster_${emp?.employeeCode || 'EMP'}_${this.selectedMusterMonth()}.csv`;
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
      this.newReg.employeeId = this.selectedMusterEmpId() || this.employees()[0].id;
      this.newReg.employeeName = this.selectedEmployee()?.fullName || this.employees()[0].fullName;
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
