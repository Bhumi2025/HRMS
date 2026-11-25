import { Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { ApiService } from '../api/api.service';
import { EmployeePunch } from '../api/api.models';

export function safeParseDate(val: any): Date {
  if (!val) return new Date();
  if (val instanceof Date) return isNaN(val.getTime()) ? new Date() : val;
  const str = String(val).trim();
  if (!str) return new Date();

  // If ISO date/time string without explicit timezone:
  // Backend stores DateTime in UTC (EF Core returns datetime2 as Unspecified),
  // so if string has 'T' and no timezone offset or Z, append 'Z' to treat as UTC!
  if (str.includes('T')) {
    const timePart = str.split('T')[1] || '';
    if (!timePart.endsWith('Z') && !timePart.includes('+') && !timePart.includes('-')) {
      const parsedUtc = new Date(str + 'Z');
      if (!isNaN(parsedUtc.getTime())) return parsedUtc;
    }
  } else if (str.includes(' ')) {
    // Format "YYYY-MM-DD HH:mm:ss"
    const formatted = str.replace(' ', 'T');
    const timePart = formatted.split('T')[1] || '';
    if (!timePart.endsWith('Z') && !timePart.includes('+') && !timePart.includes('-')) {
      const parsedUtc = new Date(formatted + 'Z');
      if (!isNaN(parsedUtc.getTime())) return parsedUtc;
    }
  }

  const direct = new Date(str);
  if (!isNaN(direct.getTime())) return direct;

  return new Date();
}

export type PunchState = 'idle' | 'active';

export interface PunchTimelineItem {
  id: string;
  kind: 'punch' | 'break';
  punchType?: 'ClockIn' | 'ClockOut' | 'BreakIn' | 'BreakOut';
  label?: 'Punch In' | 'Punch Out' | 'Start Break' | 'End Break' | string;
  isPunchIn?: boolean;
  timeStr?: string;
  rawTime?: Date;
  note?: string | null;
  device?: string | null;
  durationStr?: string;
  minutes?: number;
}

/**
 * Punch / attendance timer shown in the header punch panel and dashboard.
 * Connected directly to backend biometric/web punch API.
 */
@Injectable({ providedIn: 'root' })
export class PunchService {
  private readonly api = inject(ApiService);
  private readonly zone = inject(NgZone);

  private readonly _state = signal<PunchState>('idle');
  private readonly _onBreak = signal(false);
  private readonly _workSeconds = signal(0);
  private readonly _breakSeconds = signal(0);

  readonly state = this._state.asReadonly();
  readonly onBreak = this._onBreak.asReadonly();
  readonly workSeconds = this._workSeconds.asReadonly();
  readonly breakSeconds = this._breakSeconds.asReadonly();

  readonly workTime = signal('00:00:00');
  readonly breakTime = signal('00:00:00');
  readonly todayPunches = signal<EmployeePunch[]>([]);

  readonly punchTimeline = computed<PunchTimelineItem[]>(() => {
    const punches = this.todayPunches();
    if (!punches || punches.length === 0) {
      return [];
    }

    // Sort ascending: earliest punch of today first to latest punch last
    const sorted = [...punches].sort(
      (a, b) => safeParseDate(a.punchTime).getTime() - safeParseDate(b.punchTime).getTime()
    );

    const items: PunchTimelineItem[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      const isPunchIn = p.punchType === 'ClockIn' || p.punchType === 'BreakOut';
      let label: string = isPunchIn ? 'Punch In' : 'Punch Out';
      if (p.punchType === 'BreakIn') label = 'Start Break';
      else if (p.punchType === 'BreakOut') label = 'End Break';

      // Format time as hh:mm:ss a (e.g. 02:08:26 PM)
      const d = safeParseDate(p.punchTime);
      let hours = d.getHours();
      let minutes = d.getMinutes();
      let seconds = d.getSeconds();
      if (isNaN(hours)) hours = 0;
      if (isNaN(minutes)) minutes = 0;
      if (isNaN(seconds)) seconds = 0;
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} ${ampm}`;

      // Check if previous punch was an Out and current is an In -> Break divider!
      if (i > 0) {
        const prev = sorted[i - 1];
        const prevIsOut = prev.punchType === 'ClockOut' || prev.punchType === 'BreakIn';
        if (prevIsOut && isPunchIn) {
          const prevTime = safeParseDate(prev.punchTime).getTime();
          const currTime = d.getTime();
          const diffMs = Math.max(0, currTime - prevTime);
          const breakMinutes = Math.round(diffMs / 60000);
          if (breakMinutes >= 1) {
            let durationStr = `${breakMinutes} Min Break`;
            if (breakMinutes >= 60) {
              const h = Math.floor(breakMinutes / 60);
              const m = breakMinutes % 60;
              durationStr = m > 0 ? `${h}h ${m}m Break` : `${h}h Break`;
            }
            items.push({
              id: `break-${prev.id}-${p.id}`,
              kind: 'break',
              durationStr,
              minutes: breakMinutes,
            });
          }
        }
      }

      items.push({
        id: p.id,
        kind: 'punch',
        punchType: p.punchType as any,
        label,
        isPunchIn,
        timeStr,
        rawTime: d,
        note: p.note,
        device: p.device,
      });
    }

    // If currently on break, append ongoing break pill
    if (this._onBreak()) {
      const lastPunch = sorted[sorted.length - 1];
      if (lastPunch) {
        const lastTime = safeParseDate(lastPunch.punchTime).getTime();
        const diffMs = Math.max(0, Date.now() - lastTime);
        const breakMinutes = Math.floor(diffMs / 60000);
        const durationStr = breakMinutes < 60
          ? `${breakMinutes} Min Break (Ongoing)`
          : `${Math.floor(breakMinutes / 60)}h ${breakMinutes % 60}m Break (Ongoing)`;
        items.push({
          id: 'break-ongoing',
          kind: 'break',
          durationStr,
          minutes: breakMinutes,
        });
      }
    }

    // Return reverse chronological: latest activity at top
    return items.reverse();
  });

  readonly todayPunchBreakdown = computed(() => {
    const punches = this.todayPunches();
    if (!punches || punches.length === 0) {
      return {
        hasPunched: false,
        beforeBreakHours: 0,
        breakHours: 0,
        afterBreakHours: 0,
        totalHours: 0,
        missingHours: 0,
        phase: 'idle' as 'idle' | 'before_break' | 'on_break' | 'after_break' | 'clocked_out'
      };
    }

    const sorted = [...punches].sort((a, b) => safeParseDate(a.punchTime).getTime() - safeParseDate(b.punchTime).getTime());
    const inP = sorted.find((p) => p.punchType === 'ClockIn');
    if (!inP) {
      return {
        hasPunched: false,
        beforeBreakHours: 0,
        breakHours: 0,
        afterBreakHours: 0,
        totalHours: 0,
        missingHours: 0,
        phase: 'idle' as 'idle' | 'before_break' | 'on_break' | 'after_break' | 'clocked_out'
      };
    }

    const now = Date.now();
    const inTime = safeParseDate(inP.punchTime).getTime();
    const bInP = sorted.find((p) => p.punchType === 'BreakIn');
    const bOutP = sorted.find((p) => p.punchType === 'BreakOut');
    const outP = sorted.find((p) => p.punchType === 'ClockOut');

    let beforeBreak = 0;
    let breakHrs = 0;
    let afterBreak = 0;
    let phase: 'idle' | 'before_break' | 'on_break' | 'after_break' | 'clocked_out' = 'before_break';

    if (!bInP) {
      // Phase 1: Clocked In, lower green portion active until break punch
      if (outP) {
        const outTime = safeParseDate(outP.punchTime).getTime();
        beforeBreak = Math.max(0.1, (outTime - inTime) / 3600000);
        phase = 'clocked_out';
      } else {
        beforeBreak = Math.max(0.1, (now - inTime) / 3600000);
        phase = 'before_break';
      }
    } else {
      // Break punch occurred
      const bInTime = safeParseDate(bInP.punchTime).getTime();
      beforeBreak = Math.max(0.1, (bInTime - inTime) / 3600000);

      if (!bOutP) {
        // Phase 2: On break, yellow break portion active
        if (outP) {
          const outTime = safeParseDate(outP.punchTime).getTime();
          breakHrs = Math.max(0.1, (outTime - bInTime) / 3600000);
          phase = 'clocked_out';
        } else {
          breakHrs = Math.max(0.1, (now - bInTime) / 3600000);
          phase = 'on_break';
        }
      } else {
        // Phase 3 & 4: Break ended, converts to green for remaining time
        const bOutTime = safeParseDate(bOutP.punchTime).getTime();
        breakHrs = Math.max(0.1, (bOutTime - bInTime) / 3600000);

        if (outP) {
          // Phase 4: Final logout punch completed
          const outTime = safeParseDate(outP.punchTime).getTime();
          afterBreak = Math.max(0.1, (outTime - bOutTime) / 3600000);
          phase = 'clocked_out';
        } else {
          // Phase 3: Working after break, green after-break portion grows dynamically
          afterBreak = Math.max(0.1, (now - bOutTime) / 3600000);
          phase = 'after_break';
        }
      }
    }

    if (isNaN(beforeBreak) || beforeBreak < 0) beforeBreak = 0;
    if (isNaN(breakHrs) || breakHrs < 0) breakHrs = 0;
    if (isNaN(afterBreak) || afterBreak < 0) afterBreak = 0;

    beforeBreak = Math.round(beforeBreak * 10) / 10;
    breakHrs = Math.round(breakHrs * 10) / 10;
    afterBreak = Math.round(afterBreak * 10) / 10;
    const totalHours = Math.round((beforeBreak + breakHrs + afterBreak) * 10) / 10;
    const missingHours = Math.max(0, Math.round((8.5 - totalHours) * 10) / 10);

    return {
      hasPunched: true,
      beforeBreakHours: beforeBreak,
      breakHours: breakHrs,
      afterBreakHours: afterBreak,
      totalHours,
      missingHours,
      phase
    };
  });

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.loadTodayPunches();
  }

  private startTimer(): void {
    if (this.timer) return;
    this.zone.runOutsideAngular(() => {
      this.timer = setInterval(() => {
        this.zone.run(() => this.tick());
      }, 1000);
    });
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  loadTodayPunches(): void {
    // 1. First attempt to load authoritative punch status from backend
    this.api.punchStatus().subscribe({
      next: (status) => {
        if (status) {
          const punches = status.todayPunches || [];
          this.todayPunches.set(punches);

          const isCheckedIn = !!status.isCheckedIn;
          const isOnBreak = !!status.isOnBreak;
          this._state.set(isCheckedIn ? 'active' : 'idle');
          this._onBreak.set(isOnBreak);

          let workSec = status.workedSecondsToday;
          let breakSec = status.breakSecondsToday ?? 0;

          if (typeof workSec !== 'number' || isNaN(workSec) || workSec < 0) {
            workSec = this.calculateWorkedSeconds(punches);
          }
          if (typeof breakSec !== 'number' || isNaN(breakSec) || breakSec < 0) {
            breakSec = this.calculateBreakSeconds(punches);
          }

          this._workSeconds.set(workSec);
          this._breakSeconds.set(breakSec);
          this.render();

          if (isCheckedIn) {
            this.startTimer();
          } else {
            this.stopTimer();
          }
          return;
        }
        this.fallbackTodayPunches();
      },
      error: () => {
        this.fallbackTodayPunches();
      }
    });
  }

  private fallbackTodayPunches(): void {
    this.api.todayPunches().subscribe({
      next: (punches) => {
        const list = punches || [];
        this.todayPunches.set(list);
        if (list.length > 0) {
          const workSec = this.calculateWorkedSeconds(list);
          const breakSec = this.calculateBreakSeconds(list);
          this._workSeconds.set(workSec);
          this._breakSeconds.set(breakSec);

          const sorted = [...list].sort((a, b) => safeParseDate(a.punchTime).getTime() - safeParseDate(b.punchTime).getTime());
          const latest = sorted[sorted.length - 1];
          if (latest) {
            if (latest.punchType === 'ClockIn' || latest.punchType === 'BreakOut') {
              this._state.set('active');
              this._onBreak.set(false);
              this.startTimer();
            } else if (latest.punchType === 'BreakIn') {
              this._state.set('active');
              this._onBreak.set(true);
              this.startTimer();
            } else {
              this._state.set('idle');
              this._onBreak.set(false);
              this.stopTimer();
            }
          }
          this.render();
        } else {
          this._workSeconds.set(0);
          this._breakSeconds.set(0);
          this._state.set('idle');
          this._onBreak.set(false);
          this.render();
          this.stopTimer();
        }
      },
      error: () => {
        // Offline
      }
    });
  }

  private calculateWorkedSeconds(punches: EmployeePunch[]): number {
    if (!punches || punches.length === 0) return 0;
    const sorted = [...punches].sort((a, b) => safeParseDate(a.punchTime).getTime() - safeParseDate(b.punchTime).getTime());
    let workSec = 0;
    let workStartMs: number | null = null;
    const now = Date.now();

    for (const p of sorted) {
      const t = safeParseDate(p.punchTime).getTime();
      if (p.punchType === 'ClockIn' || p.punchType === 'BreakOut') {
        workStartMs = t;
      } else if (p.punchType === 'BreakIn' || p.punchType === 'ClockOut') {
        if (workStartMs !== null && !isNaN(workStartMs) && t >= workStartMs) {
          workSec += Math.floor((t - workStartMs) / 1000);
        }
        workStartMs = null;
      }
    }

    const latest = sorted[sorted.length - 1];
    if (latest && (latest.punchType === 'ClockIn' || latest.punchType === 'BreakOut')) {
      if (workStartMs !== null && !isNaN(workStartMs) && now >= workStartMs) {
        workSec += Math.floor((now - workStartMs) / 1000);
      }
    }

    return isNaN(workSec) || workSec < 0 ? 0 : workSec;
  }

  private calculateBreakSeconds(punches: EmployeePunch[]): number {
    if (!punches || punches.length === 0) return 0;
    const sorted = [...punches].sort((a, b) => safeParseDate(a.punchTime).getTime() - safeParseDate(b.punchTime).getTime());
    let breakSec = 0;
    let breakStartMs: number | null = null;
    let lastClockOutMs: number | null = null;
    const now = Date.now();

    for (const p of sorted) {
      const t = safeParseDate(p.punchTime).getTime();
      if (p.punchType === 'ClockIn' || p.punchType === 'BreakOut') {
        if (breakStartMs !== null && !isNaN(breakStartMs) && t >= breakStartMs) {
          breakSec += Math.floor((t - breakStartMs) / 1000);
          breakStartMs = null;
        } else if (lastClockOutMs !== null && !isNaN(lastClockOutMs) && t >= lastClockOutMs) {
          breakSec += Math.floor((t - lastClockOutMs) / 1000);
          lastClockOutMs = null;
        }
      } else if (p.punchType === 'BreakIn') {
        breakStartMs = t;
      } else if (p.punchType === 'ClockOut') {
        if (breakStartMs !== null && !isNaN(breakStartMs) && t >= breakStartMs) {
          breakSec += Math.floor((t - breakStartMs) / 1000);
          breakStartMs = null;
        }
        lastClockOutMs = t;
      }
    }

    const latest = sorted[sorted.length - 1];
    if (latest && latest.punchType === 'BreakIn') {
      if (breakStartMs !== null && !isNaN(breakStartMs) && now >= breakStartMs) {
        breakSec += Math.floor((now - breakStartMs) / 1000);
      }
    }

    return isNaN(breakSec) || breakSec < 0 ? 0 : breakSec;
  }

  readonly showFaceModal = signal(false);
  readonly faceAction = signal<'ClockIn' | 'ClockOut' | 'StartBreak' | 'EndBreak'>('ClockIn');

  requestClockIn(): void {
    this.faceAction.set('ClockIn');
    this.showFaceModal.set(true);
  }

  requestClockOut(): void {
    this.faceAction.set('ClockOut');
    this.showFaceModal.set(true);
  }

  requestStartBreak(): void {
    this.faceAction.set('StartBreak');
    this.showFaceModal.set(true);
  }

  requestEndBreak(): void {
    this.faceAction.set('EndBreak');
    this.showFaceModal.set(true);
  }

  closeFaceModal(): void {
    this.showFaceModal.set(false);
  }

  clockIn(): void {
    this._state.set('active');
    this._onBreak.set(false);
    this.render();
    this.startTimer();

    this.api.recordPunch({ punchType: 'ClockIn', device: 'Web Dashboard' }).subscribe({
      next: (p) => {
        this.todayPunches.update((list) => [p, ...list.filter(x => x.id !== p.id)]);
        this.loadTodayPunches();
      },
      error: () => {
        this.loadTodayPunches();
      }
    });
  }

  clockOut(): void {
    this._state.set('idle');
    this._onBreak.set(false);
    this.render();
    this.stopTimer();

    this.api.recordPunch({ punchType: 'ClockOut', device: 'Web Dashboard' }).subscribe({
      next: (p) => {
        this.todayPunches.update((list) => [p, ...list.filter(x => x.id !== p.id)]);
        this.loadTodayPunches();
      },
      error: () => {
        this.loadTodayPunches();
      }
    });
  }

  startBreak(): void {
    if (this._state() !== 'active') return;
    this._onBreak.set(true);
    this.startTimer();
    this.render();

    this.api.recordPunch({ punchType: 'BreakIn', device: 'Web Dashboard' }).subscribe({
      next: (p) => {
        this.todayPunches.update((list) => [p, ...list.filter(x => x.id !== p.id)]);
        this.loadTodayPunches();
      },
      error: () => {
        this.loadTodayPunches();
      }
    });
  }

  endBreak(): void {
    if (this._state() !== 'active') return;
    this._onBreak.set(false);
    this.startTimer();
    this.render();

    this.api.recordPunch({ punchType: 'BreakOut', device: 'Web Dashboard' }).subscribe({
      next: (p) => {
        this.todayPunches.update((list) => [p, ...list.filter(x => x.id !== p.id)]);
        this.loadTodayPunches();
      },
      error: () => {
        this.loadTodayPunches();
      }
    });
  }

  toggleBreak(): void {
    if (this._state() !== 'active') return;
    if (this._onBreak()) {
      this.endBreak();
    } else {
      this.startBreak();
    }
  }

  private tick(): void {
    if (this._state() !== 'active') return;
    if (this._onBreak()) {
      this._breakSeconds.update((s) => s + 1);
    } else {
      this._workSeconds.update((s) => s + 1);
    }
    this.render();
  }

  private render(): void {
    this.workTime.set(PunchService.format(this._workSeconds()));
    this.breakTime.set(PunchService.format(this._breakSeconds()));
  }

  private static format(total: number): string {
    if (typeof total !== 'number' || isNaN(total) || total < 0) {
      total = 0;
    }
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = Math.floor(total % 60);
    return [h, m, s].map((x) => String(x).padStart(2, '0')).join(':');
  }
}
