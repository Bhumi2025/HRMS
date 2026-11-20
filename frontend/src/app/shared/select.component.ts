import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { IconDirective } from '../core/icons/icon.directive';

export interface SelectOption {
  v: string;
  l: string;
}

/**
 * Standalone custom dropdown — the Angular port of `customSelect()`.
 * Usage: `<app-select [options]="opts" [(value)]="val" width="150px" />`
 */
@Component({
  selector: 'app-select',
  imports: [CommonModule, IconDirective],
  host: {
    '[class.csel-host-open]': 'open()',
  },
  template: `
    <div class="csel-wrap" [class.csel-open]="open()" [class.disabled]="disabled()" [style.width]="width() || null">
      <button type="button" class="csel-btn" [class.open]="open()" [disabled]="disabled()" (click)="toggle()">
        <span class="csel-label">{{ selectedLabel() }}</span>
        <span class="csel-arrow" [class.up]="open()" appIcon="chevron"></span>
      </button>
      <div class="csel-menu" [class.drop-up]="dropUp()" [class.align-right]="alignRight()" [style.display]="open() ? 'block' : 'none'">
        @for (option of options(); track option.v) {
          <div class="csel-opt" [class.csel-active]="option.v === value()" (click)="pick(option)">
            {{ option.l }}
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: inline-block;
      position: relative;
    }
    :host(.csel-host-open),
    :host(.csel-open) {
      z-index: 1000 !important;
    }
    .csel-wrap.csel-open {
      z-index: 1050 !important;
      position: relative;
    }
    .csel-menu {
      background-color: var(--surface, #ffffff) !important;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.18), 0 8px 10px -6px rgba(0, 0, 0, 0.1) !important;
      z-index: 99999 !important;
      max-height: 280px !important;
      overflow-y: auto !important;
    }
    .csel-menu.drop-up {
      top: auto !important;
      bottom: calc(100% + 4px) !important;
      box-shadow: 0 -10px 25px -5px rgba(0, 0, 0, 0.18), 0 -8px 10px -6px rgba(0, 0, 0, 0.1) !important;
    }
    .csel-menu.align-right {
      left: auto !important;
      right: 0 !important;
    }
    .csel-btn[disabled],
    .csel-wrap.disabled .csel-btn {
      opacity: 0.65;
      cursor: not-allowed !important;
      background: var(--bg, #f1f5f9) !important;
      color: var(--muted, #64748b) !important;
      pointer-events: none;
    }
  `],
})
export class SelectComponent implements OnDestroy {
  private readonly elementRef = inject(ElementRef);

  readonly options = input<SelectOption[]>([]);
  readonly value = input<string>('');
  readonly width = input<string>('');
  readonly valueChange = output<string>();

  readonly disabled = input<boolean>(false);

  readonly open = signal(false);
  readonly dropUp = signal(false);
  readonly alignRight = signal(false);

  readonly selectedLabel = computed(() => {
    const current = this.options().find((o) => o.v === this.value());
    return (current ?? this.options()[0])?.l ?? '';
  });

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.elementRef.nativeElement.contains(event.target)) {
      this.close();
    }
  }

  toggle(): void {
    if (this.disabled()) return;
    if (!this.open()) {
      try {
        const el = this.elementRef.nativeElement as HTMLElement;
        const rect = el.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;

        // Check for any sticky bottom obstacles (e.g. .tab-action-bar, .action-bar, fixed footers)
        let bottomObstacleHeight = 0;
        const obstacles = document.querySelectorAll(
          '.tab-action-bar, .action-bar, .form-footer, .sticky-bottom, [class*="sticky-bottom"]'
        );
        for (let i = 0; i < obstacles.length; i++) {
          const obRect = (obstacles[i] as HTMLElement).getBoundingClientRect();
          if (obRect.top > rect.bottom && obRect.top < window.innerHeight && obRect.height > 0) {
            const obstacleCutoff = window.innerHeight - obRect.top;
            if (obstacleCutoff > bottomObstacleHeight) {
              bottomObstacleHeight = obstacleCutoff;
            }
          }
        }

        const effectiveSpaceBelow = Math.max(0, spaceBelow - bottomObstacleHeight);
        // If effective space below is less than 280px (standard menu height) and there is more space above, open upwards!
        const shouldDropUp =
          (effectiveSpaceBelow < 280 && rect.top > effectiveSpaceBelow) ||
          (spaceBelow < 220 && rect.top > 220);
        this.dropUp.set(shouldDropUp);
        const shouldAlignRight = rect.right + 60 > window.innerWidth;
        this.alignRight.set(shouldAlignRight);
      } catch {
        this.dropUp.set(false);
        this.alignRight.set(false);
      }
      this.open.set(true);
      this.setParentElevation(true);
    } else {
      this.close();
    }
  }

  close(): void {
    this.open.set(false);
    this.setParentElevation(false);
  }

  pick(option: SelectOption): void {
    this.valueChange.emit(option.v);
    this.close();
  }

  ngOnDestroy(): void {
    this.setParentElevation(false);
  }

  private setParentElevation(elevate: boolean): void {
    try {
      const el = this.elementRef.nativeElement as HTMLElement;
      const parentCard = el.closest('.card') as HTMLElement | null;
      const parentGrid = el.closest('.grid-2, .grid-3, .grid-4') as HTMLElement | null;
      if (elevate) {
        if (parentCard) {
          parentCard.classList.add('has-open-dropdown');
          parentCard.style.zIndex = '50';
          parentCard.style.position = 'relative';
        }
        if (parentGrid) {
          parentGrid.classList.add('has-open-dropdown');
          parentGrid.style.zIndex = '50';
          parentGrid.style.position = 'relative';
        }
      } else {
        if (parentCard) {
          parentCard.classList.remove('has-open-dropdown');
          parentCard.style.zIndex = '';
          if (parentCard.style.position === 'relative') {
            parentCard.style.removeProperty('position');
          }
        }
        if (parentGrid) {
          parentGrid.classList.remove('has-open-dropdown');
          parentGrid.style.zIndex = '';
          if (parentGrid.style.position === 'relative') {
            parentGrid.style.removeProperty('position');
          }
        }
      }
    } catch {
      // Safe no-op
    }
  }
}
