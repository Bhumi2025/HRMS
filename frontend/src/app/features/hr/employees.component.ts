import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api/api.service';
import { EmployeeListItem } from '../../core/api/api.models';
import { IconDirective } from '../../core/icons/icon.directive';
import { PermissionService } from '../../core/services/permission.service';
import { SessionService } from '../../core/services/session.service';
import { UiService } from '../../core/services/ui.service';
import { ToastService } from '../../core/services/toast.service';
import { CurrencyService } from '../../core/services/currency.service';
import { SelectComponent, SelectOption } from '../../shared/select.component';
import { FaceRecognitionService } from '../../core/services/face-recognition.service';
import { ACCEPT_IMG_TYPES, validateImageFile } from '../../core/utils/file-validator';
import { NoAutofillDirective } from '../../shared/no-autofill.directive';

interface Employee {
  id: string;
  apiId?: string;
  name: string;
  dept: string;
  status: 'Active' | 'On Leave' | 'Offboarding';
  join: string;
  salary: string;
  email: string;
  role?: string;
  roleCode?: string;
  roleName?: string;
  designationId?: string | null;
  isFaceEnrolled?: boolean;
  facePhotoUrl?: string | null;
}

/**
 * Employees directory — ported from pages/employees.html. Search plus department
 * and status filters, row selection, view/edit modals and pagination.
 */
