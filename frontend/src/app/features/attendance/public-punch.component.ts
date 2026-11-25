import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../core/api/api.service';
import { EnrolledFace, FacePunchResult, LoginResponse } from '../../core/api/api.models';
import { FaceRecognitionService, FaceScanResult } from '../../core/services/face-recognition.service';
import { safeParseDate } from '../../core/services/punch.service';
import { SessionService } from '../../core/services/session.service';

interface PunchPopupData {
  success: boolean;
  employeeName: string;
  employeeCode: string;
  punchType: string;
  punchTime: Date;
  message: string;
  matchScore: number | null;
}

interface TerminalAuthState {
  token: string;
  expiresAtUtc: string;
  companyCode: string;
  companyName: string;
  companyLogoUrl: string | null;
  hrName: string;
  role: string;
}

const TERMINAL_AUTH_KEY = 'hrms.punch.terminal.auth';
const PUNCH_THEME_KEY = 'hrms.punch.theme';
const ALLOWED_HR_ROLES = new Set(['hr manager', 'company admin', 'hrmanager', 'companyadmin']);

/**
 * Company-specific Attendance Punch Terminal.
 * Unlocked using company HR credentials so attendance & enrolled faces stay
 * strictly scoped to that company's tenant database, while preventing access
 * to the main HR portal when unlocked in standalone terminal mode.
 */
