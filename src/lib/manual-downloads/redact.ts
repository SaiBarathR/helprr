import { redact } from '@/lib/logger';

/**
 * Text from Sonarr/Radarr kept on a download and shown to users: a rejection,
 * a queue status message, a failure reason. It can quote a download client or
 * indexer URL, so credentials, tracker passkeys and magnet links are removed.
 */
export function redactUpstreamText(text: string): string {
  return String(redact(text))
    .replace(/magnet:\?[^\s"'<>]+/gi, 'magnet:[REDACTED]')
    .replace(/([?&](?:passkey|authkey|torrent_pass|pid|key|secret|sig|signature|apikey)=)[^&\s"'<>]+/gi, '$1[REDACTED]')
    .replace(/(\/\/[^/\s:@]+:)[^@\s/]+@/g, '$1[REDACTED]@');
}
