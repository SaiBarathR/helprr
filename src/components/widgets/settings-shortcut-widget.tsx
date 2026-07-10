'use client';

import Link from 'next/link';
import type { SettingsShortcut } from '@/lib/widgets/settings-shortcuts';
import type { WidgetProps } from '@/lib/widgets/types';
import { FONT_DISPLAY, HPR } from './bento-primitives';

/**
 * Static launcher tile for one settings destination. No data fetching — the
 * whole tile is a Link (inert in edit mode). Restructures by measured cell
 * width via container queries: tiny cells (mobile 1×1, ~86px) stack the icon
 * above a small centered label; wider cells lay icon + label + subtitle in a
 * row like the settings index page.
 */
export function SettingsShortcutWidget({
  shortcut,
  editMode = false,
}: WidgetProps & { shortcut: SettingsShortcut }) {
  const Icon = shortcut.icon;

  const inner = (
    <div style={{ height: '100%', minWidth: 0 }}>
      {/* Tiny cell: centered vertical stack */}
      <div
        className="hidden @max-[159px]/cell:flex"
        style={{
          height: '100%',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          minWidth: 0,
        }}
      >
        <div
          className={`${shortcut.iconBg} ${shortcut.iconColor} flex items-center justify-center rounded-lg`}
          style={{ width: 30, height: 30, flexShrink: 0 }}
        >
          <Icon size={15} />
        </div>
        <span
          className="max-w-full truncate"
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 10,
            fontWeight: 600,
            color: HPR.fg,
            letterSpacing: '-0.01em',
          }}
        >
          {shortcut.label}
        </span>
      </div>

      {/* Regular cell: horizontal row, subtitle only when there's room */}
      <div
        className="flex @max-[159px]/cell:hidden"
        style={{ height: '100%', alignItems: 'center', gap: 12, minWidth: 0 }}
      >
        <div
          className={`${shortcut.iconBg} ${shortcut.iconColor} flex items-center justify-center rounded-lg`}
          style={{ width: 38, height: 38, flexShrink: 0 }}
        >
          <Icon size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 14,
              fontWeight: 600,
              color: HPR.fg,
              letterSpacing: '-0.015em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {shortcut.label}
          </div>
          <div
            className="@max-[219px]/cell:hidden"
            style={{
              fontSize: 11,
              color: HPR.fgMute,
              marginTop: 2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {shortcut.subtitle}
          </div>
        </div>
        <div className="@max-[219px]/cell:hidden" style={{ color: HPR.fgSubtle, fontSize: 13, flexShrink: 0 }}>
          →
        </div>
      </div>
    </div>
  );

  if (editMode) return inner;

  return (
    <Link
      href={shortcut.href}
      style={{ textDecoration: 'none', color: 'inherit', display: 'block', height: '100%' }}
    >
      {inner}
    </Link>
  );
}
