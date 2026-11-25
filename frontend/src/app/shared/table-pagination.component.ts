import { CommonModule } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';

export const DEFAULT_TABLE_PAGE_SIZE = 8;

export function paginateSlice<T>(items: readonly T[], page: number, pageSize = DEFAULT_TABLE_PAGE_SIZE): T[] {
  if (items.length === 0) return [];
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

/**
 * Shared 8-row-per-page table pagination footer without a rows-per-page selector.
 */
@Component({
  selector: 'app-table-pagination',
  imports: [CommonModule],
  template: `
    @if (total() > 0) {
      <div class="tp-bar">
        <span class="tp-info">
          Showing {{ startIndex() }} - {{ endIndex() }} of {{ total() }}
        </span>
        <div class="tp-btns">
          <button
            type="button"
            class="pg-btn"
            [disabled]="safePage() <= 1"
            (click)="go(safePage() - 1)"
            aria-label="Previous page"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          @for (p of pageNumbers(); track p) {
            <button
              type="button"
              class="pg-btn"
              [class.active]="p === safePage()"
              (click)="go(p)"
            >
              {{ p }}
            </button>
          }

          <button
            type="button"
            class="pg-btn"
            [disabled]="safePage() >= totalPages() || totalPages() <= 1"
            (click)="go(safePage() + 1)"
            aria-label="Next page"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .tp-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 18px;
        border-top: 1px solid var(--border);
        background: var(--surface);
        flex-wrap: wrap;
        gap: 10px;
      }
      .tp-info {
        font-size: 13px;
        color: var(--muted);
      }
      .tp-btns {
        display: flex;
        align-items: center;
        gap: 4px;
      }
    `,
  ],
})
export class TablePaginationComponent {
  readonly total = input.required<number>();
  readonly page = input.required<number>();
  readonly pageSize = input<number>(DEFAULT_TABLE_PAGE_SIZE);
  readonly pageChange = output<number>();

  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  protected readonly safePage = computed(() => Math.min(Math.max(1, this.page()), this.totalPages()));

  protected readonly startIndex = computed(() =>
    this.total() === 0 ? 0 : (this.safePage() - 1) * this.pageSize() + 1,
  );

  protected readonly endIndex = computed(() =>
    Math.min(this.total(), this.safePage() * this.pageSize()),
  );

  protected readonly pageNumbers = computed<number[]>(() => {
    const total = this.totalPages();
    const current = this.safePage();
    if (total <= 1) return [1];
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    let start = Math.max(1, current - 2);
    const end = Math.min(total, start + 4);
    if (end - start < 4) {
      start = Math.max(1, end - 4);
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  });

  protected go(target: number): void {
    if (target >= 1 && target <= this.totalPages() && target !== this.safePage()) {
      this.pageChange.emit(target);
    }
  }
}
