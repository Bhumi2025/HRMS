import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ApiService } from '../../core/api/api.service';
import { DocumentDto } from '../../core/api/api.models';
import { IconDirective } from '../../core/icons/icon.directive';
import { ToastService } from '../../core/services/toast.service';
import { UiService } from '../../core/services/ui.service';
import { triggerDocumentDownload } from '../../core/utils/document-download.util';
import { ACCEPT_DOC_TYPES, validateDocumentFile } from '../../core/utils/file-validator';
import { SelectComponent, SelectOption } from '../../shared/select.component';

interface DocRow {
  id: string;
  doc: string;
  type: string;
  iss: string;
  exp: string;
  s: string;
  num: string;
  issuedBy: string;
  notes: string;
  fileUrl?: string | null;
  fileSize?: string | null;
}

interface CompanyDoc {
  name: string;
  size: string;
  date: string;
  fileUrl?: string | null;
}

/** My Documents — ported from pages/emp-documents.html. */
@Component({
  selector: 'app-emp-documents',
  imports: [CommonModule, IconDirective, SelectComponent],
  template: `
    <div class="flex justify-end items-center" style="margin-bottom: 15px">
      <button class="btn btn-primary btn-sm" style="display: flex; align-items: center; gap: 6px" (click)="openUploadModal()">
        <span [appIcon]="'upload2'"></span> Upload
      </button>
    </div>

    <div style="margin-bottom: 14px">
      <div class="tabs mb-4">
        <button class="tab-btn" [class.active]="tab() === 'my'" (click)="tab.set('my')">My Documents</button>
        <button class="tab-btn" [class.active]="tab() === 'company'" (click)="tab.set('company')">Company Documents</button>
      </div>

      @if (tab() === 'my') {
        <div class="card">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th class="col-hide">Type</th>
                  <th class="col-hide">Issue Date</th>
                  <th>Expiry</th>
                  <th class="col-hide">Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                @if (docs().length === 0) {
                  <tr>
                    <td colspan="6" style="text-align: center; padding: 24px; color: var(--muted)">
                      No personal documents uploaded yet. Click <strong>Upload</strong> above to add one.
                    </td>
                  </tr>
                }
                @for (r of docs(); track r.doc + r.num) {
                  <tr>
                    <td style="font-weight: 600; white-space: nowrap">{{ r.doc }}</td>
                    <td class="col-hide"><span class="badge badge-info">{{ r.type }}</span></td>
                    <td class="col-hide" style="white-space: nowrap">{{ r.iss }}</td>
                    <td style="white-space: nowrap">{{ r.exp }}</td>
                    <td class="col-hide"><span class="badge badge-success">{{ r.s }}</span></td>
                    <td>
                      <div style="display: flex; gap: 6px">
                        <button class="btn btn-ghost btn-sm" data-tooltip="View" (click)="view(r)"><span [appIcon]="'eye'"></span></button>
                        <button class="btn btn-ghost btn-sm" data-tooltip="Download" (click)="downloadMyDoc(r)"><span [appIcon]="'download'"></span></button>
                        <button class="btn btn-ghost btn-sm" data-tooltip="Delete" style="color: var(--danger)" (click)="deleteMyDoc(r)"><span [appIcon]="'trash'"></span></button>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      @if (tab() === 'company') {
        <div class="card">
          <div class="card-body">
            @for (d of companyDocs(); track d.name) {
              <div style="display: flex; align-items: center; gap: 8px; padding: 12px 0; border-bottom: 1px solid var(--border)">
                <div style="width: 40px; height: 40px; border-radius: 10px; background: var(--p-soft); display: flex; align-items: center; justify-content: center; color: var(--p)">
                  <span [appIcon]="'documents'"></span>
                </div>
                <div style="flex: 1">
                  <div style="font-size: 14px; font-weight: 600; margin-bottom: 4px">{{ d.name }}</div>
                  <div style="font-size: 13px; color: var(--muted)">{{ d.size }} · {{ d.date }}</div>
                </div>
                <button class="btn btn-ghost btn-sm" data-tooltip="Download" (click)="downloadCompanyDoc(d)"><span [appIcon]="'download'"></span></button>
              </div>
            }
          </div>
        </div>
      }
    </div>

    <!-- Upload Document Modal -->
    <div class="modal-overlay" [class.open]="ui.isOpen('empDocUploadModal')" (click)="ui.onOverlayClick($event, 'empDocUploadModal')">
      <div class="modal" style="max-width: 550px">
        <div class="modal-header">
          <div style="font-size: 15px; font-weight: 700">Upload Document</div>
          <button class="btn btn-ghost btn-sm" (click)="closeUploadModal()"><span [appIcon]="'x'"></span></button>
        </div>
        <div class="modal-body" style="overflow: visible">
          <div class="form-group" style="margin-bottom: 14px">
            <label class="form-label">Document Type</label>
            <app-select [options]="uploadTypeOptions" [value]="uploadType()" (valueChange)="uploadType.set($event)" width="100%" />
          </div>

          <div class="form-group" style="margin-bottom: 14px">
            <label class="form-label">Document Title (Optional)</label>
            <input class="form-control" [placeholder]="uploadType() + ' Document'" [value]="customDocName()" (input)="customDocName.set($any($event.target).value)" />
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px">
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
            <label class="form-label">Document File</label>
            <input #empDocFileInput type="file" [accept]="acceptDocTypes" (change)="onFileSelected($event)" style="display: none" />
            <div
              style="border: 2px dashed var(--border); border-radius: 8px; padding: 24px; text-align: center; cursor: pointer; transition: 0.2s"
              [style.borderColor]="selectedFile() ? 'var(--p)' : 'var(--border)'"
              [style.background]="selectedFile() ? 'var(--p-soft)' : 'var(--bg)'"
              (click)="empDocFileInput.click()"
              (dragover)="$event.preventDefault()"
              (drop)="onFileDrop($event)"
            >
              @if (selectedFile()) {
                <div style="color: var(--p); font-size: 26px; margin-bottom: 6px"><span [appIcon]="'check'"></span></div>
                <div style="font-size: 0.9rem; font-weight: 700; color: var(--text)">{{ selectedFile()?.name }}</div>
                <div style="font-size: 0.78rem; color: var(--muted); margin-top: 3px">{{ formatFileSize(selectedFile()?.size || 0) }} &bull; Click to change file</div>
              } @else {
                <div style="color: var(--p); font-size: 26px; margin-bottom: 6px"><span [appIcon]="'upload2'"></span></div>
                <div style="font-size: 0.88rem; font-weight: 600">Drop file here or click to browse</div>
                <div style="font-size: 0.75rem; color: var(--muted); margin-top: 4px">PDF, JPG, PNG up to 2MB</div>
              }
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" (click)="closeUploadModal()">Cancel</button>
          <button class="btn btn-primary" [disabled]="uploading() || !selectedFile()" (click)="executeUpload()">
            {{ uploading() ? 'Uploading...' : 'Upload Document' }}
          </button>
        </div>
      </div>
    </div>

    <!-- View Document Modal -->
    <div class="modal-overlay" [class.open]="ui.isOpen('docModal')" (click)="ui.onOverlayClick($event, 'docModal')">
      <div class="modal" style="max-width: 700px">
        <div class="modal-header">
          <div>
            <div class="card-title" style="font-size: 14px">{{ viewTarget()?.doc }} · Details</div>
            <div class="card-subtitle">{{ viewTarget()?.type }} Document</div>
          </div>
          <button class="btn btn-ghost btn-sm" (click)="ui.close('docModal')"><span [appIcon]="'x'"></span></button>
        </div>
        @if (viewTarget(); as r) {
          <div class="modal-body">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px;">
              @for (f of fields(r); track f[0]) {
                <div style="background: var(--bg); border-radius: 8px; padding: 10px">
                  <div style="font-size: 11px; color: var(--muted); font-weight: 600; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.04em">
                    {{ f[0] }}
                  </div>
                  <div style="font-size: 13px; font-weight: 400; color: var(--text)">{{ f[1] }}</div>
                </div>
              }
            </div>

            @if (r.fileUrl && (r.fileUrl.startsWith('data:image') || r.fileUrl.includes('.jpg') || r.fileUrl.includes('.jpeg') || r.fileUrl.includes('.png') || r.fileUrl.includes('.webp') || r.fileUrl.includes('/image/'))) {
              <div style="text-align: center; background: #0f172a; border-radius: 8px; padding: 12px; margin-bottom: 12px; max-height: 240px; overflow: hidden;">
                <img [src]="r.fileUrl" alt="Document Preview" style="max-height: 220px; max-width: 100%; object-fit: contain; border-radius: 6px;" />
              </div>
            } @else if (r.fileUrl) {
              <div style="border: 1px dashed var(--border); border-radius: 8px; padding: 16px; text-align: center; background: var(--bg); margin-bottom: 12px;">
                <div style="color: var(--p); font-size: 24px; margin-bottom: 4px"><span [appIcon]="'documents'"></span></div>
                <div style="font-size: 13px; font-weight: 600">{{ r.doc }}</div>
                <div style="font-size: 11px; color: var(--muted); margin-top: 2px">File attached &bull; Click download below to view</div>
              </div>
            }
          </div>
          <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">
            <button class="btn btn-outline" style="color: var(--danger); border-color: rgba(239, 68, 68, 0.3); display: flex; align-items: center; gap: 6px;" (click)="deleteMyDoc(r); ui.close('docModal')">
              <span [appIcon]="'trash'"></span> Delete
            </button>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-outline" (click)="ui.close('docModal')">Close</button>
              <button class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 6px;" (click)="downloadMyDoc(r)">
                <span [appIcon]="'download'"></span> Download Document
              </button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      @media (max-width: 480px) {
        .col-hide {
          display: none;
        }
      }
    `,
  ],
})
export class EmpDocumentsComponent implements OnInit {
  protected readonly ui = inject(UiService);
  protected readonly toast = inject(ToastService);
  private readonly api = inject(ApiService);

