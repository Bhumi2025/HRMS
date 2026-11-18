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

import { EmployeePunchWidgetComponent } from '../../shared/employee-punch-widget.component';

@Component({
  selector: 'app-template-dashboard',
  imports: [CommonModule, RouterLink, EmployeePunchWidgetComponent],
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

  getBarHeight(count: number): number {
    if (!count || count <= 0) return 0;
    const max = Math.max(this.totalHeadcount(), 6);
    return Math.min(100, Math.max(16, Math.round((count / max) * 100)));
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
