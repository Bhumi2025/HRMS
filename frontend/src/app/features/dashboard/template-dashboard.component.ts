import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit, NgZone, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api/api.service';
import { PermissionService } from '../../core/services/permission.service';
import { SessionService } from '../../core/services/session.service';
import { PunchService } from '../../core/services/punch.service';
import { NotificationStateService } from '../../core/services/notification-state.service';
import { UiService } from '../../core/services/ui.service';
import {
  DashboardTemplateData,
  NoticeBoardItem,
  CelebrationItem,
  AttendancePerson,
  HolidayDto,
  TaskItem,
  PendingApproval,
  AttendanceTrendPoint,
  EmployeePunch,
  LeaveBalance,
  HrEmployeeSummary,
} from '../../core/api/api.models';

export interface TimelogBarItem {
  idx: number;
  dayNumber: number;
  dayLabel: string;
  date: string;
  formattedDate: string;
  isToday: boolean;
  beforeBreak: number;
  breakHrs: number;
  afterBreak: number;
  missing: number;
  totalHours: number;
  present: number;
  late: number;
  absent: number;
  cx: number;
  barX: number;
  barWidth: number;
  hBefore: number;
  yBefore: number;
  hBreak: number;
  yBreak: number;
  hAfter: number;
  yAfter: number;
  hMissing: number;
  yMissing: number;
  topY: number;
  totalHeight: number;
}

@Component({
  selector: 'app-template-dashboard',
  imports: [CommonModule, RouterLink],
  templateUrl: './template-dashboard.component.html',
  styleUrls: ['./template-dashboard.component.scss'],
})
export class TemplateDashboardComponent implements OnInit, OnDestroy {
  protected readonly session = inject(SessionService);
  protected readonly punchService = inject(PunchService);
  protected readonly perms = inject(PermissionService);
  protected readonly notifState = inject(NotificationStateService);
  protected readonly ui = inject(UiService);
  private readonly api = inject(ApiService);
  private readonly zone = inject(NgZone);

