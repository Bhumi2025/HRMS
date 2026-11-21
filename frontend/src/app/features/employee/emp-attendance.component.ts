import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import Chart from 'chart.js/auto';
import { ApiService } from '../../core/api/api.service';
import { AttendanceRecord, EmployeeDashboard, MonthlyMusterDay } from '../../core/api/api.models';
import { IconDirective } from '../../core/icons/icon.directive';
import { ToastService } from '../../core/services/toast.service';

interface LogRow {
  d: string;
  day: string;
  in: string;
  out: string;
  brk: string;
  hrs: string;
  s: string;
}

interface CalendarDay {
  d: number;
  weekend: boolean;
  late: boolean;
  absent: boolean;
  present: boolean;
  halfDay: boolean;
  scheduled: boolean;
  notEmployed: boolean;
}

/** My Attendance — ported from pages/emp-attendance.html. */
@Component({
  selector: 'app-emp-attendance',
  imports: [CommonModule, IconDirective],
  template: `
    <div class="grid-2" style="margin-bottom: 15px">
      <!-- 1. Left Card: Attendance Trend Graph & Bottom Weekly 2D Tracker -->
      <div class="card">
        <div class="card-header trend-header">
          <div>
            <div class="card-title">Attendance Trend</div>
            <div class="card-subtitle">{{ trendViewMode() === 'month' ? ('Month-wise View · ' + selectedMonthLabel()) : ('Weekly Cycle · ' + weekDateRangeLabel()) }}</div>
          </div>
          <div class="trend-toggle-group">
            <button
              type="button"
              class="trend-toggle-btn"
              [class.active]="trendViewMode() === 'month'"
              (click)="setViewMode('month')"
            >
              Month View
            </button>
            <button
              type="button"
              class="trend-toggle-btn"
              [class.active]="trendViewMode() === 'week'"
              (click)="setViewMode('week')"
            >
              Week View
            </button>
          </div>
        </div>

        <div class="card-body" style="padding-top: 4px;">
          <!-- KPI Summary Strip -->
          <div class="trend-kpi-bar">
            <span class="kpi-chip chip-present"><span class="dot"></span> Present: <strong>{{ musterStats().present }}d</strong></span>
            <span class="kpi-chip chip-late"><span class="dot"></span> Late: <strong>{{ musterStats().late }}d</strong></span>
            <span class="kpi-chip chip-halfday"><span class="dot"></span> Half Day: <strong>{{ musterStats().halfDay }}d</strong></span>
            <span class="kpi-chip chip-absent"><span class="dot"></span> Absent: <strong>{{ musterStats().absent }}d</strong></span>
            <span class="kpi-chip chip-hours"><span class="dot"></span> Hours: <strong>{{ musterStats().totalHours }}h</strong></span>
            <span class="kpi-chip" style="margin-left: auto; color: var(--muted);"><span style="border-top: 2px dashed #94a3b8; width: 14px; display: inline-block; vertical-align: middle; margin-right: 4px;"></span> Standard (8h)</span>
          </div>

          <!-- Trend Chart Canvas -->
          <div style="position: relative; height: 230px;">
            <canvas #trendChart></canvas>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header" style="margin-bottom: 12px">
          <div class="card-title">Monthly Summary</div>
          <select class="form-control form-select" style="width: 160px" [value]="selectedMonth()" (change)="onMonthChange($event)">
            @for (m of monthOptions(); track m.value) {
              <option [value]="m.value">{{ m.label }}</option>
            }
          </select>
        </div>
        <div class="card-body" style="padding-top: 0">
          <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; text-align: center; margin-bottom: 8px">
            @for (d of weekDays; track $index) {
              <div style="font-size: 12px; font-weight: 700; color: var(--muted); padding: 4px 0">{{ d }}</div>
            }
            @for (blank of blanks(); track $index) {
              <div></div>
            }
            @for (day of calendar(); track day.d) {
              <div
                style="padding: 5px 2px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer"
                [style.background]="dayBg(day)"
                [style.color]="dayColor(day)"
              >
                {{ day.d }}
              </div>
            }
          </div>
          <div style="display: flex; gap: 12px; margin-top: 8px; font-size: 12px">
            <span style="display: flex; align-items: center; gap: 4px"><span style="width: 8px; height: 8px; border-radius: 2px; background: rgba(16,185,129,.5); display: inline-block"></span>Present</span>
            <span style="display: flex; align-items: center; gap: 4px"><span style="width: 8px; height: 8px; border-radius: 2px; background: rgba(239,68,68,.5); display: inline-block"></span>Absent</span>
            <span style="display: flex; align-items: center; gap: 4px"><span style="width: 8px; height: 8px; border-radius: 2px; background: rgba(245,158,11,.5); display: inline-block"></span>Late</span>
            <span style="display: flex; align-items: center; gap: 4px"><span style="width: 8px; height: 8px; border-radius: 2px; background: rgba(249,115,22,.5); display: inline-block"></span>Half Day</span>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header" style="margin-bottom: 12px">
        <div class="card-title">Attendance Log</div>
        <div style="display: flex; gap: 8px">
          <select class="form-control form-select" style="width: 160px" [value]="selectedMonth()" (change)="onMonthChange($event)">
            @for (m of monthOptions(); track m.value) {
              <option [value]="m.value">{{ m.label }}</option>
            }
          </select>
          <button class="btn btn-outline btn-sm" style="display: flex; align-items: center; gap: 6px" (click)="exportCsv()">
            <span [appIcon]="'download'"></span> Export
          </button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Day</th>
              <th>Check In</th>
              <th>Check Out</th>
              <th>Break</th>
              <th>Work Hours</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            @for (r of log(); track r.d) {
              <tr>
                <td style="font-weight: 600">{{ r.d }}</td>
                <td style="color: var(--text)">{{ r.day }}</td>
                <td>{{ r.in }}</td>
                <td>{{ r.out }}</td>
                <td style="color: var(--warning); font-weight: 600">{{ r.brk }}</td>
                <td style="font-weight: 600">{{ r.hrs }}</td>
                <td><span class="badge" [class]="logClass(r.s)">{{ r.s }}</span></td>
              </tr>
            } @empty {
              <tr>
                <td colspan="7" style="text-align: center; color: var(--muted); padding: 20px;">
                  No attendance records found for this period.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [
    `
      .trend-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }
      .trend-toggle-group {
        display: flex;
        background: var(--bg);
        padding: 2px;
        border-radius: 6px;
        border: 1px solid var(--border);
        gap: 2px;
      }
      .trend-toggle-btn {
        border: none;
        background: transparent;
        color: var(--muted);
        font-size: 11px;
        font-weight: 600;
        padding: 3px 9px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .trend-toggle-btn.active {
        background: var(--primary, #2563eb);
        color: #ffffff;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
      }
      .trend-toggle-btn:hover:not(.active) {
        color: var(--text);
      }
      .trend-kpi-bar {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 8px;
        padding-bottom: 6px;
        border-bottom: 1px dashed var(--border);
      }
      .kpi-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        padding: 2px 7px;
        border-radius: 4px;
        background: var(--bg);
        color: var(--text);
      }
      .kpi-chip .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
      }
      .chip-present .dot { background: #10b981; }
      .chip-late .dot { background: #f59e0b; }
      .chip-halfday .dot { background: #f97316; }
      .chip-absent .dot { background: #ef4444; }
      .chip-hours .dot { background: #8b5cf6; }

      @media (max-width: 768px) {
        .grid-2 {
          grid-template-columns: 1fr !important;
          gap: 12px !important;
        }
        .trend-header {
          flex-direction: column;
          align-items: flex-start;
          gap: 8px;
        }
        .trend-toggle-group {
          align-self: flex-start;
        }
        .card-header {
          flex-direction: column;
          align-items: flex-start;
          gap: 8px;
        }
        .card-header select {
          width: 100% !important;
        }
      }
    `,
  ],
})
export class EmpAttendanceComponent implements OnInit, AfterViewInit {
  private readonly toast = inject(ToastService);
  private readonly api = inject(ApiService);
  private readonly trendCanvas = viewChild<ElementRef<HTMLCanvasElement>>('trendChart');

  private trendChart?: { destroy(): void };
  private renderScheduled = false;

  protected readonly weekDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  protected readonly dashboard = signal<EmployeeDashboard | null>(null);
  protected readonly muster = signal<MonthlyMusterDay[]>([]);
  protected readonly log = signal<LogRow[]>([]);
  protected readonly trendViewMode = signal<'month' | 'week'>('month');

  protected setViewMode(mode: 'month' | 'week'): void {
    this.trendViewMode.set(mode);
    this.scheduleRender();
  }

  // Default to current year-month
  protected readonly selectedMonth = signal<string>(EmpAttendanceComponent.currentYearMonth());

  protected readonly selectedMonthLabel = computed(() => {
    const val = this.selectedMonth();
    if (!val) return '';
    const [y, m] = val.split('-').map(Number);
    const d = new Date(y, (m || 1) - 1, 1);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  });

  protected readonly musterStats = computed(() => {
    const list = this.muster();
    const present = list.filter((d) => d.status === 'Present' || d.status === 'Remote' || d.status === 'LeftEarly').length;
    const late = list.filter((d) => d.status === 'Late').length;
    const halfDay = list.filter((d) => d.status === 'HalfDay').length;
    const absent = list.filter((d) => d.status === 'Absent').length;
    const totalHours = Math.round(list.reduce((sum, d) => sum + (d.workHours || 0), 0) * 10) / 10;
    return { present, late, halfDay, absent, totalHours };
  });

  protected readonly weeklyStripDays = computed(() => {
    const musterList = this.muster();
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0: Sun, 1: Mon, ..., 5: Fri, 6: Sat
    // Saturday to Friday cycle matching Image 2
    const diffToSat = (dayOfWeek + 1) % 7;
    const startSat = new Date(today);
    startSat.setDate(today.getDate() - diffToSat);

    const dayNames = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const days = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(startSat);
      d.setDate(startSat.getDate() + i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dayNum = String(d.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${dayNum}`;
      const isToday = d.toDateString() === today.toDateString();

      const found = musterList.find((item) => item.date === dateStr);
      const isWeekend = i === 0 || i === 1;

      let status = found?.status || (isWeekend ? 'Weekend' : (d > today ? 'Scheduled' : 'Absent'));
      let workHours = found?.workHours ?? 0;
      let inTime = found?.checkIn ?? null;
      let outTime = found?.checkOut ?? null;

      days.push({
        dayName: dayNames[i],
        dayNum: d.getDate(),
        dateStr,
        isToday,
        status,
        workHours,
        inTime,
        outTime,
      });
    }

    return days;
  });

  protected readonly weekDateRangeLabel = computed(() => {
    const days = this.weeklyStripDays();
    if (!days.length) return '';
    const first = days[0];
    const last = days[days.length - 1];
    return `${first.dayName} (${first.dayNum}) - ${last.dayName} (${last.dayNum})`;
  });

  protected readonly selectedMonthDate = computed(() => {
    const val = this.selectedMonth();
    if (!val) return new Date();
    const [y, m] = val.split('-').map(Number);
    return new Date(y, (m || 1) - 1, 1);
  });

  protected readonly blanks = computed(() => {
    const d = this.selectedMonthDate();
    return Array.from({ length: new Date(d.getFullYear(), d.getMonth(), 1).getDay() }, (_, i) => i);
  });

  protected readonly monthOptions = computed(() => {
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const val = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const label = `${date.toLocaleDateString('en-US', { month: 'long' })} ${date.getFullYear()}`;
      return { value: val, label };
    });
  });

  protected readonly calendar = computed<CalendarDay[]>(() =>
    this.muster().map((day) => ({
      d: Number(day.date.slice(8, 10)),
      weekend: day.status === 'Weekend' || day.status === 'Holiday',
      late: day.status === 'Late',
      absent: day.status === 'Absent' || day.status === 'NotEmployed',
      present: day.status === 'Present' || day.status === 'Remote' || day.status === 'LeftEarly',
      halfDay: day.status === 'HalfDay',
      scheduled: day.status === 'Scheduled',
      notEmployed: false,
    })),
  );

  private static currentYearMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  ngOnInit(): void {
    this.api.dashboardMe().subscribe({
      next: (dashboard) => {
        this.dashboard.set(dashboard);
        const [y, m] = this.selectedMonth().split('-').map(Number);
        this.loadMonthData(y, m);
      },
      error: () => {
        /* API offline */
      },
    });
  }

  protected onMonthChange(event: Event): void {
    const target = event.target as HTMLSelectElement | HTMLInputElement;
    const val = target?.value;
    if (!val) return;
    this.selectedMonth.set(val);
    const [y, m] = val.split('-').map(Number);
    this.loadMonthData(y, m);
  }

  private loadMonthData(year: number, month: number): void {
    const empId = this.dashboard()?.employeeId;
    if (!empId) return;

    this.api.muster(empId, year, month).subscribe({
      next: (days) => {
        this.muster.set(days || []);
        this.scheduleRender();
      },
      error: () => this.muster.set([]),
    });

    this.api.attendanceForEmployee(empId, year, month).subscribe({
      next: (records) => {
        this.log.set((records || []).map((record) => this.toRow(record)));
        this.scheduleRender();
      },
      error: () => this.log.set([]),
    });
  }

  private toRow(record: AttendanceRecord): LogRow {
    const date = new Date(record.date);
    const minutes = record.breakMinutes ?? 0;

    return {
      d: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      day: date.toLocaleDateString('en-US', { weekday: 'short' }),
      in: record.checkIn ?? ' · ',
      out: record.checkOut ?? ' · ',
      brk: minutes > 0 ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m` : ' · ',
      hrs: `${record.workHours}h`,
      s: record.status,
    };
  }

  protected dayBg(day: CalendarDay): string {
    if (day.weekend || day.scheduled) return 'var(--bg)';
    if (day.halfDay) return 'rgba(249,115,22,.15)';
    if (day.absent) return 'rgba(239,68,68,.12)';
    if (day.late) return 'rgba(245,158,11,.1)';
    if (day.present) return 'rgba(16,185,129,.1)';
    return 'var(--bg)';
  }

  protected dayColor(day: CalendarDay): string {
    if (day.weekend || day.scheduled) return 'var(--light)';
    if (day.halfDay) return '#ea580c';
    if (day.absent) return 'var(--danger)';
    if (day.late) return 'var(--warning)';
    if (day.present) return 'var(--success)';
    return 'var(--light)';
  }

  protected logClass(s: string): string {
    if (s === 'Present') return 'badge-success';
    if (s === 'Late' || s === 'HalfDay') return 'badge-warning';
    if (s === 'OnLeave') return 'badge-info';
    return 'badge-danger';
  }

  ngAfterViewInit(): void {
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      setTimeout(() => {
        this.renderScheduled = false;
        this.renderChart();
      }, 50);
    });
  }

  private renderChart(): void {
    const canvas = this.trendCanvas()?.nativeElement;
    if (!canvas) return;
    if (canvas.clientHeight === 0) {
      setTimeout(() => this.scheduleRender(), 100);
      return;
    }

    const mode = this.trendViewMode();
    let labels: string[] = [];
    let hoursData: number[] = [];
    let barColors: string[] = [];
    let hoverColors: string[] = [];

    const getColors = (status: string, hours: number) => {
      switch (status) {
        case 'Present':
        case 'Remote':
        case 'LeftEarly':
          return { bg: '#10b981', hover: '#059669' };
        case 'Late':
          return { bg: '#f59e0b', hover: '#d97706' };
        case 'HalfDay':
          return { bg: '#f97316', hover: '#ea580c' };
        case 'Absent':
          return { bg: '#ef4444', hover: '#dc2626' };
        case 'Weekend':
        case 'Holiday':
          return { bg: hours > 0 ? '#8b5cf6' : 'rgba(0,0,0,0)', hover: hours > 0 ? '#7c3aed' : 'rgba(0,0,0,0)' };
        default:
          return hours > 0 ? { bg: '#3b82f6', hover: '#2563eb' } : { bg: 'rgba(0,0,0,0)', hover: 'rgba(0,0,0,0)' };
      }
    };

    if (mode === 'month') {
      const musterList = this.muster();
      if (musterList.length > 0) {
        labels = musterList.map((d) => String(Number(d.date.slice(8, 10))));
        hoursData = musterList.map((d) => d.workHours || 0);
        barColors = musterList.map((d) => getColors(d.status, d.workHours || 0).bg);
        hoverColors = musterList.map((d) => getColors(d.status, d.workHours || 0).hover);
      }
    } else {
      const weekDays = this.weeklyStripDays();
      labels = weekDays.map((w) => w.dayName);
      hoursData = weekDays.map((w) => w.workHours || 0);
      barColors = weekDays.map((w) => getColors(w.status, w.workHours || 0).bg);
      hoverColors = weekDays.map((w) => getColors(w.status, w.workHours || 0).hover);
    }

    this.trendChart?.destroy();
    this.trendChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'Work Hours',
            data: hoursData,
            backgroundColor: barColors,
            hoverBackgroundColor: hoverColors,
            borderRadius: mode === 'month' ? 4 : 6,
            borderSkipped: false,
            minBarLength: 4,
            barPercentage: mode === 'month' ? 0.7 : 0.45,
            maxBarThickness: mode === 'month' ? 14 : 36,
            order: 2,
          },
          {
            type: 'line',
            label: 'Standard Shift (8h)',
            data: labels.map(() => 8),
            borderColor: '#94a3b8',
            borderWidth: 1.5,
            borderDash: [5, 5],
            pointRadius: 0,
            pointHoverRadius: 0,
            fill: false,
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.92)',
            titleFont: { size: 12, weight: 'bold' },
            bodyFont: { size: 11 },
            padding: 10,
            cornerRadius: 8,
            filter: (item) => item.datasetIndex === 0,
            callbacks: {
              title: (items) => {
                if (!items.length) return '';
                const idx = items[0].dataIndex;
                if (mode === 'month') {
                  const m = this.muster()[idx];
                  return m ? `${m.dayLabel || m.date}` : `Day ${items[0].label}`;
                }
                const w = this.weeklyStripDays()[idx];
                return w ? `${w.dayName} (${w.dateStr})` : items[0].label;
              },
              label: (item) => {
                const hours = item.raw as number;
                return `⏱ Work Hours: ${hours}h`;
              },
              afterBody: (items) => {
                if (!items.length) return [];
                const idx = items[0].dataIndex;
                const lines: string[] = [];
                if (mode === 'month') {
                  const m = this.muster()[idx];
                  if (m) {
                    if (m.status) lines.push(`Status: ${m.status}`);
                    if (m.checkIn) lines.push(`Punch: ${m.checkIn} - ${m.checkOut || '—'}`);
                  }
                } else {
                  const w = this.weeklyStripDays()[idx];
                  if (w) {
                    if (w.status) lines.push(`Status: ${w.status}`);
                    if (w.inTime) lines.push(`Punch: ${w.inTime} - ${w.outTime || '—'}`);
                  }
                }
                return lines;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              font: { size: mode === 'month' ? (labels.length > 20 ? 9 : 10) : 11, weight: '500' },
              color: '#64748b',
              maxRotation: 0,
            },
          },
          y: {
            min: 0,
            suggestedMax: 10,
            grid: { color: 'rgba(0, 0, 0, 0.05)' },
            ticks: {
              font: { size: 10 },
              color: '#64748b',
              stepSize: 2,
              callback: (v) => `${v}h`,
            },
          },
        },
      },
    });
  }

  protected exportCsv(): void {
    const header = ['Date', 'Day', 'Check In', 'Check Out', 'Break', 'Work Hours', 'Status'];
    const csv = [
      header.join(','),
      ...this.log().map((r) => [r.d, r.day, r.in, r.out, r.brk, r.hrs, r.s].join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-${this.selectedMonth()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast.show('Attendance exported');
  }
}
