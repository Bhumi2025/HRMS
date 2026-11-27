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
import { SessionService } from '../../core/services/session.service';
import { KeyGroupCacheService } from '../../core/services/key-group-cache.service';
import { ACCEPT_IMG_TYPES, validateImageFile } from '../../core/utils/file-validator';

/**
 * My Profile (employee) — ported from pages/emp-profile.html. The original's
 * hand-rolled calendar widget is replaced with native date inputs.
 */
@Component({
  selector: 'app-emp-profile',
  imports: [CommonModule, IconDirective, SelectComponent, KeyGroupSelectComponent],
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
                <app-select [options]="salutationOptions" [value]="personal().salutation" (valueChange)="patchPersonal('salutation', $event)" width="100%" />
              </div>
              <div class="form-group">
                <label class="form-label">First Name</label>
                <input class="form-control" [value]="personal().firstName" (input)="patchPersonal('firstName', $any($event.target).value)" placeholder="First Name" />
              </div>
            </div>

            <div class="form-grid-2">
              <div class="form-group">
                <label class="form-label">Middle Name</label>
                <input class="form-control" [value]="personal().middleName" (input)="patchPersonal('middleName', $any($event.target).value)" placeholder="Middle Name" />
              </div>
              <div class="form-group">
                <label class="form-label">Last Name</label>
                <input class="form-control" [value]="personal().lastName" (input)="patchPersonal('lastName', $any($event.target).value)" placeholder="Last Name" />
              </div>
            </div>

            <div class="form-grid-2">
              <div class="form-group">
                <label class="form-label">Personal Email</label>
                <input class="form-control" type="email" [value]="personal().email" (input)="patchPersonal('email', $any($event.target).value)" placeholder="Personal Email" />
              </div>
              <div class="form-group">
                <label class="form-label">Contact Number</label>
                <input class="form-control" type="tel" [value]="personal().phone" (input)="patchPersonal('phone', $any($event.target).value)" placeholder="Contact Number" />
              </div>
            </div>

            <div class="form-grid-2">
              <div class="form-group">
                <label class="form-label">Date of Birth</label>
                <input class="form-control" type="date" [value]="personal().dob" (input)="patchPersonal('dob', $any($event.target).value)" />
              </div>
              <div class="form-group">
                <label class="form-label">Gender</label>
                <app-key-select groupCode="GENDER" [value]="personal().gender" (valueChange)="patchPersonal('gender', $event)" width="100%" />
              </div>
            </div>

            <div class="form-grid-2">
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
              <input class="form-control" [value]="job().title" disabled readonly style="background: var(--bg); color: var(--muted)" />
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

      <div class="form-footer" style="margin-top: 16px;">
        <button class="btn btn-outline btn-sm" type="button" (click)="load()">Cancel</button>
        <button class="btn btn-primary btn-sm" type="button" (click)="save('Personal details saved!')"><span [appIcon]="'check'"></span> Save Changes</button>
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
              <input class="form-control" type="email" [value]="personal().email" (input)="patchPersonal('email', $any($event.target).value)" placeholder="Email Address" />
            </div>
            <div class="form-group">
              <label class="form-label">Password</label>
              <div class="profile-pwd-box">
                <span class="profile-pwd-icon" [appIcon]="'lock'"></span>
                <input
                  class="form-control profile-pwd-input"
                  [type]="showContactPassword() ? 'text' : 'password'"
                  [value]="personal().password"
                  (input)="patchPersonal('password', $any($event.target).value)"
                  [placeholder]="hasStoredPassword() && !personal().password ? 'Enter new password to change' : 'Password'"
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
              <app-select [options]="currencyOptions" [value]="bank().currency" (valueChange)="patchBank('currency', $event)" width="100%" />
            </div>
            <div class="form-group">
              <label class="form-label">Payment Mode</label>
              <app-key-select groupCode="PAYMENT_MODE" [value]="bank().paymentMode" (valueChange)="patchBank('paymentMode', $event)" width="100%" />
            </div>
            <div class="form-group">
              <label class="form-label">WPS ID</label>
              <input class="form-control" [value]="bank().wpsId" (input)="patchBank('wpsId', $any($event.target).value)" />
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

      <div class="form-footer" style="margin-top: 16px;">
        <button class="btn btn-outline btn-sm" type="button" (click)="load()">Cancel</button>
        <button class="btn btn-primary btn-sm" type="button" (click)="save('Bank details saved!')"><span [appIcon]="'check'"></span> Save Changes</button>
      </div>
    }
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
  private readonly session = inject(SessionService);
  private readonly keyGroupCache = inject(KeyGroupCacheService);
  protected readonly currencyService = inject(CurrencyService);

  protected readonly detail = signal<EmployeeDetail | null>(null);
  private readonly apiId = signal<string | null>(null);
  private departmentIds = new Map<string, string>();

  protected readonly avatarUrl = signal<string | null>(null);

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

  ngOnInit(): void {
    this.keyGroupCache.clearCache();
    this.api.departments().subscribe({
      next: (departments) => {
        this.departmentIds = new Map(departments.map((d) => [d.name, d.id]));
        this.deptOptions = departments.map((d) => ({ v: d.name, l: d.name }));
      },
      error: () => {
        /* API offline — department mapping stays empty. */
      },
    });

    this.load();
  }

  protected load(): void {
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
          reportsTo: (!employee.reportingManager || employee.reportingManager === 'Manager') ? 'Company Admin' : employee.reportingManager,
          joinDate: employee.joinDate,
        });

        if (employee.reportingManager && employee.reportingManager !== 'Manager' && !this.reportingOptions.some((o) => o.v.toLowerCase() === employee.reportingManager?.toLowerCase())) {
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
      },
      error: () => {
        this.toast.show('Could not load your profile.', 'danger');
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
      return 'Other';
    };

    const normalizeMarital = (m: string | null | undefined): string | null => {
      if (!m || !m.trim()) return null;
      const v = m.trim().toLowerCase();
      if (v === 'married') return 'Married';
      return 'Single';
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
        grade: '',
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
        password: personal.password?.trim() || null,
      })
      .subscribe({
        next: (updated) => {
          this.detail.set(updated);
          this.hasStoredPassword.set(!!updated.password || !!updated.hasPassword);
          const fCh = updated.firstName?.trim().slice(0, 1) || '';
          const lCh = updated.lastName?.trim().slice(0, 1) || '';
          const initials = (fCh + lCh).toUpperCase() || this.initials();
          this.session.updateUser({
            name: updated.fullName,
            email: updated.email,
            initials,
          });
          this.toast.show(message, 'success');
        },
        error: (error) => this.toast.show(error?.error?.detail ?? error?.error?.message ?? error?.error?.title ?? 'Could not save your profile.', 'danger'),
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
  ] as const;

  protected readonly tab = signal<'personal' | 'contact' | 'bank'>('personal');

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

  protected deptOptions: SelectOption[] = ['General', 'Engineering', 'Finance', 'HR', 'Sales', 'Marketing', 'Design'].map((d) => ({ v: d, l: d }));
  protected reportingOptions: SelectOption[] = [
    { v: 'Company Admin', l: 'Company Admin' },
    { v: 'HR Manager', l: 'HR Manager' },
    { v: 'Sarah Mitchell', l: 'Sarah Mitchell (HR Manager)' },
    { v: 'Priya Sharma', l: 'Priya Sharma (HR Executive)' },
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

  protected readonly salutationOptions: SelectOption[] = [
    { v: 'Mr', l: 'Mr' },
    { v: 'Mrs', l: 'Mrs' },
    { v: 'Miss', l: 'Miss' },
  ];

  protected patchPersonal(
    key: 'salutation' | 'firstName' | 'middleName' | 'lastName' | 'email' | 'password' | 'phone' | 'dob' | 'gender' | 'marital' | 'blood',
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
