import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api/api.service';
import { CentralizedPunchRequest, CentralizedPunchResult, EmployeeListItem, EnrolledFace } from '../../core/api/api.models';
import { FaceRecognitionService, FaceScanResult } from '../../core/services/face-recognition.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-punch-in-out',
  imports: [CommonModule, FormsModule],
  template: `
    <div class="punch-in-out-container">
      <!-- Page Header -->
      <div class="module-header">
        <div>
          <div class="module-badge">HR Manager Centralized Terminal</div>
          <h1 class="module-title">Centralized Attendance Punch-In / Punch-Out</h1>
          <p class="module-subtitle">AI Face Recognition Biometrics & Geofenced Attendance Recording</p>
        </div>
        <div class="live-clock-card">
          <div class="clock-label">Current Office Time</div>
          <div class="clock-time">{{ liveTime() | date:'hh:mm:ss a' }}</div>
          <div class="clock-date">{{ liveTime() | date:'EEEE, MMMM d, y' }}</div>
        </div>
      </div>

      <!-- Main Layout Grid -->
      <div class="terminal-grid">
        <!-- LEFT COLUMN: Employee Selection & Location Restriction -->
        <div class="left-col">
          <!-- Card 1: Employee Selection -->
          <div class="card p-4">
            <div class="card-section-title">
              <span class="step-num">1</span>
              <span>Select Employee</span>
            </div>

            <div class="search-box-wrap">
              <input
                type="text"
                class="form-control"
                name="kiosk_employee_search_query_no_autofill"
                autocomplete="off"
                autocorrect="off"
                autocapitalize="off"
                spellcheck="false"
                placeholder="Search by name, ID (e.g. EMP-1003), or department..."
                [ngModel]="searchQuery()"
                (ngModelChange)="onSearchChange($event)"
              />
              @if (searchQuery()) {
                <button class="btn-clear-search" (click)="clearSearch()">✕</button>
              }
            </div>

            <!-- Employee Dropdown / Filter List -->
            @if (filteredEmployees().length > 0 && isSearching()) {
              <div class="employee-results-list custom-scroll">
                @for (emp of filteredEmployees(); track emp.id) {
                  <div class="emp-select-row" (click)="selectEmployee(emp)">
                    <div class="emp-avatar-sm">{{ getInitials(emp.fullName) }}</div>
                    <div class="emp-info-sm">
                      <div class="emp-name-sm">{{ emp.fullName }}</div>
                      <div class="emp-code-sm">{{ emp.employeeCode }} · {{ emp.department || 'Staff' }}</div>
                    </div>
                    <span class="badge-select">Select</span>
                  </div>
                }
              </div>
            }

            <!-- Selected Employee Detail Card -->
            @if (selectedEmployee(); as emp) {
              <div class="selected-emp-card">
                <div class="emp-card-header">
                  <div class="emp-avatar-lg">
                    @if (empEnrolledPhoto()) {
                      <img [src]="empEnrolledPhoto()" alt="Profile" class="avatar-img" />
                    } @else {
                      {{ getInitials(emp.fullName) }}
                    }
                  </div>
                  <div class="emp-meta">
                    <div class="emp-name-lg">{{ emp.fullName }}</div>
                    <div class="emp-sub-lg">{{ emp.employeeCode }} · {{ emp.department || 'Department' }}</div>
                    <div class="emp-role-lg">{{ emp.jobTitle || 'Active Employee' }}</div>
                  </div>
                </div>

                <div class="emp-status-grid">
                  <div class="status-box">
                    <div class="status-box-label">Attendance State</div>
                    <div class="status-box-val" [class.is-in]="isClockedIn()" [class.is-out]="!isClockedIn()">
                      <span class="status-dot"></span>
                      {{ isClockedIn() ? 'Clocked In' : 'Not Clocked In' }}
                    </div>
                  </div>

                  <div class="status-box">
                    <div class="status-box-label">Face Biometrics</div>
                    <div class="status-box-val" [class.is-enrolled]="isFaceEnrolled()" [class.is-missing]="!isFaceEnrolled()">
                      {{ isFaceEnrolled() ? '✅ Enrolled' : '⚠️ Not Enrolled' }}
                    </div>
                  </div>
                </div>

                @if (!isFaceEnrolled()) {
                  <div class="enroll-warning-banner">
                    <div>
                      <strong>Face Not Registered:</strong> This employee must register their face before recording attendance.
                    </div>
                    <button class="btn btn-sm btn-outline-warning" (click)="enrollCurrentFace()" [disabled]="!hasFaceDetected() || isEnrolling()">
                      {{ isEnrolling() ? 'Enrolling…' : 'Enroll Captured Face' }}
                    </button>
                  </div>
                }

                @if (lastPunchInfo()) {
                  <div class="last-punch-text">
                    <strong>Last Activity:</strong> {{ lastPunchInfo() }}
                  </div>
                }
              </div>
            } @else {
              <div class="no-selection-placeholder">
                <div class="placeholder-icon">👤</div>
                <div class="placeholder-text">Please search and select an employee above to begin verification.</div>
              </div>
            }
          </div>

          <!-- Card 2: Company Location Geofencing Restriction -->
          <div class="card p-4 mt-3">
            <div class="card-section-title">
              <span class="step-num">2</span>
              <span>Company Geofencing Restriction</span>
            </div>

            <div class="geofence-card">
              <div class="geofence-row">
                <div class="geo-label">Company Registered Location:</div>
                <div class="geo-val">Lat: 21.238557, Lon: 72.890135 (500m Allowed Radius)</div>
              </div>

              <div class="geofence-row">
                <div class="geo-label">Device GPS Location:</div>
                <div class="geo-val">
                  @if (currentLat() !== null && currentLon() !== null) {
                    Lat: {{ currentLat() | number:'1.6-6' }}, Lon: {{ currentLon() | number:'1.6-6' }}
                  } @else {
                    <span class="text-muted">Acquiring GPS coordinates…</span>
                  }
                </div>
              </div>

              <!-- Distance Meter -->
              <div class="distance-meter-wrap">
                <div class="dist-header">
                  <span class="dist-title">Distance from Company Office</span>
                  <span class="dist-val" [class.dist-pass]="isWithinGeofence()" [class.dist-fail]="!isWithinGeofence()">
                    @if (distanceMeters() !== null) {
                      {{ distanceMeters() | number:'1.1-1' }} meters
                    } @else {
                      Calculating…
                    }
                  </span>
                </div>
                <div class="dist-bar-track">
                  <div
                    class="dist-bar-fill"
                    [style.width.%]="calcDistanceBar()"
                    [class.bar-pass]="isWithinGeofence()"
                    [class.bar-fail]="!isWithinGeofence()"
                  ></div>
                </div>
              </div>

              <!-- Location Status Badge -->
              <div class="location-badge-wrap">
                @if (isWithinGeofence()) {
                  <div class="badge-status badge-success-lg">
                    <span>📍</span> Within Allowed Location (≤ 500m)
                  </div>
                } @else {
                  <div class="badge-status badge-danger-lg">
                    <span>⛔</span> Outside Allowed Location
                  </div>
                  <div class="location-error-msg">
                    "You are outside the permitted company location. Please move within the registered office campus (≤ 500m) to mark your attendance."
                  </div>
                }
              </div>

              <div class="geo-action-row">
                <button class="btn btn-sm btn-outline-secondary" (click)="refreshGps()">
                  🔄 Refresh GPS
                </button>
                <button class="btn btn-sm btn-outline-primary" (click)="setMockOfficeGps()" title="Set coordinates to registered office for local testing">
                  🏢 Set to Office Location (HQ Demo)
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- RIGHT COLUMN: Live Camera & Face Recognition Verification -->
        <div class="right-col">
          <div class="card p-4">
            <div class="card-section-title d-flex justify-content-between align-items-center">
              <div class="d-flex align-items-center gap-2">
                <span class="step-num">3</span>
                <span>Live Face Recognition Verification</span>
              </div>
              <button
                type="button"
                class="btn-toggle-autopunch"
                [class.enabled]="autoPunchEnabled()"
                (click)="autoPunchEnabled.set(!autoPunchEnabled())"
                title="Automatically punches in/out when employee face is verified"
              >
                <span>⚡ Auto-Punch:</span> <strong>{{ autoPunchEnabled() ? 'ON' : 'OFF' }}</strong>
              </button>
            </div>

            <!-- Live Camera Viewport -->
            <div class="camera-viewport-wrap">
              <video #faceVideo class="camera-video" autoplay playsinline muted></video>
              <canvas #faceCanvas class="camera-canvas"></canvas>

              <!-- Loading overlay -->
              @if (isCameraLoading() || faceService.loadingModels()) {
                <div class="camera-loading-overlay">
                  <div class="spinner-border"></div>
                  <div class="camera-loading-text">
                    {{ faceService.loadingModels() ? 'Loading AI Face Recognition Neural Network…' : 'Initializing HD Camera Stream…' }}
                  </div>
                </div>
              }

              <!-- Error overlay when camera is blocked -->
              @if (cameraError()) {
                <div class="camera-error-overlay">
                  <div style="font-size: 26px; margin-bottom: 8px;">📷⚠️</div>
                  <div style="font-size: 13px; font-weight: 600; color: #fee2e2; margin-bottom: 12px; text-align: center; max-width: 320px; line-height: 1.4;">
                    {{ cameraError() }}
                  </div>
                  <button type="button" class="btn-retry-camera" (click)="retryCamera()">
                    🔄 Retry Camera Access
                  </button>
                </div>
              }

              <!-- Face Reticle Overlay -->
              <div
                class="face-hud-reticle"
                [class.matched]="faceStatus() === 'verified'"
                [class.mismatched]="faceStatus() === 'mismatched'"
              >
                <div class="reticle-corner top-left"></div>
                <div class="reticle-corner top-right"></div>
                <div class="reticle-corner bottom-left"></div>
                <div class="reticle-corner bottom-right"></div>
              </div>

              <!-- Live Status Pill Overlay -->
              <div class="floating-face-status" [class.success]="faceStatus() === 'verified' || punchResult()?.success" [class.error]="faceStatus() === 'mismatched'">
                @if (punchResult(); as result) {
                  @if (result.success) {
                    ✅ {{ result.message }}
                  } @else {
                    ⚠️ Punch Failed
                  }
                } @else if (faceStatus() === 'verified') {
                  ✅ {{ selectedEmployee()?.fullName }} ({{ faceMatchScore() }}% Match)
                } @else if (faceStatus() === 'mismatched') {
                  ❌ Face Verification Failed ({{ faceMatchScore() }}% &lt; 70%)
                } @else if (hasFaceDetected()) {
                  🔍 Scanning Face Biometrics…
                } @else {
                  👤 Position Face inside Frame
                }
              </div>
            </div>

            <!-- Biometric Match Score Meter -->
            <div class="biometric-meter-card mt-3">
              <div class="meter-header">
                <span class="meter-label">Face Biometric Confidence (Minimum Required: ≥ 70%)</span>
                <span class="meter-score" [class.score-pass]="faceStatus() === 'verified'" [class.score-fail]="faceStatus() === 'mismatched'">
                  {{ faceMatchScore() !== null ? faceMatchScore() + '%' : '—' }}
                </span>
              </div>
              <div class="meter-track">
                <div
                  class="meter-fill"
                  [style.width.%]="faceMatchScore() ?? 0"
                  [class.meter-pass]="faceStatus() === 'verified'"
                  [class.meter-fail]="faceStatus() === 'mismatched'"
                ></div>
              </div>
            </div>

            <!-- Verification Status Banner -->
            <div class="verification-summary-banner mt-3" [class.banner-pass]="faceStatus() === 'verified' || punchResult()?.success || (cooldownRemaining() > 0)" [class.banner-fail]="faceStatus() === 'mismatched'">
              @if (cooldownRemaining() > 0 && cooldownEmployeeName()) {
                <div class="banner-title" style="color: #047857;">✅ Attendance Recorded: {{ cooldownEmployeeName() }}</div>
                <div class="banner-desc">Shift status synchronized successfully. Please step away for next employee (Cooldown: <strong>{{ cooldownRemaining() }}s</strong>).</div>
              } @else if (punchResult(); as result) {
                @if (result.success) {
                  <div class="banner-title">{{ result.punchType === 'ClockIn' ? '🎉 ' + result.message : '🚪 ' + result.message }}</div>
                  <div class="banner-desc">
                    @if (result.punchType === 'ClockIn') {
                      Recorded at {{ result.punchTime | date:'hh:mm:ss a' }}. Live timer started on employee dashboard and attendance marked in HR panel.
                    } @else {
                      Recorded at {{ result.punchTime | date:'hh:mm:ss a' }}. Shift ended, timer stopped on employee dashboard and attendance finalized in HR panel.
                    }
                  </div>
                } @else {
                  <div class="banner-title">⚠️ Punch Transaction Failed</div>
                  <div class="banner-desc">{{ result.message }}</div>
                }
              } @else if (faceStatus() === 'verified') {
                <div class="banner-title">✅ Face Verified: {{ selectedEmployee()?.fullName }}</div>
                <div class="banner-desc">Biometrics confirmed ({{ faceMatchScore() }}% Match). Ready to record attendance.</div>
              } @else if (faceStatus() === 'mismatched') {
                <div class="banner-title">❌ Face Verification Failed</div>
                <div class="banner-desc">Captured live face does not match registered biometrics for this employee. Transaction blocked.</div>
              } @else {
                <div class="banner-title">⏳ Awaiting Face Match</div>
                <div class="banner-desc">Ensure the employee is facing the camera clearly with proper lighting. Terminal auto-identifies enrolled employees.</div>
              }
            </div>

            <!-- Step 4: Centralized Punch-In / Punch-Out Action Section -->
            <div class="action-card mt-4">
              <div class="action-checklist">
                <div class="check-item" [class.checked]="selectedEmployee() !== null">
                  <span class="check-icon">{{ selectedEmployee() ? '✓' : '○' }}</span>
                  <span>1. Employee Selected: <strong>{{ selectedEmployee()?.fullName || 'Pending' }}</strong></span>
                </div>
                <div class="check-item" [class.checked]="isWithinGeofence()">
                  <span class="check-icon">{{ isWithinGeofence() ? '✓' : '○' }}</span>
                  <span>2. Within 500m Geofence: <strong>{{ isWithinGeofence() ? 'Passed' : 'Outside Boundary' }}</strong></span>
                </div>
                <div class="check-item" [class.checked]="faceStatus() === 'verified'">
                  <span class="check-icon">{{ faceStatus() === 'verified' ? '✓' : '○' }}</span>
                  <span>3. Face Verified: <strong>{{ faceStatus() === 'verified' ? 'Verified (≥70%)' : 'Pending' }}</strong></span>
                </div>
              </div>

              <!-- Dynamic Punch Button -->
              <div class="punch-btn-wrap">
                @if (isClockedIn()) {
                  <button
                    class="btn-central-punch btn-punch-out"
                    [disabled]="!canExecutePunch() || isSubmitting()"
                    (click)="submitCentralizedPunch('ClockOut')"
                  >
                    @if (isSubmitting()) {
                      <span class="spinner-border spinner-border-sm"></span> Processing Punch Out…
                    } @else {
                      <span class="btn-icon">🚪</span>
                      <span>Punch Out (Clock Out)</span>
                    }
                  </button>
                } @else {
                  <button
                    class="btn-central-punch btn-punch-in"
                    [disabled]="!canExecutePunch() || isSubmitting()"
                    (click)="submitCentralizedPunch('ClockIn')"
                  >
                    @if (isSubmitting()) {
                      <span class="spinner-border spinner-border-sm"></span> Processing Punch In…
                    } @else {
                      <span class="btn-icon">🕒</span>
                      <span>Punch In (Clock In)</span>
                    }
                  </button>
                }
              </div>

              @if (!canExecutePunch()) {
                <div class="validation-warning-note">
                  * Punch action remains disabled until all 3 criteria (Employee Selection, 500m Geofence, and Face Match) are satisfied.
                </div>
              }
            </div>

            <!-- Result Feedback Toast / Alert -->
            @if (punchResult(); as result) {
              <div class="result-alert-box mt-3" [class.alert-success]="result.success" [class.alert-danger]="!result.success">
                <div class="alert-title">{{ result.success ? (result.punchType === 'ClockIn' ? '🎉 Successfully Punched In' : '🚪 Successfully Punched Out') : '⚠️ Attendance Failed' }}</div>
                <div class="alert-msg">{{ result.message }}</div>
                <div class="alert-meta">
                  Employee: <strong>{{ result.employeeName }} ({{ result.employeeCode }})</strong> · Action: <strong>{{ result.punchType }}</strong> · Time: <strong>{{ result.punchTime | date:'hh:mm:ss a' }}</strong> · Distance: <strong>{{ result.distanceMeters }}m</strong>
                </div>
                @if (result.success) {
                  <div class="sync-confirmation">
                    @if (result.punchType === 'ClockIn') {
                      ⏱️ <strong>Active live timer</strong> started on {{ result.employeeName }}'s dashboard. Status reflected in HR Attendance Panel.
                    } @else {
                      🚪 <strong>Shift ended & Clocked Out</strong>. Final work hours updated on {{ result.employeeName }}'s dashboard and HR Attendance Panel.
                    }
                  </div>
                  <div class="terminal-reset-row">
                    <span class="reset-text">Ready for next employee in <strong>{{ resetCountdown() ?? 3 }}s</strong>…</span>
                    <button type="button" class="btn-reset-next" (click)="resetForNextEmployee()">Scan Next Employee Now →</button>
                  </div>
                }
              </div>
            }
          </div>
        </div>
      </div>
    </div>

    <style>
      .punch-in-out-container {
        padding: 4px;
        max-width: 1400px;
        margin: 0 auto;
      }
      .module-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 16px;
        margin-bottom: 20px;
      }
      .module-badge {
        display: inline-block;
        padding: 4px 10px;
        background: rgba(14, 165, 233, 0.12);
        color: #0284c7;
        font-size: 11px;
        font-weight: 700;
        border-radius: 6px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 4px;
      }
      .module-title {
        font-size: 1.45rem;
        font-weight: 800;
        color: var(--text, #1e293b);
        margin: 0;
      }
      .module-subtitle {
        font-size: 13px;
        color: var(--muted, #64748b);
        margin: 4px 0 0;
      }
      .live-clock-card {
        background: #fff;
        border: 1px solid var(--border, #e2e8f0);
        padding: 10px 18px;
        border-radius: 12px;
        text-align: right;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      }
      .clock-label {
        font-size: 11px;
        font-weight: 700;
        color: var(--muted, #64748b);
        text-transform: uppercase;
      }
      .clock-time {
        font-size: 1.25rem;
        font-weight: 800;
        color: #0f172a;
      }
      .clock-date {
        font-size: 11px;
        color: #64748b;
      }

      .terminal-grid {
        display: grid;
        grid-template-columns: 440px 1fr;
        gap: 20px;
      }
      @media (max-width: 1024px) {
        .terminal-grid {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 600px) {
        .module-header {
          flex-direction: column;
          align-items: flex-start;
          gap: 12px;
        }
        .live-clock-card {
          width: 100%;
          text-align: left;
          box-sizing: border-box;
        }
        .module-title {
          font-size: 1.25rem;
        }
      }

      .card-section-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 800;
        color: #0f172a;
        margin-bottom: 14px;
      }
      .step-num {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        background: var(--p, #2563eb);
        color: #fff;
        border-radius: 50%;
        font-size: 11px;
        font-weight: 800;
      }

      .search-box-wrap {
        position: relative;
        margin-bottom: 10px;
      }
      .btn-clear-search {
        position: absolute;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        border: none;
        background: transparent;
        color: #94a3b8;
        cursor: pointer;
        font-size: 12px;
      }

      .employee-results-list {
        max-height: 220px;
        overflow-y: auto;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #fff;
        margin-bottom: 14px;
      }
      .emp-select-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        cursor: pointer;
        border-bottom: 1px solid #f1f5f9;
        transition: background 0.15s;
      }
      .emp-select-row:hover {
        background: #f8fafc;
      }
      .emp-avatar-sm {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: #e0e7ff;
        color: #3730a3;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 700;
      }
      .emp-info-sm {
        flex: 1;
        min-width: 0;
      }
      .emp-name-sm {
        font-size: 13px;
        font-weight: 700;
        color: #1e293b;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .emp-code-sm {
        font-size: 11px;
        color: #64748b;
      }
      .badge-select {
        font-size: 11px;
        font-weight: 700;
        color: #2563eb;
        background: #eff6ff;
        padding: 3px 8px;
        border-radius: 4px;
      }

      .selected-emp-card {
        background: #f8fafc;
        border: 1px solid #cbd5e1;
        border-radius: 12px;
        padding: 14px;
        margin-top: 6px;
      }
      .emp-card-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
      }
      .emp-avatar-lg {
        width: 52px;
        height: 52px;
        border-radius: 50%;
        background: #e0e7ff;
        color: #3730a3;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        font-weight: 800;
        overflow: hidden;
        border: 2px solid #fff;
        box-shadow: 0 2px 5px rgba(0,0,0,0.1);
      }
      .avatar-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .emp-meta {
        flex: 1;
      }
      .emp-name-lg {
        font-size: 15px;
        font-weight: 800;
        color: #0f172a;
      }
      .emp-sub-lg {
        font-size: 12px;
        font-weight: 600;
        color: #64748b;
      }
      .emp-role-lg {
        font-size: 11px;
        color: #94a3b8;
      }

      .emp-status-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin-bottom: 10px;
      }
      .status-box {
        background: #fff;
        border: 1px solid #e2e8f0;
        padding: 8px 10px;
        border-radius: 8px;
      }
      .status-box-label {
        font-size: 10px;
        font-weight: 700;
        color: #64748b;
        text-transform: uppercase;
        margin-bottom: 2px;
      }
      .status-box-val {
        font-size: 13px;
        font-weight: 800;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .status-box-val.is-in {
        color: #10b981;
      }
      .status-box-val.is-out {
        color: #64748b;
      }
      .status-box-val.is-enrolled {
        color: #059669;
      }
      .status-box-val.is-missing {
        color: #d97706;
      }
      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: currentColor;
      }

      .enroll-warning-banner {
        background: #fffbeb;
        border: 1px solid #fde68a;
        padding: 8px 10px;
        border-radius: 8px;
        font-size: 11px;
        color: #92400e;
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 10px;
      }
      .last-punch-text {
        font-size: 12px;
        color: #475569;
        background: #fff;
        padding: 6px 10px;
        border-radius: 6px;
        border: 1px dashed #cbd5e1;
      }

      .no-selection-placeholder {
        text-align: center;
        padding: 30px 16px;
        color: #94a3b8;
        border: 2px dashed #e2e8f0;
        border-radius: 12px;
      }
      .placeholder-icon {
        font-size: 32px;
        margin-bottom: 8px;
      }
      .placeholder-text {
        font-size: 13px;
        color: #64748b;
      }

      /* Geofencing Card */
      .geofence-card {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .geofence-row {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        padding: 8px 12px;
        border-radius: 8px;
      }
      .geo-label {
        font-size: 11px;
        font-weight: 700;
        color: #64748b;
        margin-bottom: 2px;
      }
      .geo-val {
        font-size: 12px;
        font-weight: 700;
        color: #1e293b;
        font-family: monospace;
      }

      .distance-meter-wrap {
        background: #fff;
        border: 1px solid #e2e8f0;
        padding: 10px 12px;
        border-radius: 8px;
      }
      .dist-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 6px;
      }
      .dist-title {
        font-size: 12px;
        font-weight: 700;
        color: #475569;
      }
      .dist-val {
        font-size: 13px;
        font-weight: 800;
      }
      .dist-val.dist-pass { color: #10b981; }
      .dist-val.dist-fail { color: #ef4444; }

      .dist-bar-track {
        height: 8px;
        background: #e2e8f0;
        border-radius: 4px;
        overflow: hidden;
      }
      .dist-bar-fill {
        height: 100%;
        transition: width 0.3s;
      }
      .dist-bar-fill.bar-pass { background: #10b981; }
      .dist-bar-fill.bar-fail { background: #ef4444; }

      .badge-status {
        padding: 8px 14px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 800;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .badge-success-lg {
        background: #ecfdf5;
        color: #065f46;
        border: 1.5px solid #a7f3d0;
      }
      .badge-danger-lg {
        background: #fef2f2;
        color: #991b1b;
        border: 1.5px solid #fecaca;
      }
      .location-error-msg {
        margin-top: 6px;
        font-size: 11px;
        color: #b91c1c;
        background: #fff1f2;
        padding: 8px 10px;
        border-radius: 6px;
        border-left: 3px solid #ef4444;
        line-height: 1.4;
      }

      .geo-action-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 4px;
      }

      /* Camera Viewport */
      .camera-viewport-wrap {
        position: relative;
        width: 100%;
        height: 380px;
        background: #000;
        border-radius: 14px;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid #334155;
      }
      .camera-video {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transform: scaleX(-1);
      }
      .camera-canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        transform: scaleX(-1);
        pointer-events: none;
      }
      .camera-loading-overlay {
        position: absolute;
        inset: 0;
        background: rgba(15, 23, 42, 0.85);
        color: #fff;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        z-index: 10;
      }
      .camera-loading-text {
        font-size: 13px;
        font-weight: 600;
      }
      .camera-error-overlay {
        position: absolute;
        inset: 0;
        background: rgba(15, 23, 42, 0.92);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 15;
        padding: 24px;
      }
      .btn-retry-camera {
        padding: 8px 16px;
        background: #3b82f6;
        color: #fff;
        border: none;
        border-radius: 8px;
        font-weight: 700;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .btn-retry-camera:hover {
        background: #2563eb;
      }

      .face-hud-reticle {
        position: absolute;
        width: 200px;
        height: 250px;
        border: 1.5px dashed rgba(255, 255, 255, 0.4);
        border-radius: 100px;
        pointer-events: none;
        transition: all 0.25s ease;
      }
      .face-hud-reticle.matched {
        border-color: #10b981;
        border-style: solid;
        box-shadow: 0 0 25px rgba(16, 185, 129, 0.6);
      }
      .face-hud-reticle.mismatched {
        border-color: #ef4444;
        border-style: solid;
        box-shadow: 0 0 25px rgba(239, 68, 68, 0.6);
      }
      .reticle-corner {
        position: absolute;
        width: 14px;
        height: 14px;
        border-color: inherit;
      }
      .reticle-corner.top-left { top: -2px; left: -2px; border-top: 3px solid currentColor; border-left: 3px solid currentColor; }
      .reticle-corner.top-right { top: -2px; right: -2px; border-top: 3px solid currentColor; border-right: 3px solid currentColor; }
      .reticle-corner.bottom-left { bottom: -2px; left: -2px; border-bottom: 3px solid currentColor; border-left: 3px solid currentColor; }
      .reticle-corner.bottom-right { bottom: -2px; right: -2px; border-bottom: 3px solid currentColor; border-right: 3px solid currentColor; }

      .floating-face-status {
        position: absolute;
        bottom: 12px;
        padding: 6px 14px;
        border-radius: 20px;
        background: rgba(15, 23, 42, 0.75);
        color: #fff;
        font-size: 12px;
        font-weight: 700;
        backdrop-filter: blur(4px);
        transition: all 0.2s;
      }
      .floating-face-status.success {
        background: rgba(6, 95, 70, 0.9);
        color: #a7f3d0;
        box-shadow: 0 0 15px rgba(16, 185, 129, 0.4);
      }
      .floating-face-status.error {
        background: rgba(153, 27, 27, 0.9);
        color: #fecaca;
      }

      .biometric-meter-card {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        padding: 10px 14px;
        border-radius: 8px;
      }
      .meter-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 6px;
      }
      .meter-label {
        font-size: 12px;
        font-weight: 700;
        color: #475569;
      }
      .meter-score {
        font-size: 14px;
        font-weight: 800;
      }
      .meter-score.score-pass { color: #10b981; }
      .meter-score.score-fail { color: #ef4444; }
      .meter-track {
        height: 8px;
        background: #e2e8f0;
        border-radius: 4px;
        overflow: hidden;
      }
      .meter-fill {
        height: 100%;
        transition: width 0.25s ease;
      }
      .meter-fill.meter-pass { background: #10b981; }
      .meter-fill.meter-fail { background: #ef4444; }

      .verification-summary-banner {
        padding: 12px 14px;
        border-radius: 8px;
        border-left: 4px solid #cbd5e1;
        background: #f8fafc;
      }
      .verification-summary-banner.banner-pass {
        border-left-color: #10b981;
        background: #ecfdf5;
      }
      .verification-summary-banner.banner-fail {
        border-left-color: #ef4444;
        background: #fef2f2;
      }
      .banner-title {
        font-size: 13px;
        font-weight: 800;
        margin-bottom: 2px;
      }
      .banner-pass .banner-title { color: #065f46; }
      .banner-fail .banner-title { color: #991b1b; }
      .banner-desc {
        font-size: 12px;
        color: #475569;
      }

      /* Step 4 Action Card */
      .action-card {
        background: #f8fafc;
        border: 1px solid #cbd5e1;
        border-radius: 12px;
        padding: 16px;
      }
      .action-checklist {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 14px;
      }
      .check-item {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: #64748b;
      }
      .check-item.checked {
        color: #065f46;
        font-weight: 600;
      }
      .check-icon {
        font-weight: 900;
        width: 16px;
      }

      .punch-btn-wrap {
        display: flex;
        justify-content: center;
      }
      .btn-central-punch {
        width: 100%;
        max-width: 400px;
        padding: 14px 20px;
        border: none;
        border-radius: 10px;
        font-size: 1.1rem;
        font-weight: 800;
        color: #fff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        transition: all 0.2s;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      }
      .btn-punch-in {
        background: #10b981;
      }
      .btn-punch-in:hover:not(:disabled) {
        background: #059669;
        transform: translateY(-1px);
        box-shadow: 0 6px 16px rgba(16, 185, 129, 0.3);
      }
      .btn-punch-out {
        background: #ef4444;
      }
      .btn-punch-out:hover:not(:disabled) {
        background: #dc2626;
        transform: translateY(-1px);
        box-shadow: 0 6px 16px rgba(239, 68, 68, 0.3);
      }
      .btn-central-punch:disabled {
        background: #94a3b8;
        cursor: not-allowed;
        box-shadow: none;
        opacity: 0.7;
      }
      .btn-icon {
        font-size: 18px;
      }

      .validation-warning-note {
        font-size: 11px;
        color: #64748b;
        text-align: center;
        margin-top: 8px;
        font-style: italic;
      }

      .result-alert-box {
        padding: 12px 14px;
        border-radius: 8px;
        font-size: 13px;
      }
      .result-alert-box.alert-success {
        background: #ecfdf5;
        border: 1px solid #a7f3d0;
        color: #065f46;
      }
      .result-alert-box.alert-danger {
        background: #fef2f2;
        border: 1px solid #fecaca;
        color: #991b1b;
      }
      .alert-title {
        font-weight: 800;
        margin-bottom: 2px;
      }
      .alert-msg {
        font-size: 12px;
        margin-bottom: 4px;
      }
      .alert-meta {
        font-size: 11px;
        opacity: 0.85;
      }

      .btn-toggle-autopunch {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 12px;
        font-size: 11px;
        font-weight: 700;
        border-radius: 20px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #64748b;
        cursor: pointer;
        transition: all 0.2s;
      }
      .btn-toggle-autopunch.enabled {
        background: #ecfdf5;
        border-color: #6ee7b7;
        color: #047857;
      }
      .sync-confirmation {
        margin-top: 8px;
        padding: 6px 10px;
        border-radius: 6px;
        background: rgba(16, 185, 129, 0.12);
        border: 1px dashed #10b981;
        font-size: 12px;
        color: #065f46;
        font-weight: 500;
      }
      .terminal-reset-row {
        margin-top: 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-top: 8px;
        border-top: 1px solid rgba(0, 0, 0, 0.08);
      }
      .reset-text {
        font-size: 11px;
        color: #4b5563;
      }
      .btn-reset-next {
        font-size: 11px;
        font-weight: 700;
        padding: 5px 12px;
        background: #0284c7;
        color: #fff;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.2s;
      }
      .btn-reset-next:hover {
        background: #0369a1;
      }

      .custom-scroll::-webkit-scrollbar {
        width: 6px;
      }
      .custom-scroll::-webkit-scrollbar-thumb {
        background: #cbd5e1;
        border-radius: 3px;
      }
    </style>
  `,
})
export class PunchInOutComponent implements OnInit, AfterViewInit, OnDestroy {
  protected readonly api = inject(ApiService);
  protected readonly toast = inject(ToastService);
  protected readonly faceService = inject(FaceRecognitionService);

