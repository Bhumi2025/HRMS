import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../core/api/api.service';
import { IconDirective } from '../../core/icons/icon.directive';
import { ToastService } from '../../core/services/toast.service';
import { UiService } from '../../core/services/ui.service';
import { SelectComponent, SelectOption } from '../../shared/select.component';

interface DocumentRow {
  n: string;
  doc: string;
  t: string;
  iss: string;
  exp: string;
  days: number;
  s: 'Critical' | 'Warning' | 'Valid' | 'Expired';
  fileUrl?: string | null;
}

/** Document Management — ported from pages/documents.html. */
@Component({
  selector: 'app-documents',
  imports: [CommonModule, IconDirective, SelectComponent],
  template: `
    <div class="flex justify-end items-center" style="margin-bottom: 16px">
      <button class="btn btn-primary btn-sm" (click)="ui.open('uploadModal')"><span [appIcon]="'plus'"></span> Upload Document</button>
    </div>

    <div class="grid-4" style="margin-bottom: 16px">
      @for (k of kpis(); track k.l) {
        <div class="kpi-card">
          <div class="kpi-icon" [style.background]="k.bg" [style.color]="k.c"><span [appIcon]="'documents'"></span></div>
          <div class="kpi-value">{{ k.v }}</div>
          <div class="kpi-label">{{ k.l }}</div>
        </div>
      }
    </div>

    @if (expiringCount() > 0) {
      <div class="alert alert-warning" style="margin-bottom: 16px">
        <span [appIcon]="'alert'"></span>
        <span>
          <strong>{{ expiringCount() }} document{{ expiringCount() === 1 ? '' : 's' }}</strong>
          {{ expiringCount() === 1 ? 'is' : 'are' }} expiring within 7 days.
          <button
            type="button"
            style="color: var(--warning); font-weight: 700; background: none; border: none; cursor: pointer; text-decoration: underline; padding: 0 4px"
            (click)="filterExpiring()"
          >
            View all →
          </button>
        </span>
      </div>
    }

    <div class="card">
      <div class="card-header">
        <div class="card-title">All Documents</div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap">
          <input class="form-control" placeholder="Search..." style="width: 200px" [value]="search()" (input)="search.set($any($event.target).value)" />
          <app-select [options]="typeOptions" [value]="type()" (valueChange)="type.set($event)" width="140px" />
          <app-select [options]="statusOptions" [value]="status()" (valueChange)="status.set($event)" width="120px" />
        </div>
      </div>
      <div class="table-wrap">
        <table class="docs-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Document</th>
              <th>Type</th>
              <th>Issue Date</th>
              <th>Expiry</th>
              <th>Days Left</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (r of filtered(); track r.n + r.doc) {
              <tr>
                <td>
                  <div class="table-avatar">
                    <div class="avatar-placeholder avatar-sm" style="background: var(--p-soft); color: var(--p)">{{ initials(r.n) }}</div>
                    <span style="font-weight: 600">{{ r.n }}</span>
                  </div>
                </td>
                <td style="font-weight: 600">{{ r.doc }}</td>
                <td><span class="badge badge-info">{{ r.t }}</span></td>
                <td style="color: var(--muted)">{{ r.iss }}</td>
                <td>{{ r.exp }}</td>
                <td><span style="font-weight: 700; color: var(--text)">{{ r.days }}d</span></td>
                <td><span class="badge" [class]="docClass(r.s)">{{ r.s }}</span></td>
                <td>
                  <div style="display: flex; gap: 4px">
                    <button class="btn btn-ghost btn-sm" data-tooltip="View" (click)="view(r)"><span [appIcon]="'eye'"></span></button>
                    <button class="btn btn-ghost btn-sm" data-tooltip="Download" (click)="download(r)"><span [appIcon]="'download'"></span></button>
                    <button class="btn btn-ghost btn-sm" data-tooltip="Send Reminder" (click)="toast.show('Reminder sent!')"><span [appIcon]="'bell'"></span></button>
                  </div>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="8" style="text-align: center; padding: 24px; color: var(--muted);">
                  No documents found. Click "Upload Document" to add one.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>

    <!-- Doc View Modal -->
    <div class="modal-overlay" [class.open]="ui.isOpen('docViewModal')" (click)="ui.onOverlayClick($event, 'docViewModal')">
      <div class="modal" style="max-width: 600px">
        <div class="modal-header">
          <div>
            <div class="card-title" style="font-size: 14px">{{ viewTarget()?.doc }} — Details</div>
            <div class="card-subtitle">{{ viewTarget()?.n }} · {{ viewTarget()?.t }}</div>
          </div>
          <button class="btn btn-ghost btn-sm" (click)="ui.close('docViewModal')"><span [appIcon]="'x'"></span></button>
        </div>
        <div class="modal-body">
          @if (viewTarget(); as r) {
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px">
              @for (f of viewFields(r); track f[0]) {
                <div style="background: var(--bg); border-radius: 8px; padding: 10px">
                  <div style="font-size: 13px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px">
                    {{ f[0] }}
                  </div>
                  <div style="font-size: 13px; font-weight: 400; color: var(--text)">{{ f[1] }}</div>
                </div>
              }
            </div>
            <div style="margin-top: 12px; display: flex; align-items: center; justify-content: space-between; padding: 12px; background: var(--bg); border-radius: 8px">
              <span style="font-size: 12px; font-weight: 700">Status</span>
              <span class="badge" [class]="docClass(r.s)">{{ r.s }}</span>
            </div>
          }
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" (click)="ui.close('docViewModal')">Close</button>
          <button class="btn btn-primary" style="display: flex; align-items: center; gap: 6px" (click)="viewTarget() && download(viewTarget()!)">
            <span [appIcon]="'download'"></span> Download
          </button>
        </div>
      </div>
    </div>

    <!-- Upload Modal -->
    <div class="modal-overlay" [class.open]="ui.isOpen('uploadModal')" (click)="ui.onOverlayClick($event, 'uploadModal')">
      <div class="modal">
        <div class="modal-header">
          <div style="font-size: 1rem; font-weight: 600">Upload Document</div>
          <button class="btn btn-ghost btn-sm" (click)="ui.close('uploadModal')"><span [appIcon]="'x'"></span></button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Employee</label>
            <app-select [options]="employeeOptions()" [value]="uploadEmployee()" (valueChange)="uploadEmployee.set($event)" width="100%" />
          </div>
          <div class="form-group">
            <label class="form-label">Document Type</label>
            <app-select [options]="uploadTypeOptions" [value]="uploadType()" (valueChange)="uploadType.set($event)" width="100%" />
          </div>
          <div class="grid-2">
            <div class="form-group">
              <label class="form-label">Issue Date</label>
              <input class="form-control" type="date" [value]="uploadIssueDate()" (input)="uploadIssueDate.set($any($event.target).value)" />
            </div>
            <div class="form-group">
              <label class="form-label">Expiry Date</label>
              <input class="form-control" type="date" [value]="uploadExpiryDate()" (input)="uploadExpiryDate.set($any($event.target).value)" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Upload File</label>
            <input #fileInput type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" (change)="onFileSelected($event)" style="display: none" />
            <div
              style="border: 2px dashed var(--border); border-radius: var(--r); padding: 24px; text-align: center; cursor: pointer; transition: var(--t)"
              [style.borderColor]="selectedFile() ? 'var(--p)' : 'var(--border)'"
              [style.background]="selectedFile() ? 'var(--p-soft)' : 'transparent'"
              (click)="fileInput.click()"
              (dragover)="$event.preventDefault()"
              (drop)="onFileDrop($event)"
            >
              @if (selectedFile()) {
                <div style="color: var(--p); margin-bottom: 6px"><span [appIcon]="'check'"></span></div>
                <div style="font-size: 0.9rem; font-weight: 700; color: var(--text)">{{ selectedFile()?.name }}</div>
                <div style="font-size: 0.78rem; color: var(--muted); margin-top: 3px">{{ formatFileSize(selectedFile()?.size || 0) }} &bull; Click to change file</div>
              } @else {
                <div style="color: var(--p); margin-bottom: 8px"><span [appIcon]="'upload2'"></span></div>
                <div style="font-size: 0.86rem; font-weight: 600">Drop files here or click to browse</div>
                <div style="font-size: 0.86rem; color: var(--muted); margin-top: 4px">PDF, JPG, PNG up to 10MB</div>
              }
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" (click)="closeUploadModal()">Cancel</button>
          <button class="btn btn-primary" [disabled]="uploading()" (click)="submitUpload()">
            {{ uploading() ? 'Uploading...' : 'Upload' }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      thead th,
      .docs-table td,
      .docs-table .table-avatar span,
      .docs-table .badge {
        white-space: nowrap;
      }
      @media (max-width: 768px) {
        .docs-table th:nth-child(3),
        .docs-table td:nth-child(3),
        .docs-table th:nth-child(4),
        .docs-table td:nth-child(4),
        .docs-table th:nth-child(5),
        .docs-table td:nth-child(5),
        .docs-table th:nth-child(6),
        .docs-table td:nth-child(6) {
          display: none;
        }
      }
      @media (max-width: 480px) {
        .docs-table th:nth-child(7),
        .docs-table td:nth-child(7) {
          display: none;
        }
      }
    `,
  ],
})
export class DocumentsComponent implements OnInit {
  protected readonly ui = inject(UiService);
  protected readonly toast = inject(ToastService);
  private readonly api = inject(ApiService);

