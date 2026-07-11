import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getVapidPublicKey } from '@/lib/vapid';
import { withApiLogging } from '@/lib/api-logger';

// Serves the install's VAPID public key at runtime so the prebuilt image works
// without baking the key in at build time. `publicKey` is null when Web Push
// isn't configured; clients surface that as "not configured".
async function getHandler() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  return NextResponse.json({ publicKey: getVapidPublicKey() });
}

export const GET = withApiLogging(getHandler, 'api/push/public-key');