@Component({
  selector: 'app-employees',
  imports: [CommonModule, IconDirective, SelectComponent, RouterLink, NoAutofillDirective],
  template: `
    <!-- Single Card: Filter + Table -->
    <div class="card" style="overflow: visible;">
      <div style="padding: 10px 12px; border-bottom: 1px solid var(--border); position: relative; z-index: 25;">
        <div class="filter-bar">
          <div class="filter-search-box input-group">
            <span class="input-icon" style="display: flex" [appIcon]="'search'"></span>
            <input
              #searchInput
              type="search"
              id="emp_search_filter_query"
              name="emp_search_filter_query"
              class="form-control"
              placeholder="Search by name, ID, dept..."
              [value]="search()"
              (input)="onSearchInput($any($event.target).value)"
              (change)="onSearchInput($any($event.target).value)"
              (search)="onSearchInput($any($event.target).value)"
              (paste)="onSearchPaste($event)"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
              data-lpignore="true"
              data-form-type="other"
              role="searchbox"
              style="padding-right: 28px; font-size: 13px;"
            />
            @if (search()) {
              <button
                type="button"
                (click)="clearSearchInput()"
                style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; font-size: 13px; cursor: pointer; color: var(--muted); padding: 4px; display: flex; align-items: center; justify-content: center; z-index: 5;"
                title="Clear search"
              >
                ✕
              </button>
            }
          </div>
          <div class="filter-controls-group">
            <app-select
              [options]="departmentOptions()"
              [value]="dept()"
              (valueChange)="onDeptChange($event)"
              width="140px"
            />
            <app-select
              [options]="statusOptions"
              [value]="status()"
              (valueChange)="onStatusChange($event)"
              width="105px"
            />
            <button class="btn btn-outline btn-sm" style="display: flex; align-items: center; gap: 4px; white-space: nowrap;" (click)="clearFilters()">
              <span [appIcon]="'x'"></span> Clear
            </button>
          </div>
          <div class="filter-actions-group">
            <button class="btn btn-outline btn-sm" style="display: flex; align-items: center; gap: 6px; white-space: nowrap;" (click)="exportCsv()">
              <span [appIcon]="'download'"></span> Export
            </button>
          </div>
        </div>
      </div>

      <div style="padding: 12px 20px; border-bottom: 1px solid var(--border); font-size: 13px; color: var(--muted)">
        Showing <strong>{{ filtered().length }}</strong> of {{ employees().length }} employee{{ employees().length === 1 ? '' : 's' }}
      </div>

      <div class="table-wrap" style="position: relative; z-index: 1;">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>ID</th>
              <th class="emp-col-dept">Department</th>
              <th>Role</th>
              <th class="emp-col-join">Join Date</th>
              <th class="emp-col-salary">Salary</th>
              <th>Status</th>
              <th>Face ID</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (e of paginatedEmployees(); track e.id) {
              <tr [class.hr-manager-row]="isHrManager(e)">
                <td>
                  <div class="table-avatar">
                    <a 
                      [routerLink]="['/employee-profile']" 
                      [queryParams]="{ id: e.apiId || e.id }"
                      class="avatar-placeholder avatar" 
                      style="background: #dbeafe; color: #1d4ed8; font-weight: 700; text-decoration: none; cursor: pointer;"
                    >
                      {{ initials(e.name) }}
                    </a>
                    <div>
                      <a 
                        [routerLink]="['/employee-profile']" 
                        [queryParams]="{ id: e.apiId || e.id }"
                        style="font-weight: 600; font-size: 13px; white-space: nowrap; color: var(--text); text-decoration: none; cursor: pointer;"
                      >
                        {{ e.name }}
                      </a>
                      <div style="font-size: 13px; color: var(--muted); white-space: nowrap">{{ e.email }}</div>
                    </div>
                  </div>
                </td>
                <td style="color: var(--text); font-weight: 600; white-space: nowrap">{{ e.id }}</td>
                <td class="emp-col-dept">
                  <span style="color: var(--text); font-weight: 600; white-space: nowrap">{{ e.dept }}</span>
                </td>
                <td>
                  <span class="badge" [class]="roleBadgeClass(e)" style="white-space: nowrap; font-weight: 600;">
                    {{ displayRole(e) }}
                  </span>
                </td>
                <td class="emp-col-join" style="white-space: nowrap">{{ e.join }}</td>
                <td class="emp-col-salary" style="font-weight: 600; white-space: nowrap">{{ e.salary }}</td>
                <td><span class="badge" [class]="statusClass(e.status)">{{ e.status }}</span></td>
                <td>
                  @if (e.isFaceEnrolled) {
                    <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 11px; padding: 3px 8px; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px; font-weight: 600;">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      Enrolled
                    </span>
                  } @else if (canEditEmployee(e)) {
                    <button class="btn btn-outline btn-sm" (click)="openFaceEnroll(e)" style="font-size: 11px; padding: 2px 8px; display: inline-flex; align-items: center; gap: 4px; border-color: #38bdf8; color: #0284c7; font-weight: 600;">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                      + Scan Face
                    </button>
                  } @else {
                    <span class="badge" style="background: var(--bg); color: var(--muted); font-size: 11px;">Not Enrolled</span>
                  }
                </td>
                <td>
                  <div style="display: flex; gap: 4px">
                    <a class="btn btn-ghost btn-sm" [routerLink]="['/employee-profile']" [queryParams]="{ id: e.apiId || e.id }" data-tooltip="Full Profile"><span [appIcon]="'user'"></span></a>
                    @if (canDeleteEmployee(e)) {
                      <button class="btn btn-ghost btn-sm" data-tooltip="Remove" (click)="remove(e)"><span [appIcon]="'trash'"></span></button>
                    }
                  </div>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="9" style="text-align: center; padding: 36px 20px; color: var(--muted);">
                  <div style="font-size: 15px; font-weight: 700; margin-bottom: 4px; color: var(--text);">No employees found</div>
                  <div style="font-size: 13px; margin-bottom: 12px;">
                    @if (search() || dept() || status()) {
                      No employees match your current search and filter criteria.
                    } @else {
                      Get started by onboarding your first team member in Onboarding.
                    }
                  </div>
                  @if (search() || dept() || status()) {
                    <button class="btn btn-outline btn-sm" style="display: inline-flex; align-items: center; gap: 6px" (click)="clearFilters()">
                      <span [appIcon]="'x'"></span> Clear Filters
                    </button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <!-- Dynamic Pagination Row with < > navigation -->
      <div
        class="pagination-row"
        style="display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-top: 1px solid var(--border); flex-wrap: wrap; gap: 12px;"
      >
        <div style="display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--muted);">
          <span>
            Showing {{ filtered().length === 0 ? 0 : currentStartIndex() + 1 }} - {{ currentEndIndex() }} of {{ filtered().length }}
          </span>
        </div>

        <div style="display: flex; gap: 4px; align-items: center;">
          <!-- Previous Button (<) -->
          <button
            type="button"
            class="pg-btn"
            [disabled]="currentPage() <= 1"
            (click)="goToPage(currentPage() - 1)"
            data-tooltip="Previous"
            aria-label="Previous page"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          <!-- Dynamic Page Numbers -->
          @for (p of pageNumbers(); track p) {
            <button
              type="button"
              class="pg-btn"
              [class.active]="p === currentPage()"
              (click)="goToPage(p)"
            >
              {{ p }}
            </button>
          }

          <!-- Next Button (>) -->
          <button
            type="button"
            class="pg-btn"
            [disabled]="currentPage() >= totalPages() || totalPages() <= 1"
            (click)="goToPage(currentPage() + 1)"
            data-tooltip="Next"
            aria-label="Next page"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- View Employee Modal -->
    <div class="modal-overlay" [class.open]="ui.isOpen('viewEmpModal')" (click)="ui.onOverlayClick($event, 'viewEmpModal')">
      <div class="modal" style="max-width: 440px">
        <div class="modal-header">
          <div>
            <div class="card-title" style="font-size: 14px">{{ viewTarget()?.name }}</div>
            <div class="card-subtitle">{{ viewTarget()?.id }} · {{ viewTarget()?.dept }}</div>
          </div>
          <button class="btn btn-ghost btn-sm" (click)="ui.close('viewEmpModal')"><span [appIcon]="'x'"></span></button>
        </div>
        <div class="modal-body">
          @if (viewTarget(); as e) {
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px">
              @for (f of viewFields(e); track f[0]) {
                <div style="background: var(--bg); border-radius: 8px; padding: 10px">
                  <div style="font-size: 11px; color: var(--muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px">
                    {{ f[0] }}
                  </div>
                  <div style="font-size: 13px; font-weight: 400">{{ f[1] }}</div>
                </div>
              }
              <div style="background: var(--bg); border-radius: 8px; padding: 10px">
                <div style="font-size: 11px; color: var(--muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px">
                  Status
                </div>
                <span class="badge" [class]="statusClass(e.status)">{{ e.status }}</span>
              </div>
              <div style="grid-column: span 2; background: var(--bg); border-radius: 8px; padding: 12px; display: flex; align-items: center; justify-content: space-between; border: 1px solid var(--border);">
                <div>
                  <div style="font-size: 11px; color: var(--muted); font-weight: 600; text-transform: uppercase; margin-bottom: 2px;">
                    Biometric Face Recognition
                  </div>
                  <div style="font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px;">
                    @if (e.isFaceEnrolled) {
                      <span style="color: #10b981; display: inline-flex; align-items: center; gap: 4px;">✓ Face ID Enrolled & Active</span>
                    } @else {
                      <span style="color: var(--muted);">No Face Profile Enrolled</span>
                    }
                  </div>
                </div>
                @if (canEditEmployee(e)) {
                  <button class="btn btn-outline btn-sm" (click)="openFaceEnrollFromView(e)" style="font-size: 12px; font-weight: 600;">
                    {{ e.isFaceEnrolled ? 'Manage Face ID' : '+ Enroll Face' }}
                  </button>
                }
              </div>
            </div>
          }
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" (click)="ui.close('viewEmpModal')">Close</button>
          @if (viewTarget() && canEditEmployee(viewTarget()!)) {
            <button class="btn btn-primary" (click)="editFromView()">Edit Employee</button>
          }
        </div>
      </div>
    </div>

    <!-- Edit Employee Modal -->
    <div class="modal-overlay" [class.open]="ui.isOpen('editEmpModal')" (click)="ui.onOverlayClick($event, 'editEmpModal')">
      <div class="modal" style="max-width: 520px; overflow: visible;">
        <div class="modal-header">
          <div style="font-size: 14px; font-weight: 800">Edit Employee</div>
          <button class="btn btn-ghost btn-sm" (click)="ui.close('editEmpModal')"><span [appIcon]="'x'"></span></button>
        </div>
        <div class="modal-body" style="overflow: visible;">
          @if (form(); as f) {
            <div class="grid-2">
              <div class="form-group">
                <label class="form-label">Full Name</label>
                <input class="form-control" [value]="f.name" (input)="patch('name', $any($event.target).value)" />
              </div>
              <div class="form-group">
                <label class="form-label">Email</label>
                <input class="form-control" [value]="f.email" (input)="patch('email', $any($event.target).value)" />
              </div>
              <div class="form-group">
                <label class="form-label">Department</label>
                <app-select
                  [options]="addDeptOptions()"
                  [value]="f.dept"
                  (valueChange)="patch('dept', $event)"
                  width="100%"
                />
              </div>
              <div class="form-group">
                <label class="form-label">Job Title</label>
                <input class="form-control" [value]="f.role || ''" readonly style="background: var(--bg); color: var(--muted)" />
              </div>
              <div class="form-group">
                <label class="form-label">Designation</label>
                <app-select
                  [options]="designationOptions()"
                  [value]="f.designationId || ''"
                  (valueChange)="patch('designationId', $event)"
                  width="100%"
                />
              </div>
              <div class="form-group">
                <label class="form-label">System Access Role</label>
                <app-select
                  [options]="systemRoleOptions"
                  [value]="f.roleCode || 'Employee'"
                  (valueChange)="patch('roleCode', $event)"
                  width="100%"
                />
              </div>
              <div class="form-group">
                <label class="form-label">Salary</label>
                <input class="form-control" [value]="f.salary" (input)="patch('salary', $any($event.target).value)" />
              </div>
              <div class="form-group">
                <label class="form-label">Join Date</label>
                <input class="form-control" [value]="f.join" (input)="patch('join', $any($event.target).value)" />
              </div>
              <div class="form-group">
                <label class="form-label">Status</label>
                <app-select
                  [options]="editStatusOptions"
                  [value]="f.status"
                  (valueChange)="patch('status', $event)"
                  width="100%"
                />
              </div>
            </div>
          }
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" (click)="ui.close('editEmpModal')">Cancel</button>
          <button class="btn btn-primary" (click)="saveEdit()">Save Changes</button>
        </div>
      </div>
    </div>

    <!-- Face Enrollment Modal -->
    <div class="modal-overlay" [class.open]="faceEnrollModalOpen()" (click)="closeFaceEnrollModal()">
      <div class="modal" style="max-width: 500px" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <div>
            <div style="font-size: 1.1rem; font-weight: 700">Face Recognition Enrollment</div>
            <div style="font-size: 12px; color: var(--muted)">{{ faceTarget()?.name }} ({{ faceTarget()?.id }})</div>
          </div>
          <button class="btn btn-ghost btn-sm" (click)="closeFaceEnrollModal()"><span [appIcon]="'x'"></span></button>
        </div>
        <div class="modal-body">
          @if (faceTarget()?.isFaceEnrolled && !reEnrolling()) {
            <div style="text-align: center; padding: 16px 0;">
              <div style="width: 100px; height: 100px; border-radius: 50%; margin: 0 auto 12px; overflow: hidden; border: 3px solid #10b981; position: relative;">
                <img [src]="faceTarget()?.facePhotoUrl || 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150'" alt="Face Photo" style="width: 100%; height: 100%; object-fit: cover;" />
              </div>
              <div style="font-size: 16px; font-weight: 700; color: #10b981; margin-bottom: 4px;">✓ Face ID Active &amp; Validated</div>
              <div style="font-size: 12px; color: var(--muted); max-width: 320px; margin: 0 auto 16px;">
                This employee can now punch in/out hands-free at any Face Attendance Kiosk or entrance terminal.
              </div>
              <div style="display: flex; gap: 8px; justify-content: center;">
                <button class="btn btn-outline btn-sm" (click)="startReEnroll()">
                  🔄 Re-scan / Change Photo
                </button>
                <button class="btn btn-outline btn-sm" style="color: #ef4444; border-color: #ef4444;" (click)="removeFaceId(faceTarget()!)">
                  Remove Face ID
                </button>
              </div>
            </div>
          } @else {
            <!-- Live Camera Scan Viewport -->
            <div style="position: relative; width: 100%; height: 260px; background: #0f172a; border-radius: 12px; overflow: hidden; display: flex; align-items: center; justify-content: center; margin-bottom: 12px;">
              <video #enrollVideo autoplay playsinline muted style="width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1);"></video>
              <canvas #enrollCanvas style="display: none;"></canvas>

              <!-- Oval HUD guide -->
              <div style="position: absolute; width: 160px; height: 200px; border: 2.5px dashed #38bdf8; border-radius: 50%; box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.45); pointer-events: none;"></div>

              @if (!cameraActive()) {
                <div style="position: absolute; z-index: 5; text-align: center; padding: 20px;">
                  <div style="font-size: 28px; margin-bottom: 6px;">📹</div>
                  <div style="font-size: 13px; font-weight: 600; color: #f8fafc; margin-bottom: 8px;">Camera offline or inactive</div>
                  <button class="btn btn-primary btn-sm" (click)="startCamera()">Activate Camera</button>
                </div>
              }
            </div>

            @if (uploadedPhotoBase64) {
              <div style="display: flex; align-items: center; gap: 10px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 8px 12px; margin-bottom: 10px;">
                <img [src]="uploadedPhotoBase64" alt="Uploaded Preview" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;" />
                <div style="font-size: 12px; color: #10b981; font-weight: 600;">Photo file loaded! Ready to enroll.</div>
              </div>
            }

            <div style="font-size: 12px; color: var(--muted); text-align: center; margin-bottom: 10px;">
              Center face in oval frame, then click <b>Capture &amp; Enroll</b>.
            </div>

            <!-- Alternative: File Upload -->
            <div style="background: var(--bg); border: 1px dashed var(--border); border-radius: 8px; padding: 8px 12px; text-align: center; margin-bottom: 10px;">
              <label style="font-size: 11px; font-weight: 600; color: var(--muted); display: block; margin-bottom: 4px;">OR UPLOAD FACE PHOTO (JPG, PNG - Max 2MB)</label>
              <input type="file" [accept]="acceptImgTypes" (change)="onFaceFileSelected($event)" style="font-size: 12px;" />
            </div>
          }
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" (click)="closeFaceEnrollModal()">Cancel</button>
          @if (!faceTarget()?.isFaceEnrolled || reEnrolling()) {
            <button class="btn btn-primary" [disabled]="enrollingFace()" (click)="captureAndSaveFace()">
              {{ enrollingFace() ? 'Saving Face ID...' : 'Capture & Enroll Face ID' }}
            </button>
          }
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      thead th {
        white-space: nowrap;
      }
      tr.hr-manager-row {
        background-color: rgba(37, 99, 235, 0.07) !important;
      }
      tr.hr-manager-row:hover {
        background-color: rgba(37, 99, 235, 0.12) !important;
      }
      input[type="search"]::-webkit-search-decoration,
      input[type="search"]::-webkit-search-cancel-button,
      input[type="search"]::-webkit-search-results-button,
      input[type="search"]::-webkit-search-results-decoration {
        -webkit-appearance: none;
        appearance: none;
        display: none !important;
      }
      input[type="search"]::-ms-clear,
      input[type="search"]::-ms-reveal {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
      }
      .form-group {
        margin-bottom: 0;
      }
      .pg-btn:disabled {
        opacity: 0.35;
        cursor: not-allowed;
        pointer-events: none;
        border-color: var(--border);
        color: var(--muted);
      }
      .filter-bar {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }
      .filter-search-box {
        flex: 1;
        min-width: 140px;
        max-width: 320px;
        position: relative;
      }
      .filter-controls-group {
        display: flex;
        gap: 6px;
        align-items: center;
        flex-wrap: wrap;
      }
      .filter-actions-group {
        display: flex;
        gap: 6px;
        margin-left: auto;
        flex-shrink: 0;
      }
      @media (max-width: 768px) {
        .filter-bar {
          flex-direction: column;
          align-items: stretch;
          gap: 8px;
        }
        .filter-search-box {
          max-width: 100% !important;
          width: 100% !important;
        }
        .filter-controls-group {
          width: 100%;
          justify-content: flex-start;
        }
        .filter-controls-group app-select {
          flex: 1;
        }
        .filter-actions-group {
          width: 100%;
          justify-content: space-between;
          margin-left: 0;
        }
        .filter-actions-group button {
          flex: 1;
          justify-content: center;
        }
      }
      @media (max-width: 600px) {
        .emp-col-join,
        .emp-col-salary {
          display: none;
        }
      }
      @media (max-width: 400px) {
        .emp-col-dept {
          display: none;
        }
      }
    `,
  ],
})
export class EmployeesComponent implements OnInit, AfterViewInit {
  private readonly router = inject(Router);
  protected readonly ui = inject(UiService);
  protected readonly perms = inject(PermissionService);
  protected readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);
  private readonly api = inject(ApiService);
  protected readonly currencyService = inject(CurrencyService);
  private readonly faceService = inject(FaceRecognitionService);

  @ViewChild('searchInput') private searchInputRef?: ElementRef<HTMLInputElement>;

  private departmentIds = new Map<string, string>();

  protected readonly pageSize = signal(8);
  protected readonly currentPage = signal(1);

  protected readonly departmentOptions = signal<SelectOption[]>([
    { v: '', l: 'All Departments' },
  ]);

  protected readonly statusOptions: SelectOption[] = [
    { v: '', l: 'All Status' },
    { v: 'Active', l: 'Active' },
    { v: 'On Leave', l: 'On Leave' },
    { v: 'Offboarding', l: 'Offboarding' },
  ];

  protected readonly editStatusOptions: SelectOption[] = [
    { v: 'Active', l: 'Active' },
    { v: 'On Leave', l: 'On Leave' },
    { v: 'Offboarding', l: 'Offboarding' },
  ];

  protected readonly addDeptOptions = signal<SelectOption[]>([]);
  protected readonly designationOptions = signal<SelectOption[]>([]);

  protected readonly employees = signal<Employee[]>([]);

  protected readonly search = signal('');
  protected readonly dept = signal('');
  protected readonly status = signal('');

  protected readonly selected = signal<Set<string>>(new Set());
  protected readonly viewTarget = signal<Employee | null>(null);
  private editId: string | null = null;
  protected readonly form = signal<Employee | null>(null);

  // Face ID Enrollment State
  @ViewChild('enrollVideo') private enrollVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild('enrollCanvas') private enrollCanvas?: ElementRef<HTMLCanvasElement>;
  protected readonly faceEnrollModalOpen = signal(false);
  protected readonly faceTarget = signal<Employee | null>(null);
  protected readonly cameraActive = signal(false);
  protected readonly enrollingFace = signal(false);
  protected readonly reEnrolling = signal(false);
  protected uploadedPhotoBase64: string | null = null;
  private cameraStream?: MediaStream;

  protected readonly filtered = computed(() => {
    // 1. Normalize unicode spaces, trim, lowercase
    const raw = (this.search() || '')
      .replace(/[\u00A0\u1680\u180e\u2000-\u200b\u202f\u205f\u3000\ufeff]/g, ' ')
      .trim()
      .toLowerCase();

    const dept = this.dept();
    const status = this.status();
    const tokens = raw ? raw.split(/\s+/).filter(Boolean) : [];

    return this.employees().filter((e) => {
      // 1. Department filter
      if (dept && e.dept.toLowerCase() !== dept.toLowerCase()) return false;

      // 2. Status filter
      if (status && e.status.toLowerCase() !== status.toLowerCase()) return false;

      // 3. Search query
      if (tokens.length === 0) return true;

      const name = (e.name || '').toLowerCase();
      const id = (e.id || '').toLowerCase();
      const email = (e.email || '').toLowerCase();
      const department = (e.dept || '').toLowerCase();
      const empStatus = (e.status || '').toLowerCase();
      const role = (e.role || '').toLowerCase();
      const roleLabel = this.displayRole(e).toLowerCase();
      const combined = `${name} ${id} ${email} ${department} ${empStatus} ${role} ${roleLabel}`;

      // Match full phrase directly
      if (combined.includes(raw)) return true;

      // Match each token anywhere in employee info
      return tokens.every(
        (token) =>
          name.includes(token) ||
          id.includes(token) ||
          email.includes(token) ||
          department.includes(token) ||
          empStatus.includes(token) ||
          role.includes(token) ||
          roleLabel.includes(token),
      );
    });
  });

  protected readonly totalPages = computed(() => {
    const total = this.filtered().length;
    return total > 0 ? Math.ceil(total / this.pageSize()) : 1;
  });

  protected readonly paginatedEmployees = computed(() => {
    const list = this.filtered();
    const page = this.currentPage();
    const size = this.pageSize();
    const start = (page - 1) * size;
    return list.slice(start, start + size);
  });

  protected readonly pageNumbers = computed<number[]>(() => {
    const total = this.totalPages();
    const current = this.currentPage();
    if (total <= 1) return [1];

    const pages: number[] = [];
    if (total <= 7) {
      for (let i = 1; i <= total; i++) pages.push(i);
      return pages;
    }

    const start = Math.max(1, current - 2);
    const end = Math.min(total, current + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  });

  protected goToPage(p: number): void {
    if (p >= 1 && p <= this.totalPages()) {
      this.currentPage.set(p);
    }
  }

  protected currentStartIndex(): number {
    return (this.currentPage() - 1) * Number(this.pageSize());
  }

  protected currentEndIndex(): number {
    const count = this.filtered().length;
    if (count === 0) return 0;
    const end = this.currentStartIndex() + Number(this.pageSize());
    return end > count ? count : end;
  }

  protected onPageSizeChange(newSize: number): void {
    this.pageSize.set(Number(newSize));
    this.currentPage.set(1);
  }

  protected readonly allSelected = computed(() => {
    const rows = this.paginatedEmployees();
    return rows.length > 0 && rows.every((r) => this.selected().has(r.id));
  });

  ngOnInit(): void {
    this.loadDepartments();
    this.loadDesignations();
    this.loadEmployees();
  }

  ngAfterViewInit(): void {
    // Prevent browser password/contact managers from autofilling user's email into search
    const wipeAutofill = () => {
      if (this.searchInputRef?.nativeElement && !this.search()) {
        this.searchInputRef.nativeElement.value = '';
      }
    };
    setTimeout(wipeAutofill, 50);
    setTimeout(wipeAutofill, 250);
    setTimeout(wipeAutofill, 600);
  }

  private loadDesignations(): void {
    this.api.designations().subscribe({
      next: (list) => {
        this.designationOptions.set([
          { v: '', l: 'Select Designation (Optional)' },
          ...(list || []).map((d) => ({ v: d.id, l: d.name }))
        ]);
      },
      error: () => this.designationOptions.set([{ v: '', l: 'Select Designation (Optional)' }]),
    });
  }

  private loadDepartments(): void {
    this.api.departments().subscribe({
      next: (departments) => {
        const list = departments || [];
        this.departmentIds = new Map(list.map((d) => [d.name, d.id]));
        const opts: SelectOption[] = list.map((d) => ({ v: d.name, l: d.name }));
        this.addDeptOptions.set(opts);
        this.departmentOptions.set([{ v: '', l: 'All Departments' }, ...opts]);
      },
      error: () => {
        this.addDeptOptions.set([]);
        this.departmentOptions.set([{ v: '', l: 'All Departments' }]);
      },
    });
  }

  /** Loads the directory from the API. */
  private loadEmployees(): void {
    this.api.employees({ page: 1, pageSize: 100 }).subscribe({
      next: (page) => {
        this.employees.set((page?.items || []).map((item) => this.mapEmployee(item)));
        this.selected.set(new Set());
      },
      error: () => {
        this.employees.set([]);
      },
    });
  }

  private mapEmployee(e: EmployeeListItem): Employee {
    const rawStatus = (e.status || 'Active').trim();
    const normalizedStatus = (rawStatus.replace(/\s+/g, '').toLowerCase() === 'onleave' ? 'On Leave' : rawStatus) as Employee['status'];
    return {
      id: e.employeeCode,
      apiId: e.id,
      name: e.fullName,
      dept: e.department,
      status: normalizedStatus,
      join: this.formatDate(e.joinDate),
      salary: `${this.currencySymbol(e.currency)}${e.salary.toLocaleString()}`,
      email: e.email,
      role: e.jobTitle,
      roleCode: e.roleCode ?? undefined,
      roleName: e.roleName ?? undefined,
      isFaceEnrolled: e.isFaceEnrolled ?? false,
      facePhotoUrl: e.facePhotoUrl ?? null,
    };
  }

  protected isHrManager(e: Employee): boolean {
    const code = (e.roleCode || '').replace(/\s+/g, '').toLowerCase();
    const name = (e.roleName || '').replace(/\s+/g, '').toLowerCase();
    return code === 'hrmanager' || name === 'hrmanager';
  }

  protected isHrOrAdmin(e: Employee): boolean {
    const code = (e.roleCode || '').replace(/\s+/g, '').toLowerCase();
    const name = (e.roleName || '').replace(/\s+/g, '').toLowerCase();
    return code === 'hrmanager' || name === 'hrmanager' ||
           code === 'companyadmin' || name === 'companyadmin' ||
           code === 'superadmin' || name === 'superadmin';
  }

  protected displayRole(e: Employee): string {
    if (e.roleName && e.roleName.trim()) return e.roleName;
    const code = (e.roleCode || '').replace(/\s+/g, '').toLowerCase();
    if (code === 'hrmanager') return 'HR Manager';
    if (code === 'companyadmin') return 'Company Admin';
    if (code === 'superadmin') return 'Super Admin';
    return 'Employee';
  }

  protected roleBadgeClass(e: Employee): string {
    if (this.isHrManager(e)) return 'badge-primary';
    const code = (e.roleCode || '').replace(/\s+/g, '').toLowerCase();
    if (code === 'companyadmin' || code === 'superadmin') return 'badge-warning';
    return 'badge-info';
  }

  protected canEditEmployee(e: Employee): boolean {
    if (!this.perms.canEdit('Employees')) return false;
    if (this.session.activeRole() === 'HR Manager' && this.isHrOrAdmin(e)) {
      return false;
    }
    return true;
  }

  protected canDeleteEmployee(e: Employee): boolean {
    if (!this.perms.canDelete('Employees')) return false;
    if (this.session.activeRole() === 'HR Manager' && this.isHrOrAdmin(e)) {
      return false;
    }
    return true;
  }

  private formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  private toIsoDate(value: string): string | null {
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private currencySymbol(code: string): string {
    return this.currencyService.getSymbol(code);
  }

  private parseMoney(value: string): number {
    const amount = Number(value.replace(/[^0-9.]/g, ''));
    return Number.isFinite(amount) ? amount : 0;
  }

  protected initials(name: string): string {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('');
  }

  protected statusClass(status: Employee['status'] | string): string {
    const s = (status || '').replace(/\s+/g, '').toLowerCase();
    if (s === 'active') return 'badge-success';
    if (s === 'onleave') return 'badge-warning';
    return 'badge-danger';
  }

  protected viewFields(e: Employee): [string, string][] {
    return [
      ['Employee ID', e.id],
      ['Full Name', e.name],
      ['Email', e.email],
      ['Department', e.dept],
      ['Role', this.displayRole(e)],
      ['Join Date', e.join],
      ['Salary', e.salary],
    ];
  }

  protected toggleAll(checked: boolean): void {
    this.selected.set(checked ? new Set(this.paginatedEmployees().map((e) => e.id)) : new Set());
  }

  protected toggleRow(id: string, checked: boolean): void {
    this.selected.update((set) => {
      const next = new Set(set);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  protected onSearchInput(val: string): void {
    this.search.set(val);
    this.currentPage.set(1);
  }

  protected onSearchPaste(event: ClipboardEvent): void {
    const pasted = event.clipboardData?.getData('text') || '';
    if (pasted) {
      setTimeout(() => {
        const inputElem = event.target as HTMLInputElement;
        const cleaned = (inputElem?.value || pasted)
          .replace(/[\u00A0\u1680\u180e\u2000-\u200b\u202f\u205f\u3000\ufeff]/g, ' ')
          .trim();
        this.search.set(cleaned);
        this.currentPage.set(1);
      }, 0);
    }
  }

  protected onDeptChange(dept: string): void {
    this.dept.set(dept);
    this.currentPage.set(1);
  }

  protected onStatusChange(status: string): void {
    this.status.set(status);
    this.currentPage.set(1);
  }

  protected clearSearchInput(): void {
    this.search.set('');
    if (this.searchInputRef?.nativeElement) {
      this.searchInputRef.nativeElement.value = '';
    }
    this.currentPage.set(1);
  }

  protected clearFilters(): void {
    this.search.set('');
    if (this.searchInputRef?.nativeElement) {
      this.searchInputRef.nativeElement.value = '';
    }
    this.dept.set('');
    this.status.set('');
    this.currentPage.set(1);
    this.toast.show('Filters cleared');
  }

  protected readonly systemRoleOptions: SelectOption[] = [
    { v: 'Employee', l: 'Employee (Self-Service Portal)' },
    { v: 'HrManager', l: 'HR Manager' },
    { v: 'CompanyAdmin', l: 'Company Admin' },
  ];

  protected view(e: Employee): void {
    this.viewTarget.set(e);
    this.ui.open('viewEmpModal');
  }

  protected edit(e: Employee): void {
    this.editId = e.id;
    this.form.set({ ...e });
    this.ui.open('editEmpModal');

    if (e.apiId) {
      this.api.employee(e.apiId).subscribe({
        next: (detail) => {
          this.form.update((f) => (f ? {
            ...f,
            designationId: detail.designationId || '',
            roleCode: detail.roleCode || (detail.jobTitle?.toLowerCase().includes('hr') ? 'HrManager' : 'Employee')
          } : f));
        },
        error: () => { },
      });
    }
  }

  protected editFromView(): void {
    const e = this.viewTarget();
    this.ui.close('viewEmpModal');
    if (e) this.edit(e);
  }

  protected patch<K extends keyof Employee>(key: K, value: string): void {
    this.form.update((f) => (f ? { ...f, [key]: value } : f));
  }

  protected saveEdit(): void {
    const f = this.form();
    if (!f || !this.editId) return;

    const original = this.employees().find((e) => e.id === this.editId);
    if (!original?.apiId) {
      this.employees.update((list) => list.map((e) => (e.id === this.editId ? { ...f } : e)));
      this.ui.close('editEmpModal');
      this.toast.show('Employee updated successfully!');
      return;
    }

    this.api.employee(original.apiId).subscribe({
      next: (detail) => {
        const [firstName, ...rest] = f.name.trim().split(' ');
        const parsedSalary = this.parseMoney(f.salary);
        const deptId = this.departmentIds.get(f.dept) ?? detail.departmentId;
        const normalizedStatus = (f.status === 'On Leave' ? 'OnLeave' : f.status);
        const body = {
          firstName: firstName || detail.firstName,
          middleName: detail.middleName,
          lastName: rest.join(' ') || detail.lastName,
          email: f.email,
          phone: detail.phone,
          departmentId: deptId,
          designationId: f.designationId ? f.designationId : null,
          branchId: detail.branchId,
          reportingManagerId: null,
          jobTitle: f.role?.trim() || detail.jobTitle,
          roleCode: f.roleCode || (f.role?.toLowerCase().includes('hr') ? 'HrManager' : 'Employee'),
          grade: '',
          employmentType: detail.employmentType,
          status: normalizedStatus,
          joinDate: this.toIsoDate(f.join) ?? detail.joinDate,
          noticePeriodDays: detail.noticePeriodDays,
          basicSalary: parsedSalary > 0 ? parsedSalary : detail.basicSalary,
          housingAllowance: detail.housingAllowance,
          transportAllowance: detail.transportAllowance,
          mobileAllowance: detail.mobileAllowance,
          otherAllowances: detail.otherAllowances,
          currency: detail.currency,
          bankName: detail.bankName,
          accountName: detail.accountName,
          accountNumber: detail.accountNumber,
          iban: detail.iban,
          ifscCode: detail.ifscCode,
          swiftCode: detail.swiftCode,
          paymentMode: detail.paymentMode,
          wpsId: detail.wpsId,
          passportNumber: detail.passportNumber,
          passportExpiry: detail.passportExpiry,
          visaNumber: detail.visaNumber,
          visaExpiry: detail.visaExpiry,
          emiratesId: detail.emiratesId,
        };

        this.api.updateEmployee(original.apiId!, body).subscribe({
          next: () => {
            this.ui.close('editEmpModal');
            this.toast.show('Employee updated successfully!');
            this.loadEmployees();
          },
          error: (error) => this.toast.show(error?.error?.detail ?? error?.error?.message ?? error?.error?.title ?? 'Could not update the employee.', 'danger'),
        });
      },
      error: () => this.toast.show('Could not load the employee details.', 'danger'),
    });
  }

  protected remove(e: Employee): void {
    if (!confirm(`Are you sure you want to delete employee "${e.name}"? This action cannot be undone.`)) {
      return;
    }
    if (!e.apiId) {
      this.employees.update((list) => list.filter((x) => x.id !== e.id));
      this.toast.show('Employee removed', 'success');
      return;
    }

    this.api.deleteEmployee(e.apiId).subscribe({
      next: () => {
        this.toast.show('Employee deleted successfully', 'success');
        this.loadEmployees();
      },
      error: (error) => this.toast.show(error?.error?.title ?? 'Could not remove the employee.', 'danger'),
    });
  }

  protected exportCsv(): void {
    const rows = this.filtered();
    const header = ['ID', 'Name', 'Email', 'Department', 'Role', 'Job Title', 'Join Date', 'Salary', 'Status', 'Face ID Enrolled'];
    const escapeCell = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      header.map(escapeCell).join(','),
      ...rows.map((r) => [
        r.id,
        r.name,
        r.email,
        r.dept,
        this.displayRole(r),
        r.role || '',
        r.join,
        r.salary,
        r.status,
        r.isFaceEnrolled ? 'Yes' : 'No',
      ].map(escapeCell).join(',')),
    ].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `employees_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast.show('Employees exported to CSV');
  }

  // ── Face ID Biometric Enrollment Methods ──

  protected openFaceEnroll(e: Employee): void {
    this.faceTarget.set(e);
    this.reEnrolling.set(false);
    this.uploadedPhotoBase64 = null;
    this.faceEnrollModalOpen.set(true);
    if (!e.isFaceEnrolled) {
      void this.startCamera();
    }
  }

  protected openFaceEnrollFromView(e: Employee): void {
    this.ui.close('viewEmpModal');
    this.openFaceEnroll(e);
  }

  protected startReEnroll(): void {
    this.reEnrolling.set(true);
    void this.startCamera();
  }

  protected async startCamera(): Promise<void> {
    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
        audio: false,
      });
      this.cameraActive.set(true);
      setTimeout(() => {
        if (this.enrollVideo?.nativeElement && this.cameraStream) {
          this.enrollVideo.nativeElement.srcObject = this.cameraStream;
        }
      }, 150);
    } catch {
      this.cameraActive.set(false);
      this.toast.show('Camera access unavailable. You can upload a photo file instead.', 'warning');
    }
  }

  protected closeFaceEnrollModal(): void {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach((t) => t.stop());
      this.cameraStream = undefined;
    }
    this.cameraActive.set(false);
    this.faceEnrollModalOpen.set(false);
    this.faceTarget.set(null);
    this.uploadedPhotoBase64 = null;
  }

  protected readonly acceptImgTypes = ACCEPT_IMG_TYPES;

  protected onFaceFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];

    const check = validateImageFile(file);
    if (!check.valid) {
      this.toast.show(check.error || 'Invalid photo file.', 'danger');
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      this.uploadedPhotoBase64 = reader.result as string;
      this.toast.show('Photo loaded. Click "Capture & Enroll Face ID" to save.');
    };
    reader.readAsDataURL(file);
  }

  protected async captureAndSaveFace(): Promise<void> {
    const target = this.faceTarget();
    if (!target?.apiId) {
      this.toast.show('Employee profile ID not found.', 'danger');
      return;
    }

    this.enrollingFace.set(true);
    let photoDataUrl = this.uploadedPhotoBase64 || '';
    let realDescriptor: number[] | null = null;

    try {
      const video = this.enrollVideo?.nativeElement;
      const canvas = this.enrollCanvas?.nativeElement;
      if (video && canvas && video.videoWidth > 0) {
        const scan = await this.faceService.detectFace(video, canvas, true);
        if (scan.hasFace && scan.descriptor) {
          realDescriptor = scan.descriptor;
          photoDataUrl = scan.snapshot || this.faceService.captureSnapshot(video, canvas) || photoDataUrl;
        }
      } else if (this.uploadedPhotoBase64 && canvas) {
        const img = new Image();
        img.src = this.uploadedPhotoBase64;
        await new Promise((resolve) => (img.onload = resolve));
        photoDataUrl = this.faceService.compressImageToDataUrl(img, 640, 0.85) || this.uploadedPhotoBase64;
        const scan = await this.faceService.detectFace(img, canvas, true);
        if (scan.hasFace && scan.descriptor) {
          realDescriptor = scan.descriptor;
        }
      }
    } catch {}

    if (!realDescriptor || !photoDataUrl) {
      this.enrollingFace.set(false);
      this.toast.show('No face detected. Please align a clear face in the camera or upload a clear frontal face photo.', 'warning');
      return;
    }

    const employeeId = target.apiId;
    const submitEnroll = () => {
      this.api
        .enrollFace(employeeId, {
          faceDescriptor: JSON.stringify(realDescriptor),
          facePhotoUrl: photoDataUrl,
        })
        .subscribe({
          next: () => {
            this.enrollingFace.set(false);
            this.toast.show(`Face ID enrolled successfully for ${target.name}!`, 'success');
            this.closeFaceEnrollModal();
            this.loadEmployees();
          },
          error: (err) => {
            this.enrollingFace.set(false);
            this.toast.show(
              err?.error?.title ?? err?.error?.detail ?? err?.error?.message ?? 'Could not enroll Face ID.',
              'danger'
            );
          },
        });
    };

    this.api.enrolledFaces().subscribe({
      next: (faces) => {
        const conflict = this.faceService.findDuplicateEnrolledFace(realDescriptor, faces || [], employeeId, photoDataUrl);
        if (conflict) {
          this.enrollingFace.set(false);
          this.toast.show(
            `Duplicate face detected: this face is already registered to ${conflict.fullName} (${conflict.employeeCode}).`,
            'danger'
          );
          return;
        }
        submitEnroll();
      },
      error: () => submitEnroll(),
    });
  }

  protected removeFaceId(emp: Employee): void {
    if (!emp.apiId) return;
    if (!confirm(`Are you sure you want to remove Face ID for ${emp.name}?`)) return;
    this.api.removeFace(emp.apiId).subscribe({
      next: () => {
        this.toast.show('Face ID removed successfully.', 'success');
        this.closeFaceEnrollModal();
        this.loadEmployees();
      },
      error: () => this.toast.show('Could not remove Face ID.', 'danger'),
    });
  }
}
