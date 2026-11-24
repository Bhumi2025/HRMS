import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from '../api/api.service';
import { SessionService } from './session.service';
import { ToastService } from './toast.service';

export interface DetailedNotification {
  id: string;
  title: string;
  message: string;
  time: string;
  category: 'Approval' | 'Attendance' | 'Policy' | 'Birthday' | 'Document' | 'Payroll' | 'System';
  unread: boolean;
  userId?: string | null;
  createdAtUtc?: string | null;
  actionUrl?: string;
  actionLabel?: string;
}

function formatRelativeTime(dateStr?: string | null, fallback = 'Just now'): string {
  if (!dateStr) return fallback;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return fallback;
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 0 || diffSec < 45) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${Math.max(1, diffMin)}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 4) return `${diffWeeks}w ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

@Injectable({
  providedIn: 'root',
})
export class NotificationStateService {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);

  readonly notifications = signal<DetailedNotification[]>([]);
  readonly unreadCount = computed(() => this.notifications().filter((n) => n.unread).length);

  private pollInterval: any = null;

  constructor() {
    this.load();
    if (typeof window !== 'undefined') {
      this.pollInterval = setInterval(() => {
        if (this.session.isAuthenticated()) {
          this.load();
        }
      }, 10000);
    }
  }

  refresh(): void {
    this.load();
  }

  load(): void {
    if (!this.session.isAuthenticated()) {
      this.notifications.set([]);
      return;
    }

    this.api.notifications().subscribe({
      next: (items) => {
        const isEmp = this.session.activeRole() === 'Employee';
        const mapped = (items || []).map((n) => {
          const t = (n.title || '').toLowerCase();
          const m = (n.message || '').toLowerCase();
          const full = `${t} ${m}`;

          let category: DetailedNotification['category'] = 'System';
          let actionUrl: string | undefined = undefined;
          let actionLabel: string | undefined = undefined;

          if (full.includes('birthday') || full.includes('celebrat')) {
            category = 'Birthday';
            actionLabel = 'Send Wishes';
          } else if (
            full.includes('attendance') ||
            full.includes('absent') ||
            full.includes('punch') ||
            full.includes('clock') ||
            full.includes('note') ||
            full.includes('late')
          ) {
            category = 'Attendance';
            actionUrl = isEmp ? '/me/attendance' : '/attendance';
            actionLabel = 'View Attendance';
          } else if (full.includes('leave') || full.includes('approval') || full.includes('overtime') || full.includes('request')) {
            category = 'Approval';
            actionUrl = isEmp ? '/me/leave' : '/approvals';
            actionLabel = 'Review in Approvals';
          } else if (full.includes('policy') || full.includes('notice') || full.includes('announcement')) {
            category = 'Policy';
            actionUrl = isEmp ? '/me/announcements' : '/announcements';
            actionLabel = 'Read Announcement';
          } else if (full.includes('document') || full.includes('passport') || full.includes('expiry') || full.includes('visa')) {
            category = 'Document';
            actionUrl = isEmp ? '/me/documents' : '/documents';
            actionLabel = 'Check Documents';
          } else if (full.includes('payroll') || full.includes('salary') || full.includes('payslip')) {
            category = 'Payroll';
            actionUrl = isEmp ? '/me/payslips' : '/payroll';
            actionLabel = isEmp ? 'View Payslip' : 'View Payroll';
          }

          const timeDisplay = n.createdAtUtc ? formatRelativeTime(n.createdAtUtc, n.timeLabel) : n.timeLabel;
          return {
            id: n.id,
            title: n.title,
            message: n.message,
            time: timeDisplay,
            category,
            unread: !n.isRead,
            userId: n.userId,
            createdAtUtc: n.createdAtUtc,
            actionUrl,
            actionLabel,
          };
        });

        if (isEmp) {
          const user = this.session.user();
          const myId = user?.id;
          const myName = (user?.name || '').trim().toLowerCase();
          const myFirstName = myName.split(' ')[0] || '';

          const filtered = mapped.filter((item) => {
            // 0. If explicitly targeted to this employee, ALWAYS show it!
            if (item.userId && myId && item.userId === myId) {
              return true;
            }

            const t = (item.title || '').toLowerCase();
            const m = (item.message || '').toLowerCase();

            // 1. Announcements (Policy, Notice, Announcement, Holiday, HR Update)
            if (
              item.category === 'Policy' ||
              t.includes('announcement') ||
              t.includes('notice') ||
              t.includes('policy') ||
              t.includes('holiday') ||
              t.includes('closure') ||
              (item.time || '').toLowerCase().includes('hr update')
            ) {
              return true;
            }

            // 2. Leave Approval Updates for this employee only
            if (item.category === 'Approval' || t.includes('leave') || t.includes('approval')) {
              // Ignore "New Leave Request" or "New Approval Request" or "Pending" review items (those are for HR managers)
              if (t.includes('new leave') || t.includes('new approval') || t.includes('pending')) {
                return false;
              }
              // If it names this employee
              if (myFirstName && (m.includes(myFirstName) || t.includes(myFirstName))) {
                return true;
              }
              // If it's a generic status update for the logged-in user (e.g. "Leave Approved", "Leave Rejected")
              if (t.includes('approved') || t.includes('rejected')) {
                // If it doesn't mention someone else's name requesting leave
                return !m.includes('requested') || (myFirstName && m.includes(myFirstName));
              }
              return false;
            }

            // 3. Attendance Reminders & Notes of that employee only
            if (
              item.category === 'Attendance' ||
              t.includes('attendance') ||
              t.includes('clock in') ||
              t.includes('clock out') ||
              t.includes('punch') ||
              t.includes('note')
            ) {
              if (item.userId && myId && item.userId === myId) {
                return true;
              }
              if (myFirstName && (m.includes(myFirstName) || t.includes(myFirstName))) {
                return true;
              }
              const isReminderOrNote =
                t.includes('reminder') ||
                m.includes('reminder') ||
                t.includes('clock in') ||
                t.includes('clock out') ||
                t.includes('punch reminder') ||
                t.includes('hr note') ||
                t.includes('note') ||
                m.includes('note') ||
                t.includes('late') ||
                m.includes('late');
              const isGenericAbsent = m.includes('recorded absent') || m.includes('window closed');
              return isReminderOrNote && !isGenericAbsent;
            }

            // 4. Payroll / Payslip notifications for this employee
            if (
              item.category === 'Payroll' ||
              t.includes('payroll') ||
              t.includes('payslip') ||
              t.includes('salary') ||
              m.includes('payslip') ||
              m.includes('salary') ||
              m.includes('net pay')
            ) {
              if (item.userId && myId && item.userId === myId) {
                return true;
              }
              if (myFirstName && (m.includes(myFirstName) || t.includes(myFirstName))) {
                return true;
              }
              return true;
            }

            // Filter out all other unrelated items for employees (birthdays of others, system alerts, approvals of others)
            return false;
          });

          this.notifications.set(filtered);
          return;
        }

        this.notifications.set(mapped);
      },
      error: () => {
        /* Best effort */
      },
    });
  }

  markRead(id: string): void {
    const list = this.notifications();
    const item = list.find((n) => n.id === id);
    if (item && item.unread) {
      this.notifications.update((items) =>
        items.map((n) => (n.id === id ? { ...n, unread: false } : n))
      );
      this.api.markNotificationRead(id).subscribe({
        error: () => {
          /* Best effort */
        },
      });
    }
  }

  toggleRead(id: string): void {
    const list = this.notifications();
    const item = list.find((n) => n.id === id);
    if (!item) return;

    const newUnread = !item.unread;
    this.notifications.update((items) =>
      items.map((n) => (n.id === id ? { ...n, unread: newUnread } : n))
    );

    this.api.toggleNotificationRead(id).subscribe({
      error: () => {
        /* Best effort */
      },
    });
  }

  markAllAsRead(): void {
    this.notifications.update((items) => items.map((n) => ({ ...n, unread: false })));
    this.api.markAllNotificationsRead().subscribe({
      next: () => {
        this.toast.show('All notifications marked as read', 'success');
      },
      error: () => {
        this.toast.show('All notifications marked as read', 'success');
      },
    });
  }

  clearAll(): void {
    this.notifications.set([]);
    this.api.clearAllNotifications().subscribe({
      next: () => {
        this.toast.show('All notifications cleared', 'info');
      },
      error: () => {
        this.toast.show('All notifications cleared', 'info');
      },
    });
  }

  deleteItem(id: string): void {
    this.notifications.update((items) => items.filter((n) => n.id !== id));
    this.api.deleteNotification(id).subscribe({
      next: () => {
        this.toast.show('Notification dismissed', 'info');
      },
      error: () => {
        this.toast.show('Notification dismissed', 'info');
      },
    });
  }
}
