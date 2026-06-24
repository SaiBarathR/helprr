import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Resolves after `ms` milliseconds. */
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Shallow props comparison for React.memo that skips the given keys (typically
 * callback props that are recreated every render). Returns true when all other
 * props are referentially equal.
 */
export function shallowEqualExcept<T extends object>(
  a: T,
  b: T,
  ignore: readonly (keyof T)[],
): boolean {
  for (const k of Object.keys(a) as (keyof T)[]) {
    if (ignore.includes(k)) continue;
    if (a[k] !== b[k]) return false;
  }
  // Catch keys present in b but not a (a's loop above can't see them).
  for (const k of Object.keys(b) as (keyof T)[]) {
    if (ignore.includes(k)) continue;
    if (!(k in a)) return false;
  }
  return true;
}
