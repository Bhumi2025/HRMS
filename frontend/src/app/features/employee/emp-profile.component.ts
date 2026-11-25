import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../core/api/api.service';
import { EmployeeDetail } from '../../core/api/api.models';
import { IconDirective } from '../../core/icons/icon.directive';
import { ToastService } from '../../core/services/toast.service';
import { UiService } from '../../core/services/ui.service';
import { CurrencyService } from '../../core/services/currency.service';
import { SelectComponent, SelectOption } from '../../shared/select.component';
import { KeyGroupSelectComponent } from '../../shared/key-select.component';
import { TablePaginationComponent, paginateSlice } from '../../shared/table-pagination.component';
import { triggerDocumentDownload } from '../../core/utils/document-download.util';
import { ACCEPT_DOC_TYPES, ACCEPT_IMG_TYPES, validateDocumentFile, validateImageFile } from '../../core/utils/file-validator';

interface DocRow {
  id?: string;
  doc: string;
  type: string;
  issue: string;
  exp: string;
  s: string;
  fileUrl?: string | null;
  fileSize?: string | null;
}

/**
 * My Profile (employee) — ported from pages/emp-profile.html. The original's
 * hand-rolled calendar widget is replaced with native date inputs.
 */
@Component({
  selector: 'app-emp-profile',
  imports: [CommonModule, IconDirective, SelectComponent, KeyGroupSelectComponent, TablePaginationComponent],
  template: `
    <!-- Banner -->
    <div
      style="background: var(--p-soft); border-radius: 16px; padding: 15px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; gap: 16px; flex-wrap: wrap; border: 1px solid var(--p-mid)"
    >
      <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap">
        <div style="position: relative">
          <input #avatarInput type="file" [accept]="acceptImgTypes" (change)="onAvatarSelected($event)" style="display: none" />
          <div
            style="width: 72px; height: 72px; border-radius: 50%; background: var(--p); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; font-weight: 800; border: 3px solid var(--surface); box-shadow: 0 4px 16px rgba(37,99,235,.2); overflow: hidden"
          >
            @if (avatarUrl()) {
              <img [src]="avatarUrl()" alt="Avatar" style="width: 100%; height: 100%; object-fit: cover" />
            } @else {
              {{ initials() }}
            }
          </div>
          <div
            (click)="avatarInput.click()"
            title="Upload photo"
            style="position: absolute; bottom: 2px; right: -4px; width: 22px; height: 22px; border-radius: 50%; background: var(--p); display: flex; align-items: center; justify-content: center; cursor: pointer; border: 2px solid var(--surface); box-shadow: 0 2px 6px rgba(37,99,235,.35)"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </div>
        </div>
        <div>
          <div style="font-size: 1.2rem; font-weight: 700; color: var(--text); margin-bottom: 2px">{{ displayName() }}</div>
          <div style="font-size: 13px; color: var(--muted); margin-bottom: 8px">{{ job().title }}{{ job().dept ? ' · ' + job().dept : '' }}{{ detail()?.employeeCode ? ' · ' + detail()?.employeeCode : '' }}</div>
          <div style="display: flex; gap: 5px; flex-wrap: wrap; justify-content: flex-start">
            <span style="display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 20px; background: var(--success-soft); color: var(--success); border: 1px solid rgba(34,197,94,.3)">
              <span style="width: 6px; height: 6px; border-radius: 50%; background: var(--success); display: inline-block"></span>Active
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="ptabs">
      @for (t of tabs; track t.id) {
        <button class="ptab" [class.active]="tab() === t.id" (click)="tab.set(t.id)">
          <span [appIcon]="t.icon"></span> {{ t.label }}
        </button>
      }
    </div>

    <!-- PERSONAL -->
    @if (tab() === 'personal') {
      <div class="grid-2">
        <div class="card" style="overflow: visible">
          <div class="card-header"><div class="card-title">Personal Details</div></div>
          <div class="card-body" style="overflow: visible">
            <div class="form-grid-salutation">
              <div class="form-group">
                <label class="form-label">Salutation</label>
                <app-select [options]="salutationOptions" [value]="personal().salutation" [disabled]="true" width="100%" />
              </div>
              <div class="form-group">
                <label class="form-label">First Name</label>
                <input class="form-control" [value]="personal().firstName" disabled placeholder="First Name" />
              </div>
            </div>

            <div class="form-grid-2">
              <div class="form-group">
                <label class="form-label">Middle Name</label>
                <input class="form-control" [value]="personal().middleName" disabled placeholder="Middle Name" />
              </div>
              <div class="form-group">
                <label class="form-label">Last Name</label>
                <input class="form-control" [value]="personal().lastName" disabled placeholder="Last Name" />
              </div>
            </div>

            <div class="form-grid-2">
              <div class="form-group">
                <label class="form-label">Personal Email</label>
                <input class="form-control" type="email" [value]="personal().email" disabled placeholder="Personal Email" />
              </div>
              <div class="form-group">
                <label class="form-label">Contact Number</label>
                <input class="form-control" type="tel" [value]="personal().phone" disabled placeholder="Contact Number" />
              </div>
            </div>

            <div class="form-grid-2">
              <div class="form-group">
                <label class="form-label">Date of Birth</label>
                <input class="form-control" type="date" [value]="personal().dob" disabled />
              </div>
              <div class="form-group">
                <label class="form-label">Gender</label>
                <app-key-select groupCode="GENDER" [value]="personal().gender" [disabled]="true" width="100%" />
              </div>
            </div>

            <div class="form-grid-2">
              <div class="form-group">
                <label class="form-label">Marital Status</label>
                <app-key-select groupCode="MARITAL_STATUS" [value]="personal().marital" [disabled]="true" width="100%" />
              </div>
              <div class="form-group">
                <label class="form-label">Blood Group</label>
                <app-key-select groupCode="BLOOD_GROUP" [value]="personal().blood" [disabled]="true" width="100%" />
              </div>
            </div>
          </div>
        </div>
        <div class="card" style="overflow: visible">
          <div class="card-header"><div class="card-title">Job Information</div></div>
          <div class="card-body" style="overflow: visible">
            <div class="form-group">
              <label class="form-label">Employee ID</label>
              <input class="form-control" [value]="detail()?.employeeCode || ''" disabled style="background: var(--bg); color: var(--muted)" />
            </div>
            <div class="form-group">
              <label class="form-label">Job Title</label>
              <input class="form-control" [value]="job().title" disabled />
            </div>
            <div class="form-group">
              <label class="form-label">Department</label>
              <app-select [options]="deptOptions" [value]="job().dept" [disabled]="true" width="100%" />
            </div>
            <div class="form-group">
              <label class="form-label">Join Date</label>
              <input class="form-control" type="date" [value]="job().joinDate" disabled />
            </div>
          </div>
        </div>
      </div>
    }

    <!-- CONTACT -->
    @if (tab() === 'contact') {
      <div class="card" style="overflow: visible">
        <div class="card-header"><div class="card-title">Contact Information</div></div>
        <div class="card-body" style="overflow: visible">
          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">Email</label>
              <input class="form-control" type="email" [value]="personal().email" disabled placeholder="Email Address" />
            </div>
            <div class="form-group">
              <label class="form-label">Password</label>
              <div class="profile-pwd-box">
                <span class="profile-pwd-icon" [appIcon]="'lock'"></span>
                <input
                  class="form-control profile-pwd-input"
                  [type]="showContactPassword() ? 'text' : 'password'"
                  [value]="personal().password"
                  disabled
                  [placeholder]="hasStoredPassword() && !personal().password ? 'Password set (change password to sync)' : 'Password'"
                />
                <button
                  type="button"
                  class="profile-pwd-toggle"
                  (click)="showContactPassword.set(!showContactPassword())"
                  [title]="showContactPassword() ? 'Hide password' : 'Show password'"
                >
                  <span [appIcon]="showContactPassword() ? 'eye_off' : 'eye'"></span>
                </button>
              </div>
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">Emergency Contact Name</label>
              <input class="form-control" [value]="contact().emergencyName" (input)="patchContact('emergencyName', $any($event.target).value)" placeholder="Emergency Contact Name" />
            </div>
            <div class="form-group">
              <label class="form-label">Emergency Contact Phone</label>
              <input class="form-control" type="tel" [value]="contact().emergencyPhone" (input)="patchContact('emergencyPhone', $any($event.target).value)" placeholder="Emergency Contact Phone" />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Address Line 1 (House No. / Street Name & City)</label>
            <input class="form-control" [value]="contact().addressLine1" (input)="patchContact('addressLine1', $any($event.target).value)" placeholder="House / Flat No., Street, City (e.g., Surat, Ahmedabad, Mumbai)" />
          </div>

          <div class="form-group">
            <label class="form-label">Address Line 2 (PIN / Zip Code)</label>
            <input class="form-control" [value]="contact().addressLine2" (input)="patchContact('addressLine2', $any($event.target).value)" placeholder="PIN code or Zip code (e.g., 395007)" />
          </div>

          <div class="form-group">
            <label class="form-label">Address Line 3 (State & Country)</label>
            <input class="form-control" [value]="contact().addressLine3" (input)="patchContact('addressLine3', $any($event.target).value)" placeholder="State, Country (e.g., Gujarat, India)" />
          </div>
        </div>
      </div>

      <div class="form-footer" style="margin-top: 16px;">
        <button class="btn btn-outline btn-sm" (click)="load()">Cancel</button>
        <button class="btn btn-primary btn-sm" (click)="save('Contact information saved!')"><span [appIcon]="'check'"></span> Save</button>
      </div>
    }

    <!-- BANK -->
    @if (tab() === 'bank') {
      <div class="grid-2">
        <div class="card" style="overflow: visible">
          <div class="card-header"><div class="card-title">Bank Details</div></div>
          <div class="card-body" style="overflow: visible">
            <div class="form-group">
              <label class="form-label">Bank Name</label>
              <app-select [options]="bankOptions" [value]="bank().bankName" [disabled]="true" width="100%" />
            </div>
            <div class="form-group">
              <label class="form-label">Bank Account Name</label>
              <input class="form-control" [value]="bank().accountName" disabled />
            </div>
            <div class="form-group">
              <label class="form-label">Account No</label>
              <input class="form-control" [value]="bank().accountNo" disabled />
            </div>
            <div class="form-group">
              <label class="form-label">IBAN</label>
              <input class="form-control" [value]="bank().iban" disabled />
            </div>
            <div class="form-group">
              <label class="form-label">IFSC Code</label>
              <input class="form-control" [value]="bank().ifsc" disabled />
            </div>
            <div class="form-group">
              <label class="form-label">Swift Code</label>
              <input class="form-control" [value]="bank().swift" disabled />
            </div>
            <div class="form-group">
              <label class="form-label">Currency</label>
              <app-select [options]="currencyOptions" [value]="bank().currency" [disabled]="true" width="100%" />
            </div>
            <div class="form-group">
              <label class="form-label">Payment Mode</label>
              <app-key-select groupCode="PAYMENT_MODE" [value]="bank().paymentMode" [disabled]="true" width="100%" />
            </div>
            <div class="form-group">
              <label class="form-label">WPS ID</label>
              <input class="form-control" [value]="bank().wpsId" disabled />
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Salary Structure</div></div>
          <div class="card-body">
            <div style="margin-bottom: 14px">
              <div style="font-size: 1.4rem; font-weight: 800; color: var(--p)">{{ grossMonthlySalary() }}</div>
              <div style="font-size: 13px; color: var(--muted)">Gross Monthly Salary</div>
            </div>
            @for (s of salaryStructure(); track s[0]) {
              <div style="display: flex; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid var(--border)">
                <span style="font-size: 13px; color: var(--muted)">{{ s[0] }}</span>
                <span style="font-size: 13px; font-weight: 700" [style.color]="s[2]">{{ s[1] }}</span>
              </div>
            }
          </div>
        </div>
      </div>
    }

    <!-- DOCUMENTS -->
    @if (tab() === 'docs') {
      <div class="card">
        <div class="card-header">
          <div class="card-title">My Documents</div>
          <button class="btn btn-primary btn-sm" (click)="ui.open('empUploadDocModal')"><span [appIcon]="'upload2'"></span> Upload</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Type</th>
                <th>Issue Date</th>
                <th>Expiry Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (r of paginatedDocs(); track r.doc) {
                <tr>
                  <td style="font-weight: 600">{{ r.doc }}</td>
                  <td><span class="badge badge-info">{{ r.type }}</span></td>
                  <td><input class="form-control" type="date" [value]="r.issue" (input)="r.issue = $any($event.target).value" style="padding: 4px 8px; font-size: 12px" /></td>
                  <td><input class="form-control" type="date" [value]="r.exp" (input)="r.exp = $any($event.target).value" style="padding: 4px 8px; font-size: 12px" /></td>
                  <td><span class="badge badge-success">{{ r.s }}</span></td>
                  <td>
                    <div style="display: flex; gap: 4px">
                      <button class="btn btn-ghost btn-sm" data-tooltip="View" (click)="viewDoc(r)"><span [appIcon]="'eye'"></span></button>
                      <button class="btn btn-ghost btn-sm" data-tooltip="Download" (click)="downloadDocument(r)"><span [appIcon]="'download'"></span></button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <app-table-pagination [total]="docs().length" [page]="docsPage()" (pageChange)="docsPage.set($event)" />
      </div>
    }

    <!-- Upload Doc Modal -->
    <div class="modal-overlay" [class.open]="ui.isOpen('empUploadDocModal')" (click)="ui.onOverlayClick($event, 'empUploadDocModal')">
      <div class="modal">
        <div class="modal-header">
          <div style="font-size: 14px; font-weight: 700">Upload Document</div>
          <button class="btn btn-ghost btn-sm" (click)="ui.close('empUploadDocModal')"><span [appIcon]="'x'"></span></button>
        </div>
        <div class="modal-body" style="overflow: visible">
          <div class="form-group">
            <label class="form-label">Document Type</label>
            <app-select [options]="uploadTypeOptions" [value]="uploadType()" (valueChange)="uploadType.set($event)" width="100%" />
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
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
            <input #empFileInput type="file" [accept]="acceptDocTypes" (change)="onDocFileSelected($event)" style="display: none" />
            <div
              style="border: 2px dashed var(--border); border-radius: var(--r); padding: 24px; text-align: center; cursor: pointer; transition: var(--t)"
              [style.borderColor]="selectedDocFile() ? 'var(--p)' : 'var(--border)'"
              [style.background]="selectedDocFile() ? 'var(--p-soft)' : 'transparent'"
              (click)="empFileInput.click()"
              (dragover)="$event.preventDefault()"
              (drop)="onDocFileDrop($event)"
            >
              @if (selectedDocFile()) {
                <div style="color: var(--p); margin-bottom: 6px"><span [appIcon]="'check'"></span></div>
                <div style="font-size: 0.9rem; font-weight: 700; color: var(--text)">{{ selectedDocFile()?.name }}</div>
                <div style="font-size: 0.78rem; color: var(--muted); margin-top: 3px">{{ formatFileSize(selectedDocFile()?.size || 0) }} &bull; Click to change file</div>
              } @else {
                <div style="color: var(--p); margin-bottom: 6px"><span [appIcon]="'upload2'"></span></div>
                <div style="font-size: 0.86rem; font-weight: 600">Drop file or click to browse</div>
                <div style="font-size: 0.75rem; color: var(--muted); margin-top: 4px">PDF, JPG, PNG up to 2MB</div>
              }
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" (click)="closeUploadDocModal()">Cancel</button>
          <button class="btn btn-primary" [disabled]="uploadingDoc()" (click)="uploadDocument()">
            {{ uploadingDoc() ? 'Uploading...' : 'Upload' }}
          </button>
        </div>
      </div>
    </div>

    <!-- View Document Modal -->
    <div class="modal-overlay" [class.open]="ui.isOpen('viewDocModal')" (click)="ui.onOverlayClick($event, 'viewDocModal')">
      <div class="modal" style="max-width: 650px;">
        <div class="modal-header">
          <div>
            <div style="font-size: 15px; font-weight: 700;">{{ selectedDocView()?.doc }}</div>
            <div style="font-size: 12px; color: var(--muted);">Document Details & Verification</div>
          </div>
          <button class="btn btn-ghost btn-sm" (click)="ui.close('viewDocModal')"><span [appIcon]="'x'"></span></button>
        </div>
        <div class="modal-body">
          @if (selectedDocView(); as d) {
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
              <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px;">
                <div style="font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase;">Document Type</div>
                <div style="font-size: 13px; font-weight: 600; margin-top: 2px;">{{ d.type }}</div>
              </div>
              <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px;">
                <div style="font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase;">Status</div>
                <div style="font-size: 13px; font-weight: 600; margin-top: 2px;">
                  <span class="badge" [class]="d.s === 'Expired' ? 'badge-danger' : 'badge-success'">{{ d.s }}</span>
                </div>
              </div>
              <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px;">
                <div style="font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase;">Issue Date</div>
                <div style="font-size: 13px; font-weight: 600; margin-top: 2px;">{{ d.issue || 'Not set' }}</div>
              </div>
              <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px;">
                <div style="font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase;">Expiry Date</div>
                <div style="font-size: 13px; font-weight: 600; margin-top: 2px;">{{ d.exp || 'Not set' }}</div>
              </div>
            </div>

            @if (d.fileUrl && (d.fileUrl.startsWith('data:image') || d.fileUrl.endsWith('.jpg') || d.fileUrl.endsWith('.jpeg') || d.fileUrl.endsWith('.png'))) {
              <div style="text-align: center; background: #0f172a; border-radius: 8px; padding: 12px; margin-bottom: 12px; max-height: 240px; overflow: hidden;">
                <img [src]="d.fileUrl" alt="Document Preview" style="max-height: 220px; max-width: 100%; object-fit: contain; border-radius: 6px;" />
              </div>
            } @else {
              <div style="border: 2px dashed var(--border); border-radius: 10px; padding: 24px; text-align: center; background: var(--bg); margin-bottom: 12px;">
                <div style="color: var(--p); font-size: 28px; margin-bottom: 6px;"><span [appIcon]="'documents'"></span></div>
                <div style="font-size: 14px; font-weight: 700; color: var(--text);">{{ d.doc }}</div>
                <div style="font-size: 12px; color: var(--muted); margin-top: 4px;">Verified HR Document &bull; Ready for Download</div>
              </div>
            }
          }
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" (click)="ui.close('viewDocModal')">Close</button>
          <button class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 6px;" (click)="selectedDocView() && downloadDocument(selectedDocView()!)">
            <span [appIcon]="'download'"></span> Download Document
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .ptabs {
        display: flex;
        gap: 0;
        margin-bottom: 20px;
        border-bottom: 2px solid var(--border);
        overflow-x: auto;
        scrollbar-width: none;
      }
      .ptabs::-webkit-scrollbar {
        display: none;
      }
      .ptab {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 8px 14px;
        font-size: 14px;
        font-weight: 600;
        color: var(--muted);
        cursor: pointer;
        border-bottom: 3px solid transparent;
        margin-bottom: -2px;
        transition: 0.2s;
        background: none;
        border-top: none;
        border-left: none;
        border-right: none;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .ptab:hover {
        color: var(--p);
      }
      .ptab.active {
        color: var(--p);
        border-bottom-color: var(--p);
      }
      .form-footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 16px;
        padding-top: 12px;
        border-top: 1px solid var(--border);
      }
      .form-grid-2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      .form-grid-salutation {
        display: grid;
        grid-template-columns: 130px 1fr;
        gap: 12px;
      }
      .profile-pwd-box {
        position: relative;
        display: flex;
        align-items: center;
        width: 100%;
      }
      .profile-pwd-icon {
        position: absolute;
        left: 12px;
        top: 50%;
        transform: translateY(-50%);
        color: #2563eb;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        z-index: 2;
      }
      .profile-pwd-icon svg {
        width: 16px;
        height: 16px;
      }
      .profile-pwd-input {
        width: 100%;
        padding-left: 36px !important;
        padding-right: 38px !important;
        background: #f8fafc;
        border: 1px solid var(--border);
        border-radius: 12px;
        font-size: 14px;
        color: var(--text);
        transition: var(--t);
      }
      .profile-pwd-input:focus {
        background: #fff;
        border-color: #2563eb;
        box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12);
      }
      .profile-pwd-toggle {
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        background: transparent;
        border: none;
        color: #64748b;
        cursor: pointer;
        padding: 4px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        z-index: 2;
        transition: color 0.15s ease;
      }
      .profile-pwd-toggle:hover {
        color: #2563eb;
      }
      .profile-pwd-toggle svg {
        width: 16px;
        height: 16px;
      }
      @media (max-width: 768px) {
        .grid-2 {
          grid-template-columns: 1fr !important;
        }
        .form-grid-2,
        .form-grid-salutation {
          grid-template-columns: 1fr !important;
        }
        .form-footer {
          flex-wrap: wrap;
        }
        .ptab {
          font-size: 13px;
          padding: 8px 10px;
        }
      }
    `,
  ],
})
export class EmpProfileComponent implements OnInit {
  protected readonly ui = inject(UiService);
  protected readonly toast = inject(ToastService);
  private readonly api = inject(ApiService);
  protected readonly currencyService = inject(CurrencyService);

