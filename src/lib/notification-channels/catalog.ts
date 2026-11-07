// The kinds of outbound notification channel and the fields each one takes.
// Safe to import on the client: the settings form is built from this, and the
// server validates against the same list.

export const CHANNEL_TYPES = ['ntfy', 'gotify', 'webhook', 'apprise', 'email'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export interface ChannelField {
  key: string;
  label: string;
  /** Stored encrypted and never sent back to the browser once saved. */
  secret?: boolean;
  required?: boolean;
  kind: 'text' | 'url' | 'email' | 'number' | 'select';
  placeholder?: string;
  help?: string;
  defaultValue?: string;
  options?: { value: string; label: string }[];
}

export interface ChannelTypeMeta {
  label: string;
  description: string;
  fields: ChannelField[];
}

const PRIORITY_OPTIONS = [
  { value: '1', label: 'Min' },
  { value: '2', label: 'Low' },
  { value: '3', label: 'Default' },
  { value: '4', label: 'High' },
  { value: '5', label: 'Urgent' },
];

export const CHANNEL_CATALOG: Record<ChannelType, ChannelTypeMeta> = {
  ntfy: {
    label: 'ntfy',
    description: 'Push to the ntfy app on iPhone, Android or desktop, through ntfy.sh or your own server.',
    fields: [
      { key: 'serverUrl', label: 'Server', kind: 'url', required: true, defaultValue: 'https://ntfy.sh', placeholder: 'https://ntfy.sh' },
      { key: 'topic', label: 'Topic', kind: 'text', secret: true, required: true, placeholder: 'helprr-a1b2c3', help: 'Anyone who knows a topic on a public server can read it: pick one that is hard to guess.' },
      { key: 'token', label: 'Access token', kind: 'text', secret: true, placeholder: 'tk_…', help: 'Only for a protected topic.' },
      { key: 'username', label: 'User name', kind: 'text', help: 'Instead of a token, for a protected topic.' },
      { key: 'password', label: 'Password', kind: 'text', secret: true },
      { key: 'priority', label: 'Priority', kind: 'select', defaultValue: '3', options: PRIORITY_OPTIONS },
    ],
  },
  gotify: {
    label: 'Gotify',
    description: 'Send to a Gotify server, as one of its applications.',
    fields: [
      { key: 'serverUrl', label: 'Server', kind: 'url', required: true, placeholder: 'https://gotify.example.com' },
      { key: 'appToken', label: 'Application token', kind: 'text', secret: true, required: true, help: 'Gotify → Apps → create an app, then copy its token.' },
      {
        key: 'priority', label: 'Priority', kind: 'select', defaultValue: '5',
        options: [{ value: '2', label: 'Low' }, { value: '5', label: 'Normal' }, { value: '8', label: 'High' }],
      },
    ],
  },
  webhook: {
    label: 'Webhook',
    description: 'POST each notification as JSON, for Home Assistant or any other automation.',
    fields: [
      {
        key: 'url', label: 'URL', kind: 'url', secret: true, required: true,
        placeholder: 'http://homeassistant.local:8123/api/webhook/…',
        help: 'Kept like a password, since a Home Assistant webhook keeps its key in the address.',
      },
      { key: 'headerName', label: 'Secret header name', kind: 'text', defaultValue: 'X-Helprr-Secret', help: 'Sent with the value below, so the receiver can check the call came from Helprr.' },
      { key: 'headerValue', label: 'Secret header value', kind: 'text', secret: true },
    ],
  },
  apprise: {
    label: 'Apprise',
    description: 'Send through an Apprise API server to any of the services it supports.',
    fields: [
      { key: 'apiUrl', label: 'Apprise API', kind: 'url', required: true, placeholder: 'http://apprise:8000' },
      { key: 'key', label: 'Configuration key', kind: 'text', required: true, defaultValue: 'apprise', help: 'The key your Apprise URLs are saved under.' },
      { key: 'tags', label: 'Tags', kind: 'text', placeholder: 'family, phone', help: 'Only the saved URLs with one of these tags. Leave empty for all.' },
    ],
  },
  email: {
    label: 'Email',
    description: 'Send an email through your SMTP server.',
    fields: [
      { key: 'host', label: 'SMTP server', kind: 'text', required: true, placeholder: 'smtp.example.com' },
      { key: 'port', label: 'Port', kind: 'number', required: true, defaultValue: '587' },
      {
        key: 'security', label: 'Encryption', kind: 'select', required: true, defaultValue: 'starttls',
        options: [{ value: 'starttls', label: 'STARTTLS (port 587)' }, { value: 'tls', label: 'TLS (port 465)' }],
      },
      { key: 'username', label: 'User name', kind: 'text' },
      { key: 'password', label: 'Password', kind: 'text', secret: true, help: 'Use an app password where your provider offers one.' },
      { key: 'from', label: 'From', kind: 'email', required: true, placeholder: 'helprr@example.com' },
      { key: 'to', label: 'To', kind: 'email', required: true, placeholder: 'you@example.com' },
    ],
  },
};

export function isChannelType(value: unknown): value is ChannelType {
  return typeof value === 'string' && (CHANNEL_TYPES as readonly string[]).includes(value);
}

/** What the API returns for a saved channel: never a secret, only which secret fields are set. */
export interface ChannelSummary {
  id: string;
  type: ChannelType;
  name: string;
  enabled: boolean;
  events: string[];
  config: Record<string, string>;
  secretsSet: string[];
  /** The host the channel sends to, for display. */
  destination: string;
  consecutiveFailures: number;
  lastFailedAt: string | null;
  lastSucceededAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export const MAX_CHANNELS_PER_USER = 10;