  protected readonly tab = signal<'my' | 'company'>('my');
  protected readonly viewTarget = signal<DocRow | null>(null);

  protected readonly docs = signal<DocRow[]>([]);
  protected readonly companyDocs = signal<CompanyDoc[]>([]);

  protected readonly currentEmpId = signal<string | null>(null);
  protected readonly currentEmpName = signal<string>('Employee');
  protected readonly currentEmpCode = signal<string>('EMP');

  // ── Upload Document State ──
  protected readonly selectedFile = signal<File | null>(null);
  protected readonly uploading = signal(false);
  protected readonly uploadType = signal('Passport');
  protected readonly customDocName = signal('');
  protected readonly uploadIssueDate = signal(new Date().toISOString().slice(0, 10));
  protected readonly uploadExpiryDate = signal('');

  protected readonly uploadTypeOptions: SelectOption[] = [
    'Passport',
    'Visa',
    'Work Permit',
    'Emirates ID',
    'Medical Insurance',
    'Driving License',
    'Degree Certificate',
    'Other',
  ].map((t) => ({ v: t, l: t }));

  ngOnInit(): void {
    this.api.employeeMe().subscribe({
      next: (employee) => {
        this.currentEmpId.set(employee.id);
        this.currentEmpName.set(employee.fullName || `${employee.firstName} ${employee.lastName}`);
        this.currentEmpCode.set(employee.employeeCode || 'EMP');
        this.loadMyDocuments(employee.id);
      },
      error: () => {
        /* API offline — no personal documents. */
      },
    });

    this.api.documents().subscribe({
      next: (rows) =>
        this.companyDocs.set(
          rows
            .filter((row) => row.isCompanyDocument)
            .map((row) => ({ name: row.name, size: row.fileSize ?? '—', date: row.issueDate ?? '—', fileUrl: row.fileUrl ?? null })),
        ),
      error: () => {
        /* API offline — no company documents. */
      },
    });
  }