  @ViewChild('faceVideo') private faceVideoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('faceCanvas') private faceCanvasRef?: ElementRef<HTMLCanvasElement>;

  // Office Location Constants
  readonly OFFICE_LAT = 21.2385574033792;
  readonly OFFICE_LON = 72.89013466219234;
  readonly ALLOWED_RADIUS = 500.0; // meters (campus office radius)

  // State signals
  protected readonly liveTime = signal<Date>(new Date());
  protected readonly employees = signal<EmployeeListItem[]>([]);
  protected readonly enrolledFaces = signal<EnrolledFace[]>([]);
  protected readonly searchQuery = signal<string>('');
  protected readonly selectedEmployee = signal<EmployeeListItem | null>(null);

  // Auto-punch & Auto-reset signals
  protected readonly autoPunchEnabled = signal<boolean>(true);
  protected readonly resetCountdown = signal<number | null>(null);
  protected readonly recognizedName = signal<string | null>(null);
  private autoResetTimer: ReturnType<typeof setInterval> | null = null;
  private consecutiveVerifiedFrames = 0;
  private punchCooldown = false;

  // Per-employee post-punch cooldown (prevents rapid re-triggering while employee is in camera view)
  private lastPunchedEmployeeId: string | null = null;
  private lastPunchedTime: number = 0;
  private readonly COOLDOWN_MS = 25000; // 25 seconds cooldown for same employee
  protected readonly cooldownRemaining = signal<number>(0);
  protected readonly cooldownEmployeeName = signal<string | null>(null);

