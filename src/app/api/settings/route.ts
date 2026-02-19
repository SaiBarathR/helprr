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
        dashboardRefreshIntervalSecs: 5,
        activityRefreshIntervalSecs: 5,
        torrentsRefreshIntervalSecs: 5,
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
    const {
      pollingIntervalSecs, theme, upcomingAlertHours,
      dashboardRefreshIntervalSecs, activityRefreshIntervalSecs, torrentsRefreshIntervalSecs,
      upcomingNotifyMode, upcomingNotifyBeforeMins, upcomingDailyNotifyHour,
    } = body;

    const data: Record<string, unknown> = {};
    if (pollingIntervalSecs !== undefined)
      data.pollingIntervalSecs = pollingIntervalSecs;
    if (dashboardRefreshIntervalSecs !== undefined)
      data.dashboardRefreshIntervalSecs = dashboardRefreshIntervalSecs;
    if (activityRefreshIntervalSecs !== undefined)
      data.activityRefreshIntervalSecs = activityRefreshIntervalSecs;
    if (torrentsRefreshIntervalSecs !== undefined)
      data.torrentsRefreshIntervalSecs = torrentsRefreshIntervalSecs;
    if (theme !== undefined) data.theme = theme;
    if (upcomingAlertHours !== undefined)
      data.upcomingAlertHours = upcomingAlertHours;
    if (upcomingNotifyMode !== undefined)
      data.upcomingNotifyMode = upcomingNotifyMode;
    if (upcomingNotifyBeforeMins !== undefined)
      data.upcomingNotifyBeforeMins = upcomingNotifyBeforeMins;
    if (upcomingDailyNotifyHour !== undefined)
      data.upcomingDailyNotifyHour = upcomingDailyNotifyHour;

    const settings = await prisma.appSettings.upsert({
      where: { id: 'singleton' },
      update: data,
      create: {
        id: 'singleton',
        pollingIntervalSecs: pollingIntervalSecs ?? 30,
        dashboardRefreshIntervalSecs: dashboardRefreshIntervalSecs ?? 5,
        activityRefreshIntervalSecs: activityRefreshIntervalSecs ?? 5,
        torrentsRefreshIntervalSecs: torrentsRefreshIntervalSecs ?? 5,
        theme: theme ?? 'dark',
        upcomingAlertHours: upcomingAlertHours ?? 24,
        upcomingNotifyMode: upcomingNotifyMode ?? 'before_air',
        upcomingNotifyBeforeMins: upcomingNotifyBeforeMins ?? 60,
        upcomingDailyNotifyHour: upcomingDailyNotifyHour ?? 9,
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
