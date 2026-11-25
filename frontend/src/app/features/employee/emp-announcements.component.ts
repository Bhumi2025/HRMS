import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api/api.service';
import { SessionService } from '../../core/services/session.service';
import { ToastService } from '../../core/services/toast.service';

interface Announcement {
  id?: string;
  title: string;
  msg: string;
  type: 'info' | 'warning' | 'danger' | 'success';
  time: string;
  tag: string;
  rawSeverity?: string;
}

/** Announcements & Notices management. */
@Component({
  selector: 'app-emp-announcements',
  imports: [CommonModule, FormsModule],
  template: `
    <div class="announcements-container" style="display: flex; flex-direction: column; flex: 1; height: 100%; min-height: 0;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px; flex-wrap: wrap; gap: 12px; flex-shrink: 0">
        <!-- Filter Tabs / Header Info -->
        @if (!isHrManager()) {
          <div style="display: flex; align-items: center; gap: 4px; background: var(--surface); padding: 4px; border-radius: 10px; border: 1px solid var(--border)">
            <button
              type="button"
              (click)="activeFilter.set('all')"
              [style.background]="activeFilter() === 'all' ? 'var(--p)' : 'transparent'"
              [style.color]="activeFilter() === 'all' ? '#fff' : 'var(--text)'"
              style="border: none; border-radius: 7px; padding: 6px 14px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s"
            >
              All ({{ announcements().length }})
            </button>
            <button
              type="button"
              (click)="activeFilter.set('unread')"
              [style.background]="activeFilter() === 'unread' ? 'var(--p)' : 'transparent'"
              [style.color]="activeFilter() === 'unread' ? '#fff' : 'var(--text)'"
              style="border: none; border-radius: 7px; padding: 6px 14px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s"
            >
              Unread ({{ unreadCount() }})
            </button>
            <button
              type="button"
              (click)="activeFilter.set('read')"
              [style.background]="activeFilter() === 'read' ? 'var(--p)' : 'transparent'"
              [style.color]="activeFilter() === 'read' ? '#fff' : 'var(--text)'"
              style="border: none; border-radius: 7px; padding: 6px 14px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s"
            >
              Read ({{ readCount() }})
            </button>
          </div>
        } @else {
          <div>
            <h2 style="font-size: 1.25rem; font-weight: 800; color: var(--text); margin: 0 0 4px 0;">Announcements</h2>
            <p style="font-size: 13px; color: var(--muted); margin: 0;">Total Announcements: {{ announcements().length }}</p>
          </div>
        }

        <!-- Header Actions -->
        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap">
          @if (!isHrManager() && unreadCount() > 0) {
            <button
              class="btn btn-outline btn-sm"
              type="button"
              (click)="markAllAsRead()"
              style="display: inline-flex; align-items: center; gap: 6px; font-weight: 600"
            >
              ✓ Mark All as Read
            </button>
          }
          @if (canManage()) {
            <button class="btn btn-primary btn-sm" (click)="openCreateModal()" style="display: inline-flex; align-items: center; gap: 6px; font-weight: 600">
              <span>+</span> Post Announcement
            </button>
          }
        </div>
      </div>

      <div class="announcements-list-scroll custom-scroll" style="display: flex; flex-direction: column; gap: 14px; flex: 1; min-height: 0; overflow-y: auto; padding-right: 2px;">
        @for (a of paginatedAnnouncements(); track a.id ?? a.title) {
          <div
            class="news-card"
            (click)="readNews(a)"
            style="background: var(--surface); border-radius: 14px; border: 1px solid var(--border); box-shadow: var(--shadow); overflow: hidden; cursor: pointer; transition: transform 0.15s ease, box-shadow 0.15s ease;"
            [style.opacity]="!isHrManager() && isRead(a) ? '0.88' : '1'"
          >
            <div [style.background]="barColor(a.type)" [style.height]="!isHrManager() && isRead(a) ? '2px' : '4px'"></div>
            <div style="padding: 16px 20px">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; flex-wrap: wrap; gap: 8px">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
                  <span class="badge" [class]="badgeClass(a.type)">{{ a.tag }}</span>
                  
                  @if (!isHrManager()) {
                    @if (isRead(a)) {
                      <span
                        class="badge"
                        style="font-size: 11px; padding: 3px 8px; border-radius: 12px; background: rgba(16,185,129,0.12); color: #10b981; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;"
                      >
                        ✓ Read
                      </span>
                    } @else {
                      <span
                        class="badge"
                        style="font-size: 11px; padding: 3px 8px; border-radius: 12px; background: rgba(239,68,68,0.12); color: #ef4444; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;"
                      >
                        <span style="width: 6px; height: 6px; border-radius: 50%; background: #ef4444; display: inline-block;"></span>
                        Unread
                      </span>
                    }
                  }

                  <span class="ann-time" style="font-size: 11px; color: var(--muted); white-space: nowrap">{{ a.time }}</span>
                </div>

                <div style="display: flex; align-items: center; gap: 8px" (click)="$event.stopPropagation()">
                  <!-- Mark as read button / action (hidden for HR Manager) -->
                  @if (!isHrManager()) {
                    @if (!isRead(a)) {
                      <button
                        type="button"
                        class="btn btn-outline btn-xs"
                        (click)="markAsRead(a, $event)"
                        title="Mark news as read"
                        style="font-size: 12px; padding: 4px 12px; border-radius: 6px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;"
                      >
                        <span>✓</span> Mark as Read
                      </button>
                    } @else {
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs"
                        (click)="toggleRead(a, $event)"
                        title="Mark as unread"
                        style="font-size: 11px; padding: 4px 8px; border-radius: 6px; color: var(--muted); display: inline-flex; align-items: center; gap: 4px;"
                      >
                        Mark Unread
                      </button>
                    }
                  }

                  @if (canManage() && a.id) {
                    <div style="display: flex; align-items: center; gap: 4px; margin-left: 4px; border-left: 1px solid var(--border); padding-left: 8px">
                      <button
                        type="button"
                        (click)="openEditModal(a)"
                        title="Edit announcement"
                        style="border: none; background: transparent; color: var(--muted); cursor: pointer; padding: 4px 8px; border-radius: 6px; font-size: 13px; transition: color 0.15s; display: inline-flex; align-items: center; gap: 4px"
                        onmouseover="this.style.color='var(--p)'"
                        onmouseout="this.style.color='var(--muted)'"
                      >
                        ✎ Edit
                      </button>
                      <button
                        type="button"
                        (click)="deleteItem(a)"
                        title="Delete announcement"
                        style="border: none; background: transparent; color: var(--muted); cursor: pointer; padding: 4px 8px; border-radius: 6px; font-size: 14px; transition: color 0.15s"
                        onmouseover="this.style.color='var(--danger, #ef4444)'"
                        onmouseout="this.style.color='var(--muted)'"
                      >
                        ✕
                      </button>
                    </div>
                  }
                </div>
              </div>

              <div class="ann-title" style="font-size: 15px; font-weight: 700; color: var(--text); margin-bottom: 7px; line-height: 1.4">
                {{ a.title }}
              </div>
              <div class="ann-msg" style="font-size: 14px; color: var(--muted); line-height: 1.6">{{ a.msg }}</div>
            </div>
          </div>
        } @empty {
          <div style="text-align: center; padding: 48px; background: var(--surface); border-radius: 14px; border: 1px dashed var(--border)">
            <p style="color: var(--muted); margin-bottom: 14px">
              @if (activeFilter() === 'unread') {
                No unread news. You are all caught up! 🎉
              } @else if (activeFilter() === 'read') {
                No read news yet.
              } @else {
                No active announcements right now.
              }
            </p>
            @if (canManage()) {
              <button class="btn btn-primary btn-sm" (click)="openCreateModal()">+ Post the First Announcement</button>
            }
          </div>
        }
      </div>

      <!-- Pagination Controls (shows when total pages > 1 or for navigation) -->
      @if (totalPages() > 1) {
        <div style="display: flex; justify-content: flex-end; align-items: center; margin-top: auto; padding-top: 16px; gap: 6px; flex-shrink: 0">
          <button
            type="button"
            class="pg-btn"
            [disabled]="currentPage() <= 1"
            (click)="goToPage(currentPage() - 1)"
            aria-label="Previous page"
            style="width: 34px; height: 34px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: var(--muted); font-size: 14px; transition: all 0.15s;"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          @for (p of pageNumbers(); track p) {
            <button
              type="button"
              (click)="goToPage(p)"
              [style.background]="p === currentPage() ? 'var(--p)' : 'var(--surface)'"
              [style.color]="p === currentPage() ? '#fff' : 'var(--muted)'"
              [style.border-color]="p === currentPage() ? 'var(--p)' : 'var(--border)'"
              style="min-width: 34px; height: 34px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--border); font-size: 13px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s;"
            >
              {{ p }}
            </button>
          }

          <button
            type="button"
            class="pg-btn"
            [disabled]="currentPage() >= totalPages()"
            (click)="goToPage(currentPage() + 1)"
            aria-label="Next page"
            style="width: 34px; height: 34px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: var(--muted); font-size: 14px; transition: all 0.15s;"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      }
    </div>

    <!-- Read News Details Modal (automatically marks as read when opened) -->
    @if (readingItem(); as item) {
      <div class="modal-overlay open" (click)="closeReaderModal()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <div style="display: flex; align-items: center; gap: 8px">
              <span class="badge" [class]="badgeClass(item.type)">{{ item.tag }}</span>
              <span class="badge" style="font-size: 11px; padding: 2px 8px; border-radius: 12px; background: rgba(16,185,129,0.12); color: #10b981; font-weight: 600;">✓ Read</span>
              <span style="font-size: 12px; color: var(--muted)">{{ item.time }}</span>
            </div>
            <button class="btn btn-ghost btn-sm" type="button" (click)="closeReaderModal()" style="font-size: 18px; line-height: 1; padding: 4px 8px; border-radius: 6px">✕</button>
          </div>
          <div class="modal-body">
            <h3 style="margin: 0 0 12px 0; font-size: 1.25rem; font-weight: 700; color: var(--text); line-height: 1.4">
              {{ item.title }}
            </h3>
            <div style="font-size: 14.5px; color: var(--text); line-height: 1.7; white-space: pre-wrap; background: var(--bg); padding: 16px; border-radius: 10px; border: 1px solid var(--border)">
              {{ item.msg }}
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-primary btn-sm" type="button" (click)="closeReaderModal()">Done</button>
          </div>
        </div>
      </div>
    }

    <!-- Create / Edit Announcement Modal -->
    @if (showModal()) {
      <div class="modal-overlay open" (click)="closeCreateModal()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: var(--text)">{{ editingId ? 'Edit Announcement' : 'Post Announcement' }}</h3>
            <button class="btn btn-ghost btn-sm" type="button" (click)="closeCreateModal()" style="font-size: 18px; line-height: 1; padding: 4px 8px; border-radius: 6px">✕</button>
          </div>
          <div class="modal-body">
            <div>
              <label class="form-label" style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--text)">Title *</label>
              <input
                type="text"
                class="form-control"
                placeholder="e.g. Scheduled System Maintenance"
                [(ngModel)]="formTitle"
                maxlength="160"
                style="width: 100%"
              />
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
              <div>
                <label class="form-label" style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--text)">Category Tag *</label>
                <input
                  type="text"
                  class="form-control"
                  placeholder="e.g. IT Notice, Holiday"
                  [(ngModel)]="formTag"
                  maxlength="40"
                  style="width: 100%"
                />
              </div>
              <div>
                <label class="form-label" style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--text)">Severity Level</label>
                <select class="form-control" [(ngModel)]="formSeverity" style="width: 100%">
                  <option value="Info">Info (Blue)</option>
                  <option value="Success">Success (Green)</option>
                  <option value="Warning">Warning (Amber)</option>
                  <option value="Danger">Danger / Urgent (Red)</option>
                </select>
              </div>
            </div>

            <!-- Quick tag suggestions -->
            <div>
              <span style="font-size: 11px; color: var(--muted); display: block; margin-bottom: 6px; font-weight: 500">Quick Categories:</span>
              <div style="display: flex; flex-wrap: wrap; gap: 6px">
                @for (tag of quickTags; track tag) {
                  <button
                    type="button"
                    (click)="formTag = tag"
                    style="border: 1px solid var(--border); background: var(--surface-2, #f3f4f6); padding: 3px 10px; border-radius: 999px; font-size: 11px; cursor: pointer; color: var(--text)"
                  >
                    {{ tag }}
                  </button>
                }
              </div>
            </div>

            <div>
              <label class="form-label" style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--text)">Message *</label>
              <textarea
                class="form-control"
                rows="4"
                placeholder="Write the full announcement details for all employees..."
                [(ngModel)]="formMessage"
                maxlength="2000"
                style="width: 100%; resize: vertical"
              ></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-outline" type="button" (click)="closeCreateModal()">Cancel</button>
            <button class="btn btn-primary" type="button" (click)="submitAnnouncement()" [disabled]="isSubmitting()">
              {{ isSubmitting() ? 'Saving...' : (editingId ? 'Save Changes' : 'Publish Announcement') }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        height: 100%;
        box-sizing: border-box;
      }
      .custom-scroll::-webkit-scrollbar {
        width: 6px;
      }
      .custom-scroll::-webkit-scrollbar-track {
        background: transparent;
      }
      .custom-scroll::-webkit-scrollbar-thumb {
        background: var(--border);
        border-radius: 4px;
      }
      .custom-scroll::-webkit-scrollbar-thumb:hover {
        background: var(--muted);
      }
      .pg-btn:disabled {
        opacity: 0.35;
        cursor: not-allowed;
        pointer-events: none;
        border-color: var(--border);
        color: var(--muted);
      }
      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(15, 23, 42, 0.55);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        padding: 16px;
        box-sizing: border-box;
        overflow-y: auto;
      }
      .modal {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 16px;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.05);
        width: 100%;
        max-width: 520px;
        max-height: calc(100vh - 48px);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        margin: auto;
        animation: modalIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .modal-header {
        padding: 18px 22px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
      }
      .modal-body {
        padding: 20px 22px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        overflow-y: auto;
        flex: 1 1 auto;
      }
      .modal-footer {
        padding: 14px 22px;
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        border-top: 1px solid var(--border);
        background: var(--surface);
        flex-shrink: 0;
      }
      @keyframes modalIn {
        from {
          opacity: 0;
          transform: scale(0.96) translateY(-8px);
        }
        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }
      @media (max-width: 768px) {
        .ann-title {
          font-size: 13px !important;
        }
        .ann-msg {
          font-size: 12px !important;
        }
        .modal {
          max-height: calc(100vh - 24px);
        }
      }
    `,
  ],
})
export class EmpAnnouncementsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);

  protected readonly canManage = computed(() => this.session.role() !== 'Employee');
  protected readonly isHrManager = computed(() => this.session.activeRole() === 'HR Manager');

  protected readonly announcements = signal<Announcement[]>([]);
  protected readonly showModal = signal(false);
  protected readonly isSubmitting = signal(false);
  protected readonly readIds = signal<Set<string>>(new Set());
  protected readonly activeFilter = signal<'all' | 'unread' | 'read'>('all');
  protected readonly readingItem = signal<Announcement | null>(null);

  // Pagination state for announcements
  protected readonly currentPage = signal(1);
  protected readonly pageSize = signal(8);

  protected formTitle = '';
  protected formTag = 'HR Update';
  protected formSeverity = 'Info';
  protected formMessage = '';
  protected editingId: string | null = null;

  protected readonly quickTags = ['HR Update', 'Notice', 'Company Event', 'Holiday', 'IT Notice', 'Policy', 'Urgent'];

  private get storageKey(): string {
    const user = this.session.user();
    const id = user?.employeeId || user?.email || user?.name || 'default';
    return `hrms_news_read_${id}`;
  }

  protected isRead(a: Announcement): boolean {
    const key = a.id || a.title;
    return this.readIds().has(key);
  }

  protected readonly unreadCount = computed(() => {
    const read = this.readIds();
    return this.announcements().filter((a) => !read.has(a.id || a.title)).length;
  });

  protected readonly readCount = computed(() => {
    const read = this.readIds();
    return this.announcements().filter((a) => read.has(a.id || a.title)).length;
  });

  protected readonly filteredAnnouncements = computed(() => {
    const filter = this.activeFilter();
    const items = this.announcements();
    const read = this.readIds();
    if (this.isHrManager()) {
      return items;
    }
    if (filter === 'unread') {
      return items.filter((a) => !read.has(a.id || a.title));
    }
    if (filter === 'read') {
      return items.filter((a) => read.has(a.id || a.title));
    }
    return items;
  });

  protected readonly totalPages = computed(() => {
    const total = this.filteredAnnouncements().length;
    const size = this.pageSize();
    return Math.max(1, Math.ceil(total / size));
  });

  protected readonly paginatedAnnouncements = computed(() => {
    const list = this.filteredAnnouncements();
    const page = this.currentPage();
    const size = this.pageSize();
    const start = (page - 1) * size;
    return list.slice(start, start + size);
  });

  protected readonly pageNumbers = computed(() => {
    const total = this.totalPages();
    const pages: number[] = [];
    for (let i = 1; i <= total; i++) {
      pages.push(i);
    }
    return pages;
  });

  protected goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
    }
  }

  ngOnInit(): void {
    this.loadReadState();
    this.loadAnnouncements();
  }

  protected readNews(a: Announcement): void {
    this.readingItem.set(a);
    this.markAsRead(a);
  }

  protected closeReaderModal(): void {
    this.readingItem.set(null);
  }

  protected markAsRead(a: Announcement, event?: Event): void {
    if (event) event.stopPropagation();
    const key = a.id || a.title;
    const current = new Set(this.readIds());
    if (!current.has(key)) {
      current.add(key);
      this.readIds.set(current);
      this.saveReadState();
      this.toast.show('News marked as read.', 'success');
    }
  }

  protected toggleRead(a: Announcement, event?: Event): void {
    if (event) event.stopPropagation();
    const key = a.id || a.title;
    const current = new Set(this.readIds());
    if (current.has(key)) {
      current.delete(key);
      this.toast.show('News marked as unread.', 'info');
    } else {
      current.add(key);
      this.toast.show('News marked as read.', 'success');
    }
    this.readIds.set(current);
    this.saveReadState();
  }

  protected markAllAsRead(): void {
    const current = new Set(this.readIds());
    for (const a of this.announcements()) {
      current.add(a.id || a.title);
    }
    this.readIds.set(current);
    this.saveReadState();
    this.toast.show('All news marked as read.', 'success');
  }

  private saveReadState(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify([...this.readIds()]));
    } catch { }
  }

  private loadReadState(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          this.readIds.set(new Set(arr));
        }
      }
    } catch { }
  }

  loadAnnouncements(): void {
    this.api.announcements().subscribe({
      next: (items) =>
        this.announcements.set(
          items.map((a) => {
            const sev = (a.severity || '').toLowerCase();
            const type: Announcement['type'] =
              sev === 'danger' ? 'danger' : sev === 'warning' ? 'warning' : sev === 'success' ? 'success' : 'info';
            return {
              id: a.id,
              title: a.title,
              msg: a.message,
              type,
              time: a.publishedLabel,
              tag: a.tag,
              rawSeverity: a.severity || 'Info',
            };
          }),
        ),
      error: () => {
        /* Keep empty or fallback */
      },
    });
  }

  openCreateModal(): void {
    if (!this.canManage()) return;
    this.editingId = null;
    this.formTitle = '';
    this.formTag = 'HR Update';
    this.formSeverity = 'Info';
    this.formMessage = '';
    this.showModal.set(true);
  }

  openEditModal(a: Announcement): void {
    if (!this.canManage()) return;
    this.editingId = a.id ?? null;
    this.formTitle = a.title;
    this.formTag = a.tag;
    this.formSeverity = a.rawSeverity || 'Info';
    this.formMessage = a.msg;
    this.showModal.set(true);
  }

  closeCreateModal(): void {
    this.showModal.set(false);
    this.editingId = null;
  }

  submitAnnouncement(): void {
    if (!this.canManage()) return;
    if (!this.formTitle.trim()) {
      this.toast.show('Please enter an announcement title.', 'warning');
      return;
    }
    if (!this.formMessage.trim()) {
      this.toast.show('Please enter the announcement message.', 'warning');
      return;
    }

    this.isSubmitting.set(true);
    const payload = {
      title: this.formTitle.trim(),
      message: this.formMessage.trim(),
      tag: this.formTag.trim() || 'HR Update',
      severity: this.formSeverity,
    };

    const action$ = this.editingId
      ? this.api.updateAnnouncement(this.editingId, payload)
      : this.api.createAnnouncement(payload);

    action$.subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.closeCreateModal();
        this.toast.show(this.editingId ? 'Announcement updated successfully!' : 'Announcement published successfully!', 'success');
        this.editingId = null;
        this.loadAnnouncements();
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.toast.show(err.error?.message || 'Failed to save announcement.', 'danger');
      },
    });
  }

  deleteItem(a: Announcement): void {
    if (!this.canManage() || !a.id) return;
    if (!confirm(`Are you sure you want to delete notice "${a.title}"?`)) return;

    this.api.deleteAnnouncement(a.id).subscribe({
      next: () => {
        this.toast.show('Notice deleted.', 'success');
        this.loadAnnouncements();
      },
      error: () => this.toast.show('Failed to delete notice.', 'danger'),
    });
  }

  protected barColor(type: Announcement['type']): string {
    return type === 'danger'
      ? 'var(--danger)'
      : type === 'warning'
        ? 'var(--warning)'
        : type === 'success'
          ? 'var(--success, #10b981)'
          : 'var(--p)';
  }

  protected badgeClass(type: Announcement['type']): string {
    return `badge-${type === 'danger' ? 'danger' : type === 'warning' ? 'warning' : type === 'success' ? 'success' : 'primary'}`;
  }
}
