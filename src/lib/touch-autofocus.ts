/**
 * For a dialog's onOpenAutoFocus: on a touch screen, focusing its first field
 * opens the keyboard over the dialog before anything was tapped (and a
 * selected value is one stray key from being replaced). A mouse or keyboard
 * keeps the usual focus.
 */
export function skipAutoFocusOnTouch(event: Event): void {
  if (window.matchMedia?.('(pointer: coarse)').matches) event.preventDefault();
}
