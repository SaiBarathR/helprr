import { redactUpstreamText } from '@/lib/manual-downloads/redact';
import { urlsToOrigins } from '@/lib/url-origins';
import type {
  ProwlarrHistoryRecord,
  ProwlarrTestAllResponse,
} from '@/lib/prowlarr-client';

/**
 * Text from Prowlarr shown to users. It quotes the URLs Prowlarr called: an
 * indexer URL can carry the indexer's API key or passkey (in the query or the
 * path), and a grab's download link carries Prowlarr's own key. URLs are cut
 * to their origin, then the usual credential and magnet redaction runs.
 */
export function redactProwlarrText(text: string): string {
  return redactUpstreamText(urlsToOrigins(text));
}

export function redactProwlarrHistoryRecord(record: ProwlarrHistoryRecord): ProwlarrHistoryRecord {
  if (!record.data || typeof record.data !== 'object') return record;
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(record.data)) {
    data[key] = typeof value === 'string' ? redactProwlarrText(value) : value;
  }
  return { ...record, data };
}

/** Rebuilt from the known fields only, so nothing else Prowlarr adds is passed on. */
export function redactProwlarrTestAll(response: ProwlarrTestAllResponse): ProwlarrTestAllResponse {
  return {
    passed: response.passed,
    failed: response.failed,
    hasFailures: response.hasFailures,
    results: response.results.map((result) => ({
      id: result.id,
      isValid: result.isValid,
      validationFailures: result.validationFailures.map((failure) => ({
        propertyName: String(failure.propertyName ?? ''),
        errorMessage: redactProwlarrText(String(failure.errorMessage ?? '')),
        severity: String(failure.severity ?? ''),
      })),
    })),
  };
}
