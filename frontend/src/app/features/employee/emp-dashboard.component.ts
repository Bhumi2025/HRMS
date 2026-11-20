import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import Chart from 'chart.js/auto';
import { ApiService } from '../../core/api/api.service';
import { EmployeeDashboard } from '../../core/api/api.models';
import { PunchService } from '../../core/services/punch.service';

interface Holiday {
  mon: string;
  day: string;
  name: string;
  type: string;
}

interface LeaveBalance {
  t: string;
  n: string;
  total: number;
  c: string;
}

interface Announcement {
  title: string;
  msg: string;
  type: string;
  time: string;
}

/** Employee dashboard — modernized UI matching HRMS template theme with employee-specific metrics. */
@Component({
  selector: 'app-emp-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './emp-dashboard.component.html',
  styleUrl: './emp-dashboard.component.scss',
})
export class EmpDashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly api = inject(ApiService);
  protected readonly punchService = inject(PunchService);

  private readonly attCanvas = viewChild<ElementRef<HTMLCanvasElement>>('attChart');
  private readonly hoursCanvas = viewChild<ElementRef<HTMLCanvasElement>>('hoursChart');

  protected readonly greeting = EmpDashboardComponent.greet();
  protected readonly dateStr = EmpDashboardComponent.dateString();

  protected readonly dashboard = signal<EmployeeDashboard | null>(null);
  protected readonly currentTime = signal(new Date());

  private clockInterval: ReturnType<typeof setInterval> | null = null;
  private punchPollInterval: ReturnType<typeof setInterval> | null = null;
  private attChart?: { destroy(): void };
  private hoursChart?: { destroy(): void };
  private renderScheduled = false;

  protected readonly firstName = computed(() => (this.dashboard()?.fullName ?? '').split(' ')[0]);
  protected readonly workingHours = computed(() => this.dashboard()?.workingHoursThisWeek ?? 0);

  protected readonly totalLeaveBalance = computed(() => {
    const list = this.dashboard()?.leaveBalances ?? [];
    return list.reduce((sum, l) => sum + (l.balance || 0), 0);
  });

  protected readonly holidays = computed<Holiday[]>(() =>
    (this.dashboard()?.upcomingHolidays ?? []).map((h) => ({
      mon: new Date(h.date).toLocaleDateString('en-US', { month: 'short' }),
      day: h.date ? String(Number(h.date.slice(8, 10))) : '',
      name: h.name,
      type: h.type,
    })),
  );

  protected readonly leaveBalances = computed<LeaveBalance[]>(() =>
    (this.dashboard()?.leaveBalances ?? []).map((l) => ({
      t: l.type,
      n: String(l.balance),
      total: l.total,
      c: l.color,
    })),
  );

  protected readonly recentLeave = computed(() =>
    (this.dashboard()?.recentLeaves ?? []).map((r) => ({
      t: r.leaveType,
      d: r.dateLabel,
      s: r.status,
    })),
  );

  protected readonly announcements = computed<Announcement[]>(() =>
    (this.dashboard()?.announcements ?? []).map((a) => ({
      title: a.title,
      msg: a.message,
      type: a.severity.toLowerCase(),
      time: a.publishedLabel,
    })),
  );

  ngOnInit(): void {
    this.loadData();
    this.punchService.loadTodayPunches();
    this.clockInterval = setInterval(() => {
      this.currentTime.set(new Date());
    }, 1000);
    this.punchPollInterval = setInterval(() => {
      this.punchService.loadTodayPunches();
    }, 4000);
  }

  loadData(): void {
    this.api.dashboardMe().subscribe({
      next: (dashboard) => {
        this.dashboard.set(dashboard);
        this.scheduleRender();
      },
      error: () => {
        /* API offline — the dashboard stays empty. */
      },
    });
  }

  clockIn(): void {
    this.punchService.requestClockIn();
    setTimeout(() => {
      this.loadData();
      this.punchService.loadTodayPunches();
    }, 1200);
  }

  clockOut(): void {
    this.punchService.requestClockOut();
    setTimeout(() => {
      this.loadData();
      this.punchService.loadTodayPunches();
    }, 1200);
  }

  toggleBreak(): void {
    if (this.punchService.onBreak()) {
      this.punchService.endBreak();
    } else {
      this.punchService.startBreak();
    }
    setTimeout(() => {
      this.loadData();
    }, 800);
  }

  protected ratio(l: LeaveBalance): number {
    const n = parseFloat(l.n);
    return Number.isNaN(n) ? 0 : (n / l.total) * 100;
  }

  ngAfterViewInit(): void {
    this.scheduleRender();
  }

  ngOnDestroy(): void {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
    if (this.punchPollInterval) {
      clearInterval(this.punchPollInterval);
      this.punchPollInterval = null;
    }
    this.attChart?.destroy();
    this.hoursChart?.destroy();
  }

  private scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      setTimeout(() => {
        this.renderScheduled = false;
        this.renderCharts();
      }, 60);
    });
  }

  private renderCharts(): void {
    const rawTrend = this.dashboard()?.attendanceTrend ?? [];
    let trend = rawTrend;
    if (trend.length === 0) {
      // Default 7-day fallback so graph always renders even before or without API data
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const today = new Date();
      trend = Array.from({ length: 7 }, (_, idx) => {
        const d = new Date(today);
        d.setDate(today.getDate() - (6 - idx));
        return { label: days[d.getDay()], present: 0, late: 0, absent: 0 };
      });
    }

    const P = '#2563eb';
    const labels = trend.map((t) => t.label);

    const att = this.attCanvas()?.nativeElement;
    if (att) {
      if (att.clientHeight === 0) {
        setTimeout(() => this.scheduleRender(), 100);
        return;
      }
      this.attChart?.destroy();
      this.attChart = new Chart(att, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Present', data: trend.map((t) => t.present), backgroundColor: P, borderRadius: 4, stack: 's' },
            { label: 'Late', data: trend.map((t) => t.late), backgroundColor: '#fcd34d', borderRadius: 4, stack: 's' },
            { label: 'Absent', data: trend.map((t) => t.absent), backgroundColor: '#fca5a5', borderRadius: 4, stack: 's' },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 } } },
            y: { stacked: true, min: 0, grid: { color: 'rgba(0,0,0,.04)' }, ticks: { font: { size: 10 } } },
          },
        },
      });
    }

    const hours = this.hoursCanvas()?.nativeElement;
    if (hours) {
      if (hours.clientHeight === 0) {
        setTimeout(() => this.scheduleRender(), 100);
        return;
      }
      this.hoursChart?.destroy();
      this.hoursChart = new Chart(hours, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Hours',
              data: trend.map((t) => t.present),
              borderColor: '#8b5cf6',
              backgroundColor: 'rgba(139,92,246,.12)',
              borderWidth: 2,
              pointRadius: 3,
              pointBackgroundColor: '#8b5cf6',
              fill: true,
              tension: 0.4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { min: 0, grid: { color: 'rgba(0,0,0,.04)' }, ticks: { font: { size: 10 }, callback: (v) => `${v}h` } },
            x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          },
        },
      });
    }
  }

  private static greet(): string {
    const hr = new Date().getHours();
    return hr < 12 ? 'Good Morning' : hr < 17 ? 'Good Afternoon' : 'Good Evening';
  }

  private static dateString(): string {
    const now = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
  }
}
