import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ApiService } from '../../core/api/api.service';
import { EmployeeDetail, EmployeeListItem } from '../../core/api/api.models';
import { IconDirective } from '../../core/icons/icon.directive';
import { SessionService } from '../../core/services/session.service';
import { ToastService } from '../../core/services/toast.service';
import { UiService } from '../../core/services/ui.service';
import { CurrencyService } from '../../core/services/currency.service';
import { SelectComponent, SelectOption } from '../../shared/select.component';
import { KeyGroupSelectComponent } from '../../shared/key-select.component';
import { KeyGroupCacheService } from '../../core/services/key-group-cache.service';
import { FaceRecognitionService } from '../../core/services/face-recognition.service';

interface ProfileData {
  id: string;
  name: string;
  dept: string;
  grade?: string;
  status: string;
  join: string;
  salary: string;
  email: string;
}

/** Employee Profile — ported from pages/employee-profile.html. */
@Component({
  selector: 'app-employee-profile',
  imports: [CommonModule, IconDirective, SelectComponent, KeyGroupSelectComponent, RouterModule],
  template: `
    @if (viewMode() === 'admin') {
      <!-- ADMINISTRATOR BANNER -->
      <div class="profile-banner">
        <div style="position: relative; flex-shrink: 0">
          <div class="profile-avatar admin-avatar">{{ adminInitials() }}</div>
        </div>
        <div style="flex: 1; min-width: 0">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 2px">
            <div style="font-size: 1.25rem; font-weight: 700; color: var(--text)">{{ currentAdminName() }}</div>
            <span class="profile-badge admin-badge">
              <span [appIcon]="'shield'"></span> {{ currentRole() }}
            </span>
          </div>
          <div style="font-size: 13px; color: var(--muted); margin-bottom: 8px">
            {{ currentAdminEmail() }}@if (currentRole() !== 'Super Admin') { &bull; {{ currentCompanyName() }} ({{ currentCompanyCode() }}) }
          </div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap">
            <span class="profile-badge active">Active Administrator</span>
            @if (currentRole() !== 'Super Admin') {
              <span class="profile-badge"><span [appIcon]="'company'"></span> {{ currentCompanyName() }}</span>
            }
            <span class="profile-badge"><span [appIcon]="'lock'"></span> System Authenticated</span>
          </div>
        </div>
        @if (currentRole() !== 'Super Admin' && employeeOptions().length > 0) {
          <div class="profile-header-actions">
            <button class="btn btn-outline btn-sm" type="button" (click)="goBack()">
              <span [appIcon]="'arrow-left'"></span> Back to List
            </button>
            <div class="profile-switcher-dropdown">
              <span class="switcher-label">Inspect Employee:</span>
              <app-select
                [options]="employeeOptions()"
                [value]="selectedEmployeeId()"
                (valueChange)="onEmployeeSelect($event)"
                width="280px"
              />
            </div>
          </div>
        }
      </div>

      <div class="ptabs">
        @for (t of adminTabs; track t.id) {
          <button class="ptab" [class.active]="adminTab() === t.id" (click)="adminTab.set(t.id)">
            <span [appIcon]="t.icon"></span> {{ t.label }}
          </button>
        }
      </div>

      <div class="profile-content-scroll">

      <!-- ADMIN TAB: ACCOUNT -->
      @if (adminTab() === 'account') {
        <div style="width: 100%">
          <div class="card" style="width: 100%; overflow: visible">
            <div class="card-header"><div class="card-title">Administrator Account Information</div></div>
            <div class="card-body" style="overflow: visible">
              <div class="form-group">
                <label class="form-label">Full Name</label>
                <input
                  class="form-control"
                  [value]="adminFullName()"
                  (input)="adminFullName.set($any($event.target).value)"
                  placeholder="Enter administrator full name"
                />
              </div>
              <div class="form-group">
                <label class="form-label">System Login Email</label>
                <input
                  class="form-control"
                  [value]="currentAdminEmail()"
                  readonly
                  style="background: var(--bg); color: var(--muted); cursor: not-allowed"
                />
                <div style="font-size: 11px; color: var(--muted); margin-top: 3px">
                  Primary email associated with this administrative login.
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Administrative Role</label>
                <input
                  class="form-control"
                  [value]="currentRole()"
                  readonly
                  style="background: var(--bg); color: var(--muted); cursor: not-allowed"
                />
              </div>
              @if (currentRole() !== 'Super Admin') {
                <div class="form-group">
                  <label class="form-label">Company &amp; Tenant Workspace</label>
                  <input
                    class="form-control"
                    [value]="currentCompanyName() + ' (' + currentCompanyCode() + ')'"
                    readonly
                    style="background: var(--bg); color: var(--muted); cursor: not-allowed"
                  />
                </div>
              }
              <div class="form-footer">
                <button class="btn btn-primary btn-sm" [disabled]="savingAdminProfile()" (click)="saveAdminProfile()">
                  <span [appIcon]="'check'"></span> Save Administrator Profile
                </button>
              </div>
            </div>
          </div>
        </div>
      }

      <!-- ADMIN TAB: SECURITY -->
      @if (adminTab() === 'security') {
        <div style="width: 100%">
          <div class="card" style="width: 100%">
            <div class="card-header"><div class="card-title">Change Password</div></div>
            <div class="card-body">
              <div class="form-group">
                <label class="form-label">Current Password</label>
                <input
                  class="form-control"
                  type="password"
                  [value]="currentPwd()"
                  (input)="currentPwd.set($any($event.target).value)"
                  placeholder="Enter current password"
                />
              </div>
              <div class="form-group">
                <label class="form-label">New Password</label>
                <input
                  class="form-control"
                  type="password"
                  [value]="newPwd()"
                  (input)="newPwd.set($any($event.target).value)"
                  placeholder="At least 8 characters"
                />
                <!-- Inline Mini Spotify Volume Bar -->
                @if (newPwd().length > 0) {
                  <div style="margin-top: 8px; display: flex; align-items: center; gap: 8px;">
                    <div style="flex: 1; height: 5px; background: #e2e8f0; border-radius: 999px; overflow: hidden;">
                      <div
                        [style.width.%]="passwordStrength().score"
                        [style.background]="passwordStrength().color"
                        style="height: 100%; border-radius: 999px; transition: width 0.3s ease, background-color 0.3s ease;"
                      ></div>
                    </div>
                    <span [style.color]="passwordStrength().color" style="font-size: 11px; font-weight: 700; min-width: 60px; text-align: right;">
                      {{ passwordStrength().label }}
                    </span>
                  </div>
                }
              </div>
              <div class="form-group">
                <label class="form-label">Confirm New Password</label>
                <input
                  class="form-control"
                  type="password"
                  [value]="confirmPwd()"
                  (input)="confirmPwd.set($any($event.target).value)"
                  placeholder="Re-enter new password"
                />
              </div>
              <div class="form-footer">
                <button class="btn btn-primary btn-sm" [disabled]="changingPwd()" (click)="saveAdminPassword()">
                  <span [appIcon]="'lock'"></span> Update Password
                </button>
              </div>
            </div>
          </div>
        </div>
      }
      </div>
    } @else {
      <!-- EMPLOYEE MODE BANNER -->
      <div class="profile-banner">
        <div style="position: relative; flex-shrink: 0">
          <div class="profile-avatar">{{ initials() }}</div>
        </div>
        <div style="flex: 1; min-width: 0">
          <div style="font-size: 1.2rem; font-weight: 700; color: var(--text); margin-bottom: 2px">{{ profile().name }}</div>
          <div style="font-size: 13px; color: var(--muted); margin-bottom: 8px">
            {{ profile().dept }} - {{ profile().id }}
          </div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap">
            <span class="profile-badge" [class.active]="profile().status === 'Active'" [class.warning]="profile().status === 'On Leave'">{{ profile().status }}</span>
            <span class="profile-badge"><span [appIcon]="'calendar2'"></span> Joined {{ profile().join }}</span>
          </div>
        </div>

        @if (canManageEmployees()) {
          <div class="profile-header-actions">
            <button class="btn btn-outline btn-sm" type="button" (click)="goBack()" title="Back to Employee Directory">
              <span [appIcon]="'arrow-left'"></span> Back to List
            </button>
            @if (isAdminViewAvailable()) {
              <button class="btn btn-outline btn-sm" (click)="switchToAdminView()">
                <span [appIcon]="'shield'"></span> Admin Mode
              </button>
            }
            @if (employeeOptions().length > 0) {
              <div class="profile-switcher-dropdown">
                <span class="switcher-label">Select Employee:</span>
                <app-select
                  [options]="employeeOptions()"
                  [value]="selectedEmployeeId()"
                  (valueChange)="onEmployeeSelect($event)"
                  width="260px"
                />
              </div>
            }
          </div>
        }
      </div>

      <div class="ptabs">
        @for (t of tabs; track t.id) {
          <button class="ptab" [class.active]="tab() === t.id" (click)="tab.set(t.id)">
            <span [appIcon]="t.icon"></span> {{ t.label }}
          </button>
        }
      </div>

      <div class="profile-content-scroll">
        @if (!canEditCurrentProfile()) {
          <div style="margin-bottom: 14px; padding: 10px 14px; border-radius: 8px; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.28); color: #1e40af; font-size: 13px; font-weight: 500;">
            Read-only view: HR Managers can edit Employee profiles, not HR Manager or Administrator profiles.
          </div>
        }

    <!-- PERSONAL TAB -->
    @if (tab() === 'personal') {
      <fieldset [disabled]="!canEditCurrentProfile()" style="border: 0; padding: 0; margin: 0;" [style.pointer-events]="!canEditCurrentProfile() ? 'none' : null" [style.opacity]="!canEditCurrentProfile() ? '0.82' : null">
      <div class="grid-2">
        <div class="card" style="overflow: visible">
          <div class="card-header"><div class="card-title">Personal Details</div></div>
          <div class="card-body" style="overflow: visible">
            <div class="form-group">
              <label class="form-label">Full Name</label>
              <input class="form-control" [value]="personal().fullName" (input)="patchPersonal('fullName', $any($event.target).value)" />
            </div>
            <div class="form-group">
              <label class="form-label">Date of Birth</label>
              <input class="form-control" type="date" [value]="personal().dob" (input)="patchPersonal('dob', $any($event.target).value)" />
            </div>
            <div class="form-group">
              <label class="form-label">Gender</label>
              <app-key-select groupCode="GENDER" [value]="personal().gender" (valueChange)="patchPersonal('gender', $event)" width="100%" />
            </div>
            <div class="form-group">
              <label class="form-label">Nationality</label>
              <input class="form-control" [value]="personal().nationality" (input)="patchPersonal('nationality', $any($event.target).value)" />
            </div>
            <div class="form-group">
              <label class="form-label">Marital Status</label>
              <app-key-select groupCode="MARITAL_STATUS" [value]="personal().marital" (valueChange)="patchPersonal('marital', $event)" width="100%" />
            </div>
            <div class="form-group">
              <label class="form-label">Blood Group</label>
              <app-key-select groupCode="BLOOD_GROUP" [value]="personal().blood" (valueChange)="patchPersonal('blood', $event)" width="100%" />
            </div>
          </div>
        </div>

        <div class="card" style="overflow: visible">
          <div class="card-header"><div class="card-title">Job Information</div></div>
          <div class="card-body" style="overflow: visible">
            <div class="form-group">
              <label class="form-label">Employee ID</label>
              <input class="form-control" [value]="profile().id" readonly style="background: var(--bg); color: var(--muted)" />
            </div>
            <div class="form-group">
              <label class="form-label">Job Title</label>
              <input class="form-control" [value]="job().title" readonly style="background: var(--bg); color: var(--muted)" />
            </div>
            <div class="form-group">
              <label class="form-label">Department</label>
              <app-select [options]="deptOptions()" [value]="job().dept" (valueChange)="patchJob('dept', $event)" width="100%" />
            </div>
            <div class="form-group">
              <label class="form-label">Designation</label>
              <app-select [options]="designationOptions()" [value]="selectedDesignationId()" (valueChange)="onDesignationChange($event)" width="100%" />
            </div>
            <div class="form-group">
              <label class="form-label">Reporting To</label>
              <app-select [options]="reportingOptions" [value]="job().reportsTo" (valueChange)="patchJob('reportsTo', $event)" width="100%" />
            </div>
            <div class="form-group">
              <label class="form-label">Join Date</label>
              <input class="form-control" type="date" [value]="job().joinDate" (input)="patchJob('joinDate', $any($event.target).value)" />
            </div>
            <div class="form-group">
              <label class="form-label">System Access Role</label>
              <app-select [options]="systemRoleOptions()" [value]="job().roleCode" (valueChange)="patchJob('roleCode', $event)" [disabled]="!canManageEmployees()" width="100%" />
            </div>
          </div>
        </div>
      </div>
      </fieldset>
    }

    <!-- CONTACT TAB -->
    @if (tab() === 'contact') {
      <fieldset [disabled]="!canEditCurrentProfile()" style="border: 0; padding: 0; margin: 0;" [style.pointer-events]="!canEditCurrentProfile() ? 'none' : null" [style.opacity]="!canEditCurrentProfile() ? '0.82' : null">
      <div class="grid-2">
        <div class="card" style="overflow: visible">
          <div class="card-header"><div class="card-title">Contact Details</div></div>
          <div class="card-body" style="overflow: visible">
            <div class="form-group">
              <label class="form-label">Phone</label>
              <input class="form-control" [value]="contact().phone" (input)="patchContact('phone', $any($event.target).value)" />
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
              <div class="form-group">
                <label class="form-label">Email</label>
                <input class="form-control" type="email" [value]="contact().email" (input)="patchContact('email', $any($event.target).value)" />
              </div>
              <div class="form-group">
                <label class="form-label">Password</label>
                <div class="profile-pwd-box">
                  <span class="profile-pwd-icon" [appIcon]="'lock'"></span>
                  <input
                    class="form-control profile-pwd-input"
                    [type]="showContactPassword() ? 'text' : 'password'"
                    [value]="contact().password"
                    (input)="patchContact('password', $any($event.target).value)"
                    [placeholder]="hasStoredPassword() && !contact().password ? 'Password set (re-enter to show/update)' : 'Password'"
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
            <div class="form-group">
              <label class="form-label">Emergency Contact</label>
              <input class="form-control" [value]="contact().emergency" (input)="patchContact('emergency', $any($event.target).value)" />
            </div>
            <div class="form-group">
              <label class="form-label">Address</label>
              <input class="form-control" [value]="contact().address" (input)="patchContact('address', $any($event.target).value)" />
            </div>
            <div class="form-group">
              <label class="form-label">City</label>
              <input class="form-control" [value]="contact().city" (input)="patchContact('city', $any($event.target).value)" />
            </div>
          </div>
        </div>

        <div class="card" style="overflow: visible">
          <div class="card-header"><div class="card-title">Identity Documents</div></div>
          <div class="card-body" style="overflow: visible">
            <div class="form-group">
              <label class="form-label">Passport No</label>
              <input class="form-control" [value]="identity().passportNo" (input)="patchIdentity('passportNo', $any($event.target).value)" />
            </div>
            <div class="form-group">
              <label class="form-label">Passport Expiry</label>
              <input class="form-control" type="date" [value]="identity().passportExp" (input)="patchIdentity('passportExp', $any($event.target).value)" />
            </div>
            <div class="form-group">
              <label class="form-label">Visa No</label>
              <input class="form-control" [value]="identity().visaNo" (input)="patchIdentity('visaNo', $any($event.target).value)" />
            </div>
            <div class="form-group">
              <label class="form-label">Visa Expiry</label>
              <input class="form-control" type="date" [value]="identity().visaExp" (input)="patchIdentity('visaExp', $any($event.target).value)" />
            </div>
            <div class="form-group">
              <label class="form-label">Emirates ID</label>
              <input class="form-control" [value]="identity().emiratesId" (input)="patchIdentity('emiratesId', $any($event.target).value)" />
            </div>
          </div>
        </div>
      </div>
      </fieldset>
    }

    <!-- BANK TAB -->
    @if (tab() === 'bank') {
      <fieldset [disabled]="!canEditCurrentProfile()" style="border: 0; padding: 0; margin: 0;" [style.pointer-events]="!canEditCurrentProfile() ? 'none' : null" [style.opacity]="!canEditCurrentProfile() ? '0.82' : null">
      <div style="width: 100%">
        <div class="card" style="overflow: visible; width: 100%">
          <div class="card-header"><div class="card-title">Bank Details</div></div>
          <div class="card-body" style="overflow: visible">
            <div class="form-group">
              <label class="form-label">Bank Name</label>
              <app-select [options]="bankOptions" [value]="bank().bankName" (valueChange)="patchBank('bankName', $event)" width="100%" />
            </div>
            <div class="form-group">
              <label class="form-label">Bank Account Name</label>
              <input class="form-control" [value]="bank().accountName" (input)="patchBank('accountName', $any($event.target).value)" />
            </div>
            <div class="form-group">
              <label class="form-label">Account No</label>
              <input class="form-control" [value]="bank().accountNo" (input)="patchBank('accountNo', $any($event.target).value)" />
            </div>
            <div class="form-group">
              <label class="form-label">IBAN</label>
              <input class="form-control" [value]="bank().iban" (input)="patchBank('iban', $any($event.target).value)" />
            </div>
            <div class="form-group">
              <label class="form-label">IFSC Code</label>
              <input class="form-control" [value]="bank().ifsc" (input)="patchBank('ifsc', $any($event.target).value)" />
            </div>
            <div class="form-group">
              <label class="form-label">Swift Code</label>
              <input class="form-control" [value]="bank().swift" (input)="patchBank('swift', $any($event.target).value)" />
            </div>
            <div class="form-group">
              <label class="form-label">Currency</label>
              <app-select [options]="bankCurrencyOptions" [value]="bank().currency" (valueChange)="patchBank('currency', $event)" width="100%" />
            </div>
            <div class="form-group">
              <label class="form-label">Payment Mode</label>
              <app-key-select groupCode="PAYMENT_MODE" [value]="bank().paymentMode" (valueChange)="patchBank('paymentMode', $event)" width="100%" />
            </div>
            <div class="form-group">
              <label class="form-label">WPS ID</label>
              <input class="form-control" [value]="bank().wpsId" (input)="patchBank('wpsId', $any($event.target).value)" />
            </div>
            <div class="form-group">
              <label class="form-label">Basic Salary</label>
              <input class="form-control" type="number" min="0"
                [value]="editSalary() !== null ? editSalary() : (detail()?.basicSalary ?? '')"
                (input)="onSalaryInput($any($event.target).value)"
                placeholder="Enter basic salary" />
            </div>
          </div>
        </div>
      </div>
      </fieldset>
    }

    <!-- BIOMETRIC & FACE ID TAB -->
    @if (tab() === 'biometric') {
      <div style="width: 100%">
        <div class="card" style="overflow: visible; width: 100%">
          <div class="card-header"><div class="card-title">Face Recognition Profile</div></div>
          <div class="card-body" style="overflow: visible">
            <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 20px;">
              <div style="position: relative; width: 72px; height: 72px; border-radius: 50%; overflow: hidden; background: var(--p-soft); display: flex; align-items: center; justify-content: center; border: 2px solid var(--border); flex-shrink: 0;">
                @if (facePhotoUrl()) {
                  <img [src]="facePhotoUrl()!" alt="Face" style="width: 100%; height: 100%; object-fit: cover;" />
                } @else {
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--p)" stroke-width="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
                }
              </div>
              <div>
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                  <span style="font-weight: 700; font-size: 15px;">{{ profile().name }}</span>
                  <span class="badge" [class]="isFaceEnrolled() ? 'badge-success' : 'badge-warning'">
                    {{ isFaceEnrolled() ? 'Face ID Enrolled' : 'Not Enrolled' }}
                  </span>
                </div>
                <div style="font-size: 12px; color: var(--muted);">
                  {{ isFaceEnrolled() ? ('Enrolled: ' + (faceEnrolledAt() | slice:0:10)) : 'No biometric face template registered yet.' }}
                </div>
              </div>
            </div>

        

            @if (canEditCurrentProfile()) {
              <div style="display: flex; gap: 10px;">
                <button class="btn btn-outline btn-sm" type="button" (click)="openFaceEnrollModal()">
                  📷 {{ isFaceEnrolled() ? 'Re-enroll Face ID' : 'Enroll Face ID' }}
                </button>
                @if (isFaceEnrolled()) {
                  <button class="btn btn-outline btn-sm" type="button" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.4);" (click)="removeFaceId()">
                    Remove Face ID
                  </button>
                }
              </div>
            }
          </div>
        </div>

      </div>
    }
    </div>

      <div class="tab-action-bar">
        <button class="btn btn-outline btn-sm" type="button" (click)="previousTab()">
          <span [appIcon]="'arrow_left'"></span> Back
        </button>
        @if (canEditCurrentProfile()) {
          <div class="tab-action-group">
            @if (!isLastTab()) {
              <button class="btn btn-outline btn-sm" type="button" (click)="save(currentSaveMessage())">
                <span [appIcon]="'check'"></span> Save
              </button>
              <button class="btn btn-primary btn-sm" type="button" (click)="saveAndNext(currentSaveMessage())">
                Save &amp; Next <span [appIcon]="'arrow_right'"></span>
              </button>
            } @else {
              <button class="btn btn-primary btn-sm" type="button" (click)="save('Biometric & Profile details saved!')">
                <span [appIcon]="'check'"></span> Save Changes
              </button>
            }
          </div>
        }
      </div>
  }

    <!-- ENROLL FACE ID WEBCAM MODAL -->
    @if (faceEnrollModalOpen()) {
      <div class="modal-overlay open" (click)="closeFaceEnrollModal()">
        <div class="modal" style="width: 440px;" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <div style="font-size: 15px; font-weight: 700;">Enroll Face ID — {{ profile().name }}</div>
            <button class="btn btn-ghost btn-sm" (click)="closeFaceEnrollModal()"><span [appIcon]="'x'"></span></button>
          </div>
          <div class="modal-body" style="text-align: center;">
            <div style="position: relative; width: 100%; height: 280px; background: #000; border-radius: 12px; overflow: hidden; margin-bottom: 14px; display: flex; align-items: center; justify-content: center;">
              <video #enrollVideo autoplay playsinline muted style="width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1);"></video>
              <canvas #enrollCanvas style="display: none;"></canvas>

              <div style="position: absolute; width: 180px; height: 230px; border: 2px dashed #38bdf8; border-radius: 50% / 45%; box-shadow: 0 0 20px rgba(56, 189, 248, 0.4); pointer-events: none;"></div>
            </div>

            <div style="font-size: 12px; color: var(--muted); margin-bottom: 14px;">
              Center the employee's face in the oval frame, look directly into the camera, and click capture.
            </div>

            <div style="display: flex; gap: 10px; justify-content: flex-end;">
              <button class="btn btn-outline" (click)="closeFaceEnrollModal()">Cancel</button>
              <button class="btn btn-primary" [disabled]="enrollingFace()" (click)="captureAndSaveFace()">
                {{ enrollingFace() ? 'Saving...' : 'Capture & Save Face ID' }}
              </button>
            </div>
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
        height: 100%;
        max-height: 100%;
        flex: 1;
        min-height: 0;
        overflow: hidden;
        box-sizing: border-box;
      }
      .profile-content-scroll {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        padding-right: 4px;
        padding-bottom: 90px;
      }
      .profile-content-scroll::-webkit-scrollbar {
        width: 6px;
      }
      .profile-content-scroll::-webkit-scrollbar-track {
        background: transparent;
      }
      .profile-content-scroll::-webkit-scrollbar-thumb {
        background: var(--border);
        border-radius: 4px;
      }
      .profile-content-scroll::-webkit-scrollbar-thumb:hover {
        background: var(--muted);
      }
      .profile-banner {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--r);
        padding: 10px 16px;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        box-shadow: var(--shadow);
        position: relative;
        z-index: 100;
        flex-shrink: 0;
      }
      .profile-avatar {
        width: 52px;
        height: 52px;
        border-radius: 50%;
        background: var(--p);
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.15rem;
        font-weight: 800;
        border: 2px solid #fff;
        box-shadow: 0 2px 8px rgba(37, 99, 235, 0.2);
        flex-shrink: 0;
      }
      .profile-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 20px;
        background: var(--p-soft);
        color: var(--p);
        border: 1px solid var(--p-mid);
      }
      .profile-badge.active {
        background: var(--success-soft);
        color: #15803d;
        border-color: #86efac;
      }
      .profile-badge.active::before {
        content: '';
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: var(--success);
      }
      .profile-badge.warning {
        background: var(--warning-soft);
        color: #b45309;
        border-color: #fcd34d;
      }
      .profile-header-actions {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        position: relative;
        z-index: 101;
      }
      .profile-switcher-dropdown {
        display: flex;
        align-items: center;
        gap: 8px;
        background: var(--bg);
        padding: 4px 8px 4px 12px;
        border: 1px solid var(--border);
        border-radius: 8px;
      }
      .switcher-label {
        font-size: 11px;
        font-weight: 700;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        white-space: nowrap;
      }
      .ptabs {
        display: flex;
        gap: 0;
        margin-bottom: 10px;
        border-bottom: 1px solid var(--border);
        overflow-x: auto;
        scrollbar-width: none;
        flex-shrink: 0;
      }
      .ptabs::-webkit-scrollbar {
        display: none;
      }
      .ptab {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 8px 14px;
        font-size: 14px;
        font-weight: 500;
        color: var(--muted);
        cursor: pointer;
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
        transition: var(--t);
        background: none;
        border-top: none;
        border-left: none;
        border-right: none;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .ptab:hover {
        color: var(--text);
      }
      .ptab.active {
        color: var(--p);
        border-bottom-color: var(--p);
        font-weight: 600;
      }
      .tab-action-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 10px;
        padding: 12px 16px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--r);
        box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.04);
        flex-shrink: 0;
      }
      .grid-2:has(.csel-open),
      .grid-2:has(.csel-host-open),
      .grid-2.has-open-dropdown,
      .card:has(.csel-open),
      .card:has(.csel-host-open),
      .card.has-open-dropdown {
        position: relative !important;
        z-index: 50 !important;
      }
      .tab-action-group {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .form-footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 16px;
      }
      thead th,
      tbody td {
        white-space: nowrap;
      }
      .admin-avatar {
        background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%) !important;
        border: 2px solid rgba(255, 255, 255, 0.4) !important;
        box-shadow: 0 4px 14px rgba(79, 70, 229, 0.35) !important;
      }
      .admin-badge {
        background: linear-gradient(135deg, rgba(79, 70, 229, 0.12), rgba(124, 58, 237, 0.15)) !important;
        color: #6366f1 !important;
        border-color: rgba(99, 102, 241, 0.35) !important;
        font-weight: 700 !important;
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
        .profile-banner {
          padding: 10px;
          gap: 6px;
        }
        .profile-header-actions {
          width: 100%;
          justify-content: space-between;
        }
        .profile-switcher-dropdown {
          width: 100%;
          justify-content: space-between;
        }
      }
    `,
  ],
})
export class EmployeeProfileComponent implements OnInit {
  protected readonly ui = inject(UiService);
  protected readonly toast = inject(ToastService);
  protected readonly session = inject(SessionService);
  protected readonly currencyService = inject(CurrencyService);
  private readonly api = inject(ApiService);
  private readonly keyGroupCache = inject(KeyGroupCacheService);
  private readonly faceService = inject(FaceRecognitionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly detail = signal<EmployeeDetail | null>(null);
  private readonly apiId = signal<string | null>(null);
  private departmentIds = new Map<string, string>();
  private reportingManagerMap = new Map<string, string>();
  private readonly allDesignations = signal<any[]>([]);
  protected readonly selectedDesignationId = signal<string>('');
  protected readonly designationOptions = computed<SelectOption[]>(() => {
    const list = this.allDesignations();
    const currentDeptName = this.job().dept;
    const currentDeptId = this.departmentIds.get(currentDeptName);

    const matching = list.filter((d: any) =>
      (currentDeptId && d.departmentId?.toLowerCase() === currentDeptId.toLowerCase()) ||
      (currentDeptName && d.department && d.department.toLowerCase() === currentDeptName.toLowerCase())
    );

    if (matching.length === 0) {
      return [{ v: '', l: 'No Designations for Department' }];
    }
    return matching.map((d: any) => ({ v: d.id, l: d.name }));
  });

  // Profile View Mode: admin vs employee
  protected readonly viewMode = signal<'admin' | 'employee'>('admin');
  protected readonly adminTab = signal<'account' | 'security'>('account');
  protected readonly adminTabs = [
    { id: 'account', label: 'Admin Account', icon: 'user' },
    { id: 'security', label: 'Security & Password', icon: 'lock' },
  ] as const;

  // Password strength computation for Spotify Volume Slider UI
  protected readonly passwordStrength = computed(() => {
    const pwd = this.newPwd() || '';
    if (!pwd) {
      return {
        score: 0,
        label: 'No Password',
        color: '#94a3b8',
        hasMinLength: false,
        hasMixedCase: false,
        hasNumber: false,
        hasSymbol: false,
      };
    }

    const hasMinLength = pwd.length >= 8;
    const hasMixedCase = /[a-z]/.test(pwd) && /[A-Z]/.test(pwd);
    const hasNumber = /\d/.test(pwd);
    const hasSymbol = /[^A-Za-z0-9]/.test(pwd);

    let score = 0;
    if (pwd.length > 0) score += 10;
    if (hasMinLength) score += 25;
    if (pwd.length >= 12) score += 15;
    if (hasMixedCase) score += 20;
    if (hasNumber) score += 15;
    if (hasSymbol) score += 15;

    score = Math.min(100, score);

    let label = 'Very Weak';
    let color = '#ef4444'; // Red

    if (score >= 80) {
      label = 'Strong';
      color = '#1db954'; // Spotify Green
    } else if (score >= 60) {
      label = 'Good';
      color = '#22c55e'; // Green
    } else if (score >= 40) {
      label = 'Fair';
      color = '#f59e0b'; // Amber
    } else if (score >= 20) {
      label = 'Weak';
      color = '#f97316'; // Orange
    }

    return {
      score,
      label,
      color,
      hasMinLength,
      hasMixedCase,
      hasNumber,
      hasSymbol,
    };
  });

  protected readonly employeeOptions = signal<SelectOption[]>([]);
  protected readonly selectedEmployeeId = signal<string>('__admin__');

  protected readonly currentRole = computed(() => this.session.activeRole());
  protected readonly canManageEmployees = computed(() =>
    ['Super Admin', 'Company Admin', 'HR Manager', 'HR'].includes(this.currentRole())
  );
  protected readonly isCompanyOrSuperAdmin = computed(() =>
    ['Super Admin', 'Company Admin'].includes(this.currentRole())
  );
  protected readonly isTargetHrOrAdmin = computed(() => {
    const code = (this.detail()?.roleCode || this.detail()?.roleName || '').toLowerCase().replace(/[^a-z]/g, '');
    return code === 'hrmanager' || code === 'hr' || code === 'companyadmin' || code === 'superadmin';
  });
  protected readonly canEditCurrentProfile = computed(() => {
    if (['Super Admin', 'Company Admin'].includes(this.currentRole())) return true;
    if (['HR Manager', 'HR'].includes(this.currentRole())) {
      return !this.isTargetHrOrAdmin();
    }
    return true;
  });
  protected readonly isAdminViewAvailable = computed(() =>
    ['Super Admin', 'Company Admin'].includes(this.currentRole()) || !this.session.user()?.employeeId
  );
  protected readonly isAdmin = computed(() => this.isAdminViewAvailable());
  protected readonly currentAdminName = computed(() => this.session.user()?.name || 'Administrator');
  protected readonly currentAdminEmail = computed(() => this.session.user()?.email || 'admin@viralinfotech.com');
  protected readonly currentCompanyName = computed(() => this.session.user()?.companyName || 'Viral Infotech');
  protected readonly currentCompanyCode = computed(() => this.session.user()?.companyCode || 'VIRALINFOTECH');
  protected readonly adminInitials = computed(() => this.session.user()?.initials || 'AD');

  // Admin form state
  protected readonly adminFullName = signal<string>('');
  protected readonly currentPwd = signal<string>('');
  protected readonly newPwd = signal<string>('');
  protected readonly confirmPwd = signal<string>('');
  protected readonly changingPwd = signal<boolean>(false);
  protected readonly savingAdminProfile = signal<boolean>(false);

  ngOnInit(): void {
    this.keyGroupCache.clearCache();
    this.adminFullName.set(this.currentAdminName());

    this.api.departments().subscribe({
      next: (departments) => {
        this.departmentIds = new Map(departments.map((d) => [d.name, d.id]));
        this.deptOptions.set(departments.map((d) => ({ v: d.name, l: d.name })));
      },
      error: () => { },
    });

    this.api.designations().subscribe({
      next: (list) => {
        this.allDesignations.set(list || []);
      },
      error: () => {
        this.allDesignations.set([]);
      },
    });

    if (this.canManageEmployees()) {
      this.loadEmployeeOptions();
    }

    this.route.queryParams.subscribe((params) => {
      const id = params['id'] || params['employeeId'];
      if (id) {
        this.loadEmployeeById(id);
      } else if (this.isAdminViewAvailable() && !this.session.user()?.employeeId) {
        this.selectedEmployeeId.set('__admin__');
        this.viewMode.set('admin');
      } else {
        this.viewMode.set('employee');
        this.load();
      }
    });
  }

  protected loadEmployeeOptions(): void {
    if (!this.canManageEmployees()) return;
    this.api.employees({ pageSize: 150 }).subscribe({
      next: (res) => {
        const opts: SelectOption[] = [];
        if (this.isAdminViewAvailable()) {
          opts.push({ v: '__admin__', l: `👤 My Admin Profile (${this.currentAdminName()})` });
        }
        opts.push(
          ...res.items.map((e) => ({
            v: e.id,
            l: `${e.employeeCode} - ${e.fullName} (${e.jobTitle || e.department})`,
          })),
        );
        this.employeeOptions.set(opts);
        this.reportingManagerMap = new Map(res.items.map((e) => [e.fullName, e.id]));
        this.reportingOptions = [
          { v: 'Company Admin', l: 'Company Admin' },
          { v: 'HR Manager', l: 'HR Manager' },
          ...res.items.map((e) => ({
            v: e.fullName,
            l: `${e.fullName} (${e.employeeCode})`,
          })),
        ];
      },
      error: () => { },
    });
  }

  protected goBack(): void {
    this.router.navigate(['/employees']);
  }

  protected readonly tabOrder: Array<'personal' | 'contact' | 'bank' | 'biometric'> = [
    'personal',
    'contact',
    'bank',
    'biometric',
  ];

  protected isLastTab(): boolean {
    return this.tab() === this.tabOrder[this.tabOrder.length - 1];
  }

  protected currentSaveMessage(): string {
    switch (this.tab()) {
      case 'contact':
        return 'Contact & Identity details saved!';
      case 'bank':
        return 'Bank details saved!';
      case 'biometric':
        return 'Biometric & Profile details saved!';
      default:
        return 'Personal & Job details saved!';
    }
  }

  protected previousTab(): void {
    const current = this.tab();
    const idx = this.tabOrder.indexOf(current as any);
    if (idx > 0) {
      this.tab.set(this.tabOrder[idx - 1]);
    } else {
      this.goBack();
    }
  }

  protected nextTab(): void {
    const current = this.tab();
    const idx = this.tabOrder.indexOf(current as any);
    if (idx >= 0 && idx < this.tabOrder.length - 1) {
      this.tab.set(this.tabOrder[idx + 1]);
    }
  }

  protected saveAndNext(message?: string): void {
    this.save(message || 'Details saved successfully!', () => {
      this.nextTab();
    });
  }

  protected saveAdminProfile(): void {
    const name = this.adminFullName().trim();
    if (!name) {
      this.toast.show('Please enter a valid administrator name.', 'danger');
      return;
    }
    this.savingAdminProfile.set(true);
    this.api.updateProfile(name).subscribe({
      next: (res) => {
        this.savingAdminProfile.set(false);
        this.session.updateUser({ name: res.fullName, initials: res.initials });
        this.toast.show('Administrator profile updated successfully!', 'success');
      },
      error: (err) => {
        this.savingAdminProfile.set(false);
        const msg = err?.error?.detail || err?.error?.title || err?.error?.message || 'Could not update administrator profile.';
        this.toast.show(msg, 'danger');
      },
    });
  }

  protected saveAdminPassword(): void {
    const cur = this.currentPwd();
    const next = this.newPwd();
    const conf = this.confirmPwd();
    if (!cur) {
      this.toast.show('Please enter your current password.', 'warning');
      return;
    }
    if (!next || next.length < 8) {
      this.toast.show('New password must be at least 8 characters long.', 'warning');
      return;
    }
    if (next !== conf) {
      this.toast.show('New password and confirmation do not match.', 'danger');
      return;
    }

    this.changingPwd.set(true);
    this.api.changePassword(cur, next).subscribe({
      next: () => {
        this.changingPwd.set(false);
        this.currentPwd.set('');
        this.newPwd.set('');
        this.confirmPwd.set('');
        this.toast.show('Password changed successfully!', 'success');
      },
      error: (err) => {
        this.changingPwd.set(false);
        const msg = err?.error?.detail || err?.error?.title || err?.error?.message || 'Could not change password.';
        this.toast.show(msg, 'danger');
      },
    });
  }

  protected onEmployeeSelect(value: string): void {
    if (value === '__admin__') {
      this.switchToAdminView();
    } else {
      this.selectedEmployeeId.set(value);
      this.loadEmployeeById(value);
      this.router.navigate([], { relativeTo: this.route, queryParams: { id: value } });
    }
  }

  protected switchToAdminView(): void {
    this.selectedEmployeeId.set('__admin__');
    this.viewMode.set('admin');
    this.router.navigate([], { relativeTo: this.route, queryParams: {} });
  }

  protected loadEmployeeById(id: string): void {
    const isGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isGuid) {
      this.api.employee(id).subscribe({
        next: (employee) => {
          this.populateEmployee(employee);
          this.selectedEmployeeId.set(employee.id);
          this.viewMode.set('employee');
        },
        error: () => {
          this.toast.show('Could not load the selected employee profile.', 'danger');
        },
      });
    } else {
      this.api.employees({ search: id, pageSize: 10 }).subscribe({
        next: (res) => {
          const match = res.items.find(e => e.employeeCode.toLowerCase() === id.toLowerCase() || e.id === id);
          if (match) {
            this.loadEmployeeById(match.id);
          } else {
            this.toast.show(`Could not find employee with code ${id}.`, 'danger');
          }
        },
        error: () => {
          this.toast.show('Could not load employee.', 'danger');
        }
      });
    }
  }

