// Service connections section of a settings import.

import type { Prisma, ServiceType } from '@prisma/client';
import { parseCustomHeaders, isServiceType } from '@/lib/service-connection-secrets';
import { isArrType } from '@/lib/arr-instances';
import { findServiceByType } from '@/lib/settings/service-config';
import type { ExportedServiceConnection } from '@/lib/settings-export';

export async function applyServiceConnectionInTxn(
  tx: Prisma.TransactionClient,
  conn: ExportedServiceConnection,
  skipped: string[]
): Promise<ServiceType | null> {
  if (typeof conn.type !== 'string' || !isServiceType(conn.type)) {
    skipped.push(`Skipped service: invalid type "${String(conn.type)}"`);
    return null;
  }
  if (typeof conn.url !== 'string' || conn.url.trim().length === 0) {
    skipped.push(`Skipped ${conn.type}: missing URL`);
    return null;
  }
  const url = conn.url.trim().replace(/\/+$/, '');
  const externalUrl = typeof conn.externalUrl === 'string' && conn.externalUrl.trim().length > 0
    ? conn.externalUrl.trim().replace(/\/+$/, '')
    : null;
  const username = typeof conn.username === 'string' && conn.username.length > 0
    ? conn.username
    : conn.type === 'QBITTORRENT' ? 'admin' : null;

  // Multi-instance: arr connections are identified by (type, label); other types
  // are the single connection of their type. Older (pre-multi-instance) exports
  // carry no label — arr connections fall back to the type name (the same value
  // manual-fixups backfills existing rows to), so a legacy single-instance backup
  // restores onto (and idempotently updates) the migrated connection instead of
  // being skipped or duplicated. Single-instance types match by type alone, so
  // their label is cosmetic.
  const isArr = isArrType(conn.type);
  const rawLabel = typeof conn.label === 'string' ? conn.label.trim() : '';
  const label = isArr
    ? (rawLabel || conn.type)
    : (rawLabel || findServiceByType(conn.type)?.label || conn.type);

  const existing = isArr
    ? await tx.serviceConnection.findFirst({ where: { type: conn.type, label } })
    : await tx.serviceConnection.findFirst({ where: { type: conn.type } });
  const apiKey = typeof conn.apiKey === 'string' && conn.apiKey.length > 0
    ? conn.apiKey
    : existing?.apiKey ?? null;

  if (!apiKey) {
    skipped.push(`Skipped ${conn.type}: no API key in file and no existing connection`);
    return null;
  }

  const accessToken = typeof conn.accessToken === 'string' && conn.accessToken.length > 0
    ? conn.accessToken
    : existing?.accessToken ?? null;
  const refreshToken = typeof conn.refreshToken === 'string' && conn.refreshToken.length > 0
    ? conn.refreshToken
    : existing?.refreshToken ?? null;
  // Present with at least one valid header → restore; absent, empty, or
  // all-invalid → leave any existing headers untouched (a hand-edited or empty
  // map must not silently wipe stored proxy headers). A normal export writes
  // null when there are none, so legit round-trips are unaffected. Not gated by
  // HELPRR_CUSTOM_HEADERS: restoring data is independent of whether sending is on.
  const parsedHeaders = conn.customHeaders != null ? parseCustomHeaders(conn.customHeaders) : null;
  const customHeaders = parsedHeaders && Object.keys(parsedHeaders).length > 0 ? parsedHeaders : null;

  if (existing) {
    await tx.serviceConnection.update({
      where: { id: existing.id },
      data: {
        url, apiKey, username, label, externalUrl,
        ...(accessToken !== null && { accessToken }),
        ...(refreshToken !== null && { refreshToken }),
        ...(customHeaders !== null && { customHeaders }),
      },
    });
  } else {
    // A label-less arr export (a pre-multi-instance backup) restored into a DB that
    // already has instances of this type can't be matched to a specific instance, so
    // it lands as a new one labeled by type. Warn so the operator can spot a possible
    // duplicate of an existing instance instead of it being created silently.
    if (isArr && rawLabel === '') {
      const sameTypeCount = await tx.serviceConnection.count({ where: { type: conn.type } });
      if (sameTypeCount > 0) {
        skipped.push(`Imported ${conn.type} as a new instance "${label}" (backup predates instance labels) — verify it isn't a duplicate of an existing ${conn.type} instance.`);
      }
    }
    await tx.serviceConnection.create({
      data: {
        type: conn.type, label, isDefault: conn.isDefault === true, url, apiKey, username, externalUrl,
        ...(accessToken !== null && { accessToken }),
        ...(refreshToken !== null && { refreshToken }),
        ...(customHeaders !== null && { customHeaders }),
      },
    });
  }
  return conn.type;
}
