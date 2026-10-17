// The service connection form's rules, shared by Test and Save.

export interface HeaderRow {
  id: string;
  name: string;
  value: string;
}

export type FieldKey = 'label' | 'url' | 'apiKey' | 'jellyfinUser';

// Keep in sync with parseCustomHeaders in service-connection-secrets.ts (that lib
// pulls in server-only deps, so it can't be imported into this client component).
const HEADER_NAME_PATTERN = /^[A-Za-z0-9-]+$/;
export const MAX_HEADERS = 10;
const MAX_HEADER_VALUE_LENGTH = 2048;
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

export interface ConnectionForm {
  url: string;
  apiKey: string;
  /** qBittorrent takes a password where the others take an API key. */
  isQbt: boolean;
  /** The URL changed while the saved secret is still in the field. */
  savedKeyKept: boolean;
  isMultiInstance: boolean;
  label: string;
  isJellyfin: boolean;
  jellyfinValidated: boolean;
  username: string | undefined;
  canEditHeaders: boolean;
  headers: HeaderRow[];
  urlChanged: boolean;
  isSavedHeaderValue: (row: HeaderRow) => boolean;
}

export interface ConnectionFormErrors {
  fields: Partial<Record<FieldKey, string>>;
  headers: Record<string, { name?: string; value?: string }>;
}

/** The field and header-row errors for Test (`forSave` false) or Save. */
export function connectionFormErrors(form: ConnectionForm, forSave: boolean): ConnectionFormErrors {
  const errors: Partial<Record<FieldKey, string>> = {};
  const hdrErrors: Record<string, { name?: string; value?: string }> = {};
  const secretNoun = form.isQbt ? 'password' : 'API key';
  if (!form.url.trim()) errors.url = 'URL is required';
  if (!form.apiKey.trim()) errors.apiKey = form.isQbt ? 'Password is required' : 'API key is required';
  else if (form.savedKeyKept) errors.apiKey = `Enter the ${secretNoun} again for the new URL`;
  if (forSave) {
    if (form.isMultiInstance && !form.label.trim()) errors.label = 'Name this instance';
    if (form.isJellyfin && form.jellyfinValidated && !(form.username?.trim())) {
      errors.jellyfinUser = 'Select a Jellyfin user';
    }
  }
  if (form.canEditHeaders) {
    // Surface what the server would otherwise silently drop.
    for (const h of form.headers) {
      const name = h.name.trim();
      if (!name) continue; // blank rows are ignored, not an error
      if (!HEADER_NAME_PATTERN.test(name)) {
        hdrErrors[h.id] = { name: 'Letters, numbers, and hyphens only' };
        continue;
      }
      if (name.toLowerCase() === 'host') {
        hdrErrors[h.id] = { name: 'Host cannot be set here' };
        continue;
      }
      const value = h.value.trim();
      if (!value) hdrErrors[h.id] = { value: 'Value required' };
      else if (form.urlChanged && form.isSavedHeaderValue(h)) hdrErrors[h.id] = { value: 'Enter this value again for the new URL' };
      else if (value.length > MAX_HEADER_VALUE_LENGTH) {
        hdrErrors[h.id] = { value: `Too long (max ${MAX_HEADER_VALUE_LENGTH} characters)` };
      } else if (hasControlChar(h.value)) {
        hdrErrors[h.id] = { value: 'Contains invalid characters' };
      }
    }
  }
  return { fields: errors, headers: hdrErrors };
}
