'use client';

import { useEffect, useRef } from 'react';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface BufferedLog {
  level: LogLevel;
  message: string;
  metadata?: unknown;
  source?: 'client' | 'service-worker';
}

const SENSITIVE_KEY_PATTERN = /api[-_ ]?key|password|passwd|pwd|secret|token|auth|authorization|cookie|session|vapid|jwt|p256dh|endpoint/i;
const SENSITIVE_VALUE_PATTERN = /(Bearer\s+)[^\s,;]+|(api[_-]?key=)[^&\s]+|(apikey=)[^&\s]+|(password=)[^&\s]+|(token=)[^&\s]+|(sid=)[^;&\s]+/gi;

function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.replace(SENSITIVE_VALUE_PATTERN, (_match, bearer, apiKey, apikey, password, token, sid) =>
      `${bearer || apiKey || apikey || password || token || sid || ''}[REDACTED]`
    );
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message), stack: redact(value.stack) };
  }
  if (depth > 5) return '[MaxDepth]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1, seen));

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redact(item, depth + 1, seen);
  }
  return output;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return redact(value) as string;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(redact(value));
  } catch {
    return String(value);
  }
}

type ClientCaptureState = {
  enabled: boolean;
  buffer: BufferedLog[];
  flushTimer: ReturnType<typeof setTimeout> | null;
};

type ConsoleOriginals = Pick<Console, 'debug' | 'log' | 'info' | 'warn' | 'error'>;

export interface ClientLogCaptureSettingsEvent {
  logEnabled?: boolean;
  logClientConsoleEnabled?: boolean;
}

export const CLIENT_LOG_SETTINGS_EVENT = 'helprr:settings-updated';

export function ClientLogCapture() {
  const originalsRef = useRef<ConsoleOriginals | null>(null);
  const stateRef = useRef<ClientCaptureState>({
    enabled: false,
    buffer: [],
    flushTimer: null,
  });

  useEffect(() => {
    const state = stateRef.current;
    let cancelled = false;

    async function flush(): Promise<void> {
      if (state.flushTimer) {
        clearTimeout(state.flushTimer);
        state.flushTimer = null;
      }
      if (state.buffer.length === 0) return;
      const logs = state.buffer;
      state.buffer = [];
      try {
        await fetch('/api/logs/client', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ logs }),
          keepalive: true,
        });
      } catch {
        // Avoid recursive logging when log upload is unavailable.
      }
    }

    function enqueue(level: LogLevel, args: unknown[], source: 'client' | 'service-worker' = 'client') {
      if (!state.enabled) return;
      const [first, ...rest] = args;
      state.buffer.push({
        level,
        message: stringify(first ?? ''),
        source,
        metadata: {
          args: rest.map((item) => redact(item)),
          page: window.location.href,
          userAgent: navigator.userAgent,
        },
      });
      if (state.buffer.length >= 25) {
        void flush();
      } else if (!state.flushTimer) {
        state.flushTimer = setTimeout(() => void flush(), 2_000);
      }
    }

    function installConsolePatch() {
      if (originalsRef.current) return;
      const originals: ConsoleOriginals = {
        debug: console.debug.bind(console),
        log: console.log.bind(console),
        info: console.info.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
      };
      originalsRef.current = originals;

      console.debug = (...args: unknown[]) => {
        originals.debug(...args);
        enqueue('debug', args);
      };
      console.log = (...args: unknown[]) => {
        originals.log(...args);
        enqueue('info', args);
      };
      console.info = (...args: unknown[]) => {
        originals.info(...args);
        enqueue('info', args);
      };
      console.warn = (...args: unknown[]) => {
        originals.warn(...args);
        enqueue('warn', args);
      };
      console.error = (...args: unknown[]) => {
        originals.error(...args);
        enqueue('error', args);
      };
    }

    function applySettings(settings: ClientLogCaptureSettingsEvent | null | undefined) {
      const globalEnabled = settings?.logEnabled !== false;
      const consoleEnabled = settings?.logClientConsoleEnabled !== false;
      const next = Boolean(globalEnabled && consoleEnabled);
      if (next === state.enabled) return;
      state.enabled = next;
      if (!next && state.buffer.length > 0) {
        state.buffer = [];
        if (state.flushTimer) {
          clearTimeout(state.flushTimer);
          state.flushTimer = null;
        }
      }
    }

    async function refreshFromServer() {
      try {
        const response = await fetch('/api/settings', { cache: 'no-store' });
        if (cancelled || !response.ok) return;
        const settings = (await response.json()) as ClientLogCaptureSettingsEvent;
        applySettings(settings);
      } catch {
        // Silent failure — keep current state.
      }
    }

    installConsolePatch();
    void refreshFromServer();

    const onError = (event: ErrorEvent) => {
      enqueue('error', [event.error || event.message, { filename: event.filename, lineno: event.lineno, colno: event.colno }]);
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      enqueue('error', ['Unhandled promise rejection', event.reason]);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'helprr-sw-log') {
        enqueue(event.data.level || 'info', [event.data.message, event.data.metadata], 'service-worker');
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void flush();
      } else {
        void refreshFromServer();
      }
    };
    const onPageHide = () => {
      void flush();
    };
    const onFocus = () => {
      void refreshFromServer();
    };
    const onSettingsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<ClientLogCaptureSettingsEvent>).detail;
      if (detail) {
        applySettings(detail);
      } else {
        void refreshFromServer();
      }
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('focus', onFocus);
    window.addEventListener(CLIENT_LOG_SETTINGS_EVENT, onSettingsUpdated as EventListener);

    return () => {
      cancelled = true;
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(CLIENT_LOG_SETTINGS_EVENT, onSettingsUpdated as EventListener);
      if (state.flushTimer) {
        clearTimeout(state.flushTimer);
        state.flushTimer = null;
      }
      const originalConsole = originalsRef.current;
      if (originalConsole) {
        console.debug = originalConsole.debug;
        console.log = originalConsole.log;
        console.info = originalConsole.info;
        console.warn = originalConsole.warn;
        console.error = originalConsole.error;
        originalsRef.current = null;
      }
    };
  }, []);

  return null;
}
