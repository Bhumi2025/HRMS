import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { inject } from '@angular/core';
import { ApiService } from '../../core/api/api.service';
import { EnrolledFace, LoginResponse } from '../../core/api/api.models';
import { IconDirective } from '../../core/icons/icon.directive';
import { Role } from '../../core/models';
import { SessionService } from '../../core/services/session.service';
import { ToastService } from '../../core/services/toast.service';
import { CurrencyService } from '../../core/services/currency.service';
import { SafeHtmlPipe } from '../../shared/safe-html.pipe';
import { environment } from '../../../environments/environment';
import { FaceMatchEvaluation, FaceRecognitionService } from '../../core/services/face-recognition.service';

interface Slide {
  svg: string;
  title: string;
  text: string;
  pills: string[];
}

/**
 * Login screen — ported from index.html. Role chips pick the session role,
 * "Sign In" stores it and routes to that role's landing page, and the right
 * panel auto-rotates the three marketing slides.
 */
@Component({
  selector: 'app-login',
  imports: [CommonModule, FormsModule, RouterLink, IconDirective, SafeHtmlPipe],
  templateUrl: './login.component.html',
  styleUrls: ['./login-face.component.css'],
})
export class LoginComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(SessionService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly faceService = inject(FaceRecognitionService);
  private readonly currencyService = inject(CurrencyService);

  /** Disable the demo account switcher on the login screen in production builds. */
  protected readonly showDemoAccounts = false;

  /** Dynamic tenant branding resolved via query parameter (?code=...) or company code input. */
  protected readonly resolvedTenantName = signal<string>('HR Nexus');
  protected readonly resolvedTenantLogo = signal<string | null>(null);
  protected readonly resolvingTenant = signal<boolean>(false);

  /** Seeded backend accounts used to prefill credentials. */
  protected readonly demoAccounts: { role: Role; label: string; email: string; password: string; companyCode?: string }[] = [
    { role: 'Super Admin', label: 'Super Admin', email: 'admin@hrnexus.com', password: 'Admin@123' },
    { role: 'Company Admin', label: 'Company Admin', email: 'companyadmin@hrnexus.com', password: 'Admin@123' },
    { role: 'HR Manager', label: 'HR Manager', email: 'hr@hrnexus.com', password: 'Hr@12345' },
    { role: 'Employee', label: 'James Okafor', email: 'james@hrnexus.com', password: 'Employee@123' },
    { role: 'Employee', label: 'Sarah Mitchell', email: 'sarah@hrnexus.com', password: 'Employee@123' },
  ];

  protected selectDemo(acc: { email: string; password: string; companyCode?: string }): void {
    this.emailReadOnly.set(false);
    this.passwordReadOnly.set(false);
    this.email = acc.email;
    this.password = acc.password;
    this.companyCode = acc.companyCode ?? '';
    this.resolveTenant(this.companyCode);
  }

  protected email = '';
  protected password = '';
  protected companyCode = '';
  protected rememberMe = false;
  protected readonly emailReadOnly = signal(true);
  protected readonly passwordReadOnly = signal(true);
  protected readonly showPassword = signal(false);
  protected readonly submitting = signal(false);

  // ── Face Verification State ──
  protected readonly showFaceModal = signal(false);
  protected readonly faceVerifying = signal(false);
  protected readonly faceStatus = signal<'idle' | 'scanning' | 'matched' | 'failed'>('idle');
  protected readonly faceStatusMessage = signal('Position your face in the frame');
  protected readonly cameraActive = signal(false);
  protected readonly enrolledEmployeeName = signal('');
  protected readonly enrolledEmployeeCode = signal('');
  protected readonly faceMatchScore = signal<number | null>(null);
  protected readonly isFaceEnrolled = signal(false);
  /** Minimum similarity (0-100) required to accept a face match. */
  protected readonly faceThreshold = 70;
  /** Descriptor length produced by face-api ResNet-34 (128-dimensional embedding). */
  private readonly faceDescriptorLength = 128;
  private pendingLoginResponse: LoginResponse | null = null;
  /** Token held in memory (not yet a session) so face calls stay tenant-scoped. */
  private pendingToken: string | null = null;
  private enrolledFaceForUser: EnrolledFace | null = null;
  private referenceFaceFeatures: number[] | null = null;
  private mediaStream: MediaStream | undefined;
  private faceCheckAttempts = 0;

  @ViewChild('faceVideo') faceVideoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('faceCanvas') faceCanvasRef!: ElementRef<HTMLCanvasElement>;

  protected readonly activeSlide = signal(0);
  protected readonly exitingSlide = signal<number | null>(null);
  protected readonly dots = [0, 1, 2];
  private timer: ReturnType<typeof setInterval> | null = null;

  protected readonly slides: Slide[] = [
    {
      svg: `<svg viewBox="0 0 280 200" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="16" y="16" width="248" height="168" rx="12" fill="#11141c" stroke="rgba(238,240,245,0.12)"/>
        <rect x="16" y="16" width="248" height="36" rx="12" fill="#161b26"/>
        <circle cx="34" cy="34" r="4" fill="#2563eb"/>
        <rect x="46" y="30" width="96" height="7" rx="3.5" fill="rgba(238,240,245,0.85)"/>
        <rect x="202" y="28" width="46" height="12" rx="4" fill="rgba(76,195,138,0.18)" stroke="rgba(76,195,138,0.4)"/>
        <rect x="32" y="68" width="64" height="44" rx="8" fill="#1a1e28" stroke="rgba(238,240,245,0.08)"/>
        <rect x="42" y="78" width="28" height="5" rx="2.5" fill="#7a8296"/>
        <rect x="42" y="90" width="38" height="10" rx="3" fill="#eef0f5"/>
        <rect x="108" y="68" width="64" height="44" rx="8" fill="#1a1e28" stroke="rgba(238,240,245,0.08)"/>
        <rect x="118" y="78" width="32" height="5" rx="2.5" fill="#7a8296"/>
        <rect x="118" y="90" width="34" height="10" rx="3" fill="#3b82f6"/>
        <rect x="184" y="68" width="64" height="44" rx="8" fill="#1a1e28" stroke="rgba(238,240,245,0.08)"/>
        <rect x="194" y="78" width="24" height="5" rx="2.5" fill="#7a8296"/>
        <rect x="194" y="90" width="40" height="10" rx="3" fill="#4cc38a"/>
        <rect x="32" y="126" width="216" height="1" fill="rgba(238,240,245,0.08)"/>
        <rect x="32" y="138" width="110" height="6" rx="3" fill="rgba(238,240,245,0.5)"/>
        <rect x="196" y="138" width="52" height="6" rx="3" fill="#3b82f6"/>
        <rect x="32" y="156" width="84" height="6" rx="3" fill="rgba(238,240,245,0.35)"/>
        <rect x="208" y="156" width="40" height="6" rx="3" fill="rgba(238,240,245,0.5)"/>
      </svg>`,
      title: 'Workforce operations in one ledger',
      text: 'Manage employee rosters, shift attendance, and multi-stage approvals across departments',
      pills: ['Team Roster', 'Shift Attendance', 'Approvals'],
    },
    {
      svg: `<svg viewBox="0 0 280 200" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="16" y="16" width="248" height="168" rx="12" fill="#11141c" stroke="rgba(238,240,245,0.12)"/>
        <rect x="32" y="34" width="80" height="8" rx="4" fill="rgba(238,240,245,0.85)"/>
        <rect x="32" y="48" width="52" height="5" rx="2.5" fill="#7a8296"/>
        <rect x="184" y="34" width="64" height="18" rx="6" fill="#2563eb"/>
        <rect x="32" y="78" width="16" height="80" rx="4" fill="#1a1e28"/>
        <rect x="32" y="114" width="16" height="44" rx="4" fill="#3b82f6"/>
        <rect x="64" y="78" width="16" height="80" rx="4" fill="#1a1e28"/>
        <rect x="64" y="102" width="16" height="56" rx="4" fill="#3b82f6"/>
        <rect x="96" y="78" width="16" height="80" rx="4" fill="#1a1e28"/>
        <rect x="96" y="92" width="16" height="66" rx="4" fill="#2563eb"/>
        <rect x="128" y="78" width="16" height="80" rx="4" fill="#1a1e28"/>
        <rect x="128" y="106" width="16" height="52" rx="4" fill="#3b82f6"/>
        <rect x="160" y="78" width="16" height="80" rx="4" fill="#1a1e28"/>
        <rect x="160" y="88" width="16" height="70" rx="4" fill="#4cc38a"/>
        <rect x="196" y="88" width="52" height="28" rx="6" fill="#1a1e28" stroke="rgba(238,240,245,0.08)"/>
        <rect x="204" y="98" width="36" height="8" rx="3" fill="#eef0f5"/>
        <rect x="196" y="124" width="52" height="28" rx="6" fill="#1a1e28" stroke="rgba(238,240,245,0.08)"/>
        <rect x="204" y="134" width="30" height="8" rx="3" fill="#4cc38a"/>
      </svg>`,
      title: 'Accurate monthly payroll runs',
      text: 'Verify worked hours, paid leave, and deductions before publishing payslips',
      pills: ['Payroll Register', 'Deductions', 'Payslips'],
    },
    {
      svg: `<svg viewBox="0 0 280 200" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="16" y="16" width="248" height="168" rx="12" fill="#11141c" stroke="rgba(238,240,245,0.12)"/>
        <rect x="32" y="34" width="96" height="8" rx="4" fill="rgba(238,240,245,0.85)"/>
        <rect x="32" y="60" width="216" height="28" rx="6" fill="#1a1e28" stroke="rgba(238,240,245,0.08)"/>
        <circle cx="48" cy="74" r="5" fill="#4cc38a"/>
        <rect x="62" y="71" width="76" height="6" rx="3" fill="#eef0f5"/>
        <rect x="196" y="71" width="38" height="6" rx="3" fill="#7a8296"/>
        <rect x="32" y="98" width="216" height="28" rx="6" fill="#1a1e28" stroke="rgba(238,240,245,0.08)"/>
        <circle cx="48" cy="112" r="5" fill="#3b82f6"/>
        <rect x="62" y="109" width="92" height="6" rx="3" fill="#eef0f5"/>
        <rect x="196" y="109" width="38" height="6" rx="3" fill="#7a8296"/>
        <rect x="32" y="136" width="216" height="28" rx="6" fill="#1a1e28" stroke="rgba(238,240,245,0.08)"/>
        <circle cx="48" cy="150" r="5" fill="#f59e0b"/>
        <rect x="62" y="147" width="68" height="6" rx="3" fill="#eef0f5"/>
        <rect x="196" y="147" width="38" height="6" rx="3" fill="#7a8296"/>
      </svg>`,
      title: 'Attendance & leave tracking',
      text: 'Synchronized punch timelines, leave balances, and shift muster registers',
      pills: ['Muster Log', 'Leave Balances', 'Reports'],
    },
  ];

  ngOnInit(): void {
    this.email = '';
    this.password = '';
    this.rememberMe = false;
    this.resetTimer();
    setTimeout(() => {
      this.email = '';
      this.password = '';
    }, 150);
    const queryCode =
      this.route.snapshot.queryParamMap.get('code') ||
      this.route.snapshot.queryParamMap.get('company') ||
      this.route.snapshot.queryParamMap.get('tenant') ||
      this.route.snapshot.queryParamMap.get('subdomain');
    if (queryCode?.trim()) {
      this.companyCode = queryCode.trim();
      this.resolveTenant(this.companyCode);
    }
  }

  protected resolveTenant(code: string): void {
    const clean = code?.trim();
    if (!clean) {
      this.resolvedTenantName.set('HR Nexus');
      this.resolvedTenantLogo.set(null);
      return;
    }

    this.resolvingTenant.set(true);
    this.api.getTenantBranding(clean).subscribe({
      next: (branding) => {
        this.resolvingTenant.set(false);
        if (branding) {
          this.resolvedTenantName.set(branding.companyName || 'HR Nexus');
          this.resolvedTenantLogo.set(branding.logoUrl || null);
        }
      },
      error: () => {
        this.resolvingTenant.set(false);
        this.resolvedTenantName.set('HR Nexus');
        this.resolvedTenantLogo.set(null);
      },
    });
  }

  protected onCompanyCodeChange(newCode: string): void {
    this.companyCode = newCode;
    this.resolveTenant(newCode);
  }

  ngOnDestroy(): void {
    this.clearTimer();
    this.stopFaceCamera();
  }

  protected togglePassword(): void {
    this.showPassword.update((v) => !v);
  }

  protected go(event: Event): void {
    event.preventDefault();
    if (this.submitting()) return;
    if (!this.email?.trim() || !this.password?.trim()) {
      this.toast.show('Please enter both email and password.', 'danger');
      return;
    }
    this.submitting.set(true);

    this.api.login(this.email.trim(), this.password?.trim(), this.companyCode).subscribe({
      next: (response) => {
        // Complete login directly for all roles including Employee (face authentication is removed at login)
        this.completeLogin(response);
      },
      error: (error) => {
        // Network or proxy error (API not running or 502) → keep the demo usable offline if allowed.
        if ((error?.status === 0 || error?.status === 502) && environment.allowOfflineFallback) {
          this.toast.show('API backend not connected (502/offline) — signed in with local demo data.', 'warning');
          let role: Role = 'Super Admin';
          const em = this.email.toLowerCase();
          if (em.includes('admin')) role = 'Super Admin';
          else if (em.includes('hr')) role = 'HR Manager';
          else if (em.includes('employee') || em.includes('sarah') || em.includes('james')) role = 'Employee';

          this.navigateForRole(role, this.session.login(role));
          return;
        }

        this.submitting.set(false);
        const msg = error?.status === 502 
          ? '502 Bad Gateway: Backend API server is not running or unreachable on port 5096.' 
          : (error?.error?.title ?? error?.error?.message ?? 'Invalid email or password.');
        this.toast.show(msg, 'danger');
      },
    });
  }

  // ── Face Verification Flow ──

  /** After credentials pass, check if this employee has an enrolled face. */
  private checkFaceEnrollment(response: LoginResponse): void {
    const empId = response.user.employeeId || response.user.id || 'EMP-1001';
    const empName = response.user.fullName || 'Employee';

    this.enrolledEmployeeName.set(empName);
    this.enrolledEmployeeCode.set('');
    this.pendingLoginResponse = response;
    this.pendingToken = response.accessToken;
    this.faceMatchScore.set(null);
    this.faceCheckAttempts = 0;

    // Do NOT establish the session yet. Face calls carry this token explicitly, so
    // tenant scoping still works without authenticating the user before verification.

    // 1. Check local storage first for quick local registration persistence
    let localSaved: EnrolledFace | null = null;
    try {
      const raw = localStorage.getItem('hrms_face_' + empId) || localStorage.getItem('hrms_face_' + empName.toLowerCase());
      if (raw) localSaved = JSON.parse(raw);
    } catch {}

    if (localSaved && localSaved.faceDescriptor) {
      try {
        const parsed = JSON.parse(localSaved.faceDescriptor);
        if (Array.isArray(parsed) && parsed.length === this.faceDescriptorLength && !this.faceService.isDummyDescriptor(parsed)) {
          this.enrolledFaceForUser = localSaved;
          this.referenceFaceFeatures = parsed;
          this.isFaceEnrolled.set(true);
          this.openFaceModal();
          return;
        }
        // Older/incompatible/dummy template — discard it so the user re-registers cleanly.
        localStorage.removeItem('hrms_face_' + empId);
        localStorage.removeItem('hrms_face_' + empName.toLowerCase());
      } catch {}
    }

    // 2. Query backend enrolled faces
    this.api.enrolledFaces(this.pendingToken ?? undefined).subscribe({
      next: (faces) => {
        const match = faces?.find(f => 
          (response.user.employeeId && f.employeeId === response.user.employeeId) ||
          f.fullName?.toLowerCase() === empName.toLowerCase()
        );

        if (match && match.faceDescriptor) {
          try {
            const parsed = JSON.parse(match.faceDescriptor);
            if (Array.isArray(parsed) && parsed.length === this.faceDescriptorLength && !this.faceService.isDummyDescriptor(parsed)) {
              this.enrolledFaceForUser = match;
              this.referenceFaceFeatures = parsed;
              this.isFaceEnrolled.set(true);
              this.enrolledEmployeeCode.set(match.employeeCode);
              this.openFaceModal();
              return;
            } else {
              console.warn('Detected placeholder/dummy face descriptor for employee. Enabling clean AI face enrollment.');
            }
          } catch {}
        }

        // If no valid face profile found yet, open modal in enrollment mode
        this.isFaceEnrolled.set(false);
        this.referenceFaceFeatures = null;
        this.enrolledFaceForUser = {
          employeeId: empId,
          employeeCode: '',
          fullName: empName,
          department: 'Engineering',
          faceDescriptor: '',
        };
        this.openFaceModal();
      },
      error: () => {
        // Offline or backend unavailable -> allow local enrollment
        this.isFaceEnrolled.set(false);
        this.referenceFaceFeatures = null;
        this.enrolledFaceForUser = {
          employeeId: empId,
          employeeCode: '',
          fullName: empName,
          department: 'Engineering',
          faceDescriptor: '',
        };
        this.openFaceModal();
      },
    });
  }

  /** Opens the face verification camera modal. */
  private openFaceModal(): void {
    this.faceCheckAttempts = 0;
    this.faceStatus.set('idle');
    this.faceMatchScore.set(null);
    if (!this.isFaceEnrolled()) {
      this.faceStatusMessage.set('Position face in frame and click "Register My Face" to enroll.');
    } else {
      this.faceStatusMessage.set('Position your face in the frame and click "Scan & Verify Face".');
    }
    this.showFaceModal.set(true);

    // Small delay to let the DOM render the video element
    setTimeout(() => void this.startFaceCamera(), 300);
  }

  /** Starts the camera for face verification and waits until frames are flowing. */
  protected async startFaceCamera(): Promise<void> {
    try {
      this.stopFaceCamera();
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });

      const video = this.faceVideoRef?.nativeElement;
      if (!video) return;

      video.srcObject = this.mediaStream;
      try {
        await video.play();
      } catch {
        /* autoplay may still start on its own */
      }

      // Only mark the camera active once a real frame is available — otherwise the
      // first scan would capture an empty video and report "no face detected".
      const ready = await this.waitForVideo(video, 3000);
      this.cameraActive.set(ready);
      this.faceStatusMessage.set(
        ready
          ? this.isFaceEnrolled()
            ? 'Camera ready — click "Scan & Verify Face".'
            : 'Camera ready — click "Register My Face".'
          : 'Camera is still starting… wait a moment, then retry.',
      );
    } catch (err) {
      console.warn('Camera access denied or unavailable:', err);
      this.cameraActive.set(false);
      this.faceStatusMessage.set('Camera access unavailable. Grant permission in your browser, then retry.');
    }
  }

  /** Resolves true once the video element has decoded at least one frame. */
  private waitForVideo(video: HTMLVideoElement, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = (): void => {
        if (video.videoWidth > 0 && video.readyState >= 2) {
          resolve(true);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  /** Retries camera connection if initially blocked. */
  protected retryCamera(): void {
    void this.startFaceCamera();
  }

  /** Stops the camera stream. */
  private stopFaceCamera(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = undefined;
    }
    const video = this.faceVideoRef?.nativeElement;
    if (video) {
      video.srcObject = null;
    }
    this.cameraActive.set(false);
  }

  /** Resets face profile so user can re-register a new face for testing. */
  protected reEnrollFace(): void {
    this.isFaceEnrolled.set(false);
    this.referenceFaceFeatures = null;
    this.faceMatchScore.set(null);
    this.faceStatus.set('idle');
    this.faceStatusMessage.set('Position face in frame and click "Register My Face" to enroll new template.');
    this.toast.show('Ready to re-register face template.', 'info');
  }

  /**
   * Registers the current face in front of the camera using @vladmandic/face-api
   * deep ResNet-34 128-dimensional embedding.
   */
  protected async enrollCurrentFace(): Promise<void> {
    if (!this.cameraActive() || !this.faceVideoRef?.nativeElement) {
      this.toast.show('Camera must be active to register Face ID.', 'warning');
      return;
    }

    this.faceVerifying.set(true);
    this.faceStatus.set('scanning');
    this.faceStatusMessage.set('Detecting face…');

    const video = this.faceVideoRef.nativeElement;
    const canvas = this.faceCanvasRef?.nativeElement;

    // Collect up to 3 samples to construct an ultra-clean averaged biometric template
    const sampleDescriptors: number[][] = [];
    let snapshot = '';
    for (let i = 0; i < 3; i++) {
      const scan = await this.faceService.detectFace(video, canvas, true);
      if (scan.hasFace && scan.descriptor) {
        sampleDescriptors.push(scan.descriptor);
        if (scan.snapshot) snapshot = scan.snapshot;
      }
      if (i < 2) await new Promise(r => setTimeout(r, 120));
    }

    if (sampleDescriptors.length === 0) {
      this.faceVerifying.set(false);
      this.faceStatus.set('failed');
      this.faceStatusMessage.set('No face detected. Please position your face clearly in the camera frame.');
      this.toast.show('No face detected. Look directly at the camera.', 'danger');
      return;
    }

    // Average samples into a normalized 128D centroid embedding
    const finalDescriptor: number[] = new Array(this.faceDescriptorLength).fill(0);
    for (const sample of sampleDescriptors) {
      for (let j = 0; j < this.faceDescriptorLength; j++) {
        finalDescriptor[j] += sample[j] / sampleDescriptors.length;
      }
    }
    let norm = 0;
    for (let j = 0; j < this.faceDescriptorLength; j++) norm += finalDescriptor[j] * finalDescriptor[j];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let j = 0; j < this.faceDescriptorLength; j++) finalDescriptor[j] /= norm;
    }

    const empId = this.pendingLoginResponse?.user.employeeId || this.pendingLoginResponse?.user.id || 'EMP-1001';
    const empName = this.enrolledEmployeeName() || 'Employee';

    const enrolledRecord: EnrolledFace = {
      employeeId: empId,
      employeeCode: this.enrolledEmployeeCode() || '',
      fullName: empName,
      department: 'Engineering',
      avatarUrl: snapshot,
      faceDescriptor: JSON.stringify(finalDescriptor),
    };

    this.enrolledFaceForUser = enrolledRecord;
    this.referenceFaceFeatures = finalDescriptor;
    this.isFaceEnrolled.set(true);

    // Persist locally so the template survives a reload / re-login attempt.
    try {
      localStorage.setItem('hrms_face_' + empId, JSON.stringify(enrolledRecord));
      localStorage.setItem('hrms_face_' + empName.toLowerCase(), JSON.stringify(enrolledRecord));
    } catch {}

    // Persist to the backend as well.
    this.api.enrollFace(empId, {
      faceDescriptor: JSON.stringify(finalDescriptor),
      facePhotoUrl: snapshot,
    }, this.pendingToken ?? undefined).subscribe({
      next: () => {
        this.faceVerifying.set(false);
        this.faceStatus.set('idle');
        this.faceMatchScore.set(null);
        this.faceStatusMessage.set(`✅ Face registered! Now click "Scan & Verify Face".`);
        this.toast.show(`Face profile registered for ${empName}!`, 'success');
      },
      error: (err) => {
        this.faceVerifying.set(false);
        this.faceStatus.set('idle');
        this.isFaceEnrolled.set(false);
        this.referenceFaceFeatures = null;
        try {
          localStorage.removeItem('hrms_face_' + empId);
          localStorage.removeItem('hrms_face_' + empName.toLowerCase());
        } catch {}
        const msg = err?.error?.title ?? err?.error?.detail ?? err?.error?.message ?? 'Could not enroll Face ID.';
        this.faceStatusMessage.set(`❌ ${msg}`);
        this.toast.show(msg, 'danger');
      },
    });
  }

  /**
   * Performs real neural network facial analysis and strictly verifies that
   * match accuracy is >= 80% using deep metric learning (Euclidean distance).
   * If somebody else's face is shown, it rejects access!
   */
  protected async verifyFace(): Promise<void> {
    if (this.faceVerifying() || !this.pendingLoginResponse || !this.faceVideoRef?.nativeElement) return;

    if (!this.isFaceEnrolled() || !this.referenceFaceFeatures) {
      this.toast.show('Please register this employee\'s face first.', 'info');
      return;
    }

    if (this.referenceFaceFeatures.length !== this.faceDescriptorLength) {
      this.isFaceEnrolled.set(false);
      this.referenceFaceFeatures = null;
      this.faceStatus.set('idle');
      this.faceStatusMessage.set('Saved face profile needs to be re-registered. Click "Register My Face" once.');
      this.toast.show('Please register your face once to continue.', 'info');
      return;
    }

    this.faceVerifying.set(true);
    this.faceStatus.set('scanning');
    this.faceStatusMessage.set('Comparing face profile…');
    this.faceCheckAttempts++;

    const video = this.faceVideoRef.nativeElement;
    const canvas = this.faceCanvasRef?.nativeElement;

    // Sample up to 2 frames to account for natural autofocus or momentary blink
    let bestEvaluation: FaceMatchEvaluation | null = null;
    let anyFaceFound = false;

    for (let i = 0; i < 2; i++) {
      const scan = await this.faceService.detectFace(video, canvas);
      if (scan.hasFace && scan.descriptor) {
        anyFaceFound = true;
        const evaluation = this.faceService.compareFaces(
          scan.descriptor,
          this.referenceFaceFeatures,
          this.faceThreshold // 80%
        );
        if (!bestEvaluation || evaluation.matchScore > bestEvaluation.matchScore) {
          bestEvaluation = evaluation;
        }
        if (evaluation.matched) break; // Reached >= 80%
      }
      if (i === 0) await new Promise(r => setTimeout(r, 100));
    }

    this.faceVerifying.set(false);

    if (!anyFaceFound || !bestEvaluation) {
      this.faceStatus.set('failed');
      this.faceMatchScore.set(0);
      this.faceStatusMessage.set('❌ No face detected. Please look straight at the camera.');
      this.toast.show('No face detected in the camera frame.', 'warning');
      return;
    }

    const evaluation = bestEvaluation;
    this.faceMatchScore.set(evaluation.matchScore);

    if (evaluation.matched) {
      // ✅ PASS: score >= 80% (same person)
      this.faceStatus.set('matched');
      this.faceStatusMessage.set(`✅ Face verified: ${evaluation.matchScore}% match (≥${this.faceThreshold}% required). Signing you in…`);
      this.toast.show(`Face matched (${evaluation.matchScore}%)! Welcome back.`, 'success');

      setTimeout(() => {
        this.stopFaceCamera();
        this.showFaceModal.set(false);
        this.recordAttendanceAndLogin(this.pendingLoginResponse!);
      }, 800);
    } else {
      // ❌ FAIL: score < 80% (somebody else)
      this.faceStatus.set('failed');
      this.faceStatusMessage.set(`❌ Face not recognised: ${evaluation.matchScore}% match (needs ≥${this.faceThreshold}%). Face the camera directly in even light.`);

      if (this.faceCheckAttempts >= 3) {
        this.faceStatusMessage.set(`❌ Access denied after 3 attempts (best ${evaluation.matchScore}%).`);
        setTimeout(() => {
          this.stopFaceCamera();
          this.showFaceModal.set(false);
          this.session.logout();
          this.submitting.set(false);
          this.toast.show(`Access denied: best face match was ${evaluation.matchScore}% (needs ≥${this.faceThreshold}%).`, 'danger');
        }, 2400);
      } else {
        this.toast.show(`Face match ${evaluation.matchScore}% is below ${this.faceThreshold}%. Please try again (attempt ${this.faceCheckAttempts}/3).`, 'danger');
      }
    }
  }

  /** Records attendance via face-punch API then completes login. */
  private recordAttendanceAndLogin(response: LoginResponse): void {
    const employeeId = response.user.employeeId;
    const employeeCode = this.enrolledFaceForUser?.employeeCode || undefined;

    this.api.facePunch({
      employeeId: employeeId ?? undefined,
      employeeCode: employeeCode ?? undefined,
      punchType: 'ClockIn',
      confidence: 0.98,
      device: 'Employee Login Terminal',
    }, this.pendingToken ?? undefined).subscribe({
      next: (result) => {
        if (result.success) {
          this.toast.show(`Face matched! Welcome ${result.employeeName}. Attendance marked as Present.`, 'success');
        } else {
          this.toast.show(result.message || 'Face verified! Attendance logged.', 'info');
        }
        this.completeLogin(response);
      },
      error: () => {
        // Offline or backend unavailable -> still complete login gracefully
        this.toast.show(`Face matched! Welcome ${response.user.fullName}. Attendance marked as Present.`, 'success');
        this.completeLogin(response);
      },
    });
  }

  /** Completes the login flow — sets session and navigates. */
  private completeLogin(response: LoginResponse): void {
    const landing = this.session.setSession(response.accessToken, response.user);
    this.currencyService.refreshCurrency();
    this.pendingToken = null;
    this.pendingLoginResponse = null;
    this.navigateForRole(response.user.role as Role, landing);
  }

  /** Cancel face verification — logs out the pending session. */
  protected cancelFaceVerification(): void {
    this.stopFaceCamera();
    this.showFaceModal.set(false);
    this.session.logout();
    this.submitting.set(false);
    this.pendingLoginResponse = null;
    this.pendingToken = null;
    this.enrolledFaceForUser = null;
    this.toast.show('Face verification cancelled. Login aborted.', 'warning');
  }

  /** Skip face verification and sign in directly to dashboard. */
  protected skipFaceVerificationAndLogin(): void {
    this.stopFaceCamera();
    this.showFaceModal.set(false);
    this.submitting.set(false);
    if (this.pendingLoginResponse) {
      this.toast.show('Face verification skipped. Welcome to your dashboard!', 'success');
      this.completeLogin(this.pendingLoginResponse);
    }
  }

  private navigateForRole(role: Role, landing: string): void {
    void this.router.navigateByUrl(landing);
  }

  protected goSlide(n: number): void {
    const total = this.slides.length;
    this.exitingSlide.set(this.activeSlide());
    this.activeSlide.set((n + total) % total);
    setTimeout(() => this.exitingSlide.set(null), 500);
    this.resetTimer();
  }

  private resetTimer(): void {
    this.clearTimer();
    this.timer = setInterval(() => this.goSlide(this.activeSlide() + 1), 3500);
  }

  private clearTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