  // Status signals
  protected readonly isClockedIn = signal<boolean>(false);
  protected readonly lastPunchInfo = signal<string | null>(null);
  protected readonly isFaceEnrolled = signal<boolean>(false);
  protected readonly empEnrolledPhoto = signal<string | null>(null);

  // GPS Geolocation signals
  protected readonly currentLat = signal<number | null>(null);
  protected readonly currentLon = signal<number | null>(null);
  protected readonly distanceMeters = signal<number | null>(null);
  protected readonly isWithinGeofence = signal<boolean>(false);

  // Camera & Face scan signals
  protected readonly isCameraLoading = signal<boolean>(true);
  protected readonly cameraError = signal<string | null>(null);
  protected readonly hasFaceDetected = signal<boolean>(false);
  protected readonly faceStatus = signal<'idle' | 'scanning' | 'verified' | 'mismatched'>('idle');
  protected readonly faceMatchScore = signal<number | null>(null);
  private currentDescriptor: number[] | null = null;
  private currentSnapshot: string | null = null;

  // Operation flags
  protected readonly isEnrolling = signal<boolean>(false);
  protected readonly isSubmitting = signal<boolean>(false);
  protected readonly isLoadingStatus = signal<boolean>(false);
  protected readonly punchResult = signal<CentralizedPunchResult | null>(null);