@Component({
  selector: 'app-public-punch',
  standalone: true,
  imports: [CommonModule, FormsModule],
  host: { '[class.light-theme]': '!isDarkMode()' },
  template: `
    <!-- 10-second Auto-Dismiss Confirmation / Error Popup -->
    @if (showPopup() && popupData(); as p) {
      <div class="popup-backdrop" (click)="dismissPopup()">
        <div
          class="popup-card"
          [class.popup-success]="p.success"
          [class.popup-fail]="!p.success"
          (click)="$event.stopPropagation()"
        >
          <div class="popup-countdown-ring" title="Auto closing">
            <svg class="ring-svg" viewBox="0 0 44 44">
              <circle class="ring-track" cx="22" cy="22" r="18" />
              <circle class="ring-fill" cx="22" cy="22" r="18" [style.stroke-dashoffset]="countdownDashOffset()" />
            </svg>
            <span class="ring-label">{{ popupCountdown() }}</span>
          </div>

          <div class="popup-icon" [class.icon-ok]="p.success" [class.icon-err]="!p.success">
            @if (p.success) {
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            } @else {
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            }
          </div>

          <div class="popup-title">
            @if (p.success) {
              {{ p.punchType === 'ClockOut' ? 'Punched Out Successfully!' : 'Punched In Successfully!' }}
            } @else {
              Punch Failed
            }
          </div>

          <div class="popup-emp-row">
            <div class="popup-avatar">{{ getInitials(p.employeeName) }}</div>
            <div class="popup-emp-info">
              <div class="popup-emp-name">{{ p.employeeName }}</div>
              <div class="popup-emp-code">{{ p.employeeCode || 'Employee' }}</div>
            </div>
            <div
              class="popup-status-badge"
              [class.badge-in]="p.punchType !== 'ClockOut'"
              [class.badge-out]="p.punchType === 'ClockOut'"
            >
              {{ p.punchType === 'ClockOut' ? 'Punch Out' : 'Punch In' }}
            </div>
          </div>

          <div class="popup-time">
            {{ p.punchTime | date:'hh:mm:ss a, EEEE d MMM y' }}
          </div>

          <div class="popup-message" [class.msg-success]="p.success" [class.msg-fail]="!p.success">
            {{ p.message }}
          </div>

          @if (p.success && p.matchScore !== null) {
            <div class="popup-meta">Biometric Match: {{ p.matchScore }}%</div>
          }

          <button type="button" class="popup-dismiss" (click)="dismissPopup()">Dismiss Now</button>
        </div>
      </div>
    }

    @if (!isUnlocked()) {
      <!-- HR Credentials Gate (Static, No Scrollbar) -->
      <div class="auth-shell">
        <button
          type="button"
          class="btn-theme-toggle auth-theme-btn"
          (click)="toggleTheme()"
          [title]="isDarkMode() ? 'Switch to Light Mode' : 'Switch to Dark Mode'"
        >
          @if (isDarkMode()) {
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="5"></circle>
              <line x1="12" y1="1" x2="12" y2="3"></line>
              <line x1="12" y1="21" x2="12" y2="23"></line>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
              <line x1="1" y1="12" x2="3" y2="12"></line>
              <line x1="21" y1="12" x2="23" y2="12"></line>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
            </svg>
            <span>Light</span>
          } @else {
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
            <span>Dark</span>
          }
        </button>

        <div class="auth-card">
          <div class="auth-brand">
            <div class="auth-logo-wrap">
              <img src="assets/images/shape-logo.png" alt="HRMS" class="auth-logo" />
            </div>
            <div class="punch-badge">Attendance Terminal Setup</div>
            <h1 class="auth-title">HR Authentication Required</h1>
            <p class="auth-subtitle">
              Sign in with your company HR Manager or Company Admin credentials to unlock this attendance terminal.
            </p>
          </div>

          @if (authError()) {
            <div class="auth-error">{{ authError() }}</div>
          }

          <form class="auth-form" (ngSubmit)="unlockWithHrCredentials()">
            <div class="field-group">
              <label class="field-label" for="hrEmail">HR Email Address</label>
              <input
                id="hrEmail"
                type="email"
                name="hrEmail"
                class="field-input"
                placeholder="hr@company.com"
                autocomplete="username"
                [(ngModel)]="hrEmail"
                required
              />
            </div>

            <div class="field-group">
              <label class="field-label" for="hrPassword">Password</label>
              <div class="pwd-wrap">
                <input
                  id="hrPassword"
                  [type]="showPassword() ? 'text' : 'password'"
                  name="hrPassword"
                  class="field-input pwd-input"
                  placeholder="Enter HR password"
                  autocomplete="current-password"
                  [(ngModel)]="hrPassword"
                  required
                />
                <button
                  type="button"
                  class="btn-eye"
                  (click)="showPassword.set(!showPassword())"
                  [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'"
                >
                  @if (showPassword()) {
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                      <line x1="1" y1="1" x2="23" y2="23"></line>
                    </svg>
                  } @else {
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                  }
                </button>
              </div>
            </div>

            <button type="submit" class="btn-unlock" [disabled]="isAuthenticating()">
              @if (isAuthenticating()) {
                <span class="btn-spin"></span>
                <span>Verifying HR Credentials...</span>
              } @else {
                <span>Unlock Attendance Terminal</span>
              }
            </button>
          </form>
        </div>
      </div>
    } @else {
      <!-- Static Full-Viewport Punch Terminal (No Scrollbar) -->
      <div class="punch-shell">
        <header class="punch-header">
          <div class="punch-header-left">
            <div class="brand-row">
              @if (companyLogoUrl()) {
                <img [src]="companyLogoUrl()" alt="Company Logo" class="company-logo" />
              }
              <div class="punch-badge">
                {{ companyName() ? companyName() + ' · Attendance Terminal' : 'Attendance Punch Terminal' }}
              </div>
            </div>
            <h1 class="punch-title">Attendance Punch</h1>
            <p class="punch-subtitle">Face-Verified Punch In / Punch Out</p>
          </div>

          <div class="header-right-group">
            <div class="live-clock-box">
              <div class="clock-label">Current Time</div>
              <div class="clock-time">{{ liveTime() | date:'hh:mm:ss a' }}</div>
              <div class="clock-date">{{ liveTime() | date:'EEE, MMM d y' }}</div>
            </div>

            <button
              type="button"
              class="btn-header-action"
              (click)="toggleTheme()"
              [title]="isDarkMode() ? 'Switch to Light Mode' : 'Switch to Dark Mode'"
            >
              @if (isDarkMode()) {
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="5"></circle>
                  <line x1="12" y1="1" x2="12" y2="3"></line>
                  <line x1="12" y1="21" x2="12" y2="23"></line>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                  <line x1="1" y1="12" x2="3" y2="12"></line>
                  <line x1="21" y1="12" x2="23" y2="12"></line>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                </svg>
                <span class="action-text">Light</span>
              } @else {
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                </svg>
                <span class="action-text">Dark</span>
              }
            </button>

            <button
              type="button"
              class="btn-header-action btn-lock-terminal"
              (click)="lockTerminal()"
              title="Lock terminal / Sign out HR session"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
              <span class="action-text">Lock</span>
            </button>
          </div>
        </header>

        <!-- Main Face Verification Card -->
        <main class="face-card">
          <div class="card-top-bar">
            <div class="card-title-wrap">
              <span class="title-dot" [class.dot-verified]="faceStatus() === 'verified'" [class.dot-fail]="faceStatus() === 'mismatched'"></span>
              <span class="card-title">Face Verification</span>
            </div>
          </div>

          <!-- Camera Preview Area -->
          <div class="cam-wrap">
            <video #faceVideo class="cam-video" autoplay playsinline muted></video>
            <canvas #faceCanvas class="cam-canvas"></canvas>

            @if (isCamLoading() || faceService.loadingModels()) {
              <div class="cam-overlay">
                <div class="spinner"></div>
                <div class="cam-msg">
                  {{ faceService.loadingModels() ? 'Loading AI Face Recognition Models...' : 'Starting Camera...' }}
                </div>
              </div>
            }

            @if (cameraError()) {
              <div class="cam-overlay cam-error">
                <div class="cam-err-icon">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                    <line x1="2" y1="2" x2="22" y2="22"></line>
                  </svg>
                </div>
                <div class="cam-err-msg">{{ cameraError() }}</div>
                <button type="button" class="btn-retry" (click)="retryCamera()">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="23 4 23 10 17 10"></polyline>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                  </svg>
                  <span>Retry Camera Access</span>
                </button>
              </div>
            }

            <div
              class="reticle"
              [class.reticle-scanning]="hasFaceDetected() && faceStatus() === 'scanning'"
              [class.reticle-match]="faceStatus() === 'verified'"
              [class.reticle-fail]="faceStatus() === 'mismatched'"
            >
              <div class="rc tl"></div>
              <div class="rc tr"></div>
              <div class="rc bl"></div>
              <div class="rc br"></div>
              @if (!cameraError() && !isCamLoading() && !faceService.loadingModels()) {
                <div class="scan-line"></div>
              }
            </div>

            <div
              class="face-pill"
              [class.pill-success]="faceStatus() === 'verified'"
              [class.pill-fail]="faceStatus() === 'mismatched'"
            >
              @if (isSubmitting()) {
                Recording Punch...
              } @else if (faceStatus() === 'verified' && matchedFace()) {
                Verified: {{ matchedFace()!.fullName }} ({{ faceMatchScore() }}% Match)
              } @else if (faceStatus() === 'mismatched') {
                Face Not Recognized ({{ faceMatchScore() ?? 0 }}%)
              } @else if (hasFaceDetected()) {
                Scanning Face...
              } @else if (facesLoaded() && enrolledFaces.length === 0) {
                No Enrolled Faces Found
              } @else {
                Position Your Face Inside Frame
              }
            </div>
          </div>

          <!-- Biometric Confidence Bar -->
          <div class="meter-card">
            <div class="meter-hdr">
              <span class="meter-label">Biometric Confidence (Min &ge; 70%)</span>
              <span
                class="meter-score"
                [class.score-pass]="faceStatus() === 'verified'"
                [class.score-fail]="faceStatus() === 'mismatched'"
              >
                {{ faceMatchScore() !== null ? faceMatchScore() + '%' : '--' }}
              </span>
            </div>
            <div class="meter-track">
              <div
                class="meter-bar"
                [style.width.%]="faceMatchScore() ?? 0"
                [class.bar-pass]="faceStatus() === 'verified'"
                [class.bar-fail]="faceStatus() === 'mismatched'"
              ></div>
            </div>
          </div>
        </main>
      </div>
    }
  `,
  styles: [`
    :host {
      --p: #3b82f6;
      --p-dark: #2563eb;
      --bg: #090d16;
      --surface: #131a27;
      --border: #253045;
      --text: #f1f5f9;
      --muted: #94a3b8;
      --light: #64748b;
      display: flex;
      flex-direction: column;
      height: 100vh;
      height: 100dvh;
      width: 100%;
      overflow: hidden;
      background: radial-gradient(circle at 50% 0%, #111c33 0%, #090d16 65%);
      color: var(--text);
      color-scheme: dark;
      box-sizing: border-box;
    }

    :host(.light-theme) {
      --p: #2563eb;
      --p-dark: #1d4ed8;
      --bg: #f1f5f9;
      --surface: #ffffff;
      --border: #e2e8f0;
      --text: #0f172a;
      --muted: #64748b;
      --light: #94a3b8;
      background: var(--bg);
      color: var(--text);
      color-scheme: light;
    }

    /* HR Auth Gate */
    .auth-shell {
      position: relative;
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      overflow: hidden;
    }
    .btn-theme-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 12px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-theme-toggle:hover {
      border-color: var(--p);
      color: var(--p);
    }
    .auth-theme-btn {
      position: absolute;
      top: 18px;
      right: 20px;
    }
    .auth-card {
      width: 100%;
      max-width: 420px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 28px 26px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.55);
      box-sizing: border-box;
    }
    :host(.light-theme) .auth-card {
      box-shadow: 0 12px 36px rgba(15, 23, 42, 0.08);
    }
    .auth-brand {
      text-align: center;
      margin-bottom: 20px;
    }
    .auth-logo-wrap {
      width: 48px;
      height: 48px;
      margin: 0 auto 12px;
      border-radius: 12px;
      background: var(--bg);
      border: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .auth-logo {
      width: 30px;
      height: 30px;
      object-fit: contain;
    }
    .auth-title {
      font-size: 1.3rem;
      font-weight: 800;
      color: var(--text);
      margin: 8px 0 6px;
    }
    .auth-subtitle {
      font-size: 12.5px;
      color: var(--muted);
      line-height: 1.45;
      margin: 0;
    }
    .auth-error {
      background: rgba(239, 68, 68, 0.14);
      border: 1px solid rgba(248, 113, 113, 0.35);
      color: #fca5a5;
      font-size: 12.5px;
      font-weight: 600;
      padding: 10px 12px;
      border-radius: 10px;
      margin-bottom: 14px;
      line-height: 1.4;
      text-transform: none;
    }
    :host(.light-theme) .auth-error {
      background: #fef2f2;
      border-color: #fecaca;
      color: #991b1b;
    }
    .auth-form {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .field-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .field-label {
      font-size: 12px;
      font-weight: 700;
      color: var(--text);
    }
    .field-input {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: #0b101b;
      color: var(--text);
      font-size: 13.5px;
      text-transform: none;
      color-scheme: dark;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
    }
    :host(.light-theme) .field-input {
      background: #f8fafc;
      color-scheme: light;
    }
    .field-input::placeholder {
      color: var(--light);
    }
    .field-input:focus {
      border-color: var(--p);
      background: #0f1626;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.18);
    }
    :host(.light-theme) .field-input:focus {
      background: #ffffff;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
    }
    .pwd-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }
    .pwd-input {
      padding-right: 40px;
    }
    .btn-eye {
      position: absolute;
      right: 10px;
      background: transparent;
      border: none;
      color: var(--muted, #64748b);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
    }
    .btn-unlock {
      margin-top: 4px;
      width: 100%;
      padding: 11px 16px;
      border: none;
      border-radius: 10px;
      background: var(--p, #2563eb);
      color: #fff;
      font-size: 13.5px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: opacity 0.15s;
    }
    .btn-unlock:hover:not(:disabled) { opacity: 0.94; }
    .btn-unlock:disabled { opacity: 0.65; cursor: not-allowed; }
    .btn-spin {
      width: 15px;
      height: 15px;
      border: 2px solid rgba(255, 255, 255, 0.35);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    /* Main Terminal Layout */
    .punch-shell {
      flex: 1;
      min-height: 0;
      width: 100%;
      max-width: 960px;
      margin: 0 auto;
      padding: 18px 24px 20px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 14px;
      overflow: hidden;
    }

    /* Header */
    .punch-header {
      flex-shrink: 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 14px;
    }
    .brand-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .company-logo {
      width: 22px;
      height: 22px;
      border-radius: 5px;
      object-fit: contain;
      background: var(--surface, #fff);
      border: 1px solid var(--border, #e2e8f0);
    }
    .punch-badge {
      display: inline-block;
      padding: 3px 10px;
      background: rgba(56, 189, 248, 0.14);
      color: #38bdf8;
      font-size: 11px;
      font-weight: 700;
      border-radius: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .punch-title {
      font-size: 1.4rem;
      font-weight: 800;
      color: var(--text, #0f172a);
      margin: 0;
      line-height: 1.2;
    }
    .punch-subtitle {
      font-size: 12.5px;
      color: var(--muted, #64748b);
      margin: 2px 0 0;
    }

    .header-right-group {
      display: flex;
      align-items: stretch;
      gap: 10px;
      flex-shrink: 0;
    }

    .live-clock-box {
      background: var(--surface, #fff);
      border: 1px solid var(--border, #e2e8f0);
      padding: 9px 16px;
      border-radius: 12px;
      text-align: right;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
      flex-shrink: 0;
    }
    .clock-label {
      font-size: 10px;
      font-weight: 700;
      color: var(--muted, #64748b);
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .clock-time {
      font-size: 1.15rem;
      font-weight: 800;
      color: var(--text, #0f172a);
      font-variant-numeric: tabular-nums;
    }
    .clock-date {
      font-size: 11px;
      color: var(--muted, #64748b);
    }

    .btn-header-action {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      padding: 8px 12px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--muted);
      font-size: 10.5px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-header-action:hover {
      color: var(--p);
      border-color: var(--p);
      background: rgba(59, 130, 246, 0.1);
    }
    .btn-lock-terminal:hover {
      color: #fca5a5;
      border-color: rgba(248, 113, 113, 0.4);
      background: rgba(239, 68, 68, 0.14);
    }
    :host(.light-theme) .btn-lock-terminal:hover {
      color: #dc2626;
      border-color: #fecaca;
      background: #fef2f2;
    }
    :host(.light-theme) .punch-badge {
      background: rgba(14, 165, 233, 0.12);
      color: #0284c7;
    }
    :host(.light-theme) .popup-backdrop {
      background: rgba(15, 23, 42, 0.6);
    }
    :host(.light-theme) .popup-icon.icon-ok { background: #ecfdf5; color: #10b981; border-color: #a7f3d0; }
    :host(.light-theme) .popup-icon.icon-err { background: #fef2f2; color: #ef4444; border-color: #fecaca; }
    :host(.light-theme) .popup-avatar { background: #e0e7ff; color: #3730a3; }
    :host(.light-theme) .badge-in { background: #ecfdf5; color: #065f46; border-color: #a7f3d0; }
    :host(.light-theme) .badge-out { background: #fff1f2; color: #991b1b; border-color: #fecaca; }
    :host(.light-theme) .msg-success { color: #065f46; }
    :host(.light-theme) .msg-fail { color: #991b1b; }
    :host(.light-theme) .popup-dismiss:hover { background: #f8fafc; }

    /* Main Face Card */
    .face-card {
      flex: 1;
      min-height: 0;
      background: var(--surface, #fff);
      border: 1px solid var(--border, #e2e8f0);
      border-radius: var(--r, 14px);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 2px 10px rgba(15, 23, 42, 0.04);
      overflow: hidden;
    }

    .card-top-bar {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .card-title-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .title-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--p, #2563eb);
      transition: background 0.2s;
    }
    .title-dot.dot-verified { background: #10b981; }
    .title-dot.dot-fail { background: #ef4444; }
    .card-title {
      font-size: 14px;
      font-weight: 800;
      color: var(--text, #0f172a);
    }

    /* Camera Preview Area */
    .cam-wrap {
      position: relative;
      flex: 1;
      min-height: 0;
      width: 100%;
      background: #090e1a;
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1.5px solid #1e293b;
    }
    .cam-video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transform: scaleX(-1);
    }
    .cam-canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      transform: scaleX(-1);
      pointer-events: none;
    }

    .cam-overlay {
      position: absolute;
      inset: 0;
      background: rgba(15, 23, 42, 0.9);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      z-index: 10;
      padding: 20px;
    }
    .cam-error {
      background: rgba(15, 23, 42, 0.95);
    }
    .cam-err-icon {
      color: #f59e0b;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .cam-msg {
      font-size: 13px;
      font-weight: 600;
      color: #f1f5f9;
      text-align: center;
    }
    .cam-err-msg {
      font-size: 13px;
      font-weight: 600;
      color: #fee2e2;
      text-align: center;
      max-width: 340px;
      line-height: 1.45;
    }
    .btn-retry {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 9px 18px;
      background: #2563eb;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-retry:hover { background: #1d4ed8; }

    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(255, 255, 255, 0.2);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .reticle {
      position: absolute;
      width: min(210px, 52vw);
      height: min(260px, 64%);
      border: 1.5px dashed rgba(255, 255, 255, 0.35);
      border-radius: 999px;
      pointer-events: none;
      overflow: hidden;
      transition: all 0.25s;
    }
    .reticle.reticle-scanning {
      border-color: rgba(56, 189, 248, 0.75);
      box-shadow: 0 0 20px rgba(56, 189, 248, 0.25);
    }
    .reticle.reticle-match {
      border-color: #10b981;
      border-style: solid;
      box-shadow: 0 0 28px rgba(16, 185, 129, 0.55);
    }
    .reticle.reticle-fail {
      border-color: #ef4444;
      border-style: solid;
      box-shadow: 0 0 25px rgba(239, 68, 68, 0.5);
    }
    .rc {
      position: absolute;
      width: 14px;
      height: 14px;
      border-color: inherit;
    }
    .tl { top: 8px; left: 8px; border-top: 2.5px solid rgba(255,255,255,0.65); border-left: 2.5px solid rgba(255,255,255,0.65); }
    .tr { top: 8px; right: 8px; border-top: 2.5px solid rgba(255,255,255,0.65); border-right: 2.5px solid rgba(255,255,255,0.65); }
    .bl { bottom: 8px; left: 8px; border-bottom: 2.5px solid rgba(255,255,255,0.65); border-left: 2.5px solid rgba(255,255,255,0.65); }
    .br { bottom: 8px; right: 8px; border-bottom: 2.5px solid rgba(255,255,255,0.65); border-right: 2.5px solid rgba(255,255,255,0.65); }

    .scan-line {
      position: absolute;
      left: 10%;
      right: 10%;
      height: 2px;
      background: linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.85), transparent);
      animation: scanSweep 2.4s ease-in-out infinite;
    }
    @keyframes scanSweep {
      0%, 100% { top: 12%; opacity: 0.25; }
      50% { top: 86%; opacity: 0.9; }
    }

    .face-pill {
      position: absolute;
      bottom: 14px;
      padding: 6px 15px;
      border-radius: 20px;
      background: rgba(15, 23, 42, 0.78);
      color: #f8fafc;
      font-size: 12px;
      font-weight: 700;
      backdrop-filter: blur(6px);
      border: 1px solid rgba(255, 255, 255, 0.14);
      transition: all 0.2s;
      max-width: 90%;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .face-pill.pill-success {
      background: rgba(6, 95, 70, 0.92);
      color: #d1fae5;
      border-color: rgba(16, 185, 129, 0.5);
    }
    .face-pill.pill-fail {
      background: rgba(153, 27, 27, 0.92);
      color: #fee2e2;
      border-color: rgba(239, 68, 68, 0.5);
    }

    /* Biometric Confidence Meter */
    .meter-card {
      flex-shrink: 0;
      background: var(--bg, #f8fafc);
      border: 1px solid var(--border, #e2e8f0);
      padding: 10px 14px;
      border-radius: 10px;
    }
    .meter-hdr {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      margin-bottom: 6px;
    }
    .meter-label {
      font-size: 12px;
      font-weight: 700;
      color: var(--muted, #475569);
    }
    .meter-score {
      font-size: 13.5px;
      font-weight: 800;
      color: var(--text, #0f172a);
    }
    .meter-score.score-pass { color: #10b981; }
    .meter-score.score-fail { color: #ef4444; }
    .meter-track {
      height: 8px;
      background: var(--border, #e2e8f0);
      border-radius: 4px;
      overflow: hidden;
    }
    .meter-bar {
      height: 100%;
      background: var(--p, #3b82f6);
      transition: width 0.25s ease;
    }
    .meter-bar.bar-pass { background: #10b981; }
    .meter-bar.bar-fail { background: #ef4444; }

    /* Popup */
    .popup-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.72);
      backdrop-filter: blur(6px);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      animation: fadeIn 0.2s ease;
    }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

    .popup-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 28px 24px;
      width: 100%;
      max-width: 400px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
      animation: slideUp 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
      position: relative;
    }
    @keyframes slideUp {
      from { transform: translateY(32px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .popup-card.popup-success { border-top: 5px solid #10b981; }
    .popup-card.popup-fail { border-top: 5px solid #ef4444; }

    .popup-countdown-ring {
      position: absolute;
      top: 14px;
      right: 14px;
      width: 42px;
      height: 42px;
    }
    .ring-svg { width: 42px; height: 42px; transform: rotate(-90deg); }
    .ring-track { fill: none; stroke: var(--border); stroke-width: 3; }
    .ring-fill {
      fill: none;
      stroke: #10b981;
      stroke-width: 3;
      stroke-dasharray: 113.1;
      transition: stroke-dashoffset 1s linear;
    }
    .popup-card.popup-fail .ring-fill { stroke: #ef4444; }
    .ring-label {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 800;
      color: var(--text);
    }

    .popup-icon {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .popup-icon.icon-ok { background: rgba(16, 185, 129, 0.14); color: #34d399; border: 2px solid rgba(16, 185, 129, 0.35); }
    .popup-icon.icon-err { background: rgba(239, 68, 68, 0.14); color: #f87171; border: 2px solid rgba(239, 68, 68, 0.35); }

    .popup-title {
      font-size: 1.2rem;
      font-weight: 800;
      color: var(--text);
      text-align: center;
    }

    .popup-emp-row {
      display: flex;
      align-items: center;
      gap: 12px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px 12px;
      width: 100%;
      box-sizing: border-box;
    }
    .popup-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: rgba(59, 130, 246, 0.2);
      color: #93c5fd;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 800;
      flex-shrink: 0;
    }
    .popup-emp-info { min-width: 0; }
    .popup-emp-name {
      font-size: 14px;
      font-weight: 800;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .popup-emp-code { font-size: 11.5px; color: var(--muted); }
    .popup-status-badge {
      margin-left: auto;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 800;
      flex-shrink: 0;
    }
    .badge-in { background: rgba(16, 185, 129, 0.16); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); }
    .badge-out { background: rgba(239, 68, 68, 0.16); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.35); }

    .popup-time { font-size: 12px; color: var(--muted); }
    .popup-message { font-size: 13px; font-weight: 600; text-align: center; line-height: 1.4; }
    .msg-success { color: #34d399; }
    .msg-fail { color: #fca5a5; }
    .popup-meta { font-size: 11.5px; color: var(--muted); }

    .popup-dismiss {
      padding: 8px 22px;
      border-radius: 20px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .popup-dismiss:hover { background: rgba(255, 255, 255, 0.06); color: var(--text); }

    @media (max-width: 640px) {
      .punch-shell {
        padding: 12px 12px 14px;
        gap: 10px;
      }
      .punch-title { font-size: 1.15rem; }
      .punch-subtitle { font-size: 11.5px; }
      .live-clock-box { padding: 7px 11px; }
      .clock-time { font-size: 0.95rem; }
      .clock-date { font-size: 10px; }
      .btn-header-action { padding: 6px 9px; }
      .action-text { display: none; }
      .face-card { padding: 12px; gap: 10px; }
      .meter-label { font-size: 11px; }
      .auth-card { padding: 22px 18px; }
    }
  `],
})
export class PublicPunchComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(SessionService);
  protected readonly faceService = inject(FaceRecognitionService);

  @ViewChild('faceVideo') private faceVideoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('faceCanvas') private faceCanvasRef?: ElementRef<HTMLCanvasElement>;

  // Silent background GPS coordinates sent to backend for 100m validation
  private currentLat: number | null = null;
  private currentLon: number | null = null;
  private geoWatchId: number | null = null;

  // Page-only theme state (defaults to dark mode)
  protected readonly isDarkMode = signal<boolean>(this.readInitialTheme());

  // Auth gate state
  protected readonly isUnlocked = signal(false);
  protected readonly isAuthenticating = signal(false);
  protected readonly authError = signal<string | null>(null);
  protected readonly showPassword = signal(false);
  protected hrEmail = '';
  protected hrPassword = '';

  // Terminal & company state
  protected readonly liveTime = signal<Date>(new Date());
  protected readonly companyName = signal<string>('');
  protected readonly companyLogoUrl = signal<string | null>(null);

  // Camera & face detection state
  protected readonly isCamLoading = signal(true);
  protected readonly cameraError = signal<string | null>(null);
  protected readonly hasFaceDetected = signal(false);
  protected readonly faceStatus = signal<'idle' | 'scanning' | 'verified' | 'mismatched'>('idle');
  protected readonly faceMatchScore = signal<number | null>(null);
  protected readonly matchedFace = signal<EnrolledFace | null>(null);
  protected readonly isSubmitting = signal(false);
  protected readonly facesLoaded = signal(false);

  // Result popup state
  protected readonly showPopup = signal(false);
  protected readonly popupData = signal<PunchPopupData | null>(null);
  protected readonly popupCountdown = signal(10);

  private readonly POPUP_TOTAL = 10;
  private readonly RING_C = 2 * Math.PI * 18;
  protected readonly countdownDashOffset = computed(() => {
    const frac = this.popupCountdown() / this.POPUP_TOTAL;
    return this.RING_C * (1 - frac);
  });

  protected enrolledFaces: EnrolledFace[] = [];
  private activeToken: string | undefined;
  private activeCompanyCode: string | undefined;
  private queryCompanyCode: string | undefined;

  private videoStream: MediaStream | null = null;
  private scanInterval: ReturnType<typeof setInterval> | null = null;
  private clockInterval: ReturnType<typeof setInterval> | null = null;
  private popupTimer: ReturnType<typeof setInterval> | null = null;

  private isDetectingFrame = false;
  private consecutiveVerifiedFrames = 0;
  private lastVerifiedEmployeeId: string | null = null;
  private cooldownMap = new Map<string, number>();

  ngOnInit(): void {
    this.clockInterval = setInterval(() => this.liveTime.set(new Date()), 1000);

    const qp = this.route.snapshot.queryParamMap;
    const rawCode = qp.get('company') || qp.get('code') || qp.get('tenant');
    this.queryCompanyCode = rawCode && rawCode !== 'ALL' ? rawCode.trim() : undefined;

    this.restoreHrTerminalAuth();
  }

  ngAfterViewInit(): void {
    if (this.isUnlocked()) {
      void this.startCamera();
    }
  }

  ngOnDestroy(): void {
    if (this.clockInterval) clearInterval(this.clockInterval);
    if (this.scanInterval) clearInterval(this.scanInterval);
    if (this.popupTimer) clearInterval(this.popupTimer);
    if (this.geoWatchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.geoWatchId);
      this.geoWatchId = null;
    }
    this.stopCamera();
  }

  private readInitialTheme(): boolean {
    try {
      const saved = localStorage.getItem(PUNCH_THEME_KEY);
      if (saved === 'light') return false;
    } catch { }
    return true;
  }

  protected toggleTheme(): void {
    const next = !this.isDarkMode();
    this.isDarkMode.set(next);
    try {
      localStorage.setItem(PUNCH_THEME_KEY, next ? 'dark' : 'light');
    } catch { }
  }

  private isAllowedHrRole(role?: string | null): boolean {
    if (!role) return false;
    return ALLOWED_HR_ROLES.has(role.trim().toLowerCase());
  }

  private restoreHrTerminalAuth(): void {
    // 1. Check dedicated terminal auth stored in localStorage
    try {
      const raw = localStorage.getItem(TERMINAL_AUTH_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as TerminalAuthState;
        const expMs = Date.parse(parsed.expiresAtUtc);
        if (parsed.token && parsed.companyCode && (!Number.isFinite(expMs) || expMs > Date.now())) {
          if (!this.queryCompanyCode || parsed.companyCode.toLowerCase() === this.queryCompanyCode.toLowerCase()) {
            this.applyUnlockedAuth(parsed);
            return;
          }
        } else {
          localStorage.removeItem(TERMINAL_AUTH_KEY);
        }
      }
    } catch {
      localStorage.removeItem(TERMINAL_AUTH_KEY);
    }

    // 2. Fallback: if already signed in on this browser with HR credentials for a company
    const sessionUser = this.session.user();
    const sessionToken = this.session.token();
    if (
      sessionToken &&
      sessionUser?.companyCode &&
      sessionUser.companyCode !== 'ALL' &&
      this.isAllowedHrRole(sessionUser.role) &&
      (!this.queryCompanyCode || sessionUser.companyCode.toLowerCase() === this.queryCompanyCode.toLowerCase())
    ) {
      this.applyUnlockedAuth({
        token: sessionToken,
        expiresAtUtc: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
        companyCode: sessionUser.companyCode,
        companyName: sessionUser.companyName || sessionUser.companyCode,
        companyLogoUrl: sessionUser.companyLogoUrl ?? null,
        hrName: sessionUser.name || 'HR Manager',
        role: sessionUser.role,
      });
    }
  }

  protected unlockWithHrCredentials(): void {
    const email = this.hrEmail.trim();
    const password = this.hrPassword.trim();

    if (!email || !password) {
      this.authError.set('Please enter your HR email address and password.');
      return;
    }

    this.authError.set(null);
    this.isAuthenticating.set(true);

    this.api.login(email, password, this.queryCompanyCode).subscribe({
      next: (res: LoginResponse) => {
        this.isAuthenticating.set(false);
        const role = res.user?.role;
        const companyCode = res.user?.companyCode;

        if (!this.isAllowedHrRole(role) || !companyCode || companyCode === 'ALL') {
          this.authError.set('Access denied. Please sign in with company HR Manager or Company Admin credentials.');
          return;
        }

        const authState: TerminalAuthState = {
          token: res.accessToken,
          expiresAtUtc: res.expiresAtUtc,
          companyCode,
          companyName: res.user.companyName || companyCode,
          companyLogoUrl: res.user.companyLogoUrl ?? null,
          hrName: res.user.fullName || 'HR Manager',
          role,
        };

        try {
          localStorage.setItem(TERMINAL_AUTH_KEY, JSON.stringify(authState));
        } catch {
          // Ignore storage quota errors; memory session remains active
        }

        this.hrPassword = '';
        this.applyUnlockedAuth(authState);
        setTimeout(() => void this.startCamera(), 0);
      },
      error: (err) => {
        this.isAuthenticating.set(false);
        this.authError.set(
          err?.error?.detail ||
          err?.error?.title ||
          err?.error?.message ||
          'Invalid HR credentials. Please check your email and password.',
        );
      },
    });
  }

  private applyUnlockedAuth(auth: TerminalAuthState): void {
    this.activeToken = auth.token;
    this.activeCompanyCode = auth.companyCode;
    this.companyName.set(auth.companyName || auth.companyCode);
    this.companyLogoUrl.set(auth.companyLogoUrl ?? null);
    this.isUnlocked.set(true);
    this.loadEnrolledFaces();
    this.startGpsTracking();
  }

  private startGpsTracking(): void {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.currentLat = pos.coords.latitude;
        this.currentLon = pos.coords.longitude;
      },
      () => {
        this.currentLat = null;
        this.currentLon = null;
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
    if (this.geoWatchId !== null) {
      navigator.geolocation.clearWatch(this.geoWatchId);
    }
    this.geoWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.currentLat = pos.coords.latitude;
        this.currentLon = pos.coords.longitude;
      },
      () => { },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 },
    );
  }

  private getCurrentCoords(): Promise<{ lat: number | null; lon: number | null }> {
    if (this.currentLat !== null && this.currentLon !== null) {
      return Promise.resolve({ lat: this.currentLat, lon: this.currentLon });
    }
    if (!navigator.geolocation) {
      return Promise.resolve({ lat: null, lon: null });
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.currentLat = pos.coords.latitude;
          this.currentLon = pos.coords.longitude;
          resolve({ lat: this.currentLat, lon: this.currentLon });
        },
        () => resolve({ lat: null, lon: null }),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 5000 },
      );
    });
  }

  protected lockTerminal(errorMsg?: string): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    if (this.geoWatchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.geoWatchId);
      this.geoWatchId = null;
    }
    this.stopCamera();
    this.dismissPopup();

    try {
      localStorage.removeItem(TERMINAL_AUTH_KEY);
    } catch { }

    this.activeToken = undefined;
    this.activeCompanyCode = undefined;
    this.enrolledFaces = [];
    this.facesLoaded.set(false);
    this.hasFaceDetected.set(false);
    this.faceStatus.set('idle');
    this.faceMatchScore.set(null);
    this.matchedFace.set(null);
    this.currentLat = null;
    this.currentLon = null;
    this.isCamLoading.set(true);
    this.cameraError.set(null);
    this.authError.set(errorMsg ?? null);
    this.isUnlocked.set(false);
  }

  private loadEnrolledFaces(): void {
    this.api.enrolledFaces(this.activeToken, this.activeCompanyCode).subscribe({
      next: (faces) => {
        this.enrolledFaces = faces || [];
        this.facesLoaded.set(true);
      },
      error: (err) => {
        if (err?.status === 401 || err?.status === 403) {
          this.lockTerminal('HR terminal session expired. Please sign in again.');
          return;
        }
        this.enrolledFaces = [];
        this.facesLoaded.set(true);
      },
    });
  }

  protected retryCamera(): void {
    this.cameraError.set(null);
    void this.startCamera();
  }

  private async startCamera(): Promise<void> {
    if (!this.isUnlocked()) return;
    try {
      this.isCamLoading.set(true);
      this.cameraError.set(null);
      await this.faceService.loadModels();

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera API unavailable.');
      }

      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: isMobile ? 480 : 640 },
          height: { ideal: isMobile ? 360 : 480 },
          frameRate: { ideal: 30, max: 30 },
          facingMode: 'user',
        },
      });
      this.videoStream = stream;
      const v = this.faceVideoRef?.nativeElement;
      if (v) {
        v.srcObject = stream;
        v.onloadedmetadata = () => {
          void v.play();
          this.isCamLoading.set(false);
          this.startScanLoop();
        };
      }
    } catch {
      this.isCamLoading.set(false);
      this.cameraError.set('Camera access was blocked or is unavailable. Please allow camera permission and click Retry.');
    }
  }

  private startScanLoop(): void {
    if (this.scanInterval) clearInterval(this.scanInterval);
    this.scanInterval = setInterval(async () => {
      if (!this.isUnlocked() || this.isDetectingFrame || this.isSubmitting() || this.showPopup()) return;

      const v = this.faceVideoRef?.nativeElement;
      const c = this.faceCanvasRef?.nativeElement;
      if (!v || !c || v.paused || v.ended || this.isCamLoading()) return;

      this.isDetectingFrame = true;
      try {
        const scan: FaceScanResult = await this.faceService.detectFace(v, c, false);
        this.hasFaceDetected.set(scan.hasFace);

        if (scan.hasFace && scan.descriptor) {
          this.identifyFace(scan.descriptor, v, c);
        } else {
          this.faceStatus.set('idle');
          this.faceMatchScore.set(null);
          this.matchedFace.set(null);
          this.consecutiveVerifiedFrames = 0;
          this.lastVerifiedEmployeeId = null;
        }
      } catch {
        // Ignore single frame detection error
      } finally {
        this.isDetectingFrame = false;
      }
    }, 700);
  }

  private identifyFace(liveDescriptor: number[], video: HTMLVideoElement, canvas: HTMLCanvasElement): void {
    if (this.enrolledFaces.length === 0) {
      this.faceStatus.set('mismatched');
      this.faceMatchScore.set(0);
      this.matchedFace.set(null);
      return;
    }

    let bestMatch: EnrolledFace | null = null;
    let bestScore = -1;
    let bestDist = 999;

    for (const emp of this.enrolledFaces) {
      if (!emp.faceDescriptor) continue;
      try {
        const refArr = JSON.parse(emp.faceDescriptor) as number[];
        if (!Array.isArray(refArr) || refArr.length === 0) continue;
        const evalRes = this.faceService.compareFaces(liveDescriptor, refArr, 70);
        if (evalRes.matchScore > bestScore) {
          bestScore = evalRes.matchScore;
          bestDist = evalRes.distance;
          bestMatch = emp;
        }
      } catch {
        // Skip invalid descriptor
      }
    }

    const score = bestScore >= 0 ? bestScore : 0;
    this.faceMatchScore.set(score);

    if (bestMatch && score >= 70 && bestDist <= 0.58) {
      this.faceStatus.set('verified');
      this.matchedFace.set(bestMatch);

      if (this.lastVerifiedEmployeeId !== bestMatch.employeeId) {
        this.lastVerifiedEmployeeId = bestMatch.employeeId;
        this.consecutiveVerifiedFrames = 1;
      } else {
        this.consecutiveVerifiedFrames++;
      }

      const lastPunchMs = this.cooldownMap.get(bestMatch.employeeId) ?? 0;
      const inCooldown = Date.now() - lastPunchMs < 20000;

      if (!inCooldown && this.consecutiveVerifiedFrames >= 2) {
        const snapshot = this.faceService.captureSnapshot(video, canvas) || undefined;
        void this.submitFacePunch(bestMatch, score, snapshot);
      }
    } else {
      this.faceStatus.set('mismatched');
      this.matchedFace.set(null);
      this.consecutiveVerifiedFrames = 0;
      this.lastVerifiedEmployeeId = null;
    }
  }

  private async submitFacePunch(emp: EnrolledFace, matchScore: number, snapshotBase64?: string): Promise<void> {
    this.isSubmitting.set(true);
    this.consecutiveVerifiedFrames = 0;
    const coords = await this.getCurrentCoords();

    this.api
      .facePunch(
        {
          employeeId: emp.employeeId,
          employeeCode: emp.employeeCode,
          punchType: null,
          confidence: Math.min(1, Math.max(0, matchScore / 100)),
          device: 'QR Attendance Terminal',
          snapshotBase64,
          latitude: coords.lat,
          longitude: coords.lon,
        },
        this.activeToken,
        this.activeCompanyCode,
      )
      .subscribe({
        next: (res: FacePunchResult) => {
          this.isSubmitting.set(false);
          if (res.success) {
            this.cooldownMap.set(emp.employeeId, Date.now());
          }
          this.showResultPopup({
            success: res.success,
            employeeName: res.employeeName || emp.fullName,
            employeeCode: res.employeeCode || emp.employeeCode,
            punchType: res.punchType || 'ClockIn',
            punchTime: safeParseDate(res.punchTime),
            message: res.message || (res.success ? 'Attendance recorded.' : 'Punch failed.'),
            matchScore,
          });
        },
        error: (err) => {
          this.isSubmitting.set(false);
          if (err?.status === 401 || err?.status === 403) {
            this.lockTerminal('HR terminal session expired. Please sign in again.');
            return;
          }
          const msg = err?.error?.message || err?.error?.title || err?.message || 'Unable to record attendance.';
          this.showResultPopup({
            success: false,
            employeeName: emp.fullName,
            employeeCode: emp.employeeCode,
            punchType: 'ClockIn',
            punchTime: new Date(),
            message: msg,
            matchScore,
          });
        },
      });
  }

  private showResultPopup(data: PunchPopupData): void {
    this.popupData.set(data);
    this.popupCountdown.set(this.POPUP_TOTAL);
    this.showPopup.set(true);

    if (this.popupTimer) clearInterval(this.popupTimer);
    this.popupTimer = setInterval(() => {
      const rem = this.popupCountdown() - 1;
      this.popupCountdown.set(rem);
      if (rem <= 0) {
        this.dismissPopup();
        window.location.reload();
      }
    }, 1000);
  }

  protected dismissPopup(): void {
    if (this.popupTimer) {
      clearInterval(this.popupTimer);
      this.popupTimer = null;
    }
    this.showPopup.set(false);
    this.popupData.set(null);
    this.consecutiveVerifiedFrames = 0;
  }

  private stopCamera(): void {
    this.videoStream?.getTracks().forEach((t) => t.stop());
    this.videoStream = null;
  }

  protected getInitials(name: string): string {
    if (!name) return 'EM';
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
  }
}
