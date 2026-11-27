export interface DropdownCoords {
  dropUp: boolean;
  top: string | null;
  bottom: string | null;
  left: number;
  width: number;
  maxHeight: number;
}

/**
 * Computes viewport-relative coordinates for a fixed-position dropdown menu,
 * always opening downward below the trigger element.
 */
export function computeDropdownCoords(anchor: HTMLElement): DropdownCoords {
  const rect = anchor.getBoundingClientRect();
  const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - 8);

  const width = Math.max(120, Math.round(rect.width));
  const left = Math.max(8, Math.min(Math.round(rect.left), window.innerWidth - width - 8));

  const maxHeight = Math.max(100, Math.min(280, Math.floor(spaceBelow)));
  const topPx = Math.max(8, Math.round(rect.bottom + 4));

  return {
    dropUp: false,
    top: `${topPx}px`,
    bottom: null,
    left,
    width,
    maxHeight,
  };
}

/**
 * Moves a dropdown menu element to document.body while open so ancestor
 * transform/overflow/z-index containers never clip or offset fixed coordinates,
 * and returns it safely to its host container when closed.
 */
export function attachMenuToBody(menu: HTMLElement | undefined): void {
  if (!menu || typeof document === 'undefined') return;
  if (menu.parentElement !== document.body) {
    document.body.appendChild(menu);
  }
}

export function restoreMenuToHost(menu: HTMLElement | undefined, hostWrap: HTMLElement | undefined): void {
  if (!menu || typeof document === 'undefined') return;
  if (hostWrap && hostWrap.isConnected) {
    if (menu.parentElement !== hostWrap) {
      hostWrap.appendChild(menu);
    }
  } else if (menu.parentElement === document.body) {
    menu.remove();
  }
}
