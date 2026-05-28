import { ProtocolRouter } from '@/components/share/protocol-router';

interface ProtocolPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const dynamic = 'force-dynamic';

/**
 * Endpoint for the manifest `protocol_handlers` entry (web+helprr scheme),
 * iOS Shortcuts, and any external automation that wants to invoke a Helprr
 * action via URL.
 *
 * Two query-string shapes are accepted:
 *   /protocol?cmd=watchlist|request|discover&...
 *   /protocol?u=<full custom-scheme URL>   (manifest protocol_handlers form)
 *
 * The actual routing runs client-side so action POSTs carry the user's cookies
 * and follow normal toast/error feedback.
 */
export default async function ProtocolPage({ searchParams }: ProtocolPageProps) {
  const params = await searchParams;
  const cmd = pickString(params.cmd);
  const u = pickString(params.u);

  let resolvedCmd = cmd;
  let resolvedParams: Record<string, string> = {};

  if (u && !resolvedCmd) {
    const parsed = parseSchemeUrl(u);
    if (parsed) {
      resolvedCmd = parsed.cmd;
      resolvedParams = parsed.params;
    }
  }

  // Mirror the loose key/value bag for the client component, dropping `cmd`
  // and `u` which we already pulled out.
  for (const [key, value] of Object.entries(params)) {
    if (key === 'cmd' || key === 'u') continue;
    const single = pickString(value);
    if (single !== undefined && !(key in resolvedParams)) resolvedParams[key] = single;
  }

  return <ProtocolRouter command={resolvedCmd ?? null} params={resolvedParams} />;
}

function pickString(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

function parseSchemeUrl(u: string): { cmd: string; params: Record<string, string> } | null {
  // Accept web+helprr://path?query or helprr://path?query.
  const match = u.match(/^(?:web\+)?helprr:\/\/([^?#]*)(?:\?([^#]*))?/i);
  if (!match) return null;
  const path = (match[1] ?? '').replace(/^\/+/, '');
  const cmd = path.split('/')[0] || 'discover';
  const params: Record<string, string> = {};
  if (match[2]) {
    for (const [key, value] of new URLSearchParams(match[2])) {
      params[key] = value;
    }
  }
  // Capture remaining path segments as positional args, e.g. helprr://watchlist/add/12345
  const rest = path.split('/').slice(1).filter(Boolean);
  if (rest.length > 0) params.args = rest.join('/');
  return { cmd, params };
}
