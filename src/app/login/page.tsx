'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowRight } from 'lucide-react';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.replace('/');
        router.refresh();
      } else {
        setError('Incorrect password');
      }
    } catch {
      setError('Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  const now = new Date().toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* Ambient projector wash */}
      <div className="lens-flare" />
      <div className="ambient-grain" />

      {/* Marquee strobes — soft amber bands top + bottom */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px] animate-marquee"
        style={{
          background:
            'linear-gradient(90deg, transparent, var(--amber) 30%, var(--amber) 70%, transparent)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] animate-marquee"
        style={{
          background:
            'linear-gradient(90deg, transparent, var(--amber) 30%, var(--amber) 70%, transparent)',
          animationDelay: '0.6s',
        }}
      />

      {/* Editorial chrome — vertical rule + serial code */}
      <div className="pointer-events-none absolute left-6 top-0 bottom-0 hidden md:flex flex-col items-center justify-between py-8 text-[10px] tracked-mid text-muted-foreground/70">
        <span>HELPRR · MMXXVI</span>
        <span className="rotate-180" style={{ writingMode: 'vertical-rl' }}>
          PROJECTION ROOM · ENTRY
        </span>
        <span className="font-mono tabular">{now}</span>
      </div>
      <div className="pointer-events-none absolute right-6 top-0 bottom-0 hidden md:flex flex-col items-center justify-between py-8 text-[10px] tracked-mid text-muted-foreground/70">
        <span className="font-mono tabular">REEL · 01 / 01</span>
        <span style={{ writingMode: 'vertical-rl' }}>
          AUTH · 256 · ENCRYPTED
        </span>
        <span>v · 0 · 1</span>
      </div>

      {/* Centerpiece */}
      <main className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm animate-content-in">
          {/* Eyebrow */}
          <div className="mb-8 flex items-center justify-center gap-3 text-muted-foreground">
            <span className="marquee-dot" />
            <span className="tracked-caps text-[10px]">Now Showing</span>
            <span className="hairline w-8" />
          </div>

          {/* Wordmark */}
          <h1 className="font-display text-center text-[64px] sm:text-[76px] leading-[0.9] tracking-[-0.04em] font-medium">
            <span className="italic">Help</span>
            <span style={{ color: 'var(--amber)' }}>rr</span>
            <span className="text-foreground">.</span>
          </h1>

          {/* Tagline */}
          <p className="mt-5 text-center text-sm text-muted-foreground leading-relaxed">
            A private projection booth for your media library.
            <br />
            Sonarr · Radarr · qBittorrent · Jellyfin.
          </p>

          {/* Hairline */}
          <div className="my-8 hairline hairline-grow" />

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label
                htmlFor="password"
                className="tracked-caps text-muted-foreground flex items-center justify-between"
              >
                <span>Passphrase</span>
                {error && (
                  <span className="text-destructive normal-case tracking-normal text-xs font-medium">
                    {error}
                  </span>
                )}
              </label>
              <div className="group relative">
                <input
                  id="password"
                  type="password"
                  placeholder="••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  required
                  className="w-full bg-transparent border-0 border-b border-border focus:border-primary outline-none px-0 py-3 text-lg font-display tracking-[0.4em] placeholder:text-muted-foreground/40 placeholder:tracking-[0.4em] transition-colors"
                />
                <div
                  className="absolute bottom-0 left-0 h-[2px] bg-primary transition-transform duration-500 origin-left scale-x-0 group-focus-within:scale-x-100"
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !password}
              className="cta-sheen projector-glow group relative w-full flex items-center justify-between gap-2 rounded-full bg-primary text-primary-foreground px-6 py-3.5 text-sm font-semibold tracking-wide transition-all hover:translate-y-[-1px] active:translate-y-0 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
            >
              <span className="tracked-caps text-[11px]">
                {loading ? 'Authenticating' : 'Enter Booth'}
              </span>
              <span className="flex items-center gap-2">
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                )}
              </span>
            </button>
          </form>

          {/* Footer mark */}
          <div className="mt-12 flex items-center justify-center gap-3 text-[10px] tracked-mid text-muted-foreground/60">
            <span className="reel" />
            <span>Self-hosted · No telemetry</span>
          </div>
        </div>
      </main>
    </div>
  );
}