  protected readonly detail = signal<EmployeeDetail | null>(null);
  private readonly apiId = signal<string | null>(null);
  private departmentIds = new Map<string, string>();

  protected readonly avatarUrl = signal<string | null>(null);
  protected readonly selectedDocFile = signal<File | null>(null);
  protected readonly uploadIssueDate = signal(new Date().toISOString().slice(0, 10));
  protected readonly uploadExpiryDate = signal('');
  protected readonly uploadingDoc = signal(false);

  protected readonly displayName = computed(() => {
    const p = this.personal();
    const parts = [p.salutation, p.firstName, p.middleName, p.lastName].filter((s) => !!s && !!s.trim());
    if (parts.length > 0) return parts.join(' ');
    return this.detail()?.fullName || 'Employee Profile';
  });

  protected initials(): string {
    const p = this.personal();
    const f = p.firstName || this.detail()?.firstName || '';
    const l = p.lastName || this.detail()?.lastName || '';
    const initials = `${f.slice(0, 1)}${l.slice(0, 1)}`.toUpperCase();
    return initials || 'EP';
  }

  protected readonly acceptDocTypes = ACCEPT_DOC_TYPES;
  protected readonly acceptImgTypes = ACCEPT_IMG_TYPES;

  protected onAvatarSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const check = validateImageFile(file);
      if (!check.valid) {
        this.toast.show(check.error || 'Invalid image file.', 'danger');
        input.value = '';
        return;
      }