  protected cancelEdit(): void {
    const d = this.detail();
    if (d) {
      this.populateEmployee(d);
      this.toast.show('Changes discarded.', 'info');
    }
  }

  private load(): void {
    this.api.employeeMe().subscribe({
      next: (employee) => {
        this.populateEmployee(employee);
        this.selectedEmployeeId.set(employee.id);
      },
      error: () => {
        this.toast.show('Could not load the employee profile.', 'danger');
      },
    });
  }

  private populateEmployee(employee: EmployeeDetail): void {
    this.detail.set(employee);
    this.apiId.set(employee.id);
    this.editSalary.set(employee.basicSalary);

    const sym = this.currencyService.getSymbol(employee.currency || this.currencyService.currencyCode());
    this.profile.set({
      id: employee.employeeCode,
      name: employee.fullName,
      dept: employee.department,
      status: employee.status,
      join: employee.joinDate,
      salary: `${sym}${employee.grossSalary.toLocaleString()}`,
      email: employee.email,
    });

    this.salaryStructure = [
      ['Basic Salary', `${sym}${employee.basicSalary.toLocaleString()}`, 'var(--text)'],
      ['Housing Allowance', `${sym}${employee.housingAllowance.toLocaleString()}`, 'var(--text)'],
      ['Transport Allowance', `${sym}${employee.transportAllowance.toLocaleString()}`, 'var(--text)'],
      ['Mobile Allowance', `${sym}${employee.mobileAllowance.toLocaleString()}`, 'var(--text)'],
      ['Other Allowances', `${sym}${employee.otherAllowances.toLocaleString()}`, 'var(--text)'],
      ['Gross Salary', `${sym}${employee.grossSalary.toLocaleString()}`, 'var(--p)'],
    ];

    this.personal.set({
      fullName: employee.fullName,
      dob: employee.dateOfBirth ?? '',
      gender: employee.gender,
      nationality: employee.nationality ?? '',
      marital: employee.maritalStatus,
      blood: employee.bloodGroup ?? '',
    });

    this.job.set({
      title: employee.jobTitle,
      dept: employee.department,
      reportsTo: (!employee.reportingManager || employee.reportingManager === 'Manager') ? 'Company Admin' : employee.reportingManager,
      joinDate: employee.joinDate,
      roleCode: this.normalizeRoleCode(employee.roleCode, employee.roleName, employee.jobTitle),
    });
    this.selectedDesignationId.set(employee.designationId ?? '');

    this.hasStoredPassword.set(!!employee.password || !!employee.hasPassword);

    this.contact.set({
      phone: employee.phone ?? '',
      email: employee.email,
      password: employee.password ?? '',
      emergency: employee.emergencyContactPhone
        ? (employee.emergencyContactName ? `${employee.emergencyContactName} (${employee.emergencyContactPhone})` : employee.emergencyContactPhone)
        : (employee.emergencyContactName ?? ''),
      address: employee.address ?? '',
      city: employee.city ?? '',
      country: employee.country ?? '',
    });

    this.identity.set({
      passportNo: employee.passportNumber ?? '',
      passportExp: employee.passportExpiry ?? '',
      visaNo: employee.visaNumber ?? '',
      visaExp: employee.visaExpiry ?? '',
      emiratesId: employee.emiratesId ?? '',
    });

    this.bank.set({
      bankName: employee.bankName ?? '',
      accountName: employee.accountName ?? '',
      accountNo: employee.accountNumber ?? '',
      iban: employee.iban ?? '',
      ifsc: employee.ifscCode ?? '',
      swift: employee.swiftCode ?? '',
      currency: employee.currency,
      paymentMode: employee.paymentMode,
      wpsId: employee.wpsId ?? '',
    });

    this.api.enrolledFaces().subscribe({
      next: (faces) => {
        const match = faces.find((f) => f.employeeId.toLowerCase() === employee.id.toLowerCase());
        if (match) {
          this.isFaceEnrolled.set(true);
          this.faceEnrolledAt.set(match.enrolledAtUtc ?? null);
          this.facePhotoUrl.set(match.avatarUrl ?? null);
        } else {
          this.isFaceEnrolled.set(false);
          this.faceEnrolledAt.set(null);
          this.facePhotoUrl.set(null);
        }
      },
      error: () => { },
    });
  }

