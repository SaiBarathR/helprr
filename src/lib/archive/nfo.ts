export const HEADER = '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n';

export function xml(value: string): string {
  // Characters XML 1.0 cannot carry at all, then the five it must escape.
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const tag = (name: string, value: string | number) => `  <${name}>${xml(String(value))}</${name}>\n`;

export function seasonNfo(title: string, seasonNumber: number): string {
  return `${HEADER}<season>\n${tag('title', title)}${tag('seasonnumber', seasonNumber)}</season>\n`;
}
