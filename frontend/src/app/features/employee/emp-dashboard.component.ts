import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import Chart from 'chart.js/auto';
import { ApiService } from '../../core/api/api.service';
import { EmployeeDashboard } from '../../core/api/api.models';
import { PunchService } from '../../core/services/punch.service';
import { UiService } from '../../core/services/ui.service';

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
  protected readonly ui = inject(UiService);

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
    this.resizeChartsAfterTransition();
  }

  protected closePopout(event?: Event): void {
    event?.stopPropagation();
    this.poppedWidget.set(null);
    this.resizeChartsAfterTransition();
  }

  private resizeChartsAfterTransition(): void {
    setTimeout(() => {
      this.attChart?.resize();
      this.hoursChart?.resize();
    }, 60);
  }

  private readonly attCanvas = viewChild<ElementRef<HTMLCanvasElement>>('attChart');
  private readonly hoursCanvas = viewChild<ElementRef<HTMLCanvasElement>>('hoursChart');

  protected readonly greeting = EmpDashboardComponent.greet();
  protected readonly dateStr = EmpDashboardComponent.dateString();

  protected readonly dashboard = signal<EmployeeDashboard | null>(null);
  protected readonly currentTime = signal(new Date());
  protected readonly activeMobileSection = signal<'all' | 'clock' | 'notices' | 'holidays'>('all');

  protected setMobileSection(section: 'all' | 'clock' | 'notices' | 'holidays'): void {
    this.activeMobileSection.set(section);
    if (section === 'all') {
      setTimeout(() => {
        this.renderCharts();
        this.attChart?.resize();
        this.hoursChart?.resize();
      }, 50);
    }
  }

  private clockInterval: ReturnType<typeof setInterval> | null = null;
  private punchPollInterval: ReturnType<typeof setInterval> | null = null;
  private attChart: Chart | null = null;
  private hoursChart: Chart | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private renderScheduled = false;

  protected readonly firstName = computed(() => (this.dashboard()?.fullName ?? '').split(' ')[0]);
  protected readonly workingHours = computed(() => {
    const apiHours = this.dashboard()?.workingHoursThisWeek ?? 0;
    const liveTodayHours = Math.round((this.punchService.workSeconds() / 3600) * 10) / 10;
    return Math.round(Math.max(apiHours, liveTodayHours) * 10) / 10;
  });

  constructor() {
    effect(() => {
      // Live smooth in-place update when working hours change, without bouncing/destroying charts
      const hrs = this.workingHours();
      if (this.hoursChart) {
        const trend = this.getTrend();
        const { labels, hoursData } = this.getHoursData(trend);
        this.hoursChart.data.labels = labels;
        this.hoursChart.data.datasets[0].data = hoursData;
        this.hoursChart.update('none');
      }
    });
  }

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
    setTimeout(() => this.renderCharts(), 80);

    // Keep charts responsive on container resize without destroying
    if (typeof ResizeObserver !== 'undefined') {
      const attWrap = this.attCanvas()?.nativeElement?.parentElement;
      const hoursWrap = this.hoursCanvas()?.nativeElement?.parentElement;
      this.resizeObserver = new ResizeObserver(() => {
        if (this.attChart) this.attChart.resize();
        if (this.hoursChart) this.hoursChart.resize();
        this.renderCharts();
      });
      if (attWrap) this.resizeObserver.observe(attWrap);
      if (hoursWrap) this.resizeObserver.observe(hoursWrap);
    }
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
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.attChart) {
      this.attChart.destroy();
      this.attChart = null;
    }
    if (this.hoursChart) {
      this.hoursChart.destroy();
      this.hoursChart = null;
    }
  }

  private scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.renderCharts();
    });
  }

  private getTrend(): { label: string; present: number; late: number; absent: number; workHours?: number; beforeBreakHours?: number; afterBreakHours?: number }[] {
    const rawTrend = this.dashboard()?.attendanceTrend ?? [];
    if (rawTrend.length > 0) return rawTrend;

    // Default 7-day fallback so graph always renders even before or without API data
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const today = new Date();
    return Array.from({ length: 7 }, (_, idx) => {
      const d = new Date(today);
      d.setDate(today.getDate() - (6 - idx));
      return { label: days[d.getDay()], present: 0, late: 0, absent: 0, workHours: 0 };
    });
  }

  private getHoursData(trend: ReturnType<typeof this.getTrend>): { labels: string[]; hoursData: number[] } {
    const todayDayName = new Date().toLocaleDateString('en-US', { weekday: 'short' });
    const liveTodayHours = Math.round((this.punchService.workSeconds() / 3600) * 10) / 10;
    const labels = trend.map((t) => t.label);

    const hoursData = trend.map((t) => {
      if (typeof t.workHours === 'number' && t.workHours > 0) {
        return t.workHours;
      }
      if (t.label.toLowerCase() === todayDayName.toLowerCase() && liveTodayHours > 0) {
        return liveTodayHours;
      }
      if (t.beforeBreakHours || t.afterBreakHours) {
        return Math.round(((t.beforeBreakHours || 0) + (t.afterBreakHours || 0)) * 10) / 10;
      }
      return 0;
    });

    return { labels, hoursData };
  }

  private renderCharts(): void {
    this.renderAttendanceChart();
    this.renderHoursChart();
  }

  private renderAttendanceChart(): void {
    const canvas = this.attCanvas()?.nativeElement;
    if (!canvas) return;

    // If container is hidden (e.g. mobile tab not active), wait until shown
    if (canvas.clientWidth === 0 && canvas.clientHeight === 0) {
      return;
    }

    const trend = this.getTrend();
    const labels = trend.map((t) => t.label);
    const presentData = trend.map((t) => t.present);
    const lateData = trend.map((t) => t.late);
    const absentData = trend.map((t) => t.absent);

    // If chart already exists on this canvas, update in-place without dancing
    if (this.attChart && this.attChart.canvas === canvas) {
      this.attChart.data.labels = labels;
      this.attChart.data.datasets[0].data = presentData;
      this.attChart.data.datasets[1].data = lateData;
      this.attChart.data.datasets[2].data = absentData;
      this.attChart.update('none');
      return;
    }

    if (this.attChart) {
      this.attChart.destroy();
      this.attChart = null;
    }

    this.attChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Present',
            data: presentData,
            backgroundColor: '#2563eb',
            borderRadius: { topLeft: 4, topRight: 4 },
            borderSkipped: false,
            stack: 'attendance',
          },
          {
            label: 'Late',
            data: lateData,
            backgroundColor: '#f59e0b',
            borderRadius: { topLeft: 4, topRight: 4 },
            borderSkipped: false,
            stack: 'attendance',
          },
          {
            label: 'Absent',
            data: absentData,
            backgroundColor: '#ef4444',
            borderRadius: { topLeft: 4, topRight: 4 },
            borderSkipped: false,
            stack: 'attendance',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 350 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.92)',
            titleFont: { size: 12, weight: 'bold' },
            bodyFont: { size: 11 },
            padding: 8,
            cornerRadius: 6,
            callbacks: {
              label: (context) => {
                const status = context.dataset.label;
                const val = context.raw as number;
                return val > 0 ? ` Status: ${status}` : '';
              },
            },
            filter: (item) => (item.raw as number) > 0,
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { font: { size: 11, weight: '600' }, color: '#64748b' },
          },
          y: {
            stacked: true,
            min: 0,
            max: 1,
            grid: { color: 'rgba(0,0,0,.04)' },
            ticks: {
              stepSize: 1,
              font: { size: 10, weight: '600' },
              color: '#94a3b8',
              callback: (val) => (val === 1 ? '1d' : '0'),
            },
          },
        },
      },
    });
  }

  private renderHoursChart(): void {
    const canvas = this.hoursCanvas()?.nativeElement;
    if (!canvas) return;

    if (canvas.clientWidth === 0 && canvas.clientHeight === 0) {
      return;
    }

    const trend = this.getTrend();
    const { labels, hoursData } = this.getHoursData(trend);

    // If chart already exists on this canvas, update in-place without dancing
    if (this.hoursChart && this.hoursChart.canvas === canvas) {
      this.hoursChart.data.labels = labels;
      this.hoursChart.data.datasets[0].data = hoursData;
      this.hoursChart.update('none');
      return;
    }

    if (this.hoursChart) {
      this.hoursChart.destroy();
      this.hoursChart = null;
    }

    this.hoursChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Hours',
            data: hoursData,
            borderColor: '#8b5cf6',
            backgroundColor: 'rgba(139, 92, 246, 0.12)',
            borderWidth: 2.5,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: '#8b5cf6',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2,
            fill: true,
            tension: 0.35,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 350 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.92)',
            titleFont: { size: 12, weight: 'bold' },
            bodyFont: { size: 11 },
            padding: 8,
            cornerRadius: 6,
            callbacks: {
              label: (item) => ` Work Hours: ${item.raw}h`,
            },
          },
        },
        scales: {
          y: {
            min: 0,
            suggestedMax: 8,
            grid: { color: 'rgba(0,0,0,.04)' },
            ticks: {
              font: { size: 10, weight: '600' },
              color: '#94a3b8',
              stepSize: 2,
              callback: (v) => `${v}h`,
            },
          },
          x: {
            grid: { display: false },
            ticks: { font: { size: 11, weight: '600' }, color: '#64748b' },
          },
        },
      },
    });
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
