import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Bell,
  CalendarDays,
  Film,
  HardDrive,
  LayoutDashboard,
  Search,
  Settings,
  Tv,
} from 'lucide-react';
import type { NavIconKey } from '@/lib/navigation-config';

export const NAV_ICON_MAP: Record<NavIconKey, LucideIcon> = {
  layoutDashboard: LayoutDashboard,
  film: Film,
  tv: Tv,
  calendarDays: CalendarDays,
  hardDrive: HardDrive,
  search: Search,
  activity: Activity,
  bell: Bell,
  settings: Settings,
};
