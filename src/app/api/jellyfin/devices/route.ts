import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { DEVICE_ID } from '@/lib/jellyfin-client';

async function getHandler(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  const capError = await requireCapability('jellyfin.control');
  if (capError) return capError;

  try {
    const client = await getJellyfinClient();
    const devices = await client.getDevices();
    return NextResponse.json({ devices, selfDeviceId: DEVICE_ID });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch devices';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function deleteHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  const capError = await requireCapability('jellyfin.control');
  if (capError) return capError;

  // Distinguish an absent `id` param (→ Delete All) from a present-but-empty one
  // (→ reject). Falling through on `?id=` would silently wipe every device.
  const hasId = request.nextUrl.searchParams.has('id');
  const id = request.nextUrl.searchParams.get('id');

  try {
    const client = await getJellyfinClient();

    // Single device delete
    if (hasId) {
      if (!id) {
        return NextResponse.json({ error: 'Device id cannot be empty' }, { status: 400 });
      }
      // Never delete Helprr's own device — that would revoke our API session.
      if (id === DEVICE_ID) {
        return NextResponse.json(
          { error: "Helprr's own device cannot be deleted" },
          { status: 400 },
        );
      }
      await client.deleteDevice(id);
      return NextResponse.json({ deleted: 1 });
    }

    // Delete All — skip Helprr's own device.
    const devices = await client.getDevices();
    const toDelete = devices.filter((d) => d.Id !== DEVICE_ID);
    for (const device of toDelete) {
      await client.deleteDevice(device.Id);
    }
    return NextResponse.json({ deleted: toDelete.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete device';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/devices');
export const DELETE = withApiLogging(deleteHandler, 'api/jellyfin/devices');
