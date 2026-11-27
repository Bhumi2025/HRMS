import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
  computed,
  forwardRef,
  inject,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { KeyStoreItem } from '../core/api/api.models';
import { IconDirective } from '../core/icons/icon.directive';
import { KeyGroupCacheService } from '../core/services/key-group-cache.service';
import { attachMenuToBody, computeDropdownCoords, restoreMenuToHost } from './dropdown-position.util';

export interface KeyOptionItem {
  key: string;
  value: string;
  subValue?: string | null;
  isActive: boolean;
  isLegacy?: boolean;
}

@Component({
  selector: 'app-key-select, app-key-group-select',
  imports: [CommonModule, IconDirective],
  host: {
    '[class.csel-host-open]': 'open()',
  },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => KeyGroupSelectComponent),
      multi: true,
    },
  ],
  template: `
    <div #wrapEl class="csel-wrap key-select-wrap" [class.csel-open]="open()" [style.width]="width">
      <button
        #triggerBtn
        type="button"
        class="csel-btn key-select-btn"
        [class.open]="open()"
        [class.disabled]="disabledState()"
        [disabled]="disabledState()"
        (click)="toggle()"
        [attr.aria-expanded]="open()"
      >
        <span class="csel-label" [class.muted-label]="!selectedOption()">
          @if (loading()) {
            <span style="display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px;">
              <span class="spinner-sm"></span> Loading...
            </span>
          } @else if (selectedOption()) {
            {{ selectedOption()!.value }}
            @if (selectedOption()!.isLegacy) {
              <span class="badge" style="font-size: 10px; margin-left: 6px; background: rgba(239,68,68,0.12); color: #dc2626;">Inactive</span>
            }
          } @else {
            {{ placeholder }}
          }
        </span>
        <span class="csel-arrow" [class.up]="open()" appIcon="chevron"></span>
      </button>

      <div
        #menuEl
        class="csel-menu key-select-menu csel-fixed-portal"
        [class.drop-up]="dropUp()"
        style="position: fixed; overflow-y: auto; z-index: 99999;"
        [style.display]="open() ? 'block' : 'none'"
        [style.top]="menuTop() ?? 'auto'"
        [style.bottom]="menuBottom() ?? 'auto'"
        [style.left.px]="menuLeft()"
        [style.width.px]="menuWidth()"
        [style.max-height.px]="menuMaxHeight()"
      >
        @if (allowClear && innerValue()) {
          <div class="csel-opt text-muted" (click)="pickClear()" style="font-size: 12px; border-bottom: 1px solid var(--border);">
            <em>Clear selection</em>
          </div>
        }

        @if (loading()) {
          <div class="csel-opt" style="color: var(--muted); cursor: default; text-align: center; padding: 12px;">
            Loading options...
          </div>
        } @else if (displayOptions().length === 0) {
          <div class="csel-opt" style="color: var(--muted); cursor: default; text-align: center; padding: 12px;">
            No options available
          </div>
        } @else {
          @for (opt of displayOptions(); track (opt.key + '_' + opt.value + '_' + $index)) {
            <div
              class="csel-opt"
              [class.csel-active]="opt.value === innerValue() || opt.key === innerValue()"
              (click)="pick(opt)"
              style="display: flex; justify-content: space-between; align-items: center;"
            >
              <span>{{ opt.value }}</span>
              @if (opt.subValue) {
                <span style="font-size: 11px; color: var(--muted); margin-left: 8px;">{{ opt.subValue }}</span>
              }
              @if (opt.isLegacy) {
                <span class="badge" style="font-size: 9px; background: rgba(239,68,68,0.12); color: #dc2626; padding: 1px 4px;">Inactive</span>
              }
            </div>
          }
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: inline-block;
        position: relative;
      }
      :host(.csel-host-open) {
        z-index: 1000 !important;
      }
      .key-select-wrap {
        position: relative;
        display: inline-block;
      }
      .key-select-wrap.csel-open {
        z-index: 1050 !important;
        position: relative;
      }
      .key-select-menu {
        background-color: var(--surface, #ffffff) !important;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.18), 0 8px 10px -6px rgba(0, 0, 0, 0.1) !important;
        z-index: 99999 !important;
      }
      .key-select-menu.drop-up {
        box-shadow: 0 -10px 25px -5px rgba(0, 0, 0, 0.18), 0 -8px 10px -6px rgba(0, 0, 0, 0.1) !important;
      }
      .key-select-btn.disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .muted-label {
        color: var(--muted);
      }
      .spinner-sm {
        display: inline-block;
        width: 12px;
        height: 12px;
        border: 2px solid rgba(0, 0, 0, 0.1);
        border-top-color: var(--p);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class KeyGroupSelectComponent implements OnInit, OnChanges, OnDestroy, ControlValueAccessor {
  private readonly cache = inject(KeyGroupCacheService);
  private readonly elementRef = inject(ElementRef);
  @ViewChild('wrapEl') private wrapEl?: ElementRef<HTMLDivElement>;
  @ViewChild('triggerBtn') private triggerBtn?: ElementRef<HTMLButtonElement>;
  @ViewChild('menuEl') private menuEl?: ElementRef<HTMLDivElement>;

  @Input() groupCode: string = '';
  @Input() placeholder: string = 'Select option...';
  @Input() width: string = '100%';
  @Input() allowClear: boolean = false;
  @Input() set disabled(val: boolean) {
    this.disabledState.set(val);
  }

  /** Direct value input for non-form usage (e.g. [value]="val") */
  @Input() set value(val: string) {
    this.innerValue.set(val || '');
  }

  @Output() valueChange = new EventEmitter<string>();

  protected readonly innerValue = signal<string>('');
  protected readonly disabledState = signal<boolean>(false);
  protected readonly loading = signal<boolean>(false);
  protected readonly open = signal<boolean>(false);
  protected readonly rawOptions = signal<KeyStoreItem[]>([]);

  // ControlValueAccessor hooks
  private onChange: (value: string) => void = () => { };
  private onTouched: () => void = () => { };

  private norm(s: string | null | undefined): string {
    return (s || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  }

  /** Builds the displayed option list, including the current value even if inactive/legacy */
  protected readonly displayOptions = computed<KeyOptionItem[]>(() => {
    const raw = this.rawOptions();
    const curr = (this.innerValue() || '').trim();
    const normCurr = this.norm(curr);

    const result: KeyOptionItem[] = raw
      .filter((o) => o.isActive)
      .map((o) => ({
        key: o.key,
        value: o.value,
        subValue: o.subValue,
        isActive: o.isActive,
      }));

    if (curr) {
      const matchInActive = result.find(
        (o) => this.norm(o.value) === normCurr || this.norm(o.key) === normCurr
      );
      if (!matchInActive) {
        const matchInRaw = raw.find(
          (o) => this.norm(o.value) === normCurr || this.norm(o.key) === normCurr
        );
        if (matchInRaw) {
          result.unshift({
            key: matchInRaw.key,
            value: matchInRaw.value,
            subValue: matchInRaw.subValue,
            isActive: false,
            isLegacy: true,
          });
        } else {
          result.unshift({
            key: curr,
            value: curr,
            isActive: false,
            isLegacy: true,
          });
        }
      }
    }

    return result;
  });

  protected readonly selectedOption = computed<KeyOptionItem | null>(() => {
    const curr = (this.innerValue() || '').trim();
    if (!curr) return null;
    const normCurr = this.norm(curr);
    return (
      this.displayOptions().find(
        (o) => this.norm(o.value) === normCurr || this.norm(o.key) === normCurr
      ) || {
        key: curr,
        value: curr,
        isActive: true,
      }
    );
  });

  ngOnInit(): void {
    this.loadOptions();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['groupCode'] && !changes['groupCode'].firstChange) {
      this.loadOptions();
    }
  }

  private loadOptions(): void {
    const code = this.groupCode?.trim();
    if (!code) return;

    this.loading.set(true);
    this.cache.getOptions(code).subscribe({
      next: (items) => {
        this.rawOptions.set(items || []);
        this.loading.set(false);
      },
      error: () => {
        this.rawOptions.set([]);
        this.loading.set(false);
      },
    });
  }

  protected readonly dropUp = signal(false);
  protected readonly menuTop = signal<string | null>(null);
  protected readonly menuBottom = signal<string | null>(null);
  protected readonly menuLeft = signal(0);
  protected readonly menuWidth = signal(180);
  protected readonly menuMaxHeight = signal(280);

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

  protected toggle(): void {
    if (this.disabledState()) return;
    if (!this.open()) {
      attachMenuToBody(this.menuEl?.nativeElement);
      this.updatePosition();
      this.open.set(true);
      document.addEventListener('scroll', this.onViewportChange, true);
      window.addEventListener('resize', this.onViewportChange);
      this.onTouched();
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

  protected close(): void {
    this.open.set(false);
    restoreMenuToHost(this.menuEl?.nativeElement, this.wrapEl?.nativeElement);
    document.removeEventListener('scroll', this.onViewportChange, true);
    window.removeEventListener('resize', this.onViewportChange);
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  protected pick(opt: KeyOptionItem): void {
    this.innerValue.set(opt.value);
    this.onChange(opt.value);
    this.valueChange.emit(opt.value);
    this.close();
  }

  protected pickClear(): void {
    this.innerValue.set('');
    this.onChange('');
    this.valueChange.emit('');
    this.close();
  }

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

  ngOnDestroy(): void {
    this.close();
    const menu = this.menuEl?.nativeElement;
    if (menu && menu.parentElement === document.body) {
      menu.remove();
    }
  }

  // ── ControlValueAccessor Implementation ──
  writeValue(val: any): void {
    this.innerValue.set(val != null ? String(val) : '');
  }

  registerOnChange(fn: any): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabledState.set(isDisabled);
  }
}
