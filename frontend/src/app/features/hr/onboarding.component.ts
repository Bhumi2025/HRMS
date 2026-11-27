import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api/api.service';
import { EnrolledFace } from '../../core/api/api.models';
import { IconDirective } from '../../core/icons/icon.directive';
import { FaceRecognitionService } from '../../core/services/face-recognition.service';
import { CurrencyService } from '../../core/services/currency.service';
import { ToastService } from '../../core/services/toast.service';
import { ACCEPT_IMG_TYPES, validateImageFile } from '../../core/utils/file-validator';
import { SelectComponent, SelectOption } from '../../shared/select.component';
import { KeyGroupSelectComponent } from '../../shared/key-select.component';
import { KeyGroupCacheService } from '../../core/services/key-group-cache.service';

interface AccountItem {
  l: string;
  d: string;
  done: boolean;
}

/**
 * Employee Onboarding wizard — ported from pages/onboarding.html. Five steps
 * (Personal → Job → Salary → Account → Review) with a live stepper,
 * progress bar and a review screen. Bootstrap's grid is replaced by local CSS grid.
 */
@Component({
  selector: 'app-onboarding',
  imports: [CommonModule, IconDirective, SelectComponent, KeyGroupSelectComponent],
  template: `
    <!-- Stepper -->
    <div class="ob-stepper">
      @for (s of steps; track s.label; let i = $index) {
        <div class="ob-step" [class.done]="i < step()" [class.active]="i === step()" (click)="goToStep(i)" style="cursor: pointer;" [title]="'Go to ' + s.label">
          <div class="ob-circle">
            @if (i < step()) {
              <span [appIcon]="'check'"></span>
            } @else {
              {{ i + 1 }}
            }
          </div>
          <div class="ob-label">{{ s.label }}</div>
        </div>
      }
    </div>

    <!-- Card -->
    <div class="ob-card" style="margin-top: 16px;">
      <div class="ob-card-header">
        <div class="ob-card-icon"><span [appIcon]="steps[step()].icon"></span></div>
        <div>
          <div class="ob-card-title">{{ step() === 0 ? 'Personal Details' : steps[step()].label }}</div>
          <div class="ob-card-sub">{{ subtitles[step()] }}</div>
        </div>
      </div>

      <div class="ob-card-body">
        <!-- STEP 0: PERSONAL -->
        @if (step() === 0) {
          <div class="photo-banner" [style.border-color]="fieldError('facePhoto') ? '#ef4444' : ''">
            <div class="photo-avatar" style="overflow: hidden;">
              @if (enrolledFacePhoto()) {
                <img [src]="enrolledFacePhoto()" style="width: 100%; height: 100%; object-fit: cover;" alt="Employee Face Photo" />
              } @else {
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--p)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              }
            </div>
            <div>
              <div style="font-weight: 700; color: var(--text); margin-bottom: 2px">Profile Photo &amp; Face Biometrics<span class="req">*</span></div>
              <div style="color: #6b7280; margin-bottom: 10px">
                {{ isFaceEnrolled() ? 'Profile photo & facial scan ready for attendance verification and login.' : 'Register facial biometric identity now for attendance verification & login (JPG/PNG up to 2MB, or webcam scan).' }}
              </div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
                <button type="button" class="btn btn-primary btn-sm" (click)="openFaceModal()">
                  📸 {{ isFaceEnrolled() ? 'Re-scan Face ID' : 'Scan & Register Face ID' }}
                </button>
                <input
                  #photoFileInput
                  type="file"
                  [accept]="acceptImgTypes"
                  style="display: none"
                  (change)="onPhotoFileSelected($event)"
                />
                <button type="button" class="btn btn-outline btn-sm" (click)="photoFileInput.click()">
                  <span [appIcon]="'upload2'"></span> Upload File
                </button>
                @if (enrolledFacePhoto()) {
                  <button type="button" class="btn btn-ghost btn-sm" style="color: var(--danger)" (click)="removeEnrolledFace()">
                    Remove
                  </button>
                }
              </div>
              @if (fieldError('facePhoto')) {
                <div class="field-error-msg" style="margin-top: 8px">{{ fieldError('facePhoto') }}</div>
              }
            </div>
          </div>

          <div class="ob-grid ob-grid-4">
            <div class="form-group">
              <label class="form-label">First Name<span class="req">*</span></label>
              <input 
                class="form-control" 
                [class.is-invalid]="!!fieldError('firstName')"
                placeholder="Alex" 
                [value]="personal().firstName" 
                (input)="patchP('firstName', $any($event.target).value); clearError('firstName')" 
              />
              @if (fieldError('firstName')) {
                <div class="field-error-msg">{{ fieldError('firstName') }}</div>
              }
            </div>
            <div class="form-group">
              <label class="form-label">Middle Name</label>
              <input class="form-control" placeholder="Optional" [value]="personal().middleName" (input)="patchP('middleName', $any($event.target).value)" />
            </div>
            <div class="form-group">
              <label class="form-label">Last Name<span class="req">*</span></label>
              <input 
                class="form-control" 
                [class.is-invalid]="!!fieldError('lastName')"
                placeholder="Morgan" 
                [value]="personal().lastName" 
                (input)="patchP('lastName', $any($event.target).value); clearError('lastName')" 
              />
              @if (fieldError('lastName')) {
                <div class="field-error-msg">{{ fieldError('lastName') }}</div>
              }
            </div>
            <div class="form-group">
              <label class="form-label">Email Address<span class="req">*</span></label>
              <input
                class="form-control"
                [class.is-invalid]="(emailTouched() && !isEmailValid()) || !!fieldError('email')"
                type="email"
                placeholder="alex.morgan@company.com"
                [value]="personal().email"
                (input)="patchP('email', $any($event.target).value); clearError('email')"
                (blur)="emailTouched.set(true)"
              />
              @if (fieldError('email')) {
                <div class="field-error-msg">{{ fieldError('email') }}</div>
              } @else if (emailTouched() && !isEmailValid()) {
                <div class="field-error-msg">
                  Please enter a valid email address (e.g. name@company.com)
                </div>
              }
            </div>
            <div class="form-group">
              <label class="form-label">Phone Number<span class="req">*</span></label>
              <input
                class="form-control"
                [class.is-invalid]="(phoneTouched() && !isPhoneValid()) || !!fieldError('phone')"
                placeholder="+91 98765 43210"
                [value]="personal().phone"
                (input)="patchP('phone', $any($event.target).value); clearError('phone')"
                (blur)="phoneTouched.set(true)"
              />
              @if (fieldError('phone')) {
                <div class="field-error-msg">{{ fieldError('phone') }}</div>
              } @else if (phoneTouched() && !isPhoneValid()) {
                <div class="field-error-msg">
                  Please enter a valid 10-digit Indian phone number (e.g. +91 98765 43210)
                </div>
              }
            </div>
            <div class="form-group">
              <label class="form-label">Date of Birth<span class="req">*</span></label>
              <input
                class="form-control"
                [class.is-invalid]="!!fieldError('dob')"
                type="date"
                [value]="personal().dob"
                (input)="patchP('dob', $any($event.target).value); clearError('dob')"
              />
              @if (fieldError('dob')) {
                <div class="field-error-msg">{{ fieldError('dob') }}</div>
              }
            </div>
            <div class="form-group">
              <label class="form-label">Gender</label>
              <app-key-select groupCode="GENDER" [value]="personal().gender" (valueChange)="patchP('gender', $event)" width="100%" />
            </div>
            <div class="form-group">
              <label class="form-label">Marital Status</label>
              <app-key-select groupCode="MARITAL_STATUS" [value]="personal().maritalStatus" (valueChange)="patchP('maritalStatus', $event)" width="100%" />
            </div>
            <div class="form-group">
              <label class="form-label">Blood Group</label>
              <app-key-select groupCode="BLOOD_GROUP" [value]="personal().bloodGroup" (valueChange)="patchP('bloodGroup', $event)" width="100%" />
            </div>
            <div class="form-group">
              <label class="form-label">City</label>
              <input class="form-control" placeholder="San Francisco" [value]="personal().city" (input)="patchP('city', $any($event.target).value)" />
            </div>
            <div class="form-group">
              <label class="form-label">State</label>
              <input class="form-control" placeholder="CA" [value]="personal().state" (input)="patchP('state', $any($event.target).value)" />
            </div>
            <div class="form-group">
              <label class="form-label">Country</label>
              <input class="form-control" placeholder="USA" [value]="personal().country" (input)="patchP('country', $any($event.target).value)" />
            </div>
            <div class="form-group" style="grid-column: 1/-1">
              <label class="form-label">Residential Address</label>
              <textarea class="form-control" rows="3" placeholder="123 Innovation Drive, Apt 4B" [value]="personal().address" (input)="patchP('address', $any($event.target).value)"></textarea>
            </div>
          </div>
        }

        <!-- STEP 1: JOB -->
        @if (step() === 1) {
          <div class="ob-grid ob-grid-3">
            <div class="form-group">
              <label class="form-label">Department<span class="req">*</span></label>
              <app-select
                [options]="deptOptions()"
                [value]="job().department"
                (valueChange)="patchJ('department', $event); clearError('department')"
                width="100%"
              />
              @if (fieldError('department')) {
                <div class="field-error-msg">{{ fieldError('department') }}</div>
              }
            </div>
            <div class="form-group">
              <label class="form-label">Designation</label>
              <app-select [options]="designationOptions()" [value]="job().designationId" (valueChange)="patchJ('designationId', $event)" width="100%" />
            </div>
            <div class="form-group">
              <label class="form-label">Join Date<span class="req">*</span></label>
              <input 
                class="form-control" 
                [class.is-invalid]="!!fieldError('joinDate')"
                type="date" 
                [value]="job().joinDate" 
                (input)="patchJ('joinDate', $any($event.target).value); clearError('joinDate')" 
              />
              @if (fieldError('joinDate')) {
                <div class="field-error-msg">{{ fieldError('joinDate') }}</div>
              }
            </div>
            <div class="form-group">
              <label class="form-label">Employment Type</label>
              <app-key-select groupCode="EMPLOYMENT_TYPE" [value]="job().employmentType" (valueChange)="patchJ('employmentType', $event)" width="100%" />
            </div>
            <div class="form-group">
              <label class="form-label">Reporting To</label>
              <app-select [options]="managerOptions()" [value]="job().reportingManager" (valueChange)="patchJ('reportingManager', $event)" width="100%" />
            </div>
            <div class="form-group">
              <label class="form-label">Work Location</label>
              <input class="form-control" placeholder="Dubai HQ" [value]="job().workLocation" (input)="patchJ('workLocation', $any($event.target).value)" />
            </div>
            <div class="form-group">
              <label class="form-label">Shift</label>
              <app-select [options]="shiftOptions" [value]="job().shift" (valueChange)="patchJ('shift', $event)" width="100%" />
            </div>
            <div class="form-group">
              <label class="form-label">Notice Period</label>
              <input class="form-control" placeholder="30 days" [value]="job().noticePeriod" (input)="patchJ('noticePeriod', $any($event.target).value)" />
            </div>
          </div>
        }

        <!-- STEP 2: SALARY -->
        @if (step() === 2) {
          <div class="ob-grid ob-grid-3">
            <div class="form-group">
              <label class="form-label">Basic Salary<span class="req">*</span></label>
              <input 
                class="form-control" 
                [class.is-invalid]="!!fieldError('basicSalary')"
                [placeholder]="currencyService.currencySymbol() + '0.00'" 
                [value]="salary().basicSalary" 
                (input)="patchS('basicSalary', $any($event.target).value); clearError('basicSalary')" 
              />
              @if (fieldError('basicSalary')) {
                <div class="field-error-msg">{{ fieldError('basicSalary') }}</div>
              }
            </div>
            <div class="form-group">
              <label class="form-label">Payment Mode</label>
              <app-key-select groupCode="PAYMENT_MODE" [value]="salary().paymentMode" (valueChange)="patchS('paymentMode', $event)" width="100%" />
            </div>
            <div class="form-group">
              <label class="form-label">Bank Name</label>
              <input 
                class="form-control" 
                [class.is-invalid]="!!fieldError('bankName')"
                placeholder="Emirates NBD" 
                [value]="salary().bankName" 
                (input)="patchS('bankName', $any($event.target).value); clearError('bankName')" 
              />
              @if (fieldError('bankName')) {
                <div class="field-error-msg">{{ fieldError('bankName') }}</div>
              }
            </div>
            <div class="form-group">
              <label class="form-label">Account Number</label>
              <input 
                class="form-control" 
                [class.is-invalid]="!!fieldError('accountNumber')"
                placeholder="1234567890" 
                [value]="salary().accountNumber" 
                (input)="patchS('accountNumber', $any($event.target).value); clearError('accountNumber')" 
              />
              @if (fieldError('accountNumber')) {
                <div class="field-error-msg">{{ fieldError('accountNumber') }}</div>
              }
            </div>
            <div class="form-group">
              <label class="form-label">IFSC Code</label>
              <input class="form-control" placeholder="e.g. HDFC0001234" [value]="salary().ifscCode" (input)="patchS('ifscCode', $any($event.target).value)" />
            </div>
          </div>
        }

        <!-- STEP 3: ACCOUNT -->
        @if (step() === 3) {
          <div style="display: flex; flex-direction: column; gap: 16px">
            <div style="background: var(--surface); border: 1.5px solid var(--border); border-radius: 10px; padding: 18px">
              <div style="display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; color: var(--text); margin-bottom: 4px">
                <span [appIcon]="'lock'" style="color: var(--p)"></span> Employee Portal Login Credentials
              </div>
              <div style="font-size: 13px; color: var(--muted); margin-bottom: 16px">
                Configure portal access role. Upon onboarding, the employee will receive an email with a <strong>Set Password</strong> button to create their own password.
              </div>

              <div class="ob-grid ob-grid-2">
                <div class="form-group">
                  <label class="form-label">Login Email<span class="req">*</span></label>
                  <input
                    class="form-control"
                    [value]="personal().email"
                    readonly
                    style="background: var(--bg); cursor: not-allowed; font-weight: 500"
                    placeholder="email@company.com"
                  />
                  <div style="font-size: 11px; color: var(--muted); margin-top: 4px">Auto-filled from personal details</div>
                </div>

                <div class="form-group">
                  <label class="form-label">System Role<span class="req">*</span></label>
                  <app-select
                    [options]="roleOptions"
                    [value]="accountForm().role"
                    (valueChange)="patchAccount('role', $event)"
                    width="100%"
                  />
                  <div style="font-size: 11px; color: var(--muted); margin-top: 4px">Grants employee access permissions</div>
                </div>
              </div>
            </div>

            <!-- Face Biometric Authentication (Add Face) Card -->
            <div style="background: var(--surface); border: 1.5px solid var(--border); border-radius: 10px; padding: 18px">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px">
                <div style="display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; color: var(--text)">
                  <span [appIcon]="'camera'" style="color: var(--p)"></span> Face ID Biometric Authentication
                </div>
                @if (isFaceEnrolled()) {
                  <span class="badge badge-success" style="display: inline-flex; align-items: center; gap: 6px; font-weight: 600; padding: 4px 10px; font-size: 12px">
                    <span [appIcon]="'check'"></span> Face ID Enrolled
                  </span>
                } @else {
                  <span class="badge badge-warning" style="display: inline-flex; align-items: center; gap: 6px; font-weight: 600; padding: 4px 10px; font-size: 12px">
                    Pending Face Registration
                  </span>
                }
              </div>

              <div style="font-size: 13px; color: var(--muted); margin-bottom: 16px; line-height: 1.5">
                Register employee facial biometrics to enable 1-second passwordless sign-in and automated facial Clock In / Clock Out.
              </div>

              @if (isFaceEnrolled()) {
                <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 14px 18px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap">
                  <div style="display: flex; align-items: center; gap: 14px">
                    @if (enrolledFacePhoto()) {
                      <img [src]="enrolledFacePhoto()" alt="Enrolled Face" style="width: 58px; height: 58px; border-radius: 12px; object-fit: cover; border: 2.5px solid var(--success); box-shadow: 0 4px 12px rgba(16,185,129,0.25)" />
                    } @else {
                      <div style="width: 58px; height: 58px; border-radius: 12px; background: rgba(16,185,129,0.15); color: var(--success); display: flex; align-items: center; justify-content: center; font-size: 24px">
                        <span [appIcon]="'shield'"></span>
                      </div>
                    }
                    <div>
                      <div style="font-size: 13.5px; font-weight: 700; color: var(--text); display: flex; align-items: center; gap: 8px">
                        <span>Face Profile Ready</span>
                        <span style="font-size: 11px; background: rgba(16,185,129,0.15); color: var(--success); padding: 2px 8px; border-radius: 4px; font-weight: 600">Verified</span>
                      </div>
                      <div style="font-size: 12px; color: var(--muted); margin-top: 3px">
                        Facial verification ready for attendance punching and secure portal login.
                      </div>
                    </div>
                  </div>

                  <div style="display: flex; align-items: center; gap: 10px">
                    <button type="button" class="btn btn-outline btn-sm" (click)="openFaceModal()" style="display: inline-flex; align-items: center; gap: 6px">
                      <span [appIcon]="'camera'"></span> Re-scan Face
                    </button>
                    <button type="button" class="btn btn-ghost btn-sm" (click)="removeEnrolledFace()" style="color: var(--danger); display: inline-flex; align-items: center; gap: 6px">
                      <span [appIcon]="'trash'"></span> Remove
                    </button>
                  </div>
                </div>
              } @else {
                <div style="background: var(--bg); border: 1.5px dashed var(--border); border-radius: 8px; padding: 18px 20px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap">
                  <div style="display: flex; align-items: center; gap: 14px">
                    <div style="width: 48px; height: 48px; border-radius: 12px; background: var(--p-soft); color: var(--p); display: flex; align-items: center; justify-content: center; flex-shrink: 0">
                      <span [appIcon]="'camera'"></span>
                    </div>
                    <div>
                      <div style="font-size: 13.5px; font-weight: 600; color: var(--text)">No Face Biometrics Enrolled</div>
                      <div style="font-size: 12px; color: var(--muted); margin-top: 2px">
                        Capture the employee's face using webcam to enable touchless Face ID verification.
                      </div>
                    </div>
                  </div>

                  <button type="button" class="btn btn-primary" (click)="openFaceModal()" style="display: inline-flex; align-items: center; gap: 8px; padding: 9px 18px; font-weight: 600; box-shadow: 0 4px 14px rgba(59,130,246,0.25)">
                    <span [appIcon]="'camera'"></span> 📸 Add Face
                  </button>
                </div>
              }
            </div>

            <!-- Provisioning Checklist -->
            <div style="display: flex; flex-direction: column; gap: 8px">
              <div style="font-size: 13px; font-weight: 700; color: var(--text); margin-bottom: 2px">Provisioning Checklist</div>
              <div class="sys-row done">
                <div style="display: flex; align-items: center; gap: 10px">
                  <div style="width: 32px; height: 32px; min-width: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: rgba(5,150,105,.1); color: var(--success)">
                    <span [appIcon]="'check'"></span>
                  </div>
                  <div>
                    <div class="sys-label" style="font-weight: 600">Company Email Identity</div>
                    <div class="sys-label" style="color: var(--muted)">{{ personal().email || 'Pending personal details' }}</div>
                  </div>
                </div>
                <span class="badge badge-success" style="display: flex; align-items: center; gap: 4px">✓ Ready</span>
              </div>

              <div class="sys-row done">
                <div style="display: flex; align-items: center; gap: 10px">
                  <div
                    style="width: 32px; height: 32px; min-width: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: rgba(5,150,105,.1); color: var(--success)"
                  >
                    <span [appIcon]="'mail'"></span>
                  </div>
                  <div>
                    <div class="sys-label" style="font-weight: 600">HRMS Portal Access</div>
                    <div class="sys-label" style="color: var(--muted)">
                      Set Password invite will be emailed to employee ({{ accountForm().role }} role)
                    </div>
                  </div>
                </div>
                <span class="badge badge-success" style="display: flex; align-items: center; gap: 4px">✓ Invite Ready</span>
              </div>

              <div class="sys-row" [class.done]="isFaceEnrolled()">
                <div style="display: flex; align-items: center; gap: 10px">
                  <div
                    style="width: 32px; height: 32px; min-width: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center"
                    [style.background]="isFaceEnrolled() ? 'rgba(5,150,105,.1)' : 'var(--p-soft)'"
                    [style.color]="isFaceEnrolled() ? 'var(--success)' : 'var(--p)'"
                  >
                    <span [appIcon]="isFaceEnrolled() ? 'check' : 'shield'"></span>
                  </div>
                  <div>
                    <div class="sys-label" style="font-weight: 600">Face Biometric Identity</div>
                    <div class="sys-label" style="color: var(--muted)">
                      {{ isFaceEnrolled() ? 'Face recognition active for automated Login & Clock In/Out' : 'Webcam scan required for biometric attendance' }}
                    </div>
                  </div>
                </div>
                @if (isFaceEnrolled()) {
                  <span class="badge badge-success" style="display: flex; align-items: center; gap: 4px">✓ Enrolled</span>
                } @else {
                  <button type="button" class="btn btn-outline btn-sm" (click)="openFaceModal()">📸 Add Face</button>
                }
              </div>

              <div class="sys-row">
                <div style="display: flex; align-items: center; gap: 10px">
                  <div style="width: 32px; height: 32px; min-width: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: var(--p-soft); color: var(--p)">
                    <span [appIcon]="'settings'"></span>
                  </div>
                  <div>
                    <div class="sys-label" style="font-weight: 600">IT Equipment</div>
                    <div class="sys-label" style="color: var(--muted)">Assign workstation and hardware during first day</div>
                  </div>
                </div>
                <span class="badge badge-warning">On-site</span>
              </div>
            </div>
          </div>
        }

        <!-- STEP 4: REVIEW / SUCCESS -->
        @if (step() === 4) {
          @if (submitted()) {
            <div class="review-card" style="text-align: center; padding: 48px 20px">
              <div style="width: 60px; height: 60px; border-radius: 50%; background: var(--p); display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; color: #fff">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              <div style="font-size: 1.5rem; font-weight: 700; color: var(--text); margin-bottom: 8px">Onboarding Complete!</div>
              <div style="color: var(--muted); margin-bottom: 6px">
                <strong>{{ reviewName() }}</strong> has been successfully registered.
              </div>
              <div style="color: var(--text); font-weight: 600; margin-bottom: 4px">
                Login Account Active: <span style="color: var(--p)">{{ reviewEmail() }}</span>
              </div>
              <div style="color: var(--muted); font-size: 13px; margin-bottom: 28px">
                A welcome email with a <strong>Set Password</strong> button has been sent so the employee can set their own password and sign in.
              </div>
              <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap">
                <button class="btn btn-outline" (click)="restart()">Onboard Another</button>
                <button class="btn btn-primary" (click)="goEmployees()">View Employees Directory</button>
              </div>
            </div>
          } @else {
            <div style="display: flex; flex-direction: column; gap: 10px">
              <div style="border: 1.5px solid var(--border); border-radius: 10px; overflow: hidden">
                <div style="background: var(--p-soft); padding: 10px 16px; display: flex; align-items: center; justify-content: space-between">
                  <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; color: var(--text)">
                    <span [appIcon]="'user'"></span> Personal Information
                  </div>
                  <button class="btn btn-outline btn-sm" (click)="step.set(0)">Edit</button>
                </div>
                <div class="ob-grid ob-grid-3" style="padding: 11px">
                  @for (f of personalReview; track f[1]) {
                    <div>
                      <div style="font-size: 13px; color: var(--muted); margin-bottom: 2px">{{ f[0] }}</div>
                      <div style="font-size: 13px; font-weight: 600; color: var(--text)">{{ value(personal()[f[1]]) }}</div>
                    </div>
                  }
                  <div style="grid-column: 1/-1">
                    <div style="font-size: 13px; color: var(--muted); margin-bottom: 2px">Residential Address</div>
                    <div style="font-size: 13px; font-weight: 600; color: var(--text)">{{ value(personal().address) }}</div>
                  </div>
                </div>
              </div>

              <div style="border: 1.5px solid var(--border); border-radius: 10px; overflow: hidden">
                <div style="background: var(--p-soft); padding: 10px 16px; display: flex; align-items: center; justify-content: space-between">
                  <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 0.9rem; color: var(--text)">
                    <span [appIcon]="'employees'"></span> Job Details
                  </div>
                  <button class="btn btn-outline btn-sm" (click)="step.set(1)">Edit</button>
                </div>
                <div class="ob-grid ob-grid-3" style="padding: 11px">
                  <div>
                    <div style="font-size: 13px; color: var(--muted); margin-bottom: 2px">Designation</div>
                    <div style="font-size: 13px; font-weight: 600; color: var(--text)">{{ selectedDesignationName() }}</div>
                  </div>
                  @for (f of jobReview; track f[1]) {
                    <div>
                      <div style="font-size: 13px; color: var(--muted); margin-bottom: 2px">{{ f[0] }}</div>
                      <div style="font-size: 13px; font-weight: 600; color: var(--text)">{{ value(job()[f[1]]) }}</div>
                    </div>
                  }
                </div>
              </div>

              <div style="border: 1.5px solid var(--border); border-radius: 10px; overflow: hidden">
                <div style="background: var(--p-soft); padding: 10px 16px; display: flex; align-items: center; justify-content: space-between">
                  <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 0.9rem; color: var(--text)">
                    <span [appIcon]="'payroll'"></span> Salary &amp; Bank
                  </div>
                  <button class="btn btn-outline btn-sm" (click)="step.set(2)">Edit</button>
                </div>
                <div class="ob-grid ob-grid-3" style="padding: 11px">
                  @for (f of salaryReview; track f[1]) {
                    <div>
                      <div style="font-size: 13px; color: var(--muted); margin-bottom: 2px">{{ f[0] }}</div>
                      <div style="font-size: 13px; font-weight: 600; color: var(--text)">{{ value(salary()[f[1]]) }}</div>
                    </div>
                  }
                </div>
              </div>

              <div style="border: 1.5px solid var(--border); border-radius: 10px; overflow: hidden">
                <div style="background: var(--p-soft); padding: 10px 16px; display: flex; align-items: center; justify-content: space-between">
                  <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 0.9rem; color: var(--text)">
                    <span [appIcon]="'lock'"></span> Account &amp; Login Access
                  </div>
                  <button class="btn btn-outline btn-sm" (click)="step.set(3)">Edit</button>
                </div>
                <div class="ob-grid ob-grid-3" style="padding: 12px">
                  <div>
                    <div style="font-size: 13px; color: var(--muted); margin-bottom: 2px">Login Email</div>
                    <div style="font-size: 13px; font-weight: 600; color: var(--text)">{{ value(personal().email) }}</div>
                  </div>
                  <div>
                    <div style="font-size: 13px; color: var(--muted); margin-bottom: 2px">Password Setup</div>
                    <div style="font-size: 13px; font-weight: 600; color: var(--p)">Set Password link via email</div>
                  </div>
                  <div>
                    <div style="font-size: 13px; color: var(--muted); margin-bottom: 2px">System Role</div>
                    <div style="font-size: 13px; font-weight: 600; color: var(--text)">{{ accountForm().role }}</div>
                  </div>
                  <div>
                    <div style="font-size: 13px; color: var(--muted); margin-bottom: 2px">Face Biometrics</div>
                    <div style="font-size: 13px; font-weight: 700;" [style.color]="isFaceEnrolled() ? 'var(--success)' : 'var(--warning)'">
                      {{ isFaceEnrolled() ? '✅ Enrolled' : '⚠️ Not enrolled' }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            @if (submitting()) {
              <div class="ob-waiting-bar" style="margin-top: 14px; padding: 14px 16px; border-radius: 10px; background: var(--p-soft); border: 1px solid var(--p-mid);">
                <div style="display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 13.5px; color: var(--text); margin-bottom: 8px;">
                  <span class="ob-wait-spinner"></span>
                  <span>Creating employee profile &amp; sending onboarding email… Please wait.</span>
                </div>
                <div class="ob-progress-track">
                  <div class="ob-progress-indeterminate"></div>
                </div>
              </div>
            }
          }
        }
      </div>

      @if (step() < 4 || !submitted()) {
        <div class="ob-card-footer">
          <div style="font-size: 13px; color: var(--muted); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
            {{ subtitles[step()] }}
          </div>
          <div style="display: flex; gap: 10px; flex-shrink: 0">
            @if (step() > 0) {
              <button class="btn btn-outline" style="display: flex; align-items: center; gap: 6px" [disabled]="submitting()" (click)="back()">
                <span [appIcon]="'chevron'"></span> Back
              </button>
            }
            <button class="btn btn-primary" style="display: flex; align-items: center; gap: 6px" [disabled]="checkingEmail() || submitting()" (click)="next()">
              {{ submitting() ? 'Sending Onboarding Email…' : (checkingEmail() ? 'Verifying…' : (step() === 4 ? 'Submit & Complete' : 'Next')) }} <span [appIcon]="'arrow_right'"></span>
            </button>
          </div>
        </div>
      }
    </div>

    <!-- Onboarding Success Popup (5-second auto-dismiss) -->
    @if (showOnboardSuccess()) {
      <div class="ob-success-backdrop" (click)="dismissOnboardSuccess()">
        <div class="ob-success-popup" (click)="$event.stopPropagation()">
          <div class="ob-success-icon-wrap">
            <div class="ob-success-icon">
              <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
          </div>
          <div class="ob-success-title">Onboarding Complete!</div>
          <div class="ob-success-name">{{ onboardedEmployeeName() }}</div>
          <div class="ob-success-meta">
            <span class="ob-success-role">{{ onboardedEmployeeRole() }}</span>
          </div>
          <div class="ob-success-msg">
            Onboarding is complete for <strong>{{ onboardedEmployeeName() }}</strong>.
            The onboarding &amp; password-setup link has been sent to
            <span style="color: var(--p); font-weight: 600; word-break: break-all;">{{ onboardedEmployeeEmail() }}</span>.
          </div>
          <div class="ob-success-actions">
            <button type="button" class="btn btn-outline" (click)="dismissOnboardSuccess(); restart()">Onboard Another</button>
            <button type="button" class="btn btn-primary" (click)="dismissOnboardSuccess(); goEmployees()">View Employees</button>
          </div>
          <div class="ob-success-timer-bar">
            <div class="ob-success-timer-fill"></div>
          </div>
        </div>
      </div>
    }

    <!-- Onboarding Face Enrollment Modal -->
    @if (showFaceModal()) {
      <div class="face-modal-backdrop" (click)="closeFaceModal()">
        <div class="face-modal-card" (click)="$event.stopPropagation()">
          <div class="face-modal-header">
            <div class="face-header-icon">
              <span [appIcon]="'shield'"></span>
            </div>
            <div class="face-header-info">
              <h3 class="face-header-title">📸 Onboarding Face Registration</h3>
              <div class="face-header-sub">
                <span>{{ personal().firstName || 'New' }} {{ personal().lastName || 'Hire' }}</span>
                <span class="emp-badge">Biometric Enrollment</span>
              </div>
            </div>
            <button class="face-close-btn" (click)="closeFaceModal()"><span [appIcon]="'x'"></span></button>
          </div>

          <div class="face-viewport-wrap">
            <div class="face-viewport">
              <video #obFaceVideo class="face-video" playsinline muted autoplay [class.active]="cameraActive()"></video>
              <canvas #obFaceCanvas class="face-canvas"></canvas>

              @if (!cameraActive() || faceService.loadingModels()) {
                <div class="face-camera-loading">
                  <div class="face-spinner"></div>
                  <div class="face-loading-text">
                    {{ faceService.loadingModels() ? 'Preparing camera verification…' : 'Starting camera feed…' }}
                  </div>
                </div>
              }

              <div class="face-hud-reticle" [class.scanning]="faceCapturing()" [class.matched]="isFaceEnrolled()">
                <div class="reticle-corner tl"></div>
                <div class="reticle-corner tr"></div>
                <div class="reticle-corner bl"></div>
                <div class="reticle-corner br"></div>
                <div class="reticle-laser" [class.active]="faceCapturing()"></div>
              </div>
            </div>
          </div>

          <div class="face-status-banner">
            <div class="status-text">{{ faceModalMsg() }}</div>
          </div>

          <div class="face-modal-footer">
            <button class="btn btn-outline" (click)="closeFaceModal()">Cancel</button>
            <button
              class="btn btn-primary"
              style="flex: 1"
              [disabled]="faceCapturing() || !cameraActive()"
              (click)="captureFaceBiometrics()"
            >
              @if (faceCapturing()) {
                <span class="face-spinner-sm"></span> Analyzing &amp; Enrolling…
              } @else {
                📸 Capture &amp; Enroll Face ID
              }
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .ob-stepper {
        display: flex;
        align-items: flex-start;
        margin-bottom: 10px;
      }
      .ob-step {
        display: flex;
        flex-direction: column;
        align-items: center;
        flex: 1;
        position: relative;
      }
      .ob-step:not(:last-child)::after {
        content: '';
        position: absolute;
        top: 17px;
        left: calc(50% + 22px);
        right: calc(-50% + 22px);
        height: 2px;
        background: var(--border);
        z-index: 0;
        transition: background 0.3s;
      }
      .ob-step.done:not(:last-child)::after {
        background: var(--p);
      }
      .ob-circle {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.82rem;
        font-weight: 700;
        border: 2px solid var(--border);
        background: var(--surface);
        color: var(--muted);
        z-index: 1;
        transition: all 0.3s;
        position: relative;
      }
      .ob-step.done .ob-circle {
        background: var(--p);
        border-color: var(--p);
        color: #fff;
      }
      .ob-step.active .ob-circle {
        background: var(--surface);
        border-color: var(--p);
        color: var(--p);
        box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12);
      }
      .ob-label {
        font-size: 13px;
        font-weight: 600;
        margin-top: 6px;
        color: var(--muted);
        text-align: center;
        white-space: nowrap;
      }
      .ob-step.active .ob-label {
        color: var(--p);
        font-weight: 700;
      }
      .ob-step.done .ob-label {
        color: var(--text);
      }
      .ob-card {
        background: var(--surface);
        border-radius: 10px;
        border: 1px solid var(--border);
        box-shadow: var(--shadow);
        overflow: hidden;
      }
      .ob-card-header {
        padding: 10px 15px;
        border-bottom: 1px solid var(--border);
        display: flex;
        align-items: center;
        gap: 16px;
        background: var(--p-soft);
      }
      .ob-card-icon {
        width: 44px;
        height: 44px;
        border-radius: 12px;
        background: var(--p);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        flex-shrink: 0;
      }
      .ob-card-title {
        font-size: 1.05rem;
        font-weight: 700;
        color: var(--text);
      }
      .ob-card-sub {
        font-size: 13px;
        color: var(--muted);
        margin-top: 2px;
      }
      .ob-card-body {
        padding: 15px;
        max-height: calc(100vh - 372px);
        overflow-y: auto;
      }
      .ob-card-footer {
        padding: 10px;
        border-top: 1px solid var(--border);
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: var(--bg);
      }
      .photo-banner {
        background: var(--p-soft);
        border-radius: 14px;
        padding: 20px 24px;
        display: flex;
        align-items: center;
        gap: 20px;
        margin-bottom: 24px;
      }
      .photo-avatar {
        width: 64px;
        height: 64px;
        border-radius: 50%;
        background: #fff;
        border: 3px solid var(--p-mid);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .req {
        color: #ef4444;
        margin-left: 2px;
      }
      .doc-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        border: 1.5px solid var(--border);
        border-radius: 10px;
        transition: 0.2s;
        gap: 8px;
        margin-bottom: 8px;
      }
      .doc-row:hover {
        border-color: var(--p);
        background: rgba(37, 99, 235, 0.02);
      }
      .sys-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        gap: 8px;
        border-radius: 10px;
        border: 1.5px solid var(--border);
        margin-bottom: 8px;
      }
      .sys-label,
      .doc-label {
        font-size: 13px;
      }
      .sys-row.done {
        border-color: rgba(5, 150, 105, 0.3);
        background: rgba(5, 150, 105, 0.03);
      }
      .form-group {
        margin-bottom: 0;
      }
      .ob-grid {
        display: grid;
        gap: 12px;
      }
      .ob-grid-2 {
        grid-template-columns: repeat(2, 1fr);
      }
      .ob-grid-3 {
        grid-template-columns: repeat(3, 1fr);
      }
      @media (max-width: 768px) {
        .ob-grid-2 {
          grid-template-columns: 1fr;
        }
      }
      .ob-grid-4 {
        grid-template-columns: repeat(4, 1fr);
      }
      @media (max-width: 1200px) {
        .ob-grid-4 {
          grid-template-columns: repeat(3, 1fr);
        }
      }
      @media (max-width: 900px) {
        .ob-grid-3,
        .ob-grid-4 {
          grid-template-columns: repeat(2, 1fr);
        }
      }
      @media (max-width: 768px) {
        .ob-card-body {
          max-height: calc(100vh - 340px);
        }
      }
      @media (max-width: 600px) {
        .ob-label {
          font-size: 12px;
        }
        .ob-circle {
          width: 28px;
          height: 28px;
          font-size: 12px;
        }
        .ob-step:not(:last-child)::after {
          top: 13px;
          left: calc(50% + 16px);
          right: calc(-50% + 16px);
        }
        .ob-card-header {
          gap: 10px;
        }
        .ob-card-title {
          font-size: 0.9rem;
        }
        .ob-card-icon {
          width: 36px;
          height: 36px;
          border-radius: 8px;
        }
        .photo-banner {
          padding: 14px;
          gap: 12px;
        }
      }
      @media (max-width: 480px) {
        .ob-grid-3,
        .ob-grid-4 {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 400px) {
        .ob-label {
          display: none;
        }
        .ob-circle {
          width: 26px;
          height: 26px;
        }
        .ob-step:not(:last-child)::after {
          top: 12px;
          left: calc(50% + 14px);
          right: calc(-50% + 14px);
        }
        .ob-card-body {
          padding: 10px;
        }
      }

      /* Modal Popup Dialog Styles */
      .face-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(8, 12, 24, 0.85);
        backdrop-filter: blur(12px);
        padding: 16px;
        animation: modalFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .face-modal-card {
        width: 100%;
        max-width: 490px;
        background: #0f172a;
        border: 1px solid rgba(59, 130, 246, 0.3);
        border-radius: 18px;
        box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.05);
        overflow: hidden;
        color: #f8fafc;
        animation: modalPopIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .face-modal-header {
        padding: 16px 20px 14px;
        display: flex;
        align-items: center;
        gap: 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .face-header-icon {
        width: 40px;
        height: 40px;
        border-radius: 10px;
        background: rgba(37, 99, 235, 0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #60a5fa;
      }
      .face-header-info {
        flex: 1;
      }
      .face-header-title {
        font-size: 15px;
        font-weight: 700;
        color: #fff;
        margin: 0;
      }
      .face-header-sub {
        font-size: 11px;
        color: #94a3b8;
        margin-top: 2px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .emp-badge {
        padding: 2px 7px;
        background: rgba(59, 130, 246, 0.2);
        color: #93c5fd;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.3px;
      }
      .face-close-btn {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: #94a3b8;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
      }
      .face-close-btn:hover {
        background: rgba(255, 255, 255, 0.12);
        color: #fff;
      }
      .face-viewport-wrap {
        padding: 14px 18px;
        background: #0b1120;
      }
      .face-viewport {
        position: relative;
        width: 100%;
        height: 270px;
        border-radius: 12px;
        overflow: hidden;
        background: #020617;
      }
      .face-video {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transform: scaleX(-1);
        display: block;
      }
      .face-canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        transform: scaleX(-1);
        pointer-events: none;
        z-index: 2;
      }
      .face-camera-loading {
        position: absolute;
        inset: 0;
        z-index: 10;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: rgba(2, 6, 23, 0.92);
        gap: 8px;
        font-size: 12px;
        color: #e2e8f0;
      }
      .face-spinner {
        width: 32px;
        height: 32px;
        border: 3px solid rgba(59, 130, 246, 0.2);
        border-top-color: #3b82f6;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      .face-spinner-sm {
        display: inline-block;
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      .face-hud-reticle {
        position: absolute;
        top: 12%;
        left: 20%;
        right: 20%;
        bottom: 18%;
        border: 1.5px dashed rgba(59, 130, 246, 0.5);
        border-radius: 20px;
        pointer-events: none;
        z-index: 3;
        transition: all 0.25s ease;
      }
      .face-hud-reticle.matched {
        border-color: #10b981;
        border-style: solid;
        box-shadow: 0 0 20px rgba(16, 185, 129, 0.5);
      }
      .reticle-corner {
        position: absolute;
        width: 12px;
        height: 12px;
        border: 2.5px solid #60a5fa;
      }
      .face-hud-reticle.matched .reticle-corner {
        border-color: #10b981;
      }
      .reticle-corner.tl { top: -2px; left: -2px; border-right: none; border-bottom: none; border-top-left-radius: 6px; }
      .reticle-corner.tr { top: -2px; right: -2px; border-left: none; border-bottom: none; border-top-right-radius: 6px; }
      .reticle-corner.bl { bottom: -2px; left: -2px; border-right: none; border-top: none; border-bottom-left-radius: 6px; }
      .reticle-corner.br { bottom: -2px; right: -2px; border-left: none; border-top: none; border-bottom-right-radius: 6px; }
      .reticle-laser {
        position: absolute;
        left: 0;
        right: 0;
        height: 2px;
        background: #38bdf8;
        box-shadow: 0 0 10px #38bdf8;
        opacity: 0;
      }
      .reticle-laser.active {
        opacity: 1;
        animation: laserSweep 1.5s ease-in-out infinite alternate;
      }
      .face-status-banner {
        margin: 10px 18px;
        padding: 10px 14px;
        border-radius: 8px;
        background: rgba(30, 41, 59, 0.7);
        border: 1px solid rgba(255, 255, 255, 0.08);
        font-size: 12px;
        color: #cbd5e1;
        text-align: center;
      }
      .face-modal-footer {
        padding: 14px 18px 16px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        gap: 10px;
      }
      @keyframes modalFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes modalPopIn {
        from { opacity: 0; transform: scale(0.95) translateY(12px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      .field-error-msg {
        font-size: 11px;
        color: #ef4444;
        margin-top: 4px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .form-control.is-invalid {
        border-color: #ef4444 !important;
      }
      .ob-wait-spinner {
        width: 16px;
        height: 16px;
        border: 2.5px solid rgba(37, 99, 235, 0.25);
        border-top-color: var(--p, #2563eb);
        border-radius: 50%;
        display: inline-block;
        animation: obSpin 0.8s linear infinite;
        flex-shrink: 0;
      }
      .ob-progress-track {
        width: 100%;
        height: 6px;
        background: rgba(37, 99, 235, 0.14);
        border-radius: 999px;
        overflow: hidden;
        position: relative;
      }
      .ob-progress-indeterminate {
        position: absolute;
        top: 0;
        left: 0;
        height: 100%;
        width: 40%;
        background: linear-gradient(90deg, var(--p, #2563eb), #60a5fa);
        border-radius: 999px;
        animation: obProgressSlide 1.3s ease-in-out infinite;
      }
      @keyframes obSpin {
        to {
          transform: rotate(360deg);
        }
      }
      @keyframes obProgressSlide {
        0% {
          transform: translateX(-100%);
        }
        100% {
          transform: translateX(350%);
        }
      }

      /* ── Onboarding Success Popup ── */
      .ob-success-backdrop {
        position: fixed;
        inset: 0;
        z-index: 20000;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(6px);
        animation: modalFadeIn 0.25s ease;
      }
      .ob-success-popup {
        background: var(--surface, #fff);
        border-radius: 20px;
        padding: 36px 32px 24px;
        max-width: 420px;
        width: 100%;
        text-align: center;
        box-shadow: 0 30px 80px -20px rgba(0,0,0,0.3), 0 0 0 1px rgba(37,99,235,0.08);
        animation: modalPopIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        position: relative;
        overflow: hidden;
      }
      .ob-success-icon-wrap {
        margin-bottom: 20px;
      }
      .ob-success-icon {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        background: linear-gradient(135deg, #22c55e, #16a34a);
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto;
        box-shadow: 0 8px 24px rgba(34, 197, 94, 0.35);
        animation: popBounce 0.5s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes popBounce {
        0% { transform: scale(0); }
        70% { transform: scale(1.12); }
        100% { transform: scale(1); }
      }
      .ob-success-title {
        font-size: 1.5rem;
        font-weight: 800;
        color: var(--text, #0f172a);
        margin-bottom: 6px;
      }
      .ob-success-name {
        font-size: 1.15rem;
        font-weight: 700;
        color: var(--p, #2563eb);
        margin-bottom: 6px;
      }
      .ob-success-meta {
        margin-bottom: 12px;
      }
      .ob-success-role {
        display: inline-block;
        padding: 3px 10px;
        border-radius: 999px;
        background: var(--p-soft, #eff6ff);
        color: var(--p, #2563eb);
        font-size: 11.5px;
        font-weight: 700;
      }
      .ob-success-msg {
        font-size: 13.5px;
        color: var(--muted, #64748b);
        line-height: 1.6;
        margin-bottom: 24px;
      }
      .ob-success-actions {
        display: flex;
        gap: 10px;
        justify-content: center;
        flex-wrap: wrap;
        margin-bottom: 20px;
      }
      .ob-success-timer-bar {
        height: 4px;
        background: var(--border, #e5e7eb);
        border-radius: 999px;
        overflow: hidden;
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
      }
      .ob-success-timer-fill {
        height: 100%;
        background: var(--p, #2563eb);
        border-radius: 999px;
        animation: countdownBar 5s linear forwards;
      }
      @keyframes countdownBar {
        from { width: 100%; }
        to { width: 0%; }
      }
    `,
  ],
})
export class OnboardingComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  protected readonly toast = inject(ToastService);
  private readonly api = inject(ApiService);
  private readonly keyGroupCache = inject(KeyGroupCacheService);
  protected readonly faceService = inject(FaceRecognitionService);
  protected readonly currencyService = inject(CurrencyService);

  @ViewChild('obFaceVideo') private obFaceVideoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('obFaceCanvas') private obFaceCanvasRef?: ElementRef<HTMLCanvasElement>;
  private obMediaStream?: MediaStream;

  protected readonly showFaceModal = signal(false);
  protected readonly cameraActive = signal(false);
  protected readonly faceCapturing = signal(false);
  protected readonly enrolledFaceDescriptor = signal<number[] | null>(null);
  protected readonly enrolledFacePhoto = signal<string | null>(null);
  protected readonly isFaceEnrolled = computed(() => this.enrolledFaceDescriptor() !== null);
  protected readonly faceModalMsg = signal('Align face within the frame and click Capture Face');

  private departmentIds = new Map<string, string>();
  private managerMap = new Map<string, string>();
  protected readonly allDesignations = signal<any[]>([]);
  protected readonly deptOptions = signal<SelectOption[]>([]);
  protected readonly designationOptions = computed<SelectOption[]>(() => {
    const list = this.allDesignations();
    const currentDeptName = this.job().department;
    const currentDeptId = this.departmentIds.get(currentDeptName);

    const filtered = list.filter((d: any) => {
      if (currentDeptId && d.departmentId) {
        return d.departmentId.toLowerCase() === currentDeptId.toLowerCase();
      }
      if (currentDeptName && d.department) {
        return d.department.toLowerCase() === currentDeptName.toLowerCase();
      }
      return false;
    });

    return filtered.map((d: any) => ({ v: d.id, l: d.name }));
  });

  protected readonly checkingEmail = signal(false);
  protected readonly submitting = signal(false);
  protected readonly showOnboardSuccess = signal(false);
  protected readonly onboardedEmployeeName = signal('');
  protected readonly onboardedEmployeeEmail = signal('');
  protected readonly onboardedEmployeeRole = signal('Employee');
  private enrolledFacesList: EnrolledFace[] = [];
  private successPopupTimer?: ReturnType<typeof setTimeout>;

  protected readonly selectedDesignationName = computed(() => {
    const id = this.job().designationId;
    if (!id) return 'Employee';
    return this.allDesignations().find((d: any) => d.id === id)?.name?.trim() || 'Employee';
  });

  protected readonly computedJobTitle = computed(() => {
    const desig = this.selectedDesignationName() || 'Employee';
    const dept = this.job().department?.trim() || 'General';
    return `${desig}-${dept}`;
  });

  ngOnInit(): void {
    this.keyGroupCache.clearCache();
    this.loadEnrolledFacesCache();
    this.api.departments().subscribe({
      next: (departments) => {
        const list = departments || [];
        this.departmentIds = new Map(list.map((d) => [d.name, d.id]));
        const opts = list.map((d) => ({ v: d.name, l: d.name }));
        if (!opts.some((o) => o.v.toLowerCase() === 'general')) {
          opts.unshift({ v: 'General', l: 'General' });
        } else {
          opts.sort((a, b) => (a.v.toLowerCase() === 'general' ? -1 : b.v.toLowerCase() === 'general' ? 1 : 0));
        }
        this.deptOptions.set(opts);

        const generalDept = list.find((d) => d.name.trim().toLowerCase() === 'general');
        const current = this.job().department;
        const chosen = this.departmentIds.has(current)
          ? current
          : (generalDept?.name ?? list[0]?.name ?? 'General');
        this.job.update((job) => ({ ...job, department: chosen }));
        this.syncDefaultDesignation(false);
      },
      error: () => {
        this.deptOptions.set([{ v: 'General', l: 'General' }]);
      },
    });

    this.api.designations().subscribe({
      next: (list) => {
        this.allDesignations.set(list || []);
        this.syncDefaultDesignation(false);
      },
      error: () => this.allDesignations.set([]),
    });

    this.api.employees({ pageSize: 200 }).subscribe({
      next: (res) => {
        const items = res.items || [];
        this.managerMap = new Map(items.map((e) => [e.fullName, e.id]));
        const emps = items.map((e) => {
          const designation = (e as any).designation || e.jobTitle || 'Employee';
          return {
            v: e.fullName,
            l: `${e.fullName} - ${designation}`,
          };
        });
        this.managerOptions.set([
          { v: 'Company Admin', l: 'Company Admin' },
          { v: 'HR Manager', l: 'HR Manager' },
          ...emps,
        ]);
        if (!this.job().reportingManager || this.job().reportingManager === 'HR Manager' || this.job().reportingManager === 'Manager') {
          this.job.update((j) => ({ ...j, reportingManager: 'Company Admin' }));
        }
      },
      error: () => {
        this.managerOptions.set([
          { v: 'Company Admin', l: 'Company Admin' },
          { v: 'HR Manager', l: 'HR Manager' },
        ]);
        if (!this.job().reportingManager || this.job().reportingManager === 'HR Manager' || this.job().reportingManager === 'Manager') {
          this.job.update((j) => ({ ...j, reportingManager: 'Company Admin' }));
        }
      },
    });
  }

  protected readonly steps = [
    { label: 'Personal', icon: 'user' },
    { label: 'Job Details', icon: 'employees' },
    { label: 'Salary', icon: 'payroll' },
    { label: 'Account', icon: 'lock' },
    { label: 'Review', icon: 'check' },
  ];

  protected readonly subtitles = [
    "Enter the employee's basic personal information.",
    'Job role, department and reporting details.',
    'Compensation, salary and allowances.',
    'Create system login and access credentials.',
    'Review all information before submitting.',
  ];

  protected readonly step = signal(0);
  protected readonly submitted = signal(false);

  protected readonly progress = computed(() => Math.round((this.step() / (this.steps.length - 1)) * 100));

  protected readonly personal = signal({
    firstName: '',
    middleName: '',
    lastName: '',
    email: '',
    phone: '',
    dob: '',
    gender: 'Male',
    maritalStatus: 'Married',
    bloodGroup: 'O+',
    city: '',
    state: '',
    country: '',
    address: '',
  });

  protected readonly job = signal({
    designationId: '',
    department: 'General',
    joinDate: '',
    employmentType: 'Full-time',
    reportingManager: 'Company Admin',
    workLocation: '',
    shift: 'Morning (9AM - 6PM)',
    noticePeriod: '',
  });

  protected readonly salary = signal({
    basicSalary: '',
    paymentMode: 'Bank Transfer',
    bankName: '',
    accountNumber: '',
    ifscCode: '',
  });

  protected readonly accountForm = signal({
    role: 'Employee',
  });

  protected readonly roleOptions: SelectOption[] = [
    { v: 'Employee', l: 'Employee (Self-Service Portal)' },
    { v: 'HrManager', l: 'HR Manager' },
  ];

  protected patchAccount(key: 'role', value: string): void {
    this.accountForm.update((a) => ({ ...a, [key]: value }));
  }

  protected readonly account: AccountItem[] = [
    { l: 'Email Account', d: 'Work email will be created automatically', done: true },
    { l: 'System Access', d: 'ERP & HRMS login credentials', done: true },
    { l: 'Face Enrollment', d: 'Register face ID at reception', done: false },
    { l: 'IT Equipment', d: 'Laptop & accessories assigned', done: false },
  ];

  protected readonly personalReview: [string, keyof ReturnType<typeof this.personal>][] = [
    ['First Name', 'firstName'],
    ['Middle Name', 'middleName'],
    ['Last Name', 'lastName'],
    ['Email', 'email'],
    ['Phone', 'phone'],
    ['Date of Birth', 'dob'],
    ['Gender', 'gender'],
    ['Marital Status', 'maritalStatus'],
    ['Blood Group', 'bloodGroup'],
    ['City', 'city'],
    ['State', 'state'],
    ['Country', 'country'],
  ];

  protected readonly jobReview: [string, keyof ReturnType<typeof this.job>][] = [
    ['Department', 'department'],
    ['Join Date', 'joinDate'],
    ['Employment Type', 'employmentType'],
    ['Reporting To', 'reportingManager'],
    ['Work Location', 'workLocation'],
    ['Shift', 'shift'],
    ['Notice Period', 'noticePeriod'],
  ];

  protected readonly salaryReview: [string, keyof ReturnType<typeof this.salary>][] = [
    ['Basic Salary', 'basicSalary'],
    ['Payment Mode', 'paymentMode'],
    ['Bank Name', 'bankName'],
    ['Account Number', 'accountNumber'],
    ['IFSC Code', 'ifscCode'],
  ];

  protected readonly genderOptions: SelectOption[] = [
    { v: 'Male', l: 'Male' },
    { v: 'Female', l: 'Female' },
    { v: 'Other', l: 'Other' },
  ];
  protected readonly maritalOptions: SelectOption[] = [
    { v: 'Married', l: 'Married' },
    { v: 'Single', l: 'Single' },
  ];
  protected readonly emailTouched = signal(false);
  protected readonly phoneTouched = signal(false);
  protected readonly isEmailValid = computed(() => {
    const email = this.personal().email.trim();
    return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
  });
  protected readonly isPhoneValid = computed(() => {
    const phone = this.personal().phone.trim().replace(/[\s\-]/g, '');
    return phone.length === 0 || /^(?:\+91|91|0)?[6-9]\d{9}$/.test(phone);
  });

  protected readonly employmentOptions: SelectOption[] = [
    { v: 'Full-time', l: 'Full-time' },
    { v: 'Part-time', l: 'Part-time' },
    { v: 'Contract', l: 'Contract' },
  ];
  protected readonly managerOptions = signal<SelectOption[]>([
    { v: 'Company Admin', l: 'Company Admin' },
    { v: 'HR Manager', l: 'HR Manager' },
  ]);
  protected readonly shiftOptions: SelectOption[] = [
    { v: 'Morning (9AM - 6PM)', l: 'Morning (9AM - 6PM)' },
    { v: 'Evening', l: 'Evening' },
    { v: 'Night', l: 'Night' },
  ];
  protected readonly paymentOptions: SelectOption[] = [
    { v: 'Bank Transfer', l: 'Bank Transfer' },
    { v: 'Cheque', l: 'Cheque' },
    { v: 'Cash', l: 'Cash' },
  ];

  protected readonly reviewName = computed(() => {
    const p = this.personal();
    return `${this.value(p.firstName, 'Employee')} ${this.value(p.lastName, '')}`.trim();
  });

  protected readonly reviewEmail = computed(() => this.value(this.personal().email, 'the registered email'));

  protected value(v: string, fallback = '—'): string {
    return v && v.trim() ? v.trim() : fallback;
  }

  protected patchP(key: keyof ReturnType<typeof this.personal>, value: string): void {
    this.personal.update((p) => ({ ...p, [key]: value }));
  }

  private syncDefaultDesignation(forceReset = false): void {
    const list = this.allDesignations();
    if (list.length === 0) return;

    const currentDeptName = this.job().department || 'General';
    const currentDeptId = this.departmentIds.get(currentDeptName);
    const matching = list.filter((d: any) =>
      (currentDeptId && d.departmentId?.toLowerCase() === currentDeptId.toLowerCase()) ||
      (currentDeptName && d.department && d.department.toLowerCase() === currentDeptName.toLowerCase())
    );
    const pool = matching;
    const currentId = this.job().designationId;

    if (!forceReset && currentId && pool.some((d: any) => d.id === currentId)) {
      return;
    }

    const employeeDesig = pool.find((d: any) => d.name?.trim().toLowerCase() === 'employee');
    const chosenId = employeeDesig?.id || pool[0]?.id || '';
    this.job.update((j) => ({ ...j, designationId: chosenId }));
  }

  protected patchJ(key: keyof ReturnType<typeof this.job>, value: string): void {
    this.job.update((j) => ({ ...j, [key]: value }));
    if (key === 'department') {
      this.syncDefaultDesignation(true);
    }
    if (key === 'department' && /\bhr\b|human resources/i.test(value)) {
      if (this.accountForm().role === 'Employee') {
        this.accountForm.update((a) => ({ ...a, role: 'HrManager' }));
      }
    }
  }

  protected patchS(key: keyof ReturnType<typeof this.salary>, value: string): void {
    this.salary.update((s) => ({ ...s, [key]: value }));
  }

  protected readonly acceptImgTypes = ACCEPT_IMG_TYPES;

  protected readonly errors = signal<Record<string, string>>({});

  protected fieldError(key: string): string | undefined {
    return this.errors()[key];
  }

  protected clearError(key: string): void {
    if (this.errors()[key]) {
      this.errors.update((e) => {
        const copy = { ...e };
        delete copy[key];
        return copy;
      });
    }
  }

  protected validateStep(stepIndex: number): boolean {
    const errs: Record<string, string> = { ...this.errors() };

    if (stepIndex === 0) {
      delete errs['facePhoto'];
      delete errs['firstName'];
      delete errs['lastName'];
      delete errs['email'];
      delete errs['phone'];
      delete errs['dob'];

      if (!this.isFaceEnrolled() || !this.enrolledFacePhoto()) {
        errs['facePhoto'] = 'Profile photo and Face Biometrics are required before proceeding (JPG/PNG up to 2MB, or webcam scan).';
      }

      const p = this.personal();
      if (!p.firstName.trim()) {
        errs['firstName'] = 'First name is required.';
      } else if (p.firstName.trim().length < 2) {
        errs['firstName'] = 'First name must be at least 2 characters.';
      }

      if (!p.lastName.trim()) {
        errs['lastName'] = 'Last name is required.';
      }

      if (!p.email.trim()) {
        errs['email'] = 'Email address is required.';
      } else if (!this.isEmailValid()) {
        errs['email'] = 'Please enter a valid email address (e.g. name@company.com).';
      }

      const phoneClean = p.phone.trim().replace(/[\s\-]/g, '');
      if (!phoneClean) {
        errs['phone'] = 'Phone number is required.';
      } else if (!/^(?:\+91|91|0)?[6-9]\d{9}$/.test(phoneClean)) {
        errs['phone'] = 'Please enter a valid 10-digit Indian phone number (e.g. +91 98765 43210).';
      }

      if (!p.dob || !p.dob.trim()) {
        errs['dob'] = 'Date of birth is required.';
      }

      this.errors.set(errs);
      const isValid = !errs['facePhoto'] && !errs['firstName'] && !errs['lastName'] && !errs['email'] && !errs['phone'] && !errs['dob'];
      if (!isValid) {
        this.toast.show(
          errs['facePhoto'] && !errs['firstName'] && !errs['lastName'] && !errs['email'] && !errs['phone'] && !errs['dob']
            ? errs['facePhoto']
            : 'Please complete all required personal details (including Profile Photo, Face Biometrics & Date of Birth).',
          'danger',
        );
      }
      return isValid;
    }

    if (stepIndex === 1) {
      delete errs['department'];
      delete errs['joinDate'];

      const j = this.job();
      if (!j.department || !j.department.trim()) {
        errs['department'] = 'Department is required.';
      }

      if (!j.joinDate) {
        errs['joinDate'] = 'Join date is required.';
      }

      this.errors.set(errs);
      const isValid = !errs['department'] && !errs['joinDate'];
      if (!isValid) {
        this.toast.show('Please complete all required job details.', 'danger');
      }
      return isValid;
    }

    if (stepIndex === 2) {
      delete errs['basicSalary'];
      delete errs['bankName'];
      delete errs['accountNumber'];

      const s = this.salary();
      const numSal = this.numeric(s.basicSalary);
      if (!s.basicSalary.trim() || isNaN(numSal) || numSal < 0) {
        errs['basicSalary'] = 'Basic salary is required and must be a valid amount.';
      }

      if (s.paymentMode === 'Bank Transfer') {
        if (!s.bankName.trim()) {
          errs['bankName'] = 'Bank name is required for bank transfer.';
        }
        if (!s.accountNumber.trim()) {
          errs['accountNumber'] = 'Account number is required for bank transfer.';
        }
      }

      this.errors.set(errs);
      const isValid = !errs['basicSalary'] && !errs['bankName'] && !errs['accountNumber'];
      if (!isValid) {
        this.toast.show('Please complete all required salary details.', 'danger');
      }
      return isValid;
    }

    if (stepIndex === 3) {
      delete errs['facePhoto'];

      if (!this.isFaceEnrolled() || !this.enrolledFacePhoto()) {
        errs['facePhoto'] = 'Profile photo and Face Biometrics are required before saving onboarding.';
      }

      this.errors.set(errs);
      const isValid = !errs['facePhoto'];
      if (!isValid) {
        this.toast.show('Please register Profile Photo & Face Biometrics before continuing.', 'danger');
      }
      return isValid;
    }

    return true;
  }

  protected goToStep(targetIndex: number): void {
    if (targetIndex === this.step()) return;
    if (targetIndex < this.step()) {
      // Free navigation back without losing data
      this.step.set(targetIndex);
      return;
    }
    if (this.step() === 0) {
      if (!this.validateStep(0)) {
        return;
      }
      this.verifyEmailUniqueAndAdvance(() => {
        for (let s = 1; s < targetIndex; s++) {
          if (!this.validateStep(s)) {
            this.step.set(s);
            return;
          }
        }
        this.step.set(targetIndex);
      });
      return;
    }
    for (let s = this.step(); s < targetIndex; s++) {
      if (!this.validateStep(s)) {
        this.step.set(s);
        return;
      }
    }
    this.step.set(targetIndex);
  }

  protected next(): void {
    if (!this.validateStep(this.step())) {
      return;
    }

    if (this.step() === 0) {
      this.verifyEmailUniqueAndAdvance(() => this.step.set(1));
      return;
    }

    if (this.step() < 4) {
      this.step.update((s) => s + 1);
    } else {
      this.submit();
    }
  }

  private verifyEmailUniqueAndAdvance(onUnique: () => void): void {
    const email = this.personal().email.trim();
    if (!email || this.checkingEmail()) return;

    this.checkingEmail.set(true);
    this.api.checkEmployeeEmailAvailable(email).subscribe({
      next: (res) => {
        this.checkingEmail.set(false);
        if (!res.available) {
          const msg = res.message || `Email "${email}" is already registered under this company. Please use a unique email address.`;
          this.errors.update((e) => ({ ...e, email: msg }));
          this.toast.show(msg, 'danger');
          return;
        }
        onUnique();
      },
      error: (err) => {
        this.checkingEmail.set(false);
        const msg = err?.error?.message || 'Unable to verify email uniqueness. Please try again.';
        this.errors.update((e) => ({ ...e, email: msg }));
        this.toast.show(msg, 'danger');
      },
    });
  }

  protected back(): void {
    if (this.step() > 0) {
      this.step.update((s) => s - 1);
    }
  }

  private submit(): void {
    if (this.submitting()) return;

    for (let s = 0; s <= 3; s++) {
      if (!this.validateStep(s)) {
        this.step.set(s);
        this.toast.show(`Please complete required fields in Step ${s + 1}: ${this.steps[s].label}.`, 'danger');
        return;
      }
    }

    const personal = this.personal();
    const job = this.job();

    let departmentId = this.departmentIds.get(job.department);

    if (!departmentId) {
      for (const [key, val] of this.departmentIds.entries()) {
        if (
          key.toLowerCase() === job.department.toLowerCase() ||
          (job.department.toLowerCase() === 'hr' && key.toLowerCase().includes('resource')) ||
          (job.department.toLowerCase().includes('resource') && key.toLowerCase() === 'hr')
        ) {
          departmentId = val;
          break;
        }
      }
    }

    if (!departmentId && this.departmentIds.size > 0) {
      departmentId = this.departmentIds.values().next().value;
    }

    if (!departmentId) {
      this.submitting.set(true);
      const deptName = job.department?.trim() || 'General';
      this.api.createDepartment({ name: deptName, code: deptName.slice(0, 3).toUpperCase() }).subscribe({
        next: (created) => {
          this.departmentIds.set(created.name, created.id);
          this.deptOptions.update((prev) => [...prev, { v: created.name, l: created.name }]);
          this.sendEmployeePayload(created.id);
        },
        error: () => {
          this.submitting.set(false);
          this.toast.show('Please create a department under Company -> Departments first.', 'warning');
        },
      });
      return;
    }

    this.submitting.set(true);
    this.sendEmployeePayload(departmentId);
  }

  private loadEnrolledFacesCache(): void {
    this.api.enrolledFaces().subscribe({
      next: (faces) => {
        this.enrolledFacesList = faces || [];
      },
      error: () => {
        this.enrolledFacesList = [];
      },
    });
  }

  protected dismissOnboardSuccess(): void {
    if (this.successPopupTimer) {
      clearTimeout(this.successPopupTimer);
      this.successPopupTimer = undefined;
    }
    this.showOnboardSuccess.set(false);
  }

  private triggerOnboardSuccessPopup(name: string, email: string, roleCode: string): void {
    this.dismissOnboardSuccess();
    this.onboardedEmployeeName.set(name);
    this.onboardedEmployeeEmail.set(email);
    this.onboardedEmployeeRole.set(roleCode === 'HrManager' ? 'HR Manager' : 'Employee');
    this.showOnboardSuccess.set(true);
    this.successPopupTimer = setTimeout(() => {
      this.showOnboardSuccess.set(false);
      this.successPopupTimer = undefined;
    }, 5000);
  }

  private sendEmployeePayload(departmentId: string): void {
    const personal = this.personal();
    const job = this.job();
    const salary = this.salary();
    const account = this.accountForm();

    const descriptor = this.enrolledFaceDescriptor();
    const photo = this.enrolledFacePhoto() || '';
    if (descriptor) {
      this.api.enrolledFaces().subscribe({
        next: (faces) => {
          this.enrolledFacesList = faces || [];
          const conflict = this.faceService.findDuplicateEnrolledFace(descriptor, this.enrolledFacesList, undefined, photo);
          if (conflict) {
            this.submitting.set(false);
            const msg = `Duplicate face detected: this face is already registered to ${conflict.fullName} (${conflict.employeeCode}). Please use a unique face.`;
            this.errors.update((e) => ({ ...e, facePhoto: msg }));
            this.step.set(0);
            this.toast.show(msg, 'danger');
            return;
          }
          this.executeCreateEmployee(departmentId, personal, job, salary, account);
        },
        error: () => this.executeCreateEmployee(departmentId, personal, job, salary, account),
      });
      return;
    }

    this.executeCreateEmployee(departmentId, personal, job, salary, account);
  }

  private executeCreateEmployee(
    departmentId: string,
    personal: ReturnType<typeof this.personal>,
    job: ReturnType<typeof this.job>,
    salary: ReturnType<typeof this.salary>,
    account: ReturnType<typeof this.accountForm>
  ): void {
    const body = {
      firstName: personal.firstName.trim(),
      middleName: personal.middleName.trim() || null,
      lastName: personal.lastName.trim(),
      email: personal.email.trim(),
      phone: personal.phone.trim() || null,
      departmentId,
      designationId: job.designationId || null,
      branchId: null,
      shiftId: null,
      reportingManagerId: this.managerMap.get(job.reportingManager) || null,
      jobTitle: this.computedJobTitle(),
      grade: '',
      employmentType: this.employmentType(job.employmentType),
      joinDate: this.toIso(job.joinDate) ?? new Date().toISOString().slice(0, 10),
      basicSalary: this.numeric(salary.basicSalary),
      housingAllowance: 0,
      transportAllowance: 0,
      mobileAllowance: 0,
      otherAllowances: 0,
      currency: this.currencyService.currencyCode(),
      dateOfBirth: this.toIso(personal.dob),
      gender: this.mapGender(personal.gender),
      maritalStatus: personal.maritalStatus,
      bloodGroup: personal.bloodGroup || null,
      address: personal.address.trim() || null,
      city: personal.city.trim() || null,
      state: personal.state.trim() || null,
      country: personal.country.trim() || null,
      bankName: salary.bankName.trim() || null,
      accountName: `${personal.firstName} ${personal.lastName}`.trim() || null,
      accountNumber: salary.accountNumber.trim() || null,
      iban: salary.ifscCode.trim() || null,
      ifscCode: salary.ifscCode.trim() || null,
      paymentMode: this.paymentMode(salary.paymentMode),
      roleCode: account.role || 'Employee',
      sendWelcomeEmail: true,
    };

    const fullName = `${personal.firstName} ${personal.lastName}`.trim();
    const finalizeSuccess = () => {
      this.submitting.set(false);
      this.submitted.set(true);
      this.loadEnrolledFacesCache();
      this.triggerOnboardSuccessPopup(fullName, personal.email.trim(), account.role || 'Employee');
      this.toast.show('Employee onboarded successfully!', 'success');
    };

    this.api.createEmployee(body).subscribe({
      next: (created) => {
        const empId = created?.id || personal.email;
        const empCode = created?.employeeCode || empId;

        if (this.enrolledFaceDescriptor()) {
          const descriptorStr = JSON.stringify(this.enrolledFaceDescriptor());
          const photo = this.enrolledFacePhoto() || '';

          const record: EnrolledFace = {
            employeeId: empId,
            employeeCode: empCode,
            fullName,
            department: job.department,
            avatarUrl: photo,
            faceDescriptor: descriptorStr,
          };

          try {
            localStorage.setItem('hrms_face_' + empId, JSON.stringify(record));
            localStorage.setItem('hrms_face_' + empCode.toLowerCase(), JSON.stringify(record));
            localStorage.setItem('hrms_face_' + fullName.toLowerCase(), JSON.stringify(record));
            localStorage.setItem('hrms_face_' + personal.email.toLowerCase(), JSON.stringify(record));
          } catch {}

          this.api.enrollFace(empId, {
            faceDescriptor: descriptorStr,
            facePhotoUrl: photo,
          }).subscribe({
            next: () => finalizeSuccess(),
            error: (err) => {
              this.toast.show(
                err?.error?.title ?? err?.error?.detail ?? err?.error?.message ?? 'Employee created, but Face ID upload failed. You can re-enroll from their profile.',
                'warning'
              );
              finalizeSuccess();
            },
          });
          return;
        }

        finalizeSuccess();
      },
      error: (error) => {
        this.submitting.set(false);
        const msg = error?.error?.errors
          ? Object.values(error.error.errors).flat().join(' ')
          : (error?.error?.detail ?? error?.error?.message ?? error?.error?.title ?? 'Could not onboard the employee.');
        this.toast.show(msg, 'danger');
      },
    });
  }

  private mapGender(value: string): string {
    switch (value) {
      case 'Female':
        return 'Female';
      case 'Other':
        return 'Other';
      default:
        return 'Male';
    }
  }

  private employmentType(value: string): string {
    const v = (value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    if (v.includes('part')) return 'PartTime';
    if (v.includes('contract')) return 'Contract';
    if (v.includes('intern')) return 'Intern';
    if (v.includes('probation')) return 'Probation';
    return 'FullTime';
  }

  private paymentMode(value: string): string {
    const v = (value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    if (v.includes('cash')) return 'Cash';
    if (v.includes('cheque') || v.includes('check')) return 'Cheque';
    if (v.includes('wps')) return 'Wps';
    return 'BankTransfer';
  }

  private numeric(value: string): number {
    const parsed = Number(value.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private toIso(value: string): string | null {
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }

  protected restart(): void {
    this.step.set(0);
    this.submitted.set(false);
    this.enrolledFaceDescriptor.set(null);
    this.enrolledFacePhoto.set(null);
    this.errors.set({});
    this.accountForm.set({ role: 'Employee' });
    this.syncDefaultDesignation(true);
  }

  protected goEmployees(): void {
    void this.router.navigateByUrl('/employees');
  }

  ngOnDestroy(): void {
    this.stopFaceCamera();
    if (this.successPopupTimer) {
      clearTimeout(this.successPopupTimer);
      this.successPopupTimer = undefined;
    }
  }

  protected openFaceModal(): void {
    this.faceModalMsg.set('Position face in reticle and click Capture Face');
    this.showFaceModal.set(true);
    setTimeout(() => void this.startFaceCamera(), 200);
  }

  protected closeFaceModal(): void {
    this.stopFaceCamera();
    this.showFaceModal.set(false);
  }

  protected removeEnrolledFace(): void {
    this.enrolledFaceDescriptor.set(null);
    this.enrolledFacePhoto.set(null);
    this.toast.show('Face registration removed', 'info');
  }

  protected onPhotoFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    const check = validateImageFile(file);
    if (!check.valid) {
      const msg = check.error || 'Please upload a valid JPG or PNG image up to 2 MB.';
      this.errors.update((e) => ({ ...e, facePhoto: msg }));
      this.toast.show(msg, 'danger');
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => {
      const msg = 'Unable to read the selected image file. Please try another JPG or PNG photo.';
      this.errors.update((e) => ({ ...e, facePhoto: msg }));
      this.toast.show(msg, 'danger');
    };
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      if (!dataUrl) {
        const msg = 'The selected image file is empty. Please choose a valid JPG or PNG photo.';
        this.errors.update((err) => ({ ...err, facePhoto: msg }));
        this.toast.show(msg, 'danger');
        return;
      }

      const img = new Image();
      img.onload = async () => {
        // Compress oversized photos to <= 640px JPEG so upload/enrollment payloads never exceed size limits
        const compactPhoto = this.faceService.compressImageToDataUrl(img, 640, 0.85) || dataUrl;

        let candidateDescriptor: number[];
        let detectedRealFace = false;
        try {
          await this.faceService.loadModels();
          const scan = await this.faceService.detectFace(img, undefined, true);
          if (scan.hasFace && scan.descriptor) {
            candidateDescriptor = scan.descriptor;
            detectedRealFace = true;
          } else {
            candidateDescriptor = this.generateFallbackDescriptor(compactPhoto);
          }
        } catch {
          candidateDescriptor = this.generateFallbackDescriptor(compactPhoto);
        }

        // Prevent using a photo/face that is already enrolled for another employee
        const applyValidatedPhoto = (faces: EnrolledFace[]) => {
          const conflict = this.faceService.findDuplicateEnrolledFace(candidateDescriptor, faces, undefined, compactPhoto);
          if (conflict) {
            const msg = `Duplicate face detected: this photo/face is already registered to ${conflict.fullName} (${conflict.employeeCode}). Please use a unique photo for this employee.`;
            this.enrolledFaceDescriptor.set(null);
            this.enrolledFacePhoto.set(null);
            this.errors.update((err) => ({ ...err, facePhoto: msg }));
            this.toast.show(msg, 'danger');
            return;
          }
          this.enrolledFacePhoto.set(compactPhoto);
          this.enrolledFaceDescriptor.set(candidateDescriptor);
          this.clearError('facePhoto');
          this.toast.show(
            detectedRealFace
              ? 'Profile photo uploaded and Face ID registered!'
              : 'Profile photo uploaded successfully! For stronger face recognition accuracy, you can also use "Scan & Register Face ID".',
            'success'
          );
        };

        this.api.enrolledFaces().subscribe({
          next: (faces) => {
            this.enrolledFacesList = faces || [];
            applyValidatedPhoto(this.enrolledFacesList);
          },
          error: () => applyValidatedPhoto(this.enrolledFacesList),
        });
      };
      img.onerror = () => {
        const msg = 'Unable to load this image file. Please upload a valid JPG or PNG photo under 2 MB.';
        this.errors.update((err) => ({ ...err, facePhoto: msg }));
        this.toast.show(msg, 'danger');
      };
      img.src = dataUrl;
    };

    reader.readAsDataURL(file);
    input.value = '';
  }

  private generateFallbackDescriptor(seed: string): number[] {
    const desc = new Array(128).fill(0);
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    for (let j = 0; j < 128; j++) {
      desc[j] = Math.sin(hash + j) * 0.5;
    }
    let norm = Math.sqrt(desc.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let j = 0; j < 128; j++) desc[j] /= norm;
    }
    return desc;
  }

  private async startFaceCamera(): Promise<void> {
    try {
      this.stopFaceCamera();
      await this.faceService.loadModels();

      this.obMediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });

      const video = this.obFaceVideoRef?.nativeElement;
      if (!video) return;

      video.srcObject = this.obMediaStream;
      try {
        await video.play();
      } catch {}

      this.cameraActive.set(true);
    } catch (err) {
      console.warn('Camera blocked in onboarding:', err);
      this.cameraActive.set(false);
      this.faceModalMsg.set('Camera access denied or unavailable in your browser.');
    }
  }

  private stopFaceCamera(): void {
    if (this.obMediaStream) {
      this.obMediaStream.getTracks().forEach((t) => t.stop());
      this.obMediaStream = undefined;
    }
    const video = this.obFaceVideoRef?.nativeElement;
    if (video) video.srcObject = null;
    this.cameraActive.set(false);
  }

  protected async captureFaceBiometrics(): Promise<void> {
    if (!this.cameraActive() || !this.obFaceVideoRef?.nativeElement) return;

    this.faceCapturing.set(true);
    this.faceModalMsg.set('Scanning face, please look directly into the camera…');

    const video = this.obFaceVideoRef.nativeElement;
    const canvas = this.obFaceCanvasRef?.nativeElement;

    // Collect 3 samples for centroid
    const samples: number[][] = [];
    let snapshot = '';
    for (let i = 0; i < 3; i++) {
      const scan = await this.faceService.detectFace(video, canvas, true);
      if (scan.hasFace && scan.descriptor) {
        samples.push(scan.descriptor);
        if (scan.snapshot) snapshot = scan.snapshot;
      }
      if (i < 2) await new Promise((r) => setTimeout(r, 120));
    }

    if (!snapshot && canvas) {
      snapshot = this.faceService.captureSnapshot(video, canvas) || '';
    }

    this.faceCapturing.set(false);

    if (samples.length === 0) {
      this.faceModalMsg.set('❌ No face detected. Please look directly into the camera in good lighting.');
      this.toast.show('No face detected. Please face the camera.', 'warning');
      return;
    }

    const finalDescriptor = new Array(128).fill(0);
    for (const s of samples) {
      for (let j = 0; j < 128; j++) finalDescriptor[j] += s[j] / samples.length;
    }
    let norm = 0;
    for (let j = 0; j < 128; j++) norm += finalDescriptor[j] * finalDescriptor[j];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let j = 0; j < 128; j++) finalDescriptor[j] /= norm;
    }

    const finalizeCapture = (faces: EnrolledFace[]) => {
      const conflict = this.faceService.findDuplicateEnrolledFace(finalDescriptor, faces, undefined, snapshot);
      if (conflict) {
        const msg = `Duplicate face detected: this face is already registered to ${conflict.fullName} (${conflict.employeeCode}).`;
        this.faceModalMsg.set(`❌ ${msg}`);
        this.toast.show(msg, 'danger');
        return;
      }

      this.enrolledFaceDescriptor.set(finalDescriptor);
      if (snapshot) this.enrolledFacePhoto.set(snapshot);
      this.clearError('facePhoto');

      this.faceModalMsg.set('✅ Face profile captured successfully!');
      this.toast.show('Face biometrics registered for onboarding!', 'success');

      setTimeout(() => {
        this.closeFaceModal();
      }, 700);
    };

    this.api.enrolledFaces().subscribe({
      next: (faces) => {
        this.enrolledFacesList = faces || [];
        finalizeCapture(this.enrolledFacesList);
      },
      error: () => finalizeCapture(this.enrolledFacesList),
    });
  }
}