  protected readonly kpis = signal([
    { l: 'Total Documents', v: '0', c: 'var(--p)', bg: 'var(--p-soft)' },
    { l: 'Expiring Soon', v: '0', c: 'var(--warning)', bg: 'var(--warning-soft)' },
    { l: 'Expired', v: '0', c: 'var(--danger)', bg: 'var(--danger-soft)' },
    { l: 'Valid', v: '0', c: 'var(--success)', bg: 'var(--success-soft)' },
  ]);

  protected readonly typeOptions: SelectOption[] = [
    { v: '', l: 'All Types' },
    { v: 'Identity', l: 'Identity' },
    { v: 'Legal', l: 'Legal' },
    { v: 'Benefits', l: 'Benefits' },
  ];

  protected readonly statusOptions: SelectOption[] = [
    { v: '', l: 'All Status' },
    { v: 'Valid', l: 'Valid' },
    { v: 'Warning', l: 'Expiring' },
    { v: 'Critical', l: 'Critical' },
    { v: 'Expired', l: 'Expired' },
  ];

  protected readonly employeeOptions = signal<SelectOption[]>([]);

  protected readonly uploadTypeOptions: SelectOption[] = [
    { v: 'Passport', l: 'Passport' },
    { v: 'Visa', l: 'Visa' },
    { v: 'Work Permit', l: 'Work Permit' },
    { v: 'Emirates ID', l: 'Emirates ID' },
    { v: 'Insurance', l: 'Insurance' },
  ];

