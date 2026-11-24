import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from '../api/api.service';

export interface CurrencyConfig {
  code: string;
  name: string;
  symbol: string;
  pdfSymbol: string;
}

export const SUPPORTED_CURRENCIES: CurrencyConfig[] = [
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', pdfSymbol: 'Rs. ' },
  { code: 'USD', name: 'US Dollar', symbol: '$', pdfSymbol: '$' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED ', pdfSymbol: 'AED ' },
  { code: 'EUR', name: 'Euro', symbol: '€', pdfSymbol: 'EUR ' },
  { code: 'GBP', name: 'British Pound', symbol: '£', pdfSymbol: 'GBP ' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR ', pdfSymbol: 'SAR ' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', pdfSymbol: 'CAD ' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', pdfSymbol: 'AUD ' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', pdfSymbol: 'SGD ' },
];

const CURRENCY_STORAGE_KEY = 'hrms_currency_code';

@Injectable({ providedIn: 'root' })
export class CurrencyService {
  private readonly api = inject(ApiService);

  private readonly _currencyCode = signal<string>(this.readInitialCurrency());

  readonly currencyCode = this._currencyCode.asReadonly();

  readonly currencySymbol = computed<string>(() => {
    return this.getSymbol(this._currencyCode());
  });

  readonly currencyPdfSymbol = computed<string>(() => {
    return this.getPdfSymbol(this._currencyCode());
  });

  constructor() {
    this.refreshCurrency();
  }

  private readInitialCurrency(): string {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(CURRENCY_STORAGE_KEY);
      if (stored) return stored.toUpperCase();
    }
    return 'INR';
  }

  refreshCurrency(): void {
    if (typeof sessionStorage === 'undefined' || !sessionStorage.getItem('hrms.token')) {
      return;
    }
    this.api.company().subscribe({
      next: (comp) => {
        if (comp?.payrollCurrency) {
          this.setCurrency(comp.payrollCurrency);
        }
      },
      error: () => {
        /* Unauthenticated or offline fallback */
      },
    });
  }

  setCurrency(code: string): void {
    if (!code) return;
    const clean = code.trim().toUpperCase();
    this._currencyCode.set(clean);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CURRENCY_STORAGE_KEY, clean);
    }
  }

  getSymbol(code?: string | null): string {
    const c = (code || this._currencyCode()).toUpperCase();
    const found = SUPPORTED_CURRENCIES.find((item) => item.code === c);
    return found ? found.symbol : (c ? `${c} ` : '₹');
  }

  getPdfSymbol(code?: string | null): string {
    const c = (code || this._currencyCode()).toUpperCase();
    const found = SUPPORTED_CURRENCIES.find((item) => item.code === c);
    return found ? found.pdfSymbol : (c ? `${c} ` : 'Rs. ');
  }

  format(amount: number | null | undefined, customCode?: string | null): string {
    const num = amount ?? 0;
    const sym = customCode ? this.getSymbol(customCode) : this.currencySymbol();
    return `${sym}${num.toLocaleString()}`;
  }

  formatWithDecimals(amount: number | null | undefined, customCode?: string | null): string {
    const num = amount ?? 0;
    const sym = customCode ? this.getSymbol(customCode) : this.currencySymbol();
    return `${sym}${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  formatForPdf(amount: number | null | undefined, customCode?: string | null): string {
    const num = amount ?? 0;
    const sym = customCode ? this.getPdfSymbol(customCode) : this.currencyPdfSymbol();
    return `${sym}${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}
