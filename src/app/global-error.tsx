'use client';

import { useEffect } from 'react';

// Last-resort boundary: replaces the root layout when it (or an error boundary
// above a page) throws. globals.css is not loaded here, so styles are inline.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[App] Unhandled root-layout error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          background: '#0a0a0a',
          color: '#fafafa',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Something went wrong</h2>
        <p style={{ margin: 0, fontSize: 14, color: '#a1a1aa' }}>
          Helprr hit an unexpected error. Your data is fine.
          {error.digest ? ` (Error ID: ${error.digest})` : ''}
        </p>
        <button
          onClick={reset}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: '1px solid #3f3f46',
            background: '#fafafa',
            color: '#0a0a0a',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