  protected readonly search = signal('');
  protected readonly type = signal('');
  protected readonly status = signal('');
  protected readonly uploadEmployee = signal('');
  protected readonly uploadType = signal('Passport');
  protected readonly uploadIssueDate = signal('');
  protected readonly uploadExpiryDate = signal('');
  protected readonly selectedFile = signal<File | null>(null);
  protected readonly uploading = signal(false);
  protected readonly viewTarget = signal<DocumentRow | null>(null);

  private employeeMap = new Map<string, string>();

  protected readonly rows = signal<DocumentRow[]>([]);

  protected readonly filtered = computed(() => {
    const q = this.search().toLowerCase();
    const t = this.type();
    const s = this.status();
    return this.rows().filter(
      (r) => (!q || r.n.toLowerCase().includes(q) || r.doc.toLowerCase().includes(q)) && (!t || r.t === t) && (!s || r.s === s),
    );
  });

  protected readonly expiringCount = computed(() => {
    const kpi = this.kpis().find((k) => k.l === 'Expiring Soon');
    const fromKpi = kpi ? parseInt(kpi.v, 10) : 0;
    const fromRows = this.rows().filter((r) => r.s === 'Warning' || (r.days > 0 && r.days <= 7)).length;
    return Math.max(isNaN(fromKpi) ? 0 : fromKpi, fromRows);
  });

