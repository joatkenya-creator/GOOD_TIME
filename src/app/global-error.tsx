'use client';

/**
 * Last-resort boundary for errors thrown by the root layout itself.
 *
 * It replaces the whole document, so it must render its own `<html>`/`<body>`
 * and cannot rely on the design system — the failure may be in the very module
 * that provides it. Inline styles only, on purpose.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          display: 'flex',
          minHeight: '100dvh',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          fontFamily: 'system-ui, sans-serif',
          color: '#333333',
          textAlign: 'center',
          padding: '2rem',
        }}
      >
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Something went wrong</h1>
        <p style={{ color: '#6b6b6b', maxWidth: '32rem' }}>
          We could not load the page. Please refresh, or try again shortly.
        </p>
        {error.digest ? (
          <p style={{ fontSize: '0.75rem', color: '#8f8f8f' }}>Reference: {error.digest}</p>
        ) : null}
        <button
          onClick={reset}
          style={{
            marginTop: '0.5rem',
            padding: '0.75rem 1.5rem',
            borderRadius: '0.625rem',
            border: 'none',
            background: '#E91E63',
            color: '#ffffff',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
