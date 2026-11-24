import sys
import os
import pypdf
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
)
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super(NumberedCanvas, self).__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super(NumberedCanvas, self).showPage()
        super(NumberedCanvas, self).save()

    def draw_page_decorations(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#64748b"))
        
        # Header (pages > 1)
        if self._pageNumber > 1:
            self.drawString(54, 755, "HRMS Enterprise — Technical Architecture & Deployment Specification")
            self.drawRightString(558, 755, "Confidential & Proprietary")
            self.setStrokeColor(colors.HexColor("#e2e8f0"))
            self.setLineWidth(0.5)
            self.line(54, 747, 558, 747)

        # Footer (all pages)
        self.setStrokeColor(colors.HexColor("#e2e8f0"))
        self.setLineWidth(0.5)
        self.line(54, 45, 558, 45)
        self.drawString(54, 32, "HRMS Deployment Specification | Claude Code & DevOps Handover")
        page_text = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(558, 32, page_text)
        self.restoreState()

def build_pdf(filename):
    doc = SimpleDocTemplate(
        filename,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )

    styles = getSampleStyleSheet()

    # Custom styles
    c_primary = colors.HexColor("#1e3a8a")     # Deep blue
    c_accent = colors.HexColor("#2563eb")      # Bright blue
    c_dark = colors.HexColor("#0f172a")        # Near black
    c_text = colors.HexColor("#334155")        # Slate text
    c_muted = colors.HexColor("#64748b")       # Muted grey
    c_code_bg = colors.HexColor("#f1f5f9")     # Light code bg
    c_card_bg = colors.HexColor("#f8fafc")     # Light card bg

    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=22,
        leading=26,
        textColor=c_primary,
        spaceAfter=4
    )

    subtitle_style = ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=11,
        leading=15,
        textColor=c_muted,
        spaceAfter=12
    )

    h1_style = ParagraphStyle(
        'Heading1_Custom',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=13.5,
        leading=17,
        textColor=c_primary,
        spaceBefore=12,
        spaceAfter=6,
        keepWithNext=True
    )

    h2_style = ParagraphStyle(
        'Heading2_Custom',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=10.5,
        leading=14,
        textColor=c_accent,
        spaceBefore=8,
        spaceAfter=3,
        keepWithNext=True
    )

    body_style = ParagraphStyle(
        'Body_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=12,
        textColor=c_text,
        spaceAfter=4
    )

    body_bold = ParagraphStyle(
        'Body_Bold',
        parent=body_style,
        fontName='Helvetica-Bold',
        textColor=c_dark
    )

    code_style = ParagraphStyle(
        'Code_Custom',
        parent=styles['Normal'],
        fontName='Courier',
        fontSize=7.5,
        leading=10,
        textColor=colors.HexColor("#0f172a"),
        backColor=c_code_bg,
        borderPadding=5,
        spaceAfter=5
    )

    callout_style = ParagraphStyle(
        'Callout_Text',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.2,
        leading=11.5,
        textColor=colors.HexColor("#1e293b")
    )

    bullet_style = ParagraphStyle(
        'Bullet_Custom',
        parent=body_style,
        leftIndent=10,
        firstLineIndent=-6,
        spaceAfter=2.5
    )

    story = []

    # Title & Header
    story.append(Paragraph("HRMS Enterprise Platform", title_style))
    story.append(Paragraph("Production Architecture, Database Operations & Claude Code Deployment Guide", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1.5, color=c_accent, spaceBefore=0, spaceAfter=8))

    # Meta Info Table
    meta_data = [
        [
            Paragraph("<b>Platform:</b> .NET 10.0 + Angular 22.2", body_style),
            Paragraph("<b>Database:</b> SQL Server (Multi-Tenant)", body_style),
            Paragraph("<b>Target Audience:</b> DevOps & Claude Code", body_style)
        ],
        [
            Paragraph("<b>Biometrics:</b> Face-API (128D AI)", body_style),
            Paragraph("<b>Secret Config:</b> .env (Git-Ignored)", body_style),
            Paragraph("<b>Build State:</b> Production-Ready (65/65 Tests Pass)", body_style)
        ]
    ]
    meta_table = Table(meta_data, colWidths=[168, 168, 168])
    meta_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), c_card_bg),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor("#cbd5e1")),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor("#e2e8f0")),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 7),
        ('RIGHTPADDING', (0,0), (-1,-1), 7),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 6))

    # SECTION 1: EXECUTIVE OVERVIEW
    story.append(Paragraph("1. Executive Overview & Core Mission", h1_style))
    story.append(Paragraph(
        "HRMS is an enterprise Human Resource Management System engineered with an isolated database-per-tenant architecture. "
        "The system incorporates on-device biometric facial recognition attendance verification, hardware-accelerated GPS geofencing, "
        "real-time break tracking, candidate and employee onboarding, automated payroll and payslip calculation, leave workflows, "
        "audit muster reporting, and granular role-based permissions (RBAC).",
        body_style
    ))
    story.append(Paragraph(
        "This specification is created to equip deployment engineers and Claude Code with all information regarding frontend and backend stacks, "
        "database schema operations, third-party integrations (Cloudinary, SMTP, Face-API), secret management, and hosting blueprints.",
        body_style
    ))

    # SECTION 2: FRONTEND TECHNOLOGY STACK
    story.append(Paragraph("2. Frontend Technology Stack & Build Pipeline", h1_style))
    story.append(Paragraph(
        "The frontend is a single-page application built with modern Angular standalone components (no NgModules), "
        "reactive Signals, typed form controls, and client-side machine learning biometrics.",
        body_style
    ))

    fe_table_data = [
        [Paragraph("<b>Component / Package</b>", body_bold), Paragraph("<b>Version</b>", body_bold), Paragraph("<b>Role / Architecture Purpose</b>", body_bold)],
        [Paragraph("Angular Framework", body_style), Paragraph("v22.2.0", body_style), Paragraph("Core SPA architecture using Standalone Components, Signals, and Control Flow (@if/@for)", body_style)],
        [Paragraph("Angular Build & CLI", body_style), Paragraph("v22.2.3", body_style), Paragraph("@angular/build application dev-server and bundler driven by Vite and esbuild", body_style)],
        [Paragraph("TypeScript Compiler", body_style), Paragraph("v6.0.2", body_style), Paragraph("Strict typing, ES2022+ output target", body_style)],
        [Paragraph("@vladmandic/face-api", body_style), Paragraph("v1.7.15", body_style), Paragraph("Client-side neural net face detection (SSD MobileNet v1), 68 landmarks & 128D embeddings", body_style)],
        [Paragraph("Chart.js", body_style), Paragraph("v4.4.0", body_style), Paragraph("Interactive attendance overview graphs, working hours trends, and workforce distribution", body_style)],
        [Paragraph("jsPDF & html2canvas", body_style), Paragraph("v2.5.1 / v1.4.1", body_style), Paragraph("Client-side payslip generation, muster sheet export, and PDF document rendering", body_style)],
        [Paragraph("RxJS", body_style), Paragraph("v7.8.0", body_style), Paragraph("Observable pipelines and HTTP interceptor architecture", body_style)],
    ]
    fe_table = Table(fe_table_data, colWidths=[125, 60, 319])
    fe_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#e2e8f0")),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor("#cbd5e1")),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor("#e2e8f0")),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(fe_table)
    story.append(Spacer(1, 5))

    story.append(Paragraph("<b>Frontend Operational Rules:</b>", body_bold))
    story.append(Paragraph("• <b>Face Recognition Models:</b> Weights are stored in <code>frontend/public/models/</code>. When deploying, ensure the web server serves <code>/models/*</code> statically.", bullet_style))
    story.append(Paragraph("• <b>Environments:</b> <code>environment.production.ts</code> uses <code>apiUrl: '/api'</code>, allowing clean reverse-proxy routing without domain lock-in.", bullet_style))
    story.append(Paragraph("• <b>Build Command:</b> <code>npm run build</code> -> generates production bundle in <code>frontend/dist/hrms/browser/</code>.", bullet_style))

    # SECTION 3: BACKEND TECHNOLOGY STACK
    story.append(Paragraph("3. Backend Technology Stack (.NET 10 Web API)", h1_style))
    story.append(Paragraph(
        "The backend is a high-performance RESTful API built on <b>.NET 10.0 (C# 13)</b> adhering to Clean Onion Architecture.",
        body_style
    ))

    be_table_data = [
        [Paragraph("<b>Project Layer</b>", body_bold), Paragraph("<b>Target</b>", body_bold), Paragraph("<b>Responsibilities & Contents</b>", body_bold)],
        [Paragraph("Hrms.Domain", body_style), Paragraph(".NET 10.0", body_style), Paragraph("Pure domain entities (Employee, Punch, Attendance, Leave, Payroll), value objects, and enums.", body_style)],
        [Paragraph("Hrms.Application", body_style), Paragraph(".NET 10.0", body_style), Paragraph("Application DTOs, contracts, AttendanceService, PayrollService, and business validation logic.", body_style)],
        [Paragraph("Hrms.Infrastructure", body_style), Paragraph(".NET 10.0", body_style), Paragraph("EF Core 10 SQL Server DbContexts, UnitOfWork, TenantDatabaseService, and JWT token generator.", body_style)],
        [Paragraph("Hrms.Api", body_style), Paragraph(".NET 10.0", body_style), Paragraph("REST API Controllers, JWT Bearer Auth middleware, Swagger OpenAPI, CORS policy, Static files.", body_style)],
    ]
    be_table = Table(be_table_data, colWidths=[125, 60, 319])
    be_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#e2e8f0")),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor("#cbd5e1")),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor("#e2e8f0")),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(be_table)
    story.append(Spacer(1, 5))

    story.append(Paragraph("<b>Backend Publish Command:</b>", body_bold))
    story.append(Paragraph(
        "<code>dotnet publish backend/src/Hrms.Api -c Release -o ./publish/backend</code><br/>"
        "Runs on Kestrel web server listening on <code>http://0.0.0.0:5096</code> by default.",
        code_style
    ))

    story.append(PageBreak())

    # SECTION 4: SQL SERVER DATABASE ARCHITECTURE & OPERATIONS
    story.append(Paragraph("4. SQL Server Database Architecture & Operations", h1_style))
    story.append(Paragraph(
        "HRMS uses a secure <b>Database-per-Tenant Multi-Tenancy Architecture</b>. Every company registered in the system "
        "has its own dedicated, isolated SQL Server database for maximum data security, regulatory compliance, and independent tenant backup.",
        body_style
    ))

    story.append(Paragraph("A. Master Database (HrmsMasterDbContext)", h2_style))
    story.append(Paragraph(
        "The master database (e.g. <code>HRMS_Master</code>) acts as the central tenant directory. It manages: "
        "<code>Tenants</code> (company metadata, tenant code, database connection strings, subscription tiers), "
        "<code>Global Users</code> (Super Admins who manage tenant accounts across the platform), and "
        "<code>Provisioning Logs</code> (database creation records and migration version tracking).",
        body_style
    ))

    story.append(Paragraph("B. Tenant Databases (HrmsDbContext)", h2_style))
    story.append(Paragraph(
        "Each organization has its own database (e.g. <code>hrms_t_kautilyam</code> or <code>HRMS_Dummy</code>) containing organization-specific records:",
        body_style
    ))
    story.append(Paragraph("• <b>Identity & Security:</b> <code>Users</code>, <code>Roles</code>, <code>UserRoles</code>, <code>RoleNavigationPermissions</code>, <code>RefreshTokens</code>.", bullet_style))
    story.append(Paragraph("• <b>Organization:</b> <code>CompanySettings</code> (geofencing coordinates, 500m radius, timezone), <code>Departments</code>, <code>Designations</code>, <code>Branches</code>.", bullet_style))
    story.append(Paragraph("• <b>Personnel:</b> <code>Employees</code> (holds 128D FaceDescriptor JSON array, FacePhotoUrl), <code>EmployeeProfiles</code>, <code>EmergencyContacts</code>, <code>BankDetails</code>.", bullet_style))
    story.append(Paragraph("• <b>Attendance & Biometrics:</b> <code>EmployeePunches</code> (exact punch time, punch type: ClockIn/Out/BreakIn/Out, GPS Latitude, Longitude, DistanceMeters, VerificationStatus), <code>AttendanceRecords</code>, <code>Shifts</code>, <code>AttendanceRegularizationRequests</code>.", bullet_style))
    story.append(Paragraph("• <b>Leaves & Payroll:</b> <code>LeaveTypes</code>, <code>LeaveRequests</code>, <code>LeaveAllocations</code>, <code>PayrollRuns</code>, <code>Payslips</code>, <code>SalaryStructures</code>.", bullet_style))
    story.append(Paragraph("• <b>Dynamic System Dictionaries:</b> <code>KeyGroups</code>, <code>KeyStores</code>, <code>NavigationItems</code>.", bullet_style))

    story.append(Paragraph("C. Provisioning & Database Migration Operations", h2_style))
    story.append(Paragraph(
        "1. <b>Automatic Provisioning:</b> When a new tenant registers or upon startup via <code>DatabaseBootstrap</code>, the system checks whether the tenant database exists. If missing, it creates the database and runs all pending EF Core migrations automatically via <code>TenantDatabaseService.cs</code>.<br/>"
        "2. <b>Manual EF Core Migration Commands:</b><br/>"
        "&nbsp;&nbsp;• <b>Update Master Database:</b><br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;<code>dotnet ef database update --context HrmsMasterDbContext --project backend/src/Hrms.Infrastructure --startup-project backend/src/Hrms.Api</code><br/>"
        "&nbsp;&nbsp;• <b>Update Tenant Database:</b><br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;<code>dotnet ef database update --context HrmsDbContext --project backend/src/Hrms.Infrastructure --startup-project backend/src/Hrms.Api</code>",
        code_style
    ))

    # SECTION 5: THIRD-PARTY INTEGRATIONS & SERVICES
    story.append(Paragraph("5. Third-Party Integrations & External Services", h1_style))

    services_data = [
        [Paragraph("<b>Service / Tool</b>", body_bold), Paragraph("<b>Integration Point</b>", body_bold), Paragraph("<b>Operational Details & Fallback</b>", body_bold)],
        [
            Paragraph("<b>Cloudinary</b><br/>Cloud Media Storage", body_style),
            Paragraph("<code>FilesController.cs</code><br/>(Endpoints: <code>/api/files/upload</code>)", body_style),
            Paragraph(
                "Uploads employee avatar photos, onboarding identity cards, and organizational documents. "
                "Supports signed API uploads (SHA-1 signature) and unsigned presets. "
                "<b>Automatic Fallback:</b> If Cloudinary credentials are empty or unreachable, the system automatically saves the file to local server disk in <code>uploads/{companyCode}/{userId}/</code> with strict 2MB limit and PDF/JPG/PNG filtering.",
                body_style
            )
        ],
        [
            Paragraph("<b>Google SMTP</b><br/>(Gmail Email Relay)", body_style),
            Paragraph("<code>EmailService.cs</code> / <code>SmtpSettings</code>", body_style),
            Paragraph(
                "Transmits automated email alerts including new employee onboarding invitation links, password reset verification tokens, "
                "and approval notifications. Configured via Gmail App Password over TLS port 587.",
                body_style
            )
        ],
        [
            Paragraph("<b>Vladmandic Face-API</b><br/>(Biometric AI Engine)", body_style),
            Paragraph("<code>face-api.service.ts</code> & <code>punch-in-out.component.ts</code>", body_style),
            Paragraph(
                "Runs on-device via WebGL/WASM in the client's browser. Analyzes webcam video frame, detects face bounds, extracts 68 facial landmarks, "
                "and generates a normalized 128-dimensional biometric floating-point descriptor. The descriptor is transmitted to backend for Euclidean distance match verification (≤0.58 distance / ≥70% confidence).",
                body_style
            )
        ]
    ]
    services_table = Table(services_data, colWidths=[110, 120, 274])
    services_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#e2e8f0")),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor("#cbd5e1")),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor("#e2e8f0")),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(services_table)
    story.append(Spacer(1, 8))

    # SECTION 6: ENVIRONMENT VARIABLES & SECRET ISOLATION (.env)
    story.append(Paragraph("6. Sensitive Credentials & Environment Variable (.env) Specification", h1_style))
    story.append(Paragraph(
        "To comply with security best practices and prevent leaking database passwords, JWT signing keys, and SMTP credentials to GitHub, "
        "all secret configuration is extracted into an external <b><code>.env</code></b> file. "
        "The root <code>.gitignore</code> has been updated to prevent <code>.env</code> from ever being tracked by git.",
        body_style
    ))
    story.append(Paragraph("<b>ASP.NET Core Double-Underscore Mapping:</b> In Linux/Docker/systemd, hierarchical configuration keys are passed using double underscores (e.g. <code>ConnectionStrings__DefaultConnection</code>).", body_style))

    env_sample = (
        "# Runtime Mode & URL binding\n"
        "ASPNETCORE_ENVIRONMENT=Production\n"
        "ASPNETCORE_URLS=http://0.0.0.0:5096\n\n"
        "# Application Domain & CORS\n"
        "App__FrontendBaseUrl=https://hrms.yourcompany.com\n"
        "Cors__AllowedOrigins__0=https://hrms.yourcompany.com\n\n"
        "# SQL Server Databases (Master & Default Tenant)\n"
        "ConnectionStrings__DefaultConnection=Server=127.0.0.1;Database=HRMS_Production;User Id=sa;Password=StrongPassword!;Encrypt=True;TrustServerCertificate=True;\n"
        "ConnectionStrings__MasterConnection=Server=127.0.0.1;Database=HRMS_Master;User Id=sa;Password=StrongPassword!;Encrypt=True;TrustServerCertificate=True;\n"
        "Tenancy__TenantConnectionBase=Server=127.0.0.1;User Id=sa;Password=StrongPassword!;Encrypt=True;TrustServerCertificate=True;\n\n"
        "# Security & Tokens (Min 32 characters)\n"
        "Jwt__Issuer=Hrms.Api\n"
        "Jwt__Audience=Hrms.Client\n"
        "Jwt__Key=hrms-production-signing-key-minimum-32-chars-long-secure-2026\n"
        "Jwt__ExpiryMinutes=480\n\n"
        "# Email Services (Google SMTP Relay)\n"
        "Email__Enabled=true\n"
        "Email__Host=smtp.gmail.com\n"
        "Email__Port=587\n"
        "Email__UserName=your-email@gmail.com\n"
        "Email__Password=your-google-app-password\n\n"
        "# Cloudinary Media Storage\n"
        "Cloudinary__CloudName=your_cloud_name\n"
        "Cloudinary__ApiKey=your_api_key\n"
        "Cloudinary__ApiSecret=your_api_secret\n"
        "Cloudinary__UploadPreset=your_upload_preset"
    )
    story.append(Paragraph(env_sample.replace('\n', '<br/>'), code_style))

    story.append(PageBreak())

    # SECTION 7: PRODUCTION DEPLOYMENT BLUEPRINT
    story.append(Paragraph("7. Production Deployment Blueprint", h1_style))

    # CRITICAL SECURITY CALLOUT
    warn_box = [
        [
            Paragraph(
                "<b>CRITICAL SECURITY REQUIREMENT FOR WEBCAM & GPS GEOFENCING:</b><br/>"
                "Modern browsers (Google Chrome, Microsoft Edge, Safari, Mozilla Firefox) enforce strict Secure Context policies: "
                "<code>navigator.mediaDevices.getUserMedia</code> (webcam) and <code>navigator.geolocation</code> (GPS) are "
                "<b>strictly disabled over plain HTTP IP addresses</b>. Production deployments <b>MUST USE HTTPS (SSL/TLS)</b> "
                "with a valid domain certificate (e.g. Let's Encrypt). Without HTTPS, camera access will be blocked by the browser.",
                callout_style
            )
        ]
    ]
    warn_table = Table(warn_box, colWidths=[504])
    warn_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#fef2f2")),
        ('BOX', (0,0), (-1,-1), 1, colors.HexColor("#ef4444")),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(warn_table)
    story.append(Spacer(1, 8))

    story.append(Paragraph("A. Linux Deployment (Ubuntu/Debian + Nginx + Systemd)", h2_style))
    story.append(Paragraph(
        "1. <b>Build Artifacts:</b><br/>"
        "&nbsp;&nbsp;<code>cd frontend && npm install && npm run build</code><br/>"
        "&nbsp;&nbsp;<code>cd ../backend/src/Hrms.Api && dotnet publish -c Release -o /var/www/hrms/backend</code><br/>"
        "&nbsp;&nbsp;<code>cp -r ../../../frontend/dist/hrms/browser/* /var/www/hrms/frontend/</code><br/><br/>"
        "2. <b>Systemd Service (<code>/etc/systemd/system/hrms-backend.service</code>):</b><br/>"
        "&nbsp;&nbsp;[Unit]<br/>"
        "&nbsp;&nbsp;Description=HRMS .NET 10 Web API<br/>"
        "&nbsp;&nbsp;After=network.target<br/><br/>"
        "&nbsp;&nbsp;[Service]<br/>"
        "&nbsp;&nbsp;WorkingDirectory=/var/www/hrms/backend<br/>"
        "&nbsp;&nbsp;ExecStart=/usr/bin/dotnet /var/www/hrms/backend/Hrms.Api.dll<br/>"
        "&nbsp;&nbsp;Restart=always<br/>"
        "&nbsp;&nbsp;RestartSec=10<br/>"
        "&nbsp;&nbsp;EnvironmentFile=/var/www/hrms/.env<br/>"
        "&nbsp;&nbsp;User=www-data<br/><br/>"
        "&nbsp;&nbsp;[Install]<br/>"
        "&nbsp;&nbsp;WantedBy=multi-user.target<br/><br/>"
        "3. <b>Nginx Configuration (<code>/etc/nginx/sites-available/hrms</code>):</b><br/>"
        "&nbsp;&nbsp;server {<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;listen 80;<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;server_name hrms.yourcompany.com;<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;return 301 https://$host$request_uri;<br/>"
        "&nbsp;&nbsp;}<br/>"
        "&nbsp;&nbsp;server {<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;listen 443 ssl http2;<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;server_name hrms.yourcompany.com;<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;ssl_certificate /etc/letsencrypt/live/hrms.yourcompany.com/fullchain.pem;<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;ssl_certificate_key /etc/letsencrypt/live/hrms.yourcompany.com/privkey.pem;<br/><br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;# Static Angular SPA Frontend<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;root /var/www/hrms/frontend;<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;index index.html;<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;location / {<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;try_files $uri $uri/ /index.html;<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;}<br/><br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;# Reverse Proxy Backend API<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;location /api/ {<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;proxy_pass http://127.0.0.1:5096/api/;<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;proxy_http_version 1.1;<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;proxy_set_header Upgrade $http_upgrade;<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;proxy_set_header Connection keep-alive;<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;proxy_set_header Host $host;<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;proxy_cache_bypass $http_upgrade;<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;proxy_set_header X-Forwarded-Proto $scheme;<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;}<br/>"
        "&nbsp;&nbsp;}",
        code_style
    ))

    story.append(Paragraph("B. Windows Server Deployment (IIS + URL Rewrite)", h2_style))
    story.append(Paragraph(
        "1. Install <b>ASP.NET Core Hosting Bundle (.NET 10.0)</b> and <b>IIS URL Rewrite Module</b>.<br/>"
        "2. Create an IIS Site pointing to <code>C:\\inetpub\\hrms</code>.<br/>"
        "3. Place published backend files in <code>C:\\inetpub\\hrms\\api</code> and Angular dist files in root <code>C:\\inetpub\\hrms</code>.<br/>"
        "4. Configure IIS SSL binding with a valid PFX certificate for HTTPS compliance.",
        body_style
    ))

    # SECTION 8: CLAUDE CODE HANDOVER INSTRUCTIONS
    story.append(Paragraph("8. Handover Guide for Claude Code AI", h1_style))
    story.append(Paragraph(
        "When instructing Claude Code to inspect, build, or deploy this repository, provide this direct prompt summary:",
        body_style
    ))

    claude_box = [
        [
            Paragraph(
                "<b>PROMPT FOR CLAUDE CODE:</b><br/><br/>"
                "<i>\"I am providing you with the HRMS Enterprise repository. It is a multi-tenant HRMS system built with .NET 10 Web API backend and Angular 22.2 SPA frontend.<br/>"
                "• All secrets and database connections are stored in the root <code>.env</code> file (which is git-ignored).<br/>"
                "• The backend uses SQL Server with dual DbContexts: <code>HrmsMasterDbContext</code> (Master catalog) and <code>HrmsDbContext</code> (Tenant databases).<br/>"
                "• Biometric face recognition is powered by <code>@vladmandic/face-api</code> with neural models in <code>frontend/public/models/</code>.<br/>"
                "• Media storage uses Cloudinary with automatic fallback to local disk storage in <code>uploads/</code>.<br/>"
                "• To verify the project: run <code>dotnet test backend/tests/Hrms.Tests</code> (all 65 unit tests should pass) and <code>npm run build --prefix frontend</code> (production build should succeed with 0 errors).<br/>"
                "• When deploying, ensure the application is hosted under HTTPS so browser camera and geolocation APIs are permitted.\"</i>",
                callout_style
            )
        ]
    ]
    claude_table = Table(claude_box, colWidths=[504])
    claude_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#eff6ff")),
        ('BOX', (0,0), (-1,-1), 1, colors.HexColor("#3b82f6")),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(claude_table)
    story.append(Spacer(1, 8))

    story.append(Paragraph("<b>Verification Checklist Prior to Live Launch:</b>", body_bold))
    story.append(Paragraph("✔ SQL Server databases (Master and Tenant) created and accessible via connection strings in <code>.env</code>.", bullet_style))
    story.append(Paragraph("✔ EF Core migrations executed for both contexts.", bullet_style))
    story.append(Paragraph("✔ SSL Certificate installed and HTTPS binding active on port 443.", bullet_style))
    story.append(Paragraph("✔ Static <code>/models/</code> route successfully delivers face-api weights to the browser.", bullet_style))
    story.append(Paragraph("✔ Google SMTP credentials verified for sending emails.", bullet_style))
    story.append(Paragraph("✔ <code>uploads/</code> directory has write permissions for the application process user.", bullet_style))

    doc.build(story, canvasmaker=NumberedCanvas)
    
    # Read page count
    reader = pypdf.PdfReader(filename)
    print(f"PDF successfully generated: {filename} ({len(reader.pages)} pages)")

if __name__ == "__main__":
    out_file = r"d:\HRMS (2)\HRMS\HRMS_Deployment_and_Architecture_Guide.pdf"
    build_pdf(out_file)
