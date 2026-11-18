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

  // Attendance Graph Multi-Week & Heartbeat Signals
  protected readonly selectedWeek = signal<number>(this.getCalendarWeek(new Date()));
  protected readonly isAutoCycling = signal<boolean>(false);
  private cycleTimer: ReturnType<typeof setInterval> | null = null;

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
    return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(this.currentTime());
  });

  protected readonly previousWeekNumber = computed(() => {
    const w = this.selectedWeek();
    return w > 1 ? w - 1 : 1;
  });

  protected readonly weekInsights = computed(() => {
    const bars = this.activeWeekBars();
    const totalPresent = bars.reduce((s: number, b: any) => s + (b.present || 0), 0);
    const totalLate = bars.reduce((s: number, b: any) => s + (b.late || 0), 0);
    const totalAbsent = bars.reduce((s: number, b: any) => s + (b.absent || 0), 0);
    const totalPrevPresent = bars.reduce((s: number, b: any) => s + (b.prevPresent || 0), 0);

    const diff = totalPresent - totalPrevPresent;
    const diffPct = totalPrevPresent > 0 ? Math.round((diff / totalPrevPresent) * 100) : 0;

    return {
      totalPresent: totalPresent + totalLate,
      totalOnTime: totalPresent,
      totalLate,
      totalAbsent,
      diff,
      diffPct,
      hasPrevData: totalPrevPresent > 0,
    };
  });

  protected readonly activeWeekBars = computed(() => {
    const all = this.attendanceGraph();
    const w = this.selectedWeek();
    const now = this.currentTime();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Filter points for the selected week
    const weekPoints = all.filter((p) => p.weekNumber === w);
    const source = weekPoints.length > 0 ? weekPoints : all.slice(0, 7);

    return source.map((p) => {
      const isToday = p.date ? p.date === todayStr : false;
      const dayNum = p.date ? parseInt(p.date.split('-')[2], 10) : undefined;
      return {
        ...p,
        isToday,
        dayNumber: dayNum,
        prevPresent: p.prevPresent ?? 0,
        prevLate: p.prevLate ?? 0,
        prevAbsent: p.prevAbsent ?? 0,
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
    this.selectedWeek.set(week);
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
        this.selectedWeek.update((w) => (w % 4) + 1);
      });
    }, 3200);
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