  protected save(message: string, onSuccess?: () => void): void {
    if (!this.canEditCurrentProfile()) {
      this.toast.show('HR Managers can only edit Employee profiles, not HR Manager profiles.', 'warning');
      return;
    }
    const id = this.apiId();
    const detail = this.detail();
    if (!id || !detail) {
      this.toast.show('The employee profile is not loaded yet.', 'danger');
      return;
    }

    const personal = this.personal();
    const job = this.job();
    const contact = this.contact();
    const identity = this.identity();
    const bank = this.bank();

    const [firstName, ...rest] = personal.fullName.trim().split(' ');
    const lastName = rest.join(' ') || detail.lastName;

    const body = {
      firstName: firstName || detail.firstName,
      middleName: detail.middleName,
      lastName,
      email: contact.email || detail.email,
      phone: contact.phone || null,
      departmentId: this.departmentIds.get(job.dept) ?? detail.departmentId,
      designationId: this.selectedDesignationId() ? this.selectedDesignationId() : null,
      branchId: detail.branchId,
      reportingManagerId: this.reportingManagerMap.get(job.reportsTo) ?? null,
      jobTitle: job.title || detail.jobTitle,
      roleCode: job.roleCode || detail.roleCode || (job.title.toLowerCase().includes('hr') ? 'HrManager' : 'Employee'),
      grade: '',
      employmentType: detail.employmentType,
      status: detail.status === 'On Leave' ? 'OnLeave' : detail.status,
      joinDate: this.toIso(job.joinDate) ?? detail.joinDate,
      noticePeriodDays: detail.noticePeriodDays,
      basicSalary: this.editSalary() !== null ? this.editSalary()! : detail.basicSalary,
      housingAllowance: detail.housingAllowance,
      transportAllowance: detail.transportAllowance,
      mobileAllowance: detail.mobileAllowance,
      otherAllowances: detail.otherAllowances,
      currency: bank.currency || detail.currency,
      bankName: bank.bankName || null,
      accountName: bank.accountName || null,
      accountNumber: bank.accountNo || null,
      iban: bank.iban || null,
      ifscCode: bank.ifsc || null,
      swiftCode: bank.swift || null,
      paymentMode: this.normalizePaymentMode(bank.paymentMode),
      wpsId: bank.wpsId || null,
      passportNumber: identity.passportNo || null,
      passportExpiry: this.toIso(identity.passportExp),
      visaNumber: identity.visaNo || null,
      visaExpiry: this.toIso(identity.visaExp),
      emiratesId: identity.emiratesId || null,
      // Personal & Contact fields
      dateOfBirth: this.toIso(personal.dob),
      gender: personal.gender,
      maritalStatus: personal.marital,
      bloodGroup: personal.blood || null,
      nationality: personal.nationality || null,
      address: contact.address || null,
      city: contact.city || null,
      country: detail.country || contact.country || null,
      password: contact.password || null,
      emergencyContactName: contact.emergency?.includes('(') ? contact.emergency.split('(')[0].trim() : (contact.emergency?.trim() || null),
      emergencyContactPhone: contact.emergency?.includes('(') ? contact.emergency.split('(')[1]?.replace(')', '').trim() : null,
    };

    this.api.updateEmployee(id, body).subscribe({
      next: (updated) => {
        this.populateEmployee(updated);
        this.loadEmployeeOptions();
        this.toast.show(message, 'success');
        onSuccess?.();
      },
      error: (error) => this.toast.show(error?.error?.title ?? error?.error?.message ?? 'Could not save the profile.', 'danger'),
    });
  }