  protected filterExpiring(): void {
    this.status.set('Warning');
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile.set(input.files[0]);
    }
  }

  protected onFileDrop(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      this.selectedFile.set(event.dataTransfer.files[0]);
    }
  }

  protected formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  protected closeUploadModal(): void {
    this.selectedFile.set(null);
    this.uploadIssueDate.set('');
    this.uploadExpiryDate.set('');
    this.ui.close('uploadModal');
  }

  protected submitUpload(): void {
    const file = this.selectedFile();
    const type = this.uploadType();
    const empName = this.uploadEmployee();
    const empId = this.employeeMap.get(empName);

    const documentType = type === 'Visa' || type === 'Work Permit'
      ? 'Legal'
      : type === 'Insurance'
        ? 'Benefits'
        : 'Identity';

    const docName = file ? file.name : `${type} Document`;
    const fileSize = file ? this.formatFileSize(file.size) : '1.2 MB';

    this.uploading.set(true);
    this.api
      .createDocument({
        employeeId: empId || null,
        name: docName,
        type: documentType,
        issueDate: this.uploadIssueDate() || new Date().toISOString().slice(0, 10),
        expiryDate: this.uploadExpiryDate() || null,
        notes: null,
        fileUrl: file ? file.name : null,
        fileSize,
        isCompanyDocument: !empId,
      })
      .subscribe({
        next: () => {
          this.uploading.set(false);
          this.closeUploadModal();
          this.toast.show('Document uploaded successfully!', 'success');
          this.loadDocuments();
          this.loadSummary();
        },
        error: (err) => {
          this.uploading.set(false);
          this.toast.show(err?.error?.message || 'Could not upload document.', 'danger');
        },
      });
  }

  ngOnInit(): void {
    this.loadSummary();
    this.loadDocuments();
    this.loadEmployees();
  }

  private loadEmployees(): void {
    this.api.employees({ pageSize: 100 }).subscribe({
      next: (res) => {
        this.employeeMap = new Map((res.items || []).map((e) => [e.fullName, e.id]));
        const list = (res.items || []).map((e) => ({
          v: e.fullName,
          l: e.fullName,
        }));
        this.employeeOptions.set(list);
        if (list.length > 0 && !this.uploadEmployee()) {
          this.uploadEmployee.set(list[0].v);
        }
      },
      error: () => {},
    });
  }

  private loadSummary(): void {
    this.api.documentSummary().subscribe({
      next: (summary) =>
        this.kpis.set([
          { l: 'Total Documents', v: `${summary.total}`, c: 'var(--p)', bg: 'var(--p-soft)' },
          { l: 'Expiring Soon', v: `${summary.expiringSoon}`, c: 'var(--warning)', bg: 'var(--warning-soft)' },
          { l: 'Expired', v: `${summary.expired}`, c: 'var(--danger)', bg: 'var(--danger-soft)' },
          { l: 'Valid', v: `${summary.valid}`, c: 'var(--success)', bg: 'var(--success-soft)' },
        ]),
      error: () => {},
    });
  }

  private loadDocuments(): void {
    this.api.documents().subscribe({
      next: (documents) =>
        this.rows.set(
          (documents || []).map((d) => ({
            n: d.employeeName ?? 'Company',
            doc: d.name,
            t: d.type,
            iss: d.issueDate ? this.formatDate(d.issueDate) : ' · ',
            exp: d.expiryDate ? this.formatDate(d.expiryDate) : ' · ',
            days: d.daysLeft ?? 0,
            s: d.status as DocumentRow['s'],
            fileUrl: d.fileUrl ?? null,
          })),
        ),
      error: () => {
        this.rows.set([]);
      },
    });
  }

  private formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  protected initials(name: string): string {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('');
  }

  protected docClass(s: DocumentRow['s']): string {
    return `badge-${s === 'Critical' || s === 'Expired' ? 'danger' : s === 'Warning' ? 'warning' : 'success'}`;
  }

  protected viewFields(r: DocumentRow): [string, string][] {
    return [
      ['Employee', r.n],
      ['Document', r.doc],
      ['Type', r.t],
      ['Issue Date', r.iss],
      ['Expiry Date', r.exp],
      ['Days Left', `${r.days}d`],
    ];
  }

  protected view(r: DocumentRow): void {
    this.viewTarget.set(r);
    this.ui.open('docViewModal');
  }

  protected download(r: DocumentRow): void {
    const empName = r.n || 'Employee';
    const docName = r.doc || 'Document';

    if (r.fileUrl && (r.fileUrl.startsWith('data:') || r.fileUrl.startsWith('http://') || r.fileUrl.startsWith('https://') || r.fileUrl.startsWith('/'))) {
      const a = document.createElement('a');
      a.href = r.fileUrl;
      const ext = r.fileUrl.startsWith('data:image/png') ? '.png'
        : r.fileUrl.startsWith('data:image/jpeg') ? '.jpg'
        : r.fileUrl.startsWith('data:application/pdf') ? '.pdf' : '';
      a.download = `${empName.replace(/\s+/g, '_')}_${docName.replace(/\s+/g, '_')}${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      this.toast.show(`Downloaded ${docName}`, 'success');
      return;
    }

    const safeTitle = `${empName} - ${docName}`;
    const documentContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${safeTitle}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f1f5f9; color: #1e293b; padding: 40px 20px; }
    .doc-container { max-width: 680px; margin: 0 auto; background: #ffffff; border: 2px solid #e2e8f0; border-radius: 16px; padding: 36px 40px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); }
    .doc-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #f1f5f9; padding-bottom: 20px; margin-bottom: 24px; }
    .org-title { font-size: 18px; font-weight: 800; color: #0284c7; letter-spacing: -0.02em; }
    .badge { display: inline-block; padding: 4px 12px; font-size: 12px; font-weight: 700; border-radius: 20px; background: #e0f2fe; color: #0369a1; }
    .doc-title { font-size: 24px; font-weight: 800; color: #0f172a; margin-bottom: 4px; }
    .doc-subtitle { font-size: 13px; color: #64748b; margin-bottom: 24px; }
    .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 28px; }
    .field-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; }
    .field-label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 4px; letter-spacing: 0.05em; }
    .field-value { font-size: 14px; font-weight: 600; color: #0f172a; }
    .stamp-box { border: 2px dashed #0284c7; border-radius: 12px; padding: 16px; text-align: center; color: #0369a1; background: #f0f9ff; margin-top: 30px; }
    .stamp-title { font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; }
    .stamp-text { font-size: 12px; margin-top: 4px; color: #0284c7; }
    .footer { text-align: center; margin-top: 24px; font-size: 11px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="doc-container">
    <div class="doc-header">
      <div class="org-title">HR NEXUS CORPORATION</div>
      <span class="badge">${r.s}</span>
    </div>
    <div class="doc-title">${docName}</div>
    <div class="doc-subtitle">Official Employee Verification Record</div>
    <div class="field-grid">
      <div class="field-card">
        <div class="field-label">Employee Name</div>
        <div class="field-value">${empName}</div>
      </div>
      <div class="field-card">
        <div class="field-label">Document Type</div>
        <div class="field-value">${r.t}</div>
      </div>
      <div class="field-card">
        <div class="field-label">Status</div>
        <div class="field-value">${r.s}</div>
      </div>
      <div class="field-card">
        <div class="field-label">Days Left</div>
        <div class="field-value">${r.days} days</div>
      </div>
      <div class="field-card">
        <div class="field-label">Issue Date</div>
        <div class="field-value">${r.iss}</div>
      </div>
      <div class="field-card">
        <div class="field-label">Expiry Date</div>
        <div class="field-value">${r.exp}</div>
      </div>
    </div>
    <div class="stamp-box">
      <div class="stamp-title">VERIFIED HR RECORD</div>
      <div class="stamp-text">Document archived &amp; authorized by HR Nexus Management System</div>
    </div>
    <div class="footer">Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })} &bull; Confidential</div>
  </div>
</body>
</html>`;

    const blob = new Blob([documentContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${empName.replace(/\s+/g, '_')}_${docName.replace(/\s+/g, '_')}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.toast.show(`Downloaded ${docName}`, 'success');
  }
}
