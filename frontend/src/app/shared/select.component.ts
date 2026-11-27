import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { IconDirective } from '../core/icons/icon.directive';
import { attachMenuToBody, computeDropdownCoords, restoreMenuToHost } from './dropdown-position.util';

export interface SelectOption {
  v: string;
  l: string;
}

/**
 * Standalone custom dropdown — renders a portal-positioned menu attached to
 * document.body when open so modal/card overflow or transforms never clip it.
 */
@Component({
  selector: 'app-select',
  imports: [CommonModule, IconDirective],
  host: {
    '[class.csel-host-open]': 'open()',
  },
  template: `
    <div #wrapEl class="csel-wrap" [class.csel-open]="open()" [class.disabled]="disabled()" [style.width]="width() || null">
      <button #triggerBtn type="button" class="csel-btn" [class.open]="open()" [disabled]="disabled()" (click)="toggle()">
        <span class="csel-label">{{ selectedLabel() }}</span>
        <span class="csel-arrow" [class.up]="open()" appIcon="chevron"></span>
      </button>
      <div
        #menuEl
        class="csel-menu csel-fixed-portal"
        [class.drop-up]="dropUp()"
        style="position: fixed; z-index: 99999;"
        [style.display]="open() ? 'block' : 'none'"
        [style.top]="menuTop() ?? 'auto'"
        [style.bottom]="menuBottom() ?? 'auto'"
        [style.left.px]="menuLeft()"
        [style.width.px]="menuWidth()"
        [style.max-height.px]="menuMaxHeight()"
      >
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
      overflow-y: auto !important;
    }
    .csel-menu.drop-up {
      box-shadow: 0 -10px 25px -5px rgba(0, 0, 0, 0.18), 0 -8px 10px -6px rgba(0, 0, 0, 0.1) !important;
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
  @ViewChild('wrapEl') private wrapEl?: ElementRef<HTMLDivElement>;
  @ViewChild('triggerBtn') private triggerBtn?: ElementRef<HTMLButtonElement>;
  @ViewChild('menuEl') private menuEl?: ElementRef<HTMLDivElement>;

  readonly options = input<SelectOption[]>([]);
  readonly value = input<string>('');
  readonly width = input<string>('');
  readonly valueChange = output<string>();
  readonly disabled = input<boolean>(false);

  readonly open = signal(false);
  readonly dropUp = signal(false);
  readonly menuTop = signal<string | null>(null);
  readonly menuBottom = signal<string | null>(null);
  readonly menuLeft = signal(0);
  readonly menuWidth = signal(150);
  readonly menuMaxHeight = signal(280);

  private rafId: number | null = null;

  private readonly onViewportChange = (event?: Event): void => {
    if (!this.open()) return;
    const target = event?.target as Node | null;
    if (target && this.menuEl?.nativeElement &&
      (this.menuEl.nativeElement === target || this.menuEl.nativeElement.contains(target))) {
      return;
    }
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      if (!this.open()) return;
      const anchor = this.triggerBtn?.nativeElement ?? (this.elementRef.nativeElement as HTMLElement);
      const rect = anchor.getBoundingClientRect();
      if (rect.width === 0 || rect.bottom < 0 || rect.top > window.innerHeight) {
        this.close();
        return;
      }
      this.updatePosition();
    });
  };

  readonly selectedLabel = computed(() => {
    const current = this.options().find((o) => o.v === this.value());
    return (current ?? this.options()[0])?.l ?? '';
  });

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.open()) return;
    const target = event.target as Node | null;
    const insideHost = !!target && this.elementRef.nativeElement.contains(target);
    const insideMenu = !!target && !!this.menuEl?.nativeElement?.contains(target);
    if (!insideHost && !insideMenu) {
      this.close();
    }
  }

  toggle(): void {
    if (this.disabled()) return;
    if (!this.open()) {
      attachMenuToBody(this.menuEl?.nativeElement);
      this.updatePosition();
      this.open.set(true);
      document.addEventListener('scroll', this.onViewportChange, true);
      window.addEventListener('resize', this.onViewportChange);
    } else {
      this.close();
    }
  }

  private updatePosition(): void {
    try {
      const anchor = this.triggerBtn?.nativeElement ?? (this.elementRef.nativeElement as HTMLElement);
      const coords = computeDropdownCoords(anchor);
      this.dropUp.set(coords.dropUp);
      this.menuTop.set(coords.top);
      this.menuBottom.set(coords.bottom);
      this.menuLeft.set(coords.left);
      this.menuWidth.set(coords.width);
      this.menuMaxHeight.set(coords.maxHeight);
    } catch {
      this.dropUp.set(false);
    }
  }

  close(): void {
    this.open.set(false);
    restoreMenuToHost(this.menuEl?.nativeElement, this.wrapEl?.nativeElement);
    document.removeEventListener('scroll', this.onViewportChange, true);
    window.removeEventListener('resize', this.onViewportChange);
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  pick(option: SelectOption): void {
    this.valueChange.emit(option.v);
    this.close();
  }

  ngOnDestroy(): void {
    this.close();
    const menu = this.menuEl?.nativeElement;
    if (menu && menu.parentElement === document.body) {
      menu.remove();
    }
  }
}
