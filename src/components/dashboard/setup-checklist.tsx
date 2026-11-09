'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { Bell, Check, ChevronRight, DatabaseBackup, Minus, Plug, Smartphone, Users, X, type LucideIcon } from 'lucide-react';
import Link from '@/components/ui/app-link';
import { useIsStandalone } from '@/hooks/use-is-standalone';
import { isIosDevice } from '@/lib/push-availability';
import { Eyebrow, FONT_DISPLAY, FONT_MONO, HPR, mix } from '@/components/widgets/bento-primitives';
import {
  MANUAL_SETUP_STEPS,
  OPTIONAL_SETUP_STEPS,
  SETUP_STEPS,
  setupProgress,
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
    // The check page says what stands in the way (HTTPS, install) and links to Enable.
    href: '/settings/notifications/check',
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
    title: 'Back up the database',
    detail: 'Turn on scheduled backups in Settings, or run backup.sh.',
    href: '/settings/backup',
    icon: DatabaseBackup,
    manualLabel: 'Done',
  },
};

type ChecklistAction = { action: 'dismiss' } | { action: 'restore' } | { action: 'done'; step: SetupStep };

const SMALL_BUTTON: React.CSSProperties = {
  // touch-target's larger hit area is placed against this button.
  position: 'relative',
  flexShrink: 0,
  fontSize: 12,
  fontWeight: 600,
  color: HPR.fgMute,
  background: 'transparent',
  border: `1px solid ${HPR.hairline2}`,
  borderRadius: 7,
  padding: '5px 10px',
};

async function send(body: ChecklistAction): Promise<SetupChecklistState> {
  const res = await fetch('/api/setup-checklist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('checklist update failed');
  return res.json();
}

// Replies can arrive out of order, so one only adds the ticks and skips it saw: a late
// reply never undoes a newer one. Whether the card is hidden is decided here, not by replies.
function mergeReply(prev: SetupChecklistState, reply: SetupChecklistState): SetupChecklistState {
  const done = { ...prev.done };
  for (const step of SETUP_STEPS) done[step] = prev.done[step] || Boolean(reply.done?.[step]);
  const skipped = SETUP_STEPS.filter((step) => prev.skipped?.includes(step) || reply.skipped?.includes(step));
  return { ...prev, done, skipped };
}

// An optional step marked by hand is skipped; any other is done.
function withMark(prev: SetupChecklistState, step: SetupStep, on: boolean): SetupChecklistState {
  if (!OPTIONAL_SETUP_STEPS.has(step)) return { ...prev, done: { ...prev.done, [step]: on } };
  const others = (prev.skipped ?? []).filter((other) => other !== step);
  return { ...prev, skipped: on ? [...others, step] : others };
}

function isPhone(): boolean {
  return isIosDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints) || /Android/.test(navigator.userAgent);
}
const emptySubscribe = () => () => {};

// Loaded on first open: it carries the QR encoder.
const OpenOnPhoneDrawer = dynamic(
  () => import('@/components/settings/open-on-phone').then((module) => module.OpenOnPhoneDrawer),
  { loading: () => null },
);