      // First upload file to persistent server storage
      this.api.uploadFile(file).subscribe({
        next: (res) => {
          const photoUrl = res.url || res.cloudinaryUrl || '';
          if (photoUrl) {
            this.avatarUrl.set(photoUrl);
            this.api.updateMyPhoto(photoUrl).subscribe({
              next: () => {
                this.toast.show('Profile photo saved successfully!', 'success');
              },
              error: () => {
                this.toast.show('Photo uploaded, but could not update profile.', 'danger');
              },
            });
          }
        },
        error: () => {
          // Fallback to Base64 data URL
          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUrl = e.target?.result as string;
            this.avatarUrl.set(dataUrl);
            this.api.updateMyPhoto(dataUrl).subscribe({
              next: () => {
                this.toast.show('Profile photo saved successfully!', 'success');
              },
              error: () => {
                this.toast.show('Could not save profile photo to server.', 'danger');
              },
            });
          };
          reader.readAsDataURL(file);
        },
      });
    }
  }

  protected onDocFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      const check = validateDocumentFile(file);
      if (!check.valid) {
        this.toast.show(check.error || 'Invalid file.', 'danger');
        input.value = '';
        this.selectedDocFile.set(null);
        return;
      }
      this.selectedDocFile.set(file);
    }
  }

  protected onDocFileDrop(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      const file = event.dataTransfer.files[0];
      const check = validateDocumentFile(file);
      if (!check.valid) {
        this.toast.show(check.error || 'Invalid file.', 'danger');
        return;
      }
      this.selectedDocFile.set(file);
    }
  }

  protected formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  protected closeUploadDocModal(): void {
    this.selectedDocFile.set(null);
    this.uploadIssueDate.set(new Date().toISOString().slice(0, 10));
    this.uploadExpiryDate.set('');
    this.ui.close('empUploadDocModal');
  }

  protected uploadDocument(): void {
    const employeeId = this.apiId();
    if (!employeeId) {
      this.toast.show('Your profile is still loading.', 'danger');
      return;
    }

    const file = this.selectedDocFile();
    const type = this.uploadType();
    const documentType = type === 'Visa' || type === 'Work Permit'
      ? 'Legal'
      : type === 'Medical Insurance'
        ? 'Benefits'
        : type === 'Other'
          ? 'Other'
          : 'Identity';

    const docName = file ? file.name : `${type} Document`;
    const fileSize = file ? this.formatFileSize(file.size) : '1.2 MB';

    this.uploadingDoc.set(true);

    const executeSave = (fileUrl: string | null, size: string) => {
      this.api
        .createDocument({
          employeeId,
          name: docName,
          type: documentType,
          issueDate: this.uploadIssueDate() || new Date().toISOString().slice(0, 10),
          expiryDate: this.uploadExpiryDate() || null,
          notes: null,
          fileUrl,
          fileSize: size,
          isCompanyDocument: false,
        })
        .subscribe({
          next: () => {
            this.uploadingDoc.set(false);
            this.closeUploadDocModal();
            this.toast.show('Document uploaded successfully!', 'success');
            this.loadDocuments(employeeId);
          },
          error: (error) => {
            this.uploadingDoc.set(false);
            this.toast.show(error?.error?.title ?? error?.error?.message ?? 'Could not upload the document.', 'danger');
          },
        });
    };

    if (file) {
      this.api.uploadFile(file).subscribe({
        next: (uploadRes) => {
          executeSave(uploadRes.url, uploadRes.size || fileSize);
        },
        error: () => {
          const reader = new FileReader();
          reader.onload = () => executeSave(reader.result as string, fileSize);
          reader.onerror = () => {
            this.uploadingDoc.set(false);
            this.toast.show('Failed to read document file.', 'danger');
          };
          reader.readAsDataURL(file);
        },
      });
    } else {
      executeSave(null, fileSize);
    }
  }

  ngOnInit(): void {
    this.api.departments().subscribe({
      next: (departments) => {
        this.departmentIds = new Map(departments.map((d) => [d.name, d.id]));
      },
      error: () => {
        /* API offline — department mapping stays empty. */
      },
    });

    this.load();
  }

  private load(): void {
    this.api.employeeMe().subscribe({
      next: (employee) => {
        this.detail.set(employee);
        this.apiId.set(employee.id);
        this.hasStoredPassword.set(!!employee.password || !!employee.hasPassword);
        if (employee.facePhotoUrl) {
          this.avatarUrl.set(employee.facePhotoUrl);
        }

        this.personal.set({
          salutation: employee.salutation || (employee.gender === 'Male' ? 'Mr' : 'Miss'),
          firstName: employee.firstName || '',
          middleName: employee.middleName || '',
          lastName: employee.lastName || '',
          email: employee.email || '',
          password: employee.password ?? '',
          phone: employee.phone || '',
          dob: employee.dateOfBirth ?? '',
          gender: employee.gender,
          marital: employee.maritalStatus,
          blood: employee.bloodGroup ?? '',
        });

        this.job.set({
          title: employee.jobTitle,
          dept: employee.department,
          reportsTo: employee.reportingManager ?? '',
          joinDate: employee.joinDate,
        });

        if (employee.reportingManager && !this.reportingOptions.some((o) => o.v.toLowerCase() === employee.reportingManager?.toLowerCase())) {
          this.reportingOptions = [
            ...this.reportingOptions,
            { v: employee.reportingManager, l: employee.reportingManager },
          ];
        }

        const rawAddr = employee.address ?? '';
        let line1 = rawAddr;
        let line2 = '';
        const pinMatch = rawAddr.match(/(?:,\s*|\s*\[|\s*-\s*|\s+)PIN(?::\s*|\s+)(\d+)/i) || rawAddr.match(/\b(\d{6})\b/);
        if (pinMatch) {
          line2 = pinMatch[1] || '';
          line1 = rawAddr.replace(pinMatch[0], '').replace(/[\[\]]/g, '').trim().replace(/,\s*$/, '');
        }
        if (employee.city && !line1.toLowerCase().includes(employee.city.toLowerCase())) {
          line1 = line1 ? `${line1}, ${employee.city}` : employee.city;
        }

        const stateCountry = [employee.state, employee.country].filter(Boolean).join(', ');

        this.contact.set({
          emergencyName: employee.emergencyContactName ?? '',
          emergencyPhone: employee.emergencyContactPhone ?? '',
          addressLine1: line1,
          addressLine2: line2,
          addressLine3: stateCountry,
        });

        this.identity.set({
          passportNo: employee.passportNumber ?? '',
          passportExp: employee.passportExpiry ?? '',
          visaNo: employee.visaNumber ?? '',
          visaExp: employee.visaExpiry ?? '',
          emiratesId: employee.emiratesId ?? '',
        });

        this.bank.set({
          bankName: employee.bankName || 'Emirates NBD',
          accountName: employee.accountName || employee.fullName || '',
          accountNo: employee.accountNumber ?? '',
          iban: employee.iban ?? '',
          ifsc: employee.ifscCode ?? '',
          swift: employee.swiftCode ?? '',
          currency: employee.currency || 'AED',
          paymentMode: employee.paymentMode || 'Bank Transfer',
          wpsId: employee.wpsId ?? '',
        });

        this.loadDocuments(employee.id);
      },
      error: () => {
        this.toast.show('Could not load your profile.', 'danger');
      },
    });
  }

  private loadDocuments(employeeId: string): void {
    this.api.documents({ employeeId }).subscribe({
      next: (rows) =>
        this.docs.set(
          rows.map((d) => ({
            id: d.id,
            doc: d.name,
            type: d.type,
            issue: d.issueDate ?? '',
            exp: d.expiryDate ?? '',
            s: d.status,
            fileUrl: d.fileUrl ?? null,
            fileSize: d.fileSize ?? null,
          })),
        ),
      error: () => {
        /* API offline — no documents. */
      },
    });
  }

  protected save(message: string): void {
    const id = this.apiId();
    const detail = this.detail();
    if (!id || !detail) {
      this.toast.show('Your profile is still loading.', 'danger');
      return;
    }

    const personal = this.personal();
    const job = this.job();
    const contact = this.contact();
    const identity = this.identity();
    const bank = this.bank();

    const firstName = personal.firstName.trim() || detail.firstName;
    const middleName = personal.middleName?.trim() || null;
    const lastName = personal.lastName.trim() || detail.lastName;
    const email = (personal.email || detail.email).trim().toLowerCase();
    const phone = personal.phone || detail.phone;

    let addr = contact.addressLine1?.trim() || detail.address || null;
    let city = detail.city;
    if (contact.addressLine1?.trim()) {
      const parts = contact.addressLine1.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length > 1) {
        city = parts[parts.length - 1];
      }
    }
    if (contact.addressLine2?.trim()) {
      addr = `${addr ? addr + ', ' : ''}PIN: ${contact.addressLine2.trim()}`;
    }

    let state = detail.state;
    let country = detail.country;
    if (contact.addressLine3?.trim()) {
      const scParts = contact.addressLine3.split(',').map((p) => p.trim()).filter(Boolean);
      if (scParts.length === 1) {
        state = scParts[0];
      } else if (scParts.length >= 2) {
        state = scParts[0];
        country = scParts[1];
      }
    }

    const normalizeGender = (g: string | null | undefined): string | null => {
      if (!g || !g.trim()) return null;
      const v = g.trim().toLowerCase();
      if (v === 'male') return 'Male';
      if (v === 'female') return 'Female';
      if (v === 'other') return 'Other';
      if (v === 'prefer not to say' || v === 'prefernottosay') return 'PreferNotToSay';
      return g.trim();
    };

    const normalizeMarital = (m: string | null | undefined): string | null => {
      if (!m || !m.trim()) return null;
      const v = m.trim().toLowerCase();
      if (v === 'single') return 'Single';
      if (v === 'married') return 'Married';
      if (v === 'divorced') return 'Divorced';
      if (v === 'widowed') return 'Widowed';
      return m.trim();
    };

    const normalizePaymentMode = (p: string | null | undefined): string => {
      if (!p) return 'BankTransfer';
      const clean = p.replace(/\s+/g, '').toLowerCase();
      if (clean === 'banktransfer') return 'BankTransfer';
      if (clean === 'wps') return 'Wps';
      if (clean === 'cheque') return 'Cheque';
      if (clean === 'cash') return 'Cash';
      return 'BankTransfer';
    };

    this.api
      .updateEmployee(id, {
        salutation: personal.salutation || null,
        firstName,
        middleName,
        lastName,
        email,
        phone,
        departmentId: this.departmentIds.get(job.dept) ?? detail.departmentId,
        designationId: detail.designationId,
        branchId: detail.branchId,
        reportingManagerId: detail.reportingManagerId ?? null,
        jobTitle: job.title || detail.jobTitle,
        grade: detail.grade,
        employmentType: detail.employmentType,
        status: detail.status,
        joinDate: this.toIso(job.joinDate) ?? detail.joinDate,
        noticePeriodDays: detail.noticePeriodDays,
        basicSalary: detail.basicSalary,
        housingAllowance: detail.housingAllowance,
        transportAllowance: detail.transportAllowance,
        mobileAllowance: detail.mobileAllowance,
        otherAllowances: detail.otherAllowances,
        currency: bank.currency || detail.currency || 'AED',
        bankName: bank.bankName || detail.bankName || 'Emirates NBD',
        accountName: bank.accountName || detail.accountName || `${firstName} ${lastName}`.trim() || detail.fullName,
        accountNumber: bank.accountNo || detail.accountNumber,
        iban: bank.iban || detail.iban,
        ifscCode: bank.ifsc || detail.ifscCode,
        swiftCode: bank.swift || detail.swiftCode,
        paymentMode: normalizePaymentMode(bank.paymentMode || detail.paymentMode),
        wpsId: bank.wpsId || detail.wpsId,
        passportNumber: identity.passportNo || detail.passportNumber,
        passportExpiry: this.toIso(identity.passportExp) ?? (detail.passportExpiry ? this.toIso(detail.passportExpiry) : null),
        visaNumber: identity.visaNo || detail.visaNumber,
        visaExpiry: this.toIso(identity.visaExp) ?? (detail.visaExpiry ? this.toIso(detail.visaExpiry) : null),
        emiratesId: identity.emiratesId || detail.emiratesId,
        dateOfBirth: this.toIso(personal.dob) ?? (detail.dateOfBirth ? this.toIso(detail.dateOfBirth) : null),
        gender: normalizeGender(personal.gender) ?? detail.gender,
        maritalStatus: normalizeMarital(personal.marital) ?? detail.maritalStatus,
        bloodGroup: personal.blood || detail.bloodGroup || null,
        nationality: detail.nationality || null,
        address: addr,
        city: city || null,
        state: state || null,
        country: country || null,
        emergencyContactName: contact.emergencyName?.trim() || null,
        emergencyContactPhone: contact.emergencyPhone?.trim() || null,
      })
      .subscribe({
        next: (updated) => {
          this.detail.set(updated);
          this.toast.show(message);
        },
        error: (error) => this.toast.show(error?.error?.title ?? 'Could not save your profile.', 'danger'),
      });
  }

  private toIso(value: string): string | null {
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }

  protected readonly tabs = [
    { id: 'personal', label: 'Personal', icon: 'user' },
    { id: 'contact', label: 'Contact', icon: 'mail' },
    { id: 'bank', label: 'Bank', icon: 'payroll' },
    { id: 'docs', label: 'Documents', icon: 'documents' },
  ] as const;

  protected readonly tab = signal<'personal' | 'contact' | 'bank' | 'docs'>('personal');

  protected readonly showContactPassword = signal(false);
  protected readonly hasStoredPassword = signal(false);

  protected readonly personal = signal({
    salutation: 'Mr',
    firstName: '',
    middleName: '',
    lastName: '',
    email: '',
    password: '',
    phone: '',
    dob: '',
    gender: 'Female',
    marital: '',
    blood: '',
  });

  protected readonly job = signal({
    title: '',
    dept: '',
    reportsTo: '',
    joinDate: '',
  });

  protected readonly contact = signal({
    emergencyName: '',
    emergencyPhone: '',
    addressLine1: '',
    addressLine2: '',
    addressLine3: '',
  });

  protected readonly identity = signal({
    passportNo: '',
    passportExp: '',
    visaNo: '',
    visaExp: '',
    emiratesId: '',
  });

  protected readonly bank = signal({
    bankName: 'Emirates NBD',
    accountName: '',
    accountNo: '',
    iban: '',
    ifsc: '',
    swift: '',
    currency: 'INR',
    paymentMode: 'Bank Transfer',
    wpsId: '',
  });

  protected readonly grossMonthlySalary = computed<string>(() => {
    const employee = this.detail();
    if (!employee) return this.currencyService.format(0);
    const gross =
      employee.basicSalary +
      employee.housingAllowance +
      employee.transportAllowance +
      employee.mobileAllowance +
      employee.otherAllowances;
    return this.currencyService.format(gross, employee.currency);
  });

  protected readonly salaryStructure = computed<[string, string, string][]>(() => {
    const employee = this.detail();
    if (!employee) return [];

    const money = (value: number) => this.currencyService.format(value, employee.currency);
    const gross =
      employee.basicSalary +
      employee.housingAllowance +
      employee.transportAllowance +
      employee.mobileAllowance +
      employee.otherAllowances;

    return [
      ['Basic Salary', money(employee.basicSalary), 'var(--text)'],
      ['Housing Allowance', money(employee.housingAllowance), 'var(--text)'],
      ['Transport Allowance', money(employee.transportAllowance), 'var(--text)'],
      ['Mobile Allowance', money(employee.mobileAllowance), 'var(--text)'],
      ['Other Allowances', money(employee.otherAllowances), 'var(--text)'],
      ['Gross Salary', money(gross), 'var(--success)'],
    ];
  });

  protected readonly docs = signal<DocRow[]>([]);
  protected readonly docsPage = signal(1);
  protected readonly paginatedDocs = computed(() => paginateSlice(this.docs(), this.docsPage()));
  protected readonly selectedDocView = signal<DocRow | null>(null);

  protected viewDoc(r: DocRow): void {
    this.selectedDocView.set(r);
    this.ui.open('viewDocModal');
  }

  protected downloadDocument(r: DocRow): void {
    triggerDocumentDownload(r.doc, r.fileUrl, {
      employeeName: this.detail()?.fullName || 'Employee',
      employeeCode: this.detail()?.employeeCode || 'EMP',
      issueDate: r.issue,
      expiryDate: r.exp,
      status: r.s,
      type: r.type,
    });
    this.toast.show(`Downloaded ${r.doc}`, 'success');
  }

  protected saveDocRow(r: DocRow): void {
    this.toast.show(`Saved ${r.doc} details!`, 'success');
  }

  protected readonly uploadType = signal('Passport');

  protected readonly genderOptions: SelectOption[] = [
    { v: 'Female', l: 'Female' },
    { v: 'Male', l: 'Male' },
    { v: 'Other', l: 'Other' },
    { v: 'Prefer not to say', l: 'Prefer not to say' },
  ];
  protected readonly maritalOptions: SelectOption[] = [
    { v: 'Married', l: 'Married' },
    { v: 'Single', l: 'Single' },
    { v: 'Divorced', l: 'Divorced' },
    { v: 'Widowed', l: 'Widowed' },
  ];
  protected readonly bloodOptions: SelectOption[] = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'].map((b) => ({ v: b, l: b }));
  protected readonly deptOptions: SelectOption[] = ['Engineering', 'Finance', 'HR', 'Sales', 'Marketing', 'Design'].map((d) => ({ v: d, l: d }));
  protected reportingOptions: SelectOption[] = [
    { v: '', l: 'None (Direct Report)' },
    { v: 'HR Manager', l: 'HR Manager' },
    { v: 'Manager', l: 'Manager' },
    { v: 'Company Admin', l: 'Company Admin' },
    { v: 'Sarah Mitchell', l: 'Sarah Mitchell (HR Manager)' },
    { v: 'Priya Sharma', l: 'Priya Sharma (HR Executive)' },
    { v: 'Ravi Kumar', l: 'Ravi Kumar (Manager)' },
    { v: 'David Vance', l: 'David Vance (Company Admin)' },
  ];
  protected readonly countryOptions: SelectOption[] = ['UAE', 'Saudi Arabia', 'Qatar', 'United Kingdom', 'United States', 'India'].map((c) => ({ v: c, l: c }));
  protected readonly bankOptions: SelectOption[] = [
    { v: 'Emirates NBD', l: 'Emirates NBD' },
    { v: 'First Abu Dhabi Bank', l: 'First Abu Dhabi Bank' },
    { v: 'ADCB', l: 'ADCB' },
    { v: 'HSBC', l: 'HSBC' },
    { v: 'Other', l: 'Other' },
  ];
  protected readonly currencyOptions: SelectOption[] = ['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP'].map((c) => ({ v: c, l: c }));
  protected readonly paymentOptions: SelectOption[] = [
    { v: 'Bank Transfer', l: 'Bank Transfer' },
    { v: 'WPS', l: 'WPS' },
    { v: 'Cheque', l: 'Cheque' },
    { v: 'Cash', l: 'Cash' },
  ];
  protected readonly uploadTypeOptions: SelectOption[] = ['Passport', 'Visa', 'Work Permit', 'Emirates ID', 'Medical Insurance', 'Other'].map((t) => ({ v: t, l: t }));

  protected readonly salutationOptions: SelectOption[] = [
    { v: 'Mr', l: 'Mr' },
    { v: 'Mrs', l: 'Mrs' },
    { v: 'Miss', l: 'Miss' },
  ];

  protected patchPersonal(
    key: 'salutation' | 'firstName' | 'middleName' | 'lastName' | 'email' | 'phone' | 'dob' | 'gender' | 'marital' | 'blood',
    value: string
  ): void {
    this.personal.update((p) => ({ ...p, [key]: value }));
  }

  protected patchJob(key: 'title' | 'dept' | 'reportsTo' | 'joinDate', value: string): void {
    this.job.update((j) => ({ ...j, [key]: value }));
  }

  protected patchContact(key: 'emergencyName' | 'emergencyPhone' | 'addressLine1' | 'addressLine2' | 'addressLine3', value: string): void {
    this.contact.update((c) => ({ ...c, [key]: value }));
  }

  protected patchIdentity(key: 'passportNo' | 'passportExp' | 'visaNo' | 'visaExp' | 'emiratesId', value: string): void {
    this.identity.update((i) => ({ ...i, [key]: value }));
  }

  protected patchBank(key: 'bankName' | 'accountName' | 'accountNo' | 'iban' | 'ifsc' | 'swift' | 'currency' | 'paymentMode' | 'wpsId', value: string): void {
    this.bank.update((b) => ({ ...b, [key]: value }));
  }
}