  private videoStream: MediaStream | null = null;
  private scanInterval: ReturnType<typeof setInterval> | null = null;
  private clockInterval: ReturnType<typeof setInterval> | null = null;

  // Filtered employees for search
  protected readonly filteredEmployees = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return [];
    return this.employees().filter((e) =>
      e.fullName.toLowerCase().includes(q) ||
      e.employeeCode.toLowerCase().includes(q) ||
      (e.department && e.department.toLowerCase().includes(q))
    ).slice(0, 10);
  });

  protected readonly isSearching = computed(() => {
    return this.searchQuery().trim().length > 0;
  });

  // Master validation check
  protected readonly canExecutePunch = computed(() => {
    return (
      this.selectedEmployee() !== null &&
      this.isWithinGeofence() &&
      this.faceStatus() === 'verified' &&
      !this.isLoadingStatus() &&
      !this.isSubmitting()
    );
  });

  ngOnInit(): void {
    // 1. Clock interval
    this.clockInterval = setInterval(() => {
      this.liveTime.set(new Date());
    }, 1000);

    // 2. Load employees & enrolled faces
    this.loadData();

    // 3. Acquire live GPS location
    this.refreshGps();
  }

  ngAfterViewInit(): void {
    // 4. Start camera stream & face detection loop
    this.startCameraAndFaceDetection();
  }

  ngOnDestroy(): void {
    if (this.clockInterval) clearInterval(this.clockInterval);
    if (this.scanInterval) clearInterval(this.scanInterval);
    if (this.autoResetTimer) clearInterval(this.autoResetTimer);
    this.stopCamera();
  }

  private loadData(): void {
    this.api.employees({ pageSize: 200 }).subscribe({
      next: (res) => {
        this.employees.set(res.items || []);
      },
      error: (err) => console.error('Failed to load employees:', err),
    });

    this.api.enrolledFaces().subscribe({
      next: (faces) => {
        this.enrolledFaces.set(faces || []);
      },
      error: (err) => console.error('Failed to load enrolled faces:', err),
    });
  }

  // ── Employee Selection ──
  protected onSearchChange(val: string): void {
    this.searchQuery.set(val);
  }

  protected clearSearch(): void {
    this.searchQuery.set('');
  }

  protected selectEmployee(emp: EmployeeListItem): void {
    if (this.autoResetTimer) {
      clearInterval(this.autoResetTimer);
      this.autoResetTimer = null;
    }
    this.resetCountdown.set(null);
    this.punchCooldown = false;
    this.consecutiveVerifiedFrames = 0;
    this.selectedEmployee.set(emp);
    this.searchQuery.set('');
    this.punchResult.set(null);

    // Check enrollment
    const enrolled = this.enrolledFaces().find(
      (f) => f.employeeId === emp.id || f.employeeCode?.toLowerCase() === emp.employeeCode.toLowerCase()
    );
    this.isFaceEnrolled.set(!!enrolled);
    this.empEnrolledPhoto.set(enrolled?.avatarUrl || null);

    // Check attendance status
    this.isLoadingStatus.set(true);
    this.api.punchStatus(emp.id).subscribe({
      next: (status) => {
        this.isLoadingStatus.set(false);
        this.isClockedIn.set(status.isCheckedIn);
        if (status.todayPunches && status.todayPunches.length > 0) {
          const last = status.todayPunches[status.todayPunches.length - 1];
          const time = new Date(last.punchTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          this.lastPunchInfo.set(`${last.punchType} at ${time}`);
        } else {
          this.lastPunchInfo.set('No punches recorded today');
        }
      },
      error: () => {
        this.isLoadingStatus.set(false);
        this.isClockedIn.set(false);
        this.lastPunchInfo.set(null);
      },
    });

    // Reset verification status
    this.faceStatus.set('idle');
    this.faceMatchScore.set(null);
  }

  // ── GPS Geofencing ──
  protected refreshGps(): void {
    if (!navigator.geolocation) {
      this.toast.show('Geolocation is not supported by your browser.', 'danger');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        this.updateCoordinates(lat, lon);
      },
      (err) => {
        console.warn('Geolocation error or permission denied:', err.message);
        // Fallback default: set to office location so development can proceed seamlessly
        this.updateCoordinates(this.OFFICE_LAT, this.OFFICE_LON);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  protected setMockOfficeGps(): void {
    this.updateCoordinates(this.OFFICE_LAT, this.OFFICE_LON);
    this.toast.show('GPS set to Registered Company Office (21.238557, 72.890135)', 'info');
  }

  private updateCoordinates(lat: number, lon: number): void {
    this.currentLat.set(lat);
    this.currentLon.set(lon);

    const dist = this.haversine(lat, lon, this.OFFICE_LAT, this.OFFICE_LON);
    this.distanceMeters.set(dist);
    this.isWithinGeofence.set(dist <= this.ALLOWED_RADIUS);
  }

  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // meters
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  protected calcDistanceBar(): number {
    const d = this.distanceMeters() ?? 0;
    if (d <= 0) return 100;
    if (d > this.ALLOWED_RADIUS) return 0;
    return Math.max(5, 100 - (d / this.ALLOWED_RADIUS) * 100);
  }

  // ── Camera & Face Recognition Loop ──
  private async startCameraAndFaceDetection(): Promise<void> {
    try {
      this.isCameraLoading.set(true);
      this.cameraError.set(null);
      await this.faceService.loadModels();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      });
      this.videoStream = stream;

      const videoEl = this.faceVideoRef?.nativeElement;
      if (videoEl) {
        videoEl.srcObject = stream;
        videoEl.onloadedmetadata = () => {
          videoEl.play();
          this.isCameraLoading.set(false);
          this.cameraError.set(null);
          this.startDetectionCycle();
        };
      }
    } catch (err) {
      console.error('Camera stream access failed:', err);
      this.isCameraLoading.set(false);
      this.cameraError.set('Webcam access was blocked or is in use by another application. Please grant camera permission and click Retry.');
      this.toast.show('Camera access blocked. Please allow webcam permission.', 'danger');
    }
  }

  protected retryCamera(): void {
    this.cameraError.set(null);
    this.startCameraAndFaceDetection();
  }

  private startDetectionCycle(): void {
    if (this.scanInterval) clearInterval(this.scanInterval);

    this.scanInterval = setInterval(async () => {
      // 1. Maintain employee cooldown countdown
      if (this.lastPunchedEmployeeId) {
        const elapsed = Date.now() - this.lastPunchedTime;
        if (elapsed < this.COOLDOWN_MS) {
          const remSec = Math.ceil((this.COOLDOWN_MS - elapsed) / 1000);
          this.cooldownRemaining.set(remSec);
        } else {
          this.lastPunchedEmployeeId = null;
          this.cooldownRemaining.set(0);
          this.cooldownEmployeeName.set(null);
        }
      }

      const video = this.faceVideoRef?.nativeElement;
      const canvas = this.faceCanvasRef?.nativeElement;
      if (!video || !canvas || video.paused || video.ended || this.isCameraLoading()) return;

      const scan: FaceScanResult = await this.faceService.detectFace(video, canvas);
      this.hasFaceDetected.set(scan.hasFace);

      if (scan.hasFace && scan.descriptor) {
        this.currentDescriptor = scan.descriptor;
        this.currentSnapshot = scan.snapshot || null;

        // Verify if employee is selected or auto-identify from enrolled faces
        const emp = this.selectedEmployee();
        if (emp) {
          this.verifySelectedFace(scan.descriptor);
        } else {
          this.identifyFace(scan.descriptor);
        }

        // Auto-Punch when verified and eligible (ensuring same employee is not in cooldown)
        const isCooldownActive =
          this.lastPunchedEmployeeId === emp?.id && Date.now() - this.lastPunchedTime < this.COOLDOWN_MS;

        if (
          this.autoPunchEnabled() &&
          this.canExecutePunch() &&
          !this.isSubmitting() &&
          !this.punchCooldown &&
          !this.punchResult() &&
          !isCooldownActive
        ) {
          this.consecutiveVerifiedFrames++;
          if (this.consecutiveVerifiedFrames >= 2) {
            this.punchCooldown = true;
            this.submitCentralizedPunch(this.isClockedIn() ? 'ClockOut' : 'ClockIn');
          }
        } else if (this.faceStatus() !== 'verified') {
          this.consecutiveVerifiedFrames = 0;
        }
      } else {
        this.currentDescriptor = null;
        this.consecutiveVerifiedFrames = 0;
        if (!this.selectedEmployee() && this.faceStatus() !== 'idle') {
          this.faceStatus.set('idle');
          this.faceMatchScore.set(null);
        }
      }
    }, 700);
  }

  private identifyFace(liveDescriptor: number[]): void {
    const enrolledList = this.enrolledFaces();
    if (!enrolledList || enrolledList.length === 0) {
      this.faceStatus.set('scanning');
      this.faceMatchScore.set(null);
      return;
    }

    let bestMatch: EnrolledFace | null = null;
    let bestScore = 0;
    let bestDist = 999;

    for (const enrolled of enrolledList) {
      if (!enrolled.faceDescriptor) continue;
      try {
        const refArr = JSON.parse(enrolled.faceDescriptor) as number[];
        const evalResult = this.faceService.compareFaces(liveDescriptor, refArr, 70);
        if (evalResult.matchScore > bestScore) {
          bestScore = evalResult.matchScore;
          bestDist = evalResult.distance;
          bestMatch = enrolled;
        }
      } catch {}
    }

    if (bestMatch && bestScore >= 70 && bestDist <= 0.58) {
      const matchingEmp = this.employees().find(
        (e) => e.id === bestMatch!.employeeId || e.employeeCode.toLowerCase() === bestMatch!.employeeCode.toLowerCase()
      );
      if (matchingEmp) {
        // If this same employee just punched within the cooldown period, do not re-select or re-trigger
        if (this.lastPunchedEmployeeId === matchingEmp.id) {
          const elapsed = Date.now() - this.lastPunchedTime;
          if (elapsed < this.COOLDOWN_MS) {
            const rem = Math.ceil((this.COOLDOWN_MS - elapsed) / 1000);
            this.cooldownRemaining.set(rem);
            this.faceMatchScore.set(bestScore);
            this.recognizedName.set(matchingEmp.fullName);
            return;
          }
        }

        this.selectEmployee(matchingEmp);
        this.faceMatchScore.set(bestScore);
        this.faceStatus.set('verified');
        this.recognizedName.set(matchingEmp.fullName);
        this.toast.show(`Face Recognized: ${matchingEmp.fullName} (${bestScore}% Match)`, 'info');
      }
    } else {
      this.faceStatus.set('scanning');
      this.faceMatchScore.set(null);
    }
  }

  private verifySelectedFace(liveDescriptor: number[]): void {
    const emp = this.selectedEmployee();
    if (!emp) return;

    const enrolled = this.enrolledFaces().find(
      (f) => f.employeeId === emp.id || f.employeeCode?.toLowerCase() === emp.employeeCode.toLowerCase()
    );

    if (!enrolled || !enrolled.faceDescriptor) {
      this.faceStatus.set('mismatched');
      this.faceMatchScore.set(0);
      return;
    }

    try {
      const refArr = JSON.parse(enrolled.faceDescriptor) as number[];
      const evalResult = this.faceService.compareFaces(liveDescriptor, refArr, 70);

      this.faceMatchScore.set(evalResult.matchScore);
      if (evalResult.matched || evalResult.matchScore >= 70) {
        this.faceStatus.set('verified');
      } else {
        this.faceStatus.set('mismatched');
      }
    } catch {
      this.faceStatus.set('mismatched');
      this.faceMatchScore.set(0);
    }
  }

  // ── Enroll Missing Face ──
  protected enrollCurrentFace(): void {
    const emp = this.selectedEmployee();
    if (!emp || !this.currentDescriptor) {
      this.toast.show('Please center face in front of the camera first.', 'warning');
      return;
    }

    this.isEnrolling.set(true);
    this.api
      .enrollFace(emp.id, {
        faceDescriptor: JSON.stringify(this.currentDescriptor),
        facePhotoUrl: this.currentSnapshot || undefined,
      })
      .subscribe({
        next: () => {
          this.isEnrolling.set(false);
          this.toast.show(`Face enrolled successfully for ${emp.fullName}!`, 'success');
          this.loadData();
          this.isFaceEnrolled.set(true);
        },
        error: (err) => {
          this.isEnrolling.set(false);
          this.toast.show(err.error?.message || 'Failed to enroll face.', 'danger');
        },
      });
  }

  // ── Centralized Punch Execution ──
  protected submitCentralizedPunch(type: 'ClockIn' | 'ClockOut'): void {
    const emp = this.selectedEmployee();
    if (!emp) return;

    if (!this.isWithinGeofence()) {
      this.toast.show(
        'You are outside the permitted company location. Please move within the registered office campus (≤ 500m) to mark your attendance.',
        'danger'
      );
      return;
    }

    if (this.faceStatus() !== 'verified') {
      this.toast.show('Face verification failed. Please verify face before recording attendance.', 'danger');
      return;
    }

    const lat = this.currentLat() ?? this.OFFICE_LAT;
    const lon = this.currentLon() ?? this.OFFICE_LON;

    const targetType = type || (this.isClockedIn() ? 'ClockOut' : 'ClockIn');
    const payload: CentralizedPunchRequest = {
      employeeId: emp.id,
      punchType: targetType,
      latitude: lat,
      longitude: lon,
      faceDescriptor: this.currentDescriptor || undefined,
      photoSnapshot: this.currentSnapshot || undefined,
      matchScore: this.faceMatchScore() ?? 85,
    };

    this.isSubmitting.set(true);
    this.api.centralizedPunch(payload).subscribe({
      next: (res) => {
        this.isSubmitting.set(false);
        this.punchResult.set(res);
        this.isClockedIn.set(res.punchType === 'ClockIn');

        // Record cooldown for this employee to prevent auto-retrigger ping-pong
        this.lastPunchedEmployeeId = emp.id;
        this.lastPunchedTime = Date.now();
        this.cooldownEmployeeName.set(emp.fullName);
        this.cooldownRemaining.set(25);

        const actionText = res.punchType === 'ClockIn' ? 'Successfully Punched In' : 'Successfully Punched Out';
        this.toast.show(`${actionText}: ${emp.fullName}!`, 'success');

        // Update last activity text
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        this.lastPunchInfo.set(`${res.punchType} at ${time}`);

        this.consecutiveVerifiedFrames = 0;
        // Automatically refresh highlighted employee card after confirmation
        this.startAutoReset(3);
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.punchCooldown = false;
        this.consecutiveVerifiedFrames = 0;
        const msg = err.error?.message || err.message || 'Attendance transaction failed.';
        this.punchResult.set({
          success: false,
          message: msg,
          employeeId: emp.id,
          employeeName: emp.fullName,
          employeeCode: emp.employeeCode,
          punchType: targetType,
          punchTime: new Date().toISOString(),
          latitude: lat,
          longitude: lon,
          distanceMeters: this.distanceMeters() ?? 0,
          withinGeofence: this.isWithinGeofence(),
          matchScore: this.faceMatchScore() ?? 0,
          faceVerified: false,
          status: 'Failed',
        });
        this.toast.show(msg, 'danger');
      },
    });
  }

  protected startAutoReset(seconds: number = 2): void {
    if (this.autoResetTimer) clearInterval(this.autoResetTimer);
    this.resetCountdown.set(seconds);

    this.autoResetTimer = setInterval(() => {
      const cur = this.resetCountdown();
      if (cur !== null && cur > 1) {
        this.resetCountdown.set(cur - 1);
      } else {
        this.resetForNextEmployee();
      }
    }, 1000);
  }

  protected resetForNextEmployee(): void {
    if (this.autoResetTimer) {
      clearInterval(this.autoResetTimer);
      this.autoResetTimer = null;
    }
    this.resetCountdown.set(null);
    this.selectedEmployee.set(null);
    this.searchQuery.set('');
    this.punchResult.set(null);
    this.faceStatus.set('idle');
    this.faceMatchScore.set(null);
    this.isFaceEnrolled.set(false);
    this.empEnrolledPhoto.set(null);
    this.lastPunchInfo.set(null);
    this.recognizedName.set(null);
    this.currentDescriptor = null;
    this.currentSnapshot = null;
    this.consecutiveVerifiedFrames = 0;
    this.punchCooldown = false;
    this.isLoadingStatus.set(false);
  }

  private stopCamera(): void {
    if (this.videoStream) {
      this.videoStream.getTracks().forEach((track) => track.stop());
      this.videoStream = null;
    }
  }

  protected getInitials(name: string): string {
    if (!name) return 'EM';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
}
