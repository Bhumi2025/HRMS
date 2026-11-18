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

  // Attendance Graph Multi-Week & Full Month Signals
  protected readonly selectedWeek = signal<number>(0); // 0 = All Month, 1..4 = Individual Weeks
  protected readonly isAutoCycling = signal<boolean>(false);
  private cycleTimer: ReturnType<typeof setInterval> | null = null;
  protected readonly hoveredPoint = signal<any | null>(null);

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

  protected getCalendarWeek(d: Date): number {
    const day = d.getDate();
    return Math.min(4, Math.floor((day - 1) / 7) + 1);
  }

  protected readonly currentCalendarWeek = computed(() => {
    return this.getCalendarWeek(this.currentTime());
  });

  protected readonly currentMonthName = computed(() => {
    return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(this.currentTime());
  });

  protected readonly previousMonthName = computed(() => {
    const now = this.currentTime();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return new Intl.DateTimeFormat('en-US', { month: 'short' }).format(prev);
  });

  protected readonly chartMaxScale = computed(() => {
    const list = this.attendanceGraph();
    let max = 0;
    for (const p of list) {
      max = Math.max(max, p.present || 0, p.prevPresent || 0);
    }
    return Math.max(max, 8);
  });

  protected readonly chartPoints = computed(() => {
    const list = this.attendanceGraph();
    const total = list.length || 30;
    const maxVal = this.chartMaxScale();
    const now = this.currentTime();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    return list.map((p, idx) => {
      const day = idx + 1;
      const x = 28 + (idx / Math.max(1, total - 1)) * 644;
      const yCurrent = Math.round(100 - ((p.present || 0) / maxVal) * 82);
      const yPrev = Math.round(100 - ((p.prevPresent || 0) / maxVal) * 82);
      const isToday = p.date ? p.date === todayStr : false;
      const isRecorded = p.date ? p.date <= todayStr : false;

      return {
        day,
        dayOfWeek: p.label || '',
        date: p.date || '',
        weekNumber: p.weekNumber || Math.min(4, Math.floor((day - 1) / 7) + 1),
        present: p.present || 0,
        late: p.late || 0,
        absent: p.absent || 0,
        prevPresent: p.prevPresent || 0,
        isToday,
        isRecorded,
        x: Math.round(x * 10) / 10,
        yCurrent,
        yPrev,
      };
    });
  });

  protected readonly currentMonthLinePath = computed(() => {
    const points = this.chartPoints();
    if (points.length === 0) return '';
    return points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.yCurrent}`).join(' ');
  });

  protected readonly currentMonthAreaPath = computed(() => {
    const points = this.chartPoints();
    if (points.length === 0) return '';
    const first = points[0];
    const last = points[points.length - 1];
    const lineSegments = points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.yCurrent}`).join(' ');
    return `${lineSegments} L ${last.x} 104 L ${first.x} 104 Z`;
  });

  protected readonly prevMonthLinePath = computed(() => {
    const points = this.chartPoints();
    if (points.length === 0) return '';
    return points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.yPrev}`).join(' ');
  });

  protected readonly weekDividers = computed(() => {
    const points = this.chartPoints();
    if (points.length < 28) return [172, 328, 483];
    const xW1to2 = Math.round((points[6].x + points[7].x) / 2);
    const xW2to3 = Math.round((points[13].x + points[14].x) / 2);
    const xW3to4 = Math.round((points[20].x + points[21].x) / 2);
    return [xW1to2, xW2to3, xW3to4];
  });

  protected readonly weekZones = computed(() => {
    const div = this.weekDividers();
    const startX = 28;
    const endX = 672;
    const x1 = div[0] || 172;
    const x2 = div[1] || 328;
    const x3 = div[2] || 483;
    return [
      { week: 1, label: 'Week 1', range: '1–7', x: startX, width: x1 - startX },
      { week: 2, label: 'Week 2', range: '8–14', x: x1, width: x2 - x1 },
      { week: 3, label: 'Week 3', range: '15–21', isCurrent: true, x: x2, width: x3 - x2 },
      { week: 4, label: 'Week 4', range: '22–30', x: x3, width: endX - x3 },
    ];
  });

  protected readonly activeWeekZone = computed(() => {
    const w = this.selectedWeek();
    if (w === 0) return null;
    return this.weekZones().find((z) => z.week === w) || null;
  });

  protected readonly todayPoint = computed(() => {
    return this.chartPoints().find((p) => p.isToday) || null;
  });

  protected readonly weekInsights = computed(() => {
    const all = this.chartPoints();
    const w = this.selectedWeek();
    const filtered = w === 0 ? all : all.filter((p) => p.weekNumber === w);

    const totalPresent = filtered.reduce((s: number, b: any) => s + (b.present || 0), 0);
    const totalLate = filtered.reduce((s: number, b: any) => s + (b.late || 0), 0);
    const totalAbsent = filtered.reduce((s: number, b: any) => s + (b.absent || 0), 0);
    const totalPrevPresent = filtered.reduce((s: number, b: any) => s + (b.prevPresent || 0), 0);

    const diff = totalPresent - totalPrevPresent;
    const diffPct = totalPrevPresent > 0 ? Math.round((diff / totalPrevPresent) * 100) : 0;

    return {
      totalPresent,
      totalOnTime: Math.max(0, totalPresent - totalLate),
      totalLate,
      totalAbsent,
      diff,
      diffPct,
      hasPrevData: totalPrevPresent > 0,
      isMonthView: w === 0,
      selectedWeek: w,
    };
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
    this.stopAutoCycle();
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
        this.attendanceGraph.set(data.attendanceGraph || []);
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

  selectWeek(week: number): void {
    if (this.isAutoCycling()) {
      this.stopAutoCycle();
    }
    if (this.selectedWeek() === week) {
      this.selectedWeek.set(0); // Toggle to Full Month
    } else {
      this.selectedWeek.set(week);
    }
  }

  toggleAutoCycle(): void {
    if (this.isAutoCycling()) {
      this.stopAutoCycle();
    } else {
      this.startAutoCycle();
    }
  }

  private startAutoCycle(): void {
    this.isAutoCycling.set(true);
    if (this.cycleTimer) clearInterval(this.cycleTimer);
    this.cycleTimer = setInterval(() => {
      this.zone.run(() => {
        // Cycle: 1 -> 2 -> 3 -> 4 -> 0 (All Month) -> 1
        this.selectedWeek.update((w) => (w >= 4 ? 0 : w + 1));
      });
    }, 2800);
  }

  private stopAutoCycle(): void {
    this.isAutoCycling.set(false);
    if (this.cycleTimer) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }
  }

  getBarHeight(count: number, isPrev = false): number {
    if (!count || count <= 0) return 0;
    const max = Math.max(this.totalHeadcount(), 6);
    const height = Math.min(100, Math.max(16, Math.round((count / max) * 100)));
    return isPrev ? Math.round(height * 0.85) : height;
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
