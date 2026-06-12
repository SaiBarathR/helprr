import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

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
  return true;
}