  protected readonly poppedWidget = signal<string | null>(null);

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.poppedWidget()) {
      this.closePopout();
    }
  }

  protected openPopout(key: string, event: Event): void {
    if (this.poppedWidget() === key || this.ui.isInteractiveTarget(event)) {
      return;
    }
    this.poppedWidget.set(key);
  }

  protected closePopout(event?: Event): void {
    event?.stopPropagation();
    this.poppedWidget.set(null);
  }

  private clockInterval: ReturnType<typeof setInterval> | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  protected readonly loading = signal(true);
  protected readonly activeCelebrationTab = signal<'Birthday' | 'WorkAnniversary' | 'NewJoinee'>('Birthday');
  protected readonly currentNoticeIndex = signal(0);
  protected readonly currentTime = signal(new Date());

  // Dynamic Selected Month for Attendance Chart (e.g. '2026-11')
  protected readonly selectedMonthKey = signal<string>(
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  );

  // Available months: past 6 months to next 12 months (e.g., Nov 2026, Dec 2026, Jan 2027...)
  protected readonly availableMonths = computed(() => {
    const now = this.currentTime();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const list: { key: string; label: string; year: number; month: number }[] = [];

    for (let i = -6; i <= 12; i++) {
      const d = new Date(currentYear, currentMonth + i, 1);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const key = `${y}-${String(m).padStart(2, '0')}`;
      const label = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(d);
      list.push({ key, label, year: y, month: m });
    }
    return list;
  });

  // Reference Bar Chart Hover State
  protected readonly hoveredBar = signal<TimelogBarItem | null>(null);

  // Data signals
  protected readonly notices = signal<NoticeBoardItem[]>([]);
  protected readonly presentToday = signal<AttendancePerson[]>([]);
  protected readonly absentToday = signal<AttendancePerson[]>([]);
  protected readonly onLeaveToday = signal<AttendancePerson[]>([]);
  protected readonly lateToday = signal<AttendancePerson[]>([]);
  protected readonly celebrations = signal<CelebrationItem[]>([]);
  protected readonly upcomingHolidays = signal<HolidayDto[]>([]);
  protected readonly myTasks = signal<TaskItem[]>([]);
  protected readonly pendingApprovals = signal<PendingApproval[]>([]);
  protected readonly attendanceGraph = signal<AttendanceTrendPoint[]>([]);
  protected readonly leaveBalances = signal<LeaveBalance[]>([]);

  // HR Team & Selected HR for Attendance Chart
  protected readonly hrEmployees = signal<HrEmployeeSummary[]>([]);
  protected readonly selectedHrEmployeeId = signal<string>('');
  protected readonly selectedHrEmployeeName = signal<string>('HR');
  protected readonly selectedHrEmployeeCode = signal<string>('');

  // Mobile Dashboard Section Filter
  protected readonly activeMobileSection = signal<'all' | 'approvals' | 'clock' | 'notices' | 'highlights' | 'holidays'>('all');

  setMobileSection(sec: 'all' | 'approvals' | 'clock' | 'notices' | 'highlights' | 'holidays'): void {
    this.activeMobileSection.set(sec);
  }

  // Computed properties
  protected readonly role = computed(() => this.session.activeRole());

  protected readonly userName = computed(() => {
    const role = this.session.activeRole();
    if (role === 'HR Manager' || role === 'Company Admin') return 'HR Manager';
    return role === 'Super Admin' ? 'Admin' : role;
  });

  protected readonly greeting = computed(() => {
    const hr = this.currentTime().getHours();
    return hr < 12 ? 'Good Morning' : hr < 17 ? 'Good Afternoon' : 'Good Evening';
  });

  protected readonly currentMonthName = computed(() => {
    return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(this.currentTime());
  });

  protected readonly chartMaxScale = computed<number>(() => {
    const list = this.attendanceGraph();
    let max = 0;
    for (const p of list) {
      const tot = (p.beforeBreakHours || 0) + (p.breakHours || 0) + (p.afterBreakHours || 0) + (p.missingHours || 0);
      max = Math.max(max, tot);
    }
    if (max <= 1.5) return 1.5;
    if (max <= 4) return 4;
    if (max <= 8) return 8;
    if (max <= 10) return 10;
    return Math.ceil(max / 2) * 2;
  });

  protected readonly chartYScaleSteps = computed<number[]>(() => {
    const max = this.chartMaxScale();
    if (max === 1.5) {
      return [1.5, 1, 0.5, 0];
    }
    if (max <= 4) {
      return [4, 3, 2, 1, 0];
    }
    if (max <= 8) {
      return [8, 6, 4, 2, 0];
    }
    if (max <= 10) {
      return [10, 8, 6, 4, 2, 0];
    }
    const step = max / 4;
    return [max, max - step, max - 2 * step, max - 3 * step, 0].map((v) => Math.round(v * 10) / 10);
  });

  protected getYCoord(val: number): number {
    const maxVal = this.chartMaxScale() || 1.5;
    const topY = 22;
    const baselineY = 152;
    const plotHeight = baselineY - topY;
    return Math.round((baselineY - (val / maxVal) * plotHeight) * 10) / 10;
  }

  protected readonly timelogBars = computed<TimelogBarItem[]>(() => {
    const list = this.attendanceGraph();
    if (!list || list.length === 0) return [];

    const todayDate = this.currentTime();
    const todayY = todayDate.getFullYear();
    const todayM = todayDate.getMonth() + 1;
    const todayD = todayDate.getDate();
    const todayZero = new Date(todayY, todayM - 1, todayD).getTime();

    // Requirement: Show only past dates and today (present date) along with its specific graph
    const filteredList = list.filter((p, idx) => {
      let pDate: Date | null = null;
      if (p.date) {
        const parts = p.date.split('-');
        if (parts.length === 3) {
          pDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        }
      } else {
        const [yStr, mStr] = this.selectedMonthKey().split('-');
        pDate = new Date(parseInt(yStr, 10), parseInt(mStr, 10) - 1, idx + 1);
      }
      return pDate ? pDate.getTime() <= todayZero : true;
    });

    if (filteredList.length === 0) return [];

    const totalDays = filteredList.length;
    const maxVal = this.chartMaxScale() || 1.5;
    const plotLeft = 40;
    const plotRight = 745;
    const plotWidth = plotRight - plotLeft;
    const topY = 22;
    const baselineY = 152;
    const plotHeight = baselineY - topY;
    const scale = plotHeight / maxVal;
    const stepX = plotWidth / totalDays;
    const barWidth = Math.min(22, Math.max(12, Math.round(stepX * 0.52 * 10) / 10));

    // Dynamic punch breakdown for present day
    const livePunch = this.punchService.todayPunchBreakdown();

    return filteredList.map((p, idx) => {
      const cx = Math.round((plotLeft + (idx + 0.5) * stepX) * 10) / 10;
      const barX = Math.round((cx - barWidth / 2) * 10) / 10;

      let dayNumber = idx + 1;
      let isToday = false;
      let formattedDate = '';

      if (p.date) {
        const parts = p.date.split('-');
        if (parts.length === 3) {
          const y = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10);
          const d = parseInt(parts[2], 10);
          dayNumber = d;
          isToday = y === todayY && m === todayM && d === todayD;
          const dt = new Date(y, m - 1, d);
          formattedDate =
            new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(dt) +
            ` (${p.label || ''})`;
        }
      }
      if (!formattedDate) {
        const [yStr, mStr] = this.selectedMonthKey().split('-');
        formattedDate = `${mStr}/${dayNumber}/${yStr}`;
      }

      let beforeBreak = p.beforeBreakHours || 0;
      let breakHrs = p.breakHours || 0;
      let afterBreak = p.afterBreakHours || 0;
      let missing = p.missingHours || 0;

      // When today, dynamically update based on punches and live elapsed time
      if (isToday) {
        if (livePunch.hasPunched) {
          beforeBreak = livePunch.beforeBreakHours;
          breakHrs = livePunch.breakHours;
          afterBreak = livePunch.afterBreakHours;
          missing = livePunch.missingHours;
        } else if ((p.beforeBreakHours ?? 0) > 0 || (p.breakHours ?? 0) > 0 || (p.afterBreakHours ?? 0) > 0) {
          // Keep backend values if present
          beforeBreak = p.beforeBreakHours ?? 0;
          breakHrs = p.breakHours ?? 0;
          afterBreak = p.afterBreakHours ?? 0;
          missing = p.missingHours ?? 0;
        } else {
          // No punches recorded yet today
          beforeBreak = 0;
          breakHrs = 0;
          afterBreak = 0;
          missing = 0;
        }
      }

      const totalHours = Math.round((beforeBreak + breakHrs + afterBreak + missing) * 10) / 10;

      const hBefore = Math.round(beforeBreak * scale * 10) / 10;
      const yBefore = baselineY - hBefore;

      const hBreak = Math.round(breakHrs * scale * 10) / 10;
      const yBreak = yBefore - hBreak;

      const hAfter = Math.round(afterBreak * scale * 10) / 10;
      const yAfter = yBreak - hAfter;

      const hMissing = Math.round(missing * scale * 10) / 10;
      const yMissing = yAfter - hMissing;

      const totalHeight = hBefore + hBreak + hAfter + hMissing;
      const barTopY = baselineY - totalHeight;

      return {
        idx,
        dayNumber,
        dayLabel: p.label || '',
        date: p.date || '',
        formattedDate,
        isToday,
        beforeBreak,
        breakHrs,
        afterBreak,
        missing,
        totalHours,
        present: p.present || 0,
        late: p.late || 0,
        absent: p.absent || 0,
        cx,
        barX,
        barWidth,
        hBefore,
        yBefore,
        hBreak,
        yBreak,
        hAfter,
        yAfter,
        hMissing,
        yMissing,
        topY: barTopY,
        totalHeight,
      };
    });
  });

  protected readonly currentNotice = computed(() => {
    const list = this.notices();
    if (list.length === 0) return null;
    const idx = Math.min(this.currentNoticeIndex(), list.length - 1);
    return list[idx];
  });

  protected readonly filteredCelebrations = computed(() => {
    const tab = this.activeCelebrationTab();
    return this.celebrations().filter((c) => c.type === tab);
  });

  protected readonly totalHeadcount = computed(() => {
    return this.presentToday().length + this.absentToday().length + this.onLeaveToday().length;
  });

  protected readonly attendanceRate = computed(() => {
    const total = this.totalHeadcount();
    if (total === 0) return 0;
    return Math.round((this.presentToday().length / total) * 100);
  });

  protected readonly pendingActionCount = computed(() => {
    const pendingTasks = this.myTasks().filter((t) => t.status !== 'Completed').length;
    return this.pendingApprovals().length + pendingTasks;
  });

  ngOnInit(): void {
    this.zone.runOutsideAngular(() => {
      this.clockInterval = setInterval(() => {
        this.zone.run(() => this.currentTime.set(new Date()));
      }, 1000);

      this.refreshInterval = setInterval(() => {
        this.zone.run(() => this.loadData());
      }, 15000);
    });

    this.loadData();
  }

  ngOnDestroy(): void {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  loadData(): void {
    this.api.dashboardTemplateData().subscribe({
      next: (data: DashboardTemplateData) => {
        this.notices.set(data.notices || []);
        this.presentToday.set(data.todayAttendance?.present || []);
        this.absentToday.set(data.todayAttendance?.absent || []);
        this.onLeaveToday.set(data.todayAttendance?.onLeave || []);
        this.lateToday.set(data.todayAttendance?.late || []);
        this.celebrations.set(data.celebrations || []);
        this.upcomingHolidays.set(data.upcomingHolidays || []);
        this.myTasks.set(data.myTasks || []);
        this.pendingApprovals.set(data.pendingApprovals || []);
        
        // Populate HR team and select default HR employee
        if (data.hrTeam && data.hrTeam.length > 0) {
          this.hrEmployees.set(data.hrTeam);
          if (!this.selectedHrEmployeeId()) {
            const currentEmpId = this.session.user()?.employeeId;
            const matched = (currentEmpId ? data.hrTeam.find((h) => h.id === currentEmpId) : null) || data.hrTeam[0];
            this.selectedHrEmployeeId.set(matched.id);
            this.selectedHrEmployeeName.set(`${matched.firstName} ${matched.lastName}`);
            this.selectedHrEmployeeCode.set(matched.employeeCode);
          }
        }

        // Only overwrite attendanceGraph if current month is selected; otherwise keep selected month
        const now = this.currentTime();
        const defaultMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        if (this.selectedMonthKey() === defaultMonthKey) {
          this.attendanceGraph.set(data.attendanceGraph || []);
        }
        
        this.leaveBalances.set(data.leaveBalances || []);
        this.loading.set(false);
      },
      error: () => {
        // Fallback demo data if backend is starting or offline
        this.setMockData();
        this.loading.set(false);
      },
    });
  }

  nextNotice(): void {
    const total = this.notices().length;
    if (total > 0) {
      this.currentNoticeIndex.update((i) => (i + 1) % total);
    }
  }

  prevNotice(): void {
    const total = this.notices().length;
    if (total > 0) {
      this.currentNoticeIndex.update((i) => (i - 1 + total) % total);
    }
  }

  clockIn(): void {
    this.punchService.clockIn();
    setTimeout(() => {
      this.loadData();
      this.notifState.refresh();
      this.punchService.loadTodayPunches();
    }, 800);
  }

  clockOut(): void {
    this.punchService.clockOut();
    setTimeout(() => {
      this.loadData();
      this.notifState.refresh();
      this.punchService.loadTodayPunches();
    }, 800);
  }

  toggleBreak(): void {
    this.punchService.toggleBreak();
    setTimeout(() => {
      this.loadData();
      this.notifState.refresh();
      this.punchService.loadTodayPunches();
    }, 800);
  }

  facePunchIn(): void {
    this.punchService.requestClockIn();
  }

  facePunchActive(): void {
    if (this.punchService.onBreak()) {
      this.punchService.requestEndBreak();
    } else {
      this.punchService.requestClockOut();
    }
  }

  approveRequest(id: string): void {
    this.api.approveApproval(id).subscribe({
      next: () => {
        this.pendingApprovals.update((list) => list.filter((a) => a.id !== id));
        this.notifState.refresh();
        this.loadData();
      },
      error: () => {
        this.pendingApprovals.update((list) => list.filter((a) => a.id !== id));
        this.notifState.refresh();
        this.loadData();
      },
    });
  }

  rejectRequest(id: string): void {
    this.api.rejectApproval(id).subscribe({
      next: () => {
        this.pendingApprovals.update((list) => list.filter((a) => a.id !== id));
        this.notifState.refresh();
        this.loadData();
      },
      error: () => {
        this.pendingApprovals.update((list) => list.filter((a) => a.id !== id));
        this.notifState.refresh();
        this.loadData();
      },
    });
  }

  countForTab(tab: 'Birthday' | 'WorkAnniversary' | 'NewJoinee'): number {
    return this.celebrations().filter((c) => c.type === tab).length;
  }

  onBarEnter(item: TimelogBarItem): void {
    this.hoveredBar.set(item);
  }

  onBarLeave(): void {
    this.hoveredBar.set(null);
  }

  onHrEmployeeChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    if (!target) return;
    const hrId = target.value;
    this.selectedHrEmployeeId.set(hrId);
    const hr = this.hrEmployees().find((h) => h.id === hrId);
    if (hr) {
      this.selectedHrEmployeeName.set(`${hr.firstName} ${hr.lastName}`);
      this.selectedHrEmployeeCode.set(hr.employeeCode);
    }
    const [yStr, mStr] = this.selectedMonthKey().split('-');
    const year = parseInt(yStr, 10);
    const month = parseInt(mStr, 10);
    this.loadAttendanceTrendForMonth(year, month, hrId);
  }

  onMonthChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    if (!target) return;
    const key = target.value;
    this.selectedMonthKey.set(key);
    const [yStr, mStr] = key.split('-');
    const year = parseInt(yStr, 10);
    const month = parseInt(mStr, 10);
    this.loadAttendanceTrendForMonth(year, month, this.selectedHrEmployeeId());
  }

  loadAttendanceTrendForMonth(year: number, month: number, employeeId?: string): void {
    const empId = employeeId || this.selectedHrEmployeeId() || undefined;
    this.api.attendanceTrend(year, month, empId).subscribe({
      next: (points) => {
        this.attendanceGraph.set(points || []);
      },
      error: () => {},
    });
  }

  toggleTask(task: TaskItem): void {
    const newStatus = task.status === 'Completed' ? 'Pending' : 'Completed';
    task.status = newStatus;
    this.api.updateTaskStatus(task.id, newStatus).subscribe({
      next: (updated) => {
        this.myTasks.update((list) => list.map((t) => (t.id === task.id ? { ...t, status: updated.status } : t)));
        this.notifState.refresh();
      },
      error: () => {
        task.status = newStatus === 'Completed' ? 'Pending' : 'Completed';
      },
    });
  }

  getInitials(name: string): string {
    if (!name) return '—';
    return name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  }

  private setMockData(): void {
    this.notices.set([]);
    this.absentToday.set([]);
    this.onLeaveToday.set([]);
    this.celebrations.set([]);
    this.upcomingHolidays.set([]);
    this.leaveBalances.set([]);
    this.attendanceGraph.set([]);
  }
}
