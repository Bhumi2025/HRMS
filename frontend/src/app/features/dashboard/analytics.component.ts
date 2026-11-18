import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { TemplateDashboardComponent } from './template-dashboard.component';

/** Routes `/analytics` to the original HR Manager template dashboard. */
@Component({
  selector: 'app-analytics',
  imports: [CommonModule, TemplateDashboardComponent],
  template: `
    <app-template-dashboard />
  `,
})
export class AnalyticsComponent {}