  private toIso(value: string): string | null {
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const parts = value.split(/[/-]/);
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
      }
      if (parts[2].length === 4) {
        return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
      }
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  protected readonly tabs = [
    { id: 'personal', label: 'Personal', icon: 'user' },
    { id: 'contact', label: 'Contact', icon: 'mail' },
    { id: 'bank', label: 'Bank', icon: 'payroll' },
    { id: 'biometric', label: 'Face ID & Biometrics', icon: 'clock' },
  ] as const;

  protected readonly tab = signal<'personal' | 'contact' | 'bank' | 'biometric'>('personal');

  @ViewChild('enrollVideo') enrollVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild('enrollCanvas') enrollCanvas?: ElementRef<HTMLCanvasElement>;

  protected readonly faceEnrollModalOpen = signal(false);
  protected readonly enrollingFace = signal(false);
  protected readonly isFaceEnrolled = signal(false);
  protected readonly faceEnrolledAt = signal<string | null>(null);
  protected readonly facePhotoUrl = signal<string | null>(null);
  private cameraStream?: MediaStream;

  protected readonly profile = signal<ProfileData>(EmployeeProfileComponent.readProfile());

  protected readonly personal = signal({
    fullName: EmployeeProfileComponent.readProfile().name || '',
    dob: '',
    gender: 'Female',
    nationality: '',
    marital: '',
    blood: '',
  });