/** The admin's "what to do next" card at the top of the dashboard. */
export function SetupChecklist({ initial, mobile }: { initial: SetupChecklistState; mobile: boolean }) {
  const [state, setState] = useState(initial);
  // A fresh server render (after router.refresh) brings the real state.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setState(initial);
  }

  const links = useRef<Partial<Record<SetupStep, HTMLAnchorElement | null>>>({});

  const markDone = (step: SetupStep, quiet = false) => {
    setState((prev) => withMark(prev, step, true));
    send({ action: 'done', step })
      .then((reply) => setState((prev) => mergeReply(prev, reply)))
      .catch(() => {
        // Undo only this step: other ticks may have saved meanwhile.
        setState((prev) => withMark(prev, step, false));
        if (!quiet) toast.error('Could not save that. Try again.');
      });
  };
  const markByHand = (step: SetupStep) => {
    markDone(step);
    // The button goes away; keep focus on the step instead of losing it.
    links.current[step]?.focus();
  };
  // Hide and Undo are sent one after the other, so the server ends where the user did.
  const hideQueue = useRef<Promise<void>>(Promise.resolve());
  const hideChanges = useRef(0);
  const setHidden = (hidden: boolean) => {
    const change = ++hideChanges.current;
    setState((prev) => ({ ...prev, hidden }));
    hideQueue.current = hideQueue.current.then(() =>
      send({ action: hidden ? 'dismiss' : 'restore' }).then(
        () => undefined,
        () => {
          // Roll back only if the user has not changed it again since.
          if (hideChanges.current !== change) return;
          setState((prev) => ({ ...prev, hidden: !hidden }));
          toast.error('Could not save that. Try again.');
        },
      ),
    );
    if (hidden) {
      toast('Setup checklist hidden', { action: { label: 'Undo', onClick: () => setHidden(false) } });
    }
  };

  // On a computer, the install step offers a QR code for the phone.
  const onPhone = useSyncExternalStore(emptySubscribe, isPhone, () => true);
  const [phoneOpen, setPhoneOpen] = useState(false);
  // Kept mounted once opened, so closing plays the drawer's slide-down.
  const [phoneOpened, setPhoneOpened] = useState(false);
  const openPhone = () => {
    setPhoneOpened(true);
    setPhoneOpen(true);
  };

  // Opened as an installed app on a phone: the phone step is done. (An installed
  // desktop app window is standalone too, but it is not a phone.)
  const standalone = useIsStandalone();
  const autoMarked = useRef(false);
  useEffect(() => {
    if (!standalone || state.done.install || state.hidden || autoMarked.current || !isPhone()) return;
    autoMarked.current = true;
    markDone('install', true);
  });

  const progress = setupProgress(state.done);
  if (state.hidden || progress.complete) return null;

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
            Getting started ·{' '}
            <span style={{ whiteSpace: 'nowrap' }}>
              <span style={{ fontFamily: FONT_MONO }}>{progress.done} of {progress.total}</span> done
              {/* The comma stays with "done", so a phone that wraps here never starts or ends a line on a separator. */}
              {progress.optionalDone > 0 && ','}
            </span>
            {/* Optional steps are ticked too, so they are counted, apart from the required ones. */}
            {progress.optionalDone > 0 && (
              <>
                {' '}
                <span style={{ whiteSpace: 'nowrap' }}>
                  <span style={{ fontFamily: FONT_MONO }}>+{progress.optionalDone}</span> optional
                </span>
              </>
            )}
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
          onClick={() => setHidden(true)}
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
          const skipped = !done && Boolean(state.skipped?.includes(step));
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
                  background: done ? HPR.amber : skipped ? 'transparent' : mix(HPR.amber, 12),
                  color: done ? HPR.ink : skipped ? HPR.fgSubtle : HPR.amber,
                  border: skipped ? `1px dashed ${HPR.hairline2}` : undefined,
                }}
              >
                {done ? <Check size={15} strokeWidth={2.5} /> : skipped ? <Minus size={14} /> : <Icon size={14} />}
              </span>
              <Link
                ref={(element: HTMLAnchorElement | null) => {
                  links.current[step] = element;
                }}
                href={copy.href}
                className="press-feedback"
                style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', color: 'inherit', textDecoration: 'none' }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: done || skipped ? HPR.fgSubtle : HPR.fg,
                      textDecoration: done ? 'line-through' : 'none',
                    }}
                  >
                    {copy.title}
                    {skipped ? (
                      <span style={{ fontWeight: 400, color: HPR.fgSubtle }}> · Skipped</span>
                    ) : OPTIONAL_SETUP_STEPS.has(step) && (
                      <span style={{ fontWeight: 400, color: HPR.fgSubtle }}> (optional)</span>
                    )}
                    <span className="sr-only">{done ? ', done' : ''}</span>
                  </span>
                  <span style={{ display: 'block', fontSize: 12, color: HPR.fgMute, marginTop: 1 }}>{copy.detail}</span>
                </span>
                {/* Every step opens its settings page; the chevron says so on each row alike. */}
                <ChevronRight size={16} aria-hidden="true" style={{ flexShrink: 0, color: HPR.fgSubtle }} />
              </Link>
              {!done && step === 'install' && !onPhone && (
                <button
                  type="button"
                  className="touch-target press-feedback"
                  aria-label="Show a code to open Helprr on your phone"
                  onClick={openPhone}
                  style={SMALL_BUTTON}
                >
                  Show code
                </button>
              )}
              {!done && !skipped && MANUAL_SETUP_STEPS.has(step) && copy.manualLabel && (
                <button
                  type="button"
                  className="touch-target press-feedback"
                  aria-label={`${copy.manualLabel}: ${copy.title}`}
                  onClick={() => markByHand(step)}
                  style={SMALL_BUTTON}
                >
                  {copy.manualLabel}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {phoneOpened && <OpenOnPhoneDrawer open={phoneOpen} onOpenChange={setPhoneOpen} />}
    </section>
  );
}
