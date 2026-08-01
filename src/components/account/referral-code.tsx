'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

/**
 * The referral code, with a copy button.
 *
 * `navigator.clipboard` is wrapped: it rejects when the document is not focused
 * or the permission is denied, and an unhandled rejection here would surface as a
 * console error on a button that visibly did nothing.
 */
export function ReferralCodeBlock({ code, uses }: { code: string; uses: number }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the code is on screen and selectable anyway.
    }
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-3">
        <code className="rounded-lg border border-border bg-surface-muted px-4 py-2.5 font-mono text-body tracking-wider text-foreground">
          {code}
        </code>

        <Button variant="secondary" onClick={copy}>
          {copied ? (
            <>
              <Check aria-hidden="true" className="size-4" />
              Copied
            </>
          ) : (
            <>
              <Copy aria-hidden="true" className="size-4" />
              Copy code
            </>
          )}
        </Button>
      </div>

      {/* Announced politely so a screen reader confirms the copy without
          interrupting whatever else is being read. */}
      <p aria-live="polite" className="sr-only">
        {copied ? 'Referral code copied to clipboard.' : ''}
      </p>

      <p className="mt-2 text-body-xs text-foreground-subtle">
        {uses === 0 ? 'Not used yet.' : `Used ${uses} ${uses === 1 ? 'time' : 'times'}.`}
      </p>
    </div>
  );
}
