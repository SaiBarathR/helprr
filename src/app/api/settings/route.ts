import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    const settings = await prisma.appSettings.upsert({
      where: { id: 'singleton' },
      update: {},
      create: {
        id: 'singleton',
        pollingIntervalSecs: 30,
        theme: 'dark',
        upcomingAlertHours: 24,
      },
    });

    return NextResponse.json(settings);
  } catch (error) {
    console.error('Failed to fetch settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { pollingIntervalSecs, theme, upcomingAlertHours } = body;

    const data: Record<string, unknown> = {};
    if (pollingIntervalSecs !== undefined)
      data.pollingIntervalSecs = pollingIntervalSecs;
    if (theme !== undefined) data.theme = theme;
    if (upcomingAlertHours !== undefined)
      data.upcomingAlertHours = upcomingAlertHours;

    const settings = await prisma.appSettings.upsert({
      where: { id: 'singleton' },
      update: data,
      create: {
        id: 'singleton',
        pollingIntervalSecs: pollingIntervalSecs ?? 30,
        theme: theme ?? 'dark',
        upcomingAlertHours: upcomingAlertHours ?? 24,
      },
    });

    return NextResponse.json(settings);
  } catch (error) {
    console.error('Failed to update settings:', error);
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    );
  }
}