  protected openUploadModal(): void {
    this.selectedFile.set(null);
    this.customDocName.set('');
    this.uploadType.set('Passport');
    this.uploadIssueDate.set(new Date().toISOString().slice(0, 10));
    this.uploadExpiryDate.set('');
    this.ui.open('empDocUploadModal');
  }

  protected closeUploadModal(): void {
    this.selectedFile.set(null);
    this.customDocName.set('');
    this.ui.close('empDocUploadModal');
  }

  protected readonly acceptDocTypes = ACCEPT_DOC_TYPES;

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      const check = validateDocumentFile(file);
      if (!check.valid) {
        this.toast.show(check.error || 'Invalid file.', 'danger');
        input.value = '';
        this.selectedFile.set(null);
        return;
      }
      this.selectedFile.set(file);
    }
  }

  protected onFileDrop(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      const file = event.dataTransfer.files[0];
      const check = validateDocumentFile(file);
      if (!check.valid) {
        this.toast.show(check.error || 'Invalid file.', 'danger');
        return;
      }
      this.selectedFile.set(file);
    }
  }

  protected formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  protected executeUpload(): void {
    const employeeId = this.currentEmpId();
    if (!employeeId) {
      this.toast.show('Employee profile is still loading.', 'danger');
      return;
    }

    const file = this.selectedFile();
    if (!file) {
      this.toast.show('Please select a file to upload.', 'warning');
      return;
    }

    const type = this.uploadType();
    const documentType = type === 'Visa' || type === 'Work Permit'
      ? 'Legal'
      : type === 'Medical Insurance'
        ? 'Benefits'
        : type === 'Other'
          ? 'Other'
          : 'Identity';

    const docName = this.customDocName().trim() || file.name || `${type} Document`;
    const fileSize = this.formatFileSize(file.size);

    this.uploading.set(true);

    const saveDocumentRecord = (url: string | null, size: string) => {
      this.api
        .createDocument({
          employeeId,
          name: docName,
          type: documentType,
          issueDate: this.uploadIssueDate() || new Date().toISOString().slice(0, 10),
          expiryDate: this.uploadExpiryDate() || null,
          notes: null,
          fileUrl: url,
          fileSize: size,
          isCompanyDocument: false,
        })
        .subscribe({
          next: () => {
            this.uploading.set(false);
            this.closeUploadModal();
            this.toast.show('Document uploaded successfully!', 'success');
            this.loadMyDocuments(employeeId);
          },
          error: (error) => {
            this.uploading.set(false);
            this.toast.show(error?.error?.title ?? error?.error?.message ?? 'Could not upload the document.', 'danger');
          },
        });
    };

    // 1. Physically upload file via storage API
    this.api.uploadFile(file).subscribe({
      next: (uploadRes) => {
        saveDocumentRecord(uploadRes.url, uploadRes.size || fileSize);
      },
      error: () => {
        // Fallback: Read as base64 data URL if storage API is unreachable
        const reader = new FileReader();
        reader.onload = () => saveDocumentRecord(reader.result as string, fileSize);
        reader.onerror = () => {
          this.uploading.set(false);
          this.toast.show('Failed to read document file.', 'danger');
        };
        reader.readAsDataURL(file);
      },
    });
  }

  private loadMyDocuments(employeeId: string): void {
    this.api.documents({ employeeId }).subscribe({
      next: (rows) => this.docs.set(rows.map((row) => this.toRow(row))),
      error: () => {
        /* API offline — no personal documents. */
      },
    });
  }

  private toRow(row: DocumentDto): DocRow {
    return {
      id: row.id,
      doc: row.name,
      type: row.type,
      iss: row.issueDate ?? ' · ',
      exp: row.expiryDate ?? ' · ',
      s: row.status,
      num: row.documentNumber ?? '—',
      issuedBy: row.issuedBy ?? '—',
      notes: row.notes ?? '—',
      fileUrl: row.fileUrl ?? null,
      fileSize: row.fileSize ?? null,
    };
  }

  protected deleteMyDoc(r: DocRow): void {
    if (!r.id) return;
    if (confirm(`Are you sure you want to delete "${r.doc}"?`)) {
      this.api.deleteDocument(r.id).subscribe({
        next: () => {
          this.toast.show(`Deleted "${r.doc}" successfully!`, 'success');
          const empId = this.currentEmpId();
          if (empId) {
            this.loadMyDocuments(empId);
          }
        },
        error: () => this.toast.show('Could not delete document.', 'danger'),
      });
    }
  }

  protected downloadMyDoc(r: DocRow): void {
    triggerDocumentDownload(r.doc, r.fileUrl, {
      employeeName: this.currentEmpName(),
      employeeCode: this.currentEmpCode(),
      issueDate: r.iss,
      expiryDate: r.exp,
      status: r.s,
      type: r.type,
    });
    this.toast.show(`Downloaded ${r.doc}`, 'success');
  }

  protected downloadCompanyDoc(d: CompanyDoc): void {
    triggerDocumentDownload(d.name, d.fileUrl, {
      employeeName: 'All Employees',
      employeeCode: 'COMPANY',
      issueDate: d.date,
      status: 'Active',
      type: 'Company Policy',
    });
    this.toast.show(`Downloaded ${d.name}`, 'success');
  }

  protected fields(r: DocRow): [string, string][] {
    return [
      ['Document', r.doc],
      ['Type', r.type],


      ['Issue Date', r.iss],
      ['Expiry', r.exp],
      ['Status', r.s],

    ];
  }

  protected view(r: DocRow): void {
    this.viewTarget.set(r);
    this.ui.open('docModal');
  }
}
