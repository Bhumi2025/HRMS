import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, NgZone, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api/api.service';
import { PermissionService } from '../../core/services/permission.service';
import { SessionService } from '../../core/services/session.service';
import { PunchService } from '../../core/services/punch.service';
import { NotificationStateService } from '../../core/services/notification-state.service';
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
  private readonly api = inject(ApiService);
  private readonly zone = inject(NgZone);

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

    const totalDays = list.length;
    const maxVal = this.chartMaxScale() || 1.5;
    const plotLeft = 40;
    const plotRight = 745;
    const plotWidth = plotRight - plotLeft;
    const topY = 22;
    const baselineY = 152;
    const plotHeight = baselineY - topY;
    const scale = plotHeight / maxVal;
    const stepX = plotWidth / totalDays;
    const barWidth = Math.min(18, Math.max(9, Math.round(stepX * 0.55 * 10) / 10));

    const todayDate = this.currentTime();
    const todayY = todayDate.getFullYear();
    const todayM = todayDate.getMonth() + 1;
    const todayD = todayDate.getDate();

    return list.map((p, idx) => {
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

      const beforeBreak = p.beforeBreakHours || 0;
      const breakHrs = p.breakHours || 0;
      const afterBreak = p.afterBreakHours || 0;
      const missing = p.missingHours || 0;
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
    this.punchService.requestClockIn();
    setTimeout(() => {
      this.loadData();
      this.notifState.refresh();
    }, 1200);
  }

  clockOut(): void {
    this.punchService.requestClockOut();
    setTimeout(() => {
      this.loadData();
      this.notifState.refresh();
    }, 1200);
  }

  toggleBreak(): void {
    this.punchService.toggleBreak();
    setTimeout(() => {
      this.loadData();
      this.notifState.refresh();
    }, 1200);
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

  onMonthChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    if (!target) return;
    const key = target.value;
    this.selectedMonthKey.set(key);
    const [yStr, mStr] = key.split('-');
    const year = parseInt(yStr, 10);
    const month = parseInt(mStr, 10);
    this.loadAttendanceTrendForMonth(year, month);
  }

  loadAttendanceTrendForMonth(year: number, month: number): void {
    this.api.attendanceTrend(year, month).subscribe({
      next: (points) => {
        if (points && points.length > 0) {
          this.attendanceGraph.set(points);
        }
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
