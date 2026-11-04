'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Bell, Check, DatabaseBackup, Plug, Smartphone, Users, X, type LucideIcon } from 'lucide-react';
import Link from '@/components/ui/app-link';
import { useIsStandalone } from '@/hooks/use-is-standalone';
import { Eyebrow, FONT_DISPLAY, FONT_MONO, HPR, mix } from '@/components/widgets/bento-primitives';
import {
  MANUAL_SETUP_STEPS,
  OPTIONAL_SETUP_STEPS,
  SETUP_STEPS,
  type SetupChecklistState,
  type SetupStep,
} from '@/lib/setup-checklist-steps';

const STEP_COPY: Record<SetupStep, { title: string; detail: string; href: string; icon: LucideIcon; manualLabel?: string }> = {
  service: {
    title: 'Connect your first service',
    detail: 'Sonarr, Radarr, Jellyfin, qBittorrent and more.',
    href: '/settings/instances',
    icon: Plug,
  },
  people: {
    title: 'Add people',
    detail: 'Give family or friends their own sign-in.',
    href: '/settings/users',
    icon: Users,
    manualLabel: 'Skip',
  },
  push: {
    title: 'Turn on push notifications',
    detail: 'Hear about downloads and new episodes.',
    href: '/settings/notifications',
    icon: Bell,
  },
  install: {
    title: 'Install on your phone',
    detail: 'Add Helprr to your home screen; iPhone needs it for push.',
    href: '/settings/appearance#install',
    icon: Smartphone,
    manualLabel: 'Done',
  },
  backup: {
    title: 'Export a backup',
    detail: 'Save your connections and settings to a file.',
    href: '/settings/backup',
    icon: DatabaseBackup,
    manualLabel: 'Done',
  },
};

async function send(body: { action: 'dismiss' } | { action: 'done'; step: SetupStep }): Promise<SetupChecklistState> {
  const res = await fetch('/api/setup-checklist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('checklist update failed');
  return res.json();
}

/** The admin's "what to do next" card at the top of the dashboard. */
export function SetupChecklist({ initial, mobile }: { initial: SetupChecklistState; mobile: boolean }) {
  const [state, setState] = useState(initial);
  // A fresh server render (after router.refresh) brings the real state.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setState(initial);
  }

  const update = (optimistic: SetupChecklistState, body: Parameters<typeof send>[0], quiet = false) => {
    const before = state;
    setState(optimistic);
    send(body)
      .then(setState)
      .catch(() => {
        setState(before);
        if (!quiet) toast.error('Could not save that. Try again.');
      });
  };
  const markDone = (step: SetupStep, quiet = false) =>
    update({ ...state, done: { ...state.done, [step]: true } }, { action: 'done', step }, quiet);

  // Opened as an installed app: this device is installed, so the step is done.
  const standalone = useIsStandalone();
  const autoMarked = useRef(false);
  useEffect(() => {
    if (!standalone || state.done.install || state.hidden || autoMarked.current) return;
    autoMarked.current = true;
    markDone('install', true);
  });

  const required = SETUP_STEPS.filter((step) => !OPTIONAL_SETUP_STEPS.has(step));
  const doneCount = required.filter((step) => state.done[step]).length;
  if (state.hidden || doneCount === required.length) return null;

  return (
    <section
      aria-labelledby="setup-checklist-title"
      data-bento-cell=""
      style={{
        background: HPR.surface,
        border: `1px solid ${HPR.hairline}`,
        borderRadius: 10,
        padding: mobile ? '12px 12px 6px' : '14px 16px 10px',
        marginBottom: mobile ? 10 : 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <Eyebrow>
            Getting started · <span style={{ fontFamily: FONT_MONO }}>{doneCount} of {required.length}</span> done
          </Eyebrow>
          <h2
            id="setup-checklist-title"
            style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 18, letterSpacing: '-0.015em', color: HPR.fg, margin: '4px 0 0' }}
          >
            Set up Helprr
          </h2>
        </div>
        <button
          type="button"
          aria-label="Hide the setup checklist"
          title="Hide"
          className="touch-target press-feedback"
          onClick={() => update({ ...state, hidden: true }, { action: 'dismiss' })}
          style={{
            // touch-target's larger hit area is placed against this button.
            position: 'relative',
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: 8,
            color: HPR.fgMute,
            background: 'transparent',
            border: `1px solid ${HPR.hairline}`,
          }}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <ol
        style={{
          listStyle: 'none',
          margin: '10px 0 0',
          padding: 0,
          display: 'grid',
          gridTemplateColumns: mobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))',
          columnGap: 14,
        }}
      >
        {SETUP_STEPS.map((step) => {
          const copy = STEP_COPY[step];
          const done = state.done[step];
          const Icon = copy.icon;
          return (
            <li
              key={step}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                minHeight: 52,
                padding: '6px 0',
                borderTop: `1px solid ${HPR.hairline}`,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: done ? HPR.amber : mix(HPR.amber, 12),
                  color: done ? HPR.ink : HPR.amber,
                }}
              >
                {done ? <Check size={15} strokeWidth={2.5} /> : <Icon size={14} />}
              </span>
              <Link
                href={copy.href}
                className="press-feedback"
                style={{ flex: 1, minWidth: 0, display: 'block', padding: '4px 0', color: 'inherit', textDecoration: 'none' }}
              >
                <span
                  style={{
                    display: 'block',
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: done ? HPR.fgSubtle : HPR.fg,
                    textDecoration: done ? 'line-through' : 'none',
                  }}
                >
                  {copy.title}
                  {OPTIONAL_SETUP_STEPS.has(step) && (
                    <span style={{ fontWeight: 400, color: HPR.fgSubtle }}> (optional)</span>
                  )}
                  <span className="sr-only">{done ? ', done' : ''}</span>
                </span>
                <span style={{ display: 'block', fontSize: 12, color: HPR.fgMute, marginTop: 1 }}>{copy.detail}</span>
              </Link>
              {!done && MANUAL_SETUP_STEPS.has(step) && copy.manualLabel && (
                <button
                  type="button"
                  className="touch-target press-feedback"
                  aria-label={`${copy.manualLabel}: ${copy.title}`}
                  onClick={() => markDone(step)}
                  style={{
                    position: 'relative',
                    flexShrink: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    color: HPR.fgMute,
                    background: 'transparent',
                    border: `1px solid ${HPR.hairline2}`,
                    borderRadius: 7,
                    padding: '5px 10px',
                  }}
                >
                  {copy.manualLabel}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
