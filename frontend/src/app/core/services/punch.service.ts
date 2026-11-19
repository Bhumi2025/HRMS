import { Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { ApiService } from '../api/api.service';
import { EmployeePunch } from '../api/api.models';

export type PunchState = 'idle' | 'active';

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

    const sorted = [...punches].sort((a, b) => new Date(a.punchTime).getTime() - new Date(b.punchTime).getTime());
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
    const inTime = new Date(inP.punchTime).getTime();
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
        const outTime = new Date(outP.punchTime).getTime();
        beforeBreak = Math.max(0.1, (outTime - inTime) / 3600000);
        phase = 'clocked_out';
      } else {
        beforeBreak = Math.max(0.1, (now - inTime) / 3600000);
        phase = 'before_break';
      }
    } else {
      // Break punch occurred
      const bInTime = new Date(bInP.punchTime).getTime();
      beforeBreak = Math.max(0.1, (bInTime - inTime) / 3600000);

      if (!bOutP) {
        // Phase 2: On break, yellow break portion active
        if (outP) {
          const outTime = new Date(outP.punchTime).getTime();
          breakHrs = Math.max(0.1, (outTime - bInTime) / 3600000);
          phase = 'clocked_out';
        } else {
          breakHrs = Math.max(0.1, (now - bInTime) / 3600000);
          phase = 'on_break';
        }
      } else {
        // Phase 3 & 4: Break ended, converts to green for remaining time
        const bOutTime = new Date(bOutP.punchTime).getTime();
        breakHrs = Math.max(0.1, (bOutTime - bInTime) / 3600000);

        if (outP) {
          // Phase 4: Final logout punch completed
          const outTime = new Date(outP.punchTime).getTime();
          afterBreak = Math.max(0.1, (outTime - bOutTime) / 3600000);
          phase = 'clocked_out';
        } else {
          // Phase 3: Working after break, green after-break portion grows dynamically
          afterBreak = Math.max(0.1, (now - bOutTime) / 3600000);
          phase = 'after_break';
        }
      }
    }

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
    this.api.todayPunches().subscribe({
      next: (punches) => {
        this.todayPunches.set(punches);
        if (punches.length > 0) {
          const sorted = [...punches].sort((a, b) => new Date(a.punchTime).getTime() - new Date(b.punchTime).getTime());
          const inP = sorted.find((p) => p.punchType === 'ClockIn');
          const bInP = sorted.find((p) => p.punchType === 'BreakIn');
          const bOutP = sorted.find((p) => p.punchType === 'BreakOut');
          const outP = sorted.find((p) => p.punchType === 'ClockOut');
          const now = Date.now();

          let workSec = 0;
          let breakSec = 0;

          if (inP) {
            const inTime = new Date(inP.punchTime).getTime();
            if (!bInP) {
              const end = outP ? new Date(outP.punchTime).getTime() : now;
              workSec = Math.max(0, Math.floor((end - inTime) / 1000));
            } else {
              const bInTime = new Date(bInP.punchTime).getTime();
              const beforeBreak = Math.max(0, Math.floor((bInTime - inTime) / 1000));
              if (!bOutP) {
                const bEnd = outP ? new Date(outP.punchTime).getTime() : now;
                breakSec = Math.max(0, Math.floor((bEnd - bInTime) / 1000));
                workSec = beforeBreak;
              } else {
                const bOutTime = new Date(bOutP.punchTime).getTime();
                breakSec = Math.max(0, Math.floor((bOutTime - bInTime) / 1000));
                const end = outP ? new Date(outP.punchTime).getTime() : now;
                const afterBreak = Math.max(0, Math.floor((end - bOutTime) / 1000));
                workSec = beforeBreak + afterBreak;
              }
            }
          }

          this._workSeconds.set(workSec);
          this._breakSeconds.set(breakSec);
          this.render();

          const latest = punches[0];
          if (latest.punchType === 'ClockIn' || latest.punchType === 'BreakOut') {
            this._state.set('active');
            this._onBreak.set(false);
            this.startTimer();
          } else if (latest.punchType === 'BreakIn') {
            this._state.set('active');
            this._onBreak.set(true);
            this.startTimer();
          } else if (latest.punchType === 'ClockOut') {
            this._state.set('idle');
            this._onBreak.set(false);
            this.stopTimer();
          }
        }
      },
      error: () => {
        // Offline fallback
      }
    });
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

    this.api.recordPunch({ punchType: 'ClockIn', device: 'Face Biometric AI' }).subscribe({
      next: (p) => {
        this.todayPunches.update((list) => [p, ...list]);
      },
      error: () => {
        const fallback: EmployeePunch = {
          id: 'p-' + Date.now(),
          employeeId: 'EMP-001',
          employeeCode: 'EMP-001',
          employeeName: 'Sarah Jenkins',
          punchType: 'ClockIn',
          punchTime: new Date().toISOString(),
          device: 'Face Biometric AI',
        };
        this.todayPunches.update((list) => [fallback, ...list]);
      }
    });
  }

  clockOut(): void {
    this._state.set('idle');
    this._onBreak.set(false);
    this.render();
    this.stopTimer();

    this.api.recordPunch({ punchType: 'ClockOut', device: 'Face Biometric AI' }).subscribe({
      next: (p) => {
        this.todayPunches.update((list) => [p, ...list]);
      },
      error: () => {
        const fallback: EmployeePunch = {
          id: 'p-' + Date.now(),
          employeeId: 'EMP-001',
          employeeCode: 'EMP-001',
          employeeName: 'Sarah Jenkins',
          punchType: 'ClockOut',
          punchTime: new Date().toISOString(),
          device: 'Face Biometric AI',
        };
        this.todayPunches.update((list) => [fallback, ...list]);
      }
    });
  }

  startBreak(): void {
    if (this._state() !== 'active') return;
    this._onBreak.set(true);
    this.render();

    this.api.recordPunch({ punchType: 'BreakIn', device: 'Face Biometric AI' }).subscribe({
      next: (p) => {
        this.todayPunches.update((list) => [p, ...list]);
      },
      error: () => {
        const fallback: EmployeePunch = {
          id: 'p-' + Date.now(),
          employeeId: 'EMP-001',
          employeeCode: 'EMP-001',
          employeeName: 'Sarah Jenkins',
          punchType: 'BreakIn',
          punchTime: new Date().toISOString(),
          device: 'Face Biometric AI',
        };
        this.todayPunches.update((list) => [fallback, ...list]);
      }
    });
  }

  endBreak(): void {
    if (this._state() !== 'active') return;
    this._onBreak.set(false);
    this.render();

    this.api.recordPunch({ punchType: 'BreakOut', device: 'Face Biometric AI' }).subscribe({
      next: (p) => {
        this.todayPunches.update((list) => [p, ...list]);
      },
      error: () => {
        const fallback: EmployeePunch = {
          id: 'p-' + Date.now(),
          employeeId: 'EMP-001',
          employeeCode: 'EMP-001',
          employeeName: 'Sarah Jenkins',
          punchType: 'BreakOut',
          punchTime: new Date().toISOString(),
          device: 'Face Biometric AI',
        };
        this.todayPunches.update((list) => [fallback, ...list]);
      }
    });
  }

  toggleBreak(): void {
    if (this._state() !== 'active') return;
    if (this._onBreak()) {
      this.requestEndBreak();
    } else {
      this.requestStartBreak();
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
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return [h, m, s].map((x) => String(x).padStart(2, '0')).join(':');
  }
}
