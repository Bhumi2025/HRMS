import { AfterViewInit, Directive, ElementRef, HostListener, OnDestroy, OnInit, inject } from '@angular/core';

/**
 * Prevents browsers (Chrome/Edge password & contact autofill managers) from
 * silently pre-filling saved credentials like emails into search boxes on module visit.
 */
@Directive({
  selector: 'input[type="search"], input[appNoAutofill]',
  standalone: true,
})
export class NoAutofillDirective implements OnInit, AfterViewInit, OnDestroy {
  private readonly elRef = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private userInteracted = false;
  private readonly timers: ReturnType<typeof setTimeout>[] = [];

  ngOnInit(): void {
    const el = this.elRef.nativeElement;
    el.setAttribute('autocomplete', 'new-password');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('spellcheck', 'false');
    el.setAttribute('data-lpignore', 'true');
    el.setAttribute('data-1p-ignore', 'true');
    el.setAttribute('data-bwignore', 'true');
    el.setAttribute('data-form-type', 'other');
    if (!el.readOnly) {
      el.readOnly = true;
    }
  }

  ngAfterViewInit(): void {
    const wipeIfUntrusted = () => {
      if (this.userInteracted) return;
      const el = this.elRef.nativeElement;
      if (el.value) {
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };
    wipeIfUntrusted();
    for (const delay of [30, 120, 300, 600, 1200]) {
      this.timers.push(setTimeout(wipeIfUntrusted, delay));
    }
  }

  @HostListener('pointerdown', ['$event'])
  @HostListener('keydown', ['$event'])
  @HostListener('focus', ['$event'])
  onUserInteraction(event: Event): void {
    if (!event.isTrusted) return;
    this.userInteracted = true;
    const el = this.elRef.nativeElement;
    if (el.readOnly) {
      el.readOnly = false;
    }
  }

  ngOnDestroy(): void {
    for (const t of this.timers) {
      clearTimeout(t);
    }
  }
}