  protected readonly systemRoleOptions = computed<SelectOption[]>(() => {
    const base: SelectOption[] = [
      { v: 'Employee', l: 'Employee (Self-Service Portal)' },
      { v: 'HrManager', l: 'HR Manager' },
    ];
    if (this.isCompanyOrSuperAdmin()) {
      base.push({ v: 'CompanyAdmin', l: 'Company Admin' });
    }
    const current = this.job().roleCode;
    if (current && !base.some((o) => o.v === current)) {
      base.push({ v: current, l: this.detail()?.roleName || current });
    }
    return base;
  });

  private normalizeRoleCode(rawCode?: string | null, rawName?: string | null, jobTitle?: string | null): string {
    const token = (rawCode || rawName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (token === 'hr' || token === 'hrmanager') return 'HrManager';
    if (token === 'ca' || token === 'companyadmin' || token === 'manager') return 'CompanyAdmin';
    if (token === 'sa' || token === 'superadmin') return 'SuperAdmin';
    if (token === 'emp' || token === 'employee' || token === 'employeeselfserviceportal') return 'Employee';
    if (rawCode?.trim()) return rawCode.trim();
    return (jobTitle || '').toLowerCase().includes('hr') ? 'HrManager' : 'Employee';
  }

  protected readonly job = signal({
    title: '',
    dept: EmployeeProfileComponent.readProfile().dept || '',
    reportsTo: '',
    joinDate: '',
    roleCode: 'Employee',
  });

  protected readonly contact = signal({
    phone: '',
    email: EmployeeProfileComponent.readProfile().email || '',
    password: '',
    emergency: '',
    address: '',
    city: '',
    country: '',
  });

  protected readonly showContactPassword = signal(false);
  protected readonly hasStoredPassword = signal(false);
  protected readonly contactPasswordFocused = signal(false);

  protected readonly identity = signal({
    passportNo: '',
    passportExp: '',
    visaNo: '',
    visaExp: '',
    emiratesId: '',
  });

  protected readonly bank = signal({
    bankName: '',
    accountName: '',
    accountNo: '',
    iban: '',
    ifsc: '',
    swift: '',
    currency: 'INR',
    paymentMode: 'Bank Transfer',
    wpsId: '',
  });

  /** Editable salary field (separate from bank signal to avoid type issues) */
  protected readonly editSalary = signal<number | null>(null);

  protected salaryStructure: [string, string, string][] = [];

  protected deptOptions = signal<SelectOption[]>([]);
  protected reportingOptions: SelectOption[] = [
    { v: 'Company Admin', l: 'Company Admin' },
    { v: 'HR Manager', l: 'HR Manager' },
  ];
  protected readonly bankOptions: SelectOption[] = [
    { v: 'Emirates NBD', l: 'Emirates NBD' },
    { v: 'First Abu Dhabi Bank', l: 'First Abu Dhabi Bank' },
    { v: 'ADCB', l: 'ADCB' },
    { v: 'HSBC', l: 'HSBC' },
    { v: 'Other', l: 'Other' },
  ];
  protected readonly bankCurrencyOptions: SelectOption[] = ['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP'].map((c) => ({ v: c, l: c }));

  private normalizePaymentMode(value: string): string {
    const v = (value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    if (v.includes('cash')) return 'Cash';
    if (v.includes('cheque') || v.includes('check')) return 'Cheque';
    if (v.includes('wps')) return 'Wps';
    return 'BankTransfer';
  }

  protected initials(): string {
    const name = this.profile().name?.trim();
    if (!name) return 'EP';
    return name
      .split(' ')
      .filter(Boolean)
      .map((n) => n[0])
      .join('');
  }

  protected patchPersonal(key: keyof ReturnType<typeof this.personal>, value: string): void {
    this.personal.update((p) => ({ ...p, [key]: value }));
  }

  protected patchJob(key: 'title' | 'dept' | 'reportsTo' | 'joinDate' | 'roleCode', value: string): void {
    this.job.update((j) => ({ ...j, [key]: value }));
    if (key === 'dept') {
      const deptId = this.departmentIds.get(value);
      const matching = this.allDesignations().filter((d: any) =>
        (deptId && d.departmentId?.toLowerCase() === deptId.toLowerCase()) ||
        (d.department && d.department.toLowerCase() === value.toLowerCase())
      );
      const preferred = matching.find((d: any) => d.name?.trim().toLowerCase() === 'employee') || matching[0];
      const nextDesigId = preferred?.id || '';
      const desigName = preferred?.name?.trim() || 'Employee';
      this.selectedDesignationId.set(nextDesigId);
      this.job.update((j) => ({ ...j, title: `${desigName}-${value}` }));
    }
  }

  protected onDesignationChange(desigId: string): void {
    this.selectedDesignationId.set(desigId);
    const desigName = this.allDesignations().find((d: any) => d.id === desigId)?.name?.trim() || 'Employee';
    const deptName = this.job().dept?.trim() || 'General';
    this.job.update((j) => ({ ...j, title: `${desigName}-${deptName}` }));
  }

  protected patchContact(key: 'phone' | 'email' | 'password' | 'emergency' | 'address' | 'city' | 'country', value: string): void {
    this.contact.update((c) => ({ ...c, [key]: value }));
  }

  protected patchIdentity(key: 'passportNo' | 'passportExp' | 'visaNo' | 'visaExp' | 'emiratesId', value: string): void {
    this.identity.update((i) => ({ ...i, [key]: value }));
  }

  protected patchBank(key: keyof ReturnType<typeof this.bank>, value: string): void {
    this.bank.update((b) => ({ ...b, [key]: value }));
  }

  protected onSalaryInput(raw: string): void {
    const trimmed = raw.trim();
    if (!trimmed) {
      this.editSalary.set(0);
      return;
    }
    const parsed = Number(trimmed);
    this.editSalary.set(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
  }

  protected async openFaceEnrollModal(): Promise<void> {
    if (!this.canEditCurrentProfile()) {
      this.toast.show('HR Managers can only edit Employee profiles.', 'warning');
      return;
    }
    this.faceEnrollModalOpen.set(true);
    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
        audio: false,
      });
      setTimeout(() => {
        if (this.enrollVideo?.nativeElement) {
          this.enrollVideo.nativeElement.srcObject = this.cameraStream || null;
        }
      }, 200);
    } catch {
      this.toast.show('Camera access needed to capture Face ID.', 'warning');
    }
  }

