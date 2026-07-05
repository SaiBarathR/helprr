'use client';

import { useUIStore } from '@/lib/store';

export type HapticKind = 'light' | 'medium' | 'success' | 'warning';

// navigator.vibrate patterns (ms) for Android/Chromium.
const VIBRATE_PATTERNS: Record<HapticKind, number | number[]> = {
  light: 10,
  medium: 20,
  success: [10, 50, 10],
  warning: [30, 60, 30],
};

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports as MacIntel but has touch points.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

// iOS Safari has no navigator.vibrate. Since 17.4 a `<input switch>` toggle
// produces the system haptic tick, so we keep one hidden switch around and
// click it programmatically. On non-supporting versions the click is inert —
// no haptic, no side effects (the input is detached from any form/listeners).
//
// iOS 18+ additionally requires the toggle to happen during transient user
// activation: ticks fired from touch/click handlers (swipe thresholds, the
// settings demo tick) still work, while ones fired from async continuations
// (e.g. a refresh settling) silently no-op there. That's the accepted
// degradation — there is no alternative haptics API on iOS and no feature
// detection for switch ticks, so version-gating would only disable devices
// where it works.
let iosSwitchInput: HTMLInputElement | null = null;

function tickIosSwitch(): void {
  if (!iosSwitchInput) {
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;pointer-events:none;';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
    iosSwitchInput = input;
  }
  iosSwitchInput.click();
}

/**
 * Fire a haptic tick for a touch gesture. No-ops when the user disabled
 * haptics, when prefers-reduced-motion is set, or when the platform has no
 * haptic path (desktop). Safe to call from event handlers and effects.
 */
export function haptic(kind: HapticKind = 'light'): void {
  if (typeof window === 'undefined') return;
  if (!useUIStore.getState().hapticsEnabled) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  if (isIos()) {
    // iOS has a single fixed tick — every kind maps to it.
    try {
      tickIosSwitch();
    } catch {
      // DOM not ready or blocked — haptics are best-effort.
    }
    return;
  }
  navigator.vibrate?.(VIBRATE_PATTERNS[kind]);
}