  protected closeFaceEnrollModal(): void {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach((t) => t.stop());
      this.cameraStream = undefined;
    }
    this.faceEnrollModalOpen.set(false);
  }

  protected async captureAndSaveFace(): Promise<void> {
    const id = this.apiId();
    if (!id) {
      this.toast.show('Employee ID not loaded.', 'danger');
      return;
    }

    this.enrollingFace.set(true);
    let photoDataUrl = '';
    let realDescriptor: number[] | null = null;

    try {
      const video = this.enrollVideo?.nativeElement;
      const canvas = this.enrollCanvas?.nativeElement;
      if (video && canvas && video.videoWidth > 0) {
        const scan = await this.faceService.detectFace(video, canvas, true);
        if (scan.hasFace && scan.descriptor) {
          realDescriptor = scan.descriptor;
          photoDataUrl = scan.snapshot || this.faceService.captureSnapshot(video, canvas) || '';
        }
      }
    } catch { }

    if (!realDescriptor || !photoDataUrl) {
      this.enrollingFace.set(false);
      this.toast.show('No face detected in camera. Please look directly into the camera in good lighting.', 'warning');
      return;
    }

    // Check against already-enrolled employees before enrolling
    this.api.enrolledFaces().subscribe({
      next: (faces) => {
        const conflict = this.faceService.findDuplicateEnrolledFace(realDescriptor, faces || [], id, photoDataUrl);
        if (conflict) {
          this.enrollingFace.set(false);
          this.toast.show(
            `Duplicate face detected: this face is already registered to ${conflict.fullName} (${conflict.employeeCode}).`,
            'danger'
          );
          return;
        }
        this.persistFaceEnrollment(id, realDescriptor!, photoDataUrl);
      },
      error: () => this.persistFaceEnrollment(id, realDescriptor!, photoDataUrl),
    });
  }

  private persistFaceEnrollment(employeeId: string, descriptor: number[], photoDataUrl: string): void {
    this.api
      .enrollFace(employeeId, {
        faceDescriptor: JSON.stringify(descriptor),
        facePhotoUrl: photoDataUrl,
      })
      .subscribe({
        next: () => {
          this.enrollingFace.set(false);
          this.isFaceEnrolled.set(true);
          this.faceEnrolledAt.set(new Date().toISOString());
          this.facePhotoUrl.set(photoDataUrl);
          this.closeFaceEnrollModal();
          this.toast.show('Face ID registered and enrolled successfully!', 'success');
        },
        error: (err) => {
          this.enrollingFace.set(false);
          this.toast.show(
            err?.error?.title ?? err?.error?.detail ?? err?.error?.message ?? 'Could not register Face ID.',
            'danger'
          );
        },
      });
  }

  protected removeFaceId(): void {
    if (!this.canEditCurrentProfile()) {
      this.toast.show('HR Managers can only edit Employee profiles.', 'warning');
      return;
    }
    const id = this.apiId();
    if (!id) return;
    this.api.removeFace(id).subscribe({
      next: () => {
        this.isFaceEnrolled.set(false);
        this.faceEnrolledAt.set(null);
        this.facePhotoUrl.set(null);
        this.toast.show('Face ID template removed.');
      },
      error: () => this.toast.show('Could not remove Face ID.', 'danger'),
    });
  }

  private static readProfile(): ProfileData {
    const fallback: ProfileData = {
      id: '',
      name: '',
      dept: '',
      grade: '',
      status: 'Active',
      join: '',
      salary: '',
      email: '',
    };
    try {
      const stored = sessionStorage.getItem('empProfile');
      return stored ? { ...fallback, ...(JSON.parse(stored) as Partial<ProfileData>) } : fallback;
    } catch {
      return fallback;
    }
  }
}
