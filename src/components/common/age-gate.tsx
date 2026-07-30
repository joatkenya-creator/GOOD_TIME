'use client';

import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import { siteConfig } from '@/config/site';
import { ROUTES } from '@/constants/routes';
import { AGE_OK_ATTRIBUTE, readAgeConsent, writeAgeConsent } from '@/lib/age-gate';

/**
 * Age gate.
 *
 * Reasoning behind the approach lives in `src/lib/age-gate.ts` — the short
 * version is that the page renders beneath this so the catalogue stays
 * indexable, and the flash is prevented by an inline head script rather than by
 * making the route dynamic.
 *
 * Built on a native `<dialog>` opened with `showModal()`, which gives the three
 * things a gate actually needs: a focus trap, an `inert` background that cannot
 * be tabbed or clicked into, and top-layer stacking no `z-index` can defeat.
 * Escape and backdrop clicks are both suppressed.
 */

/** Cookie state as an external store — no `setState` inside an effect. */
const listeners = new Set<() => void>();
let cached: boolean | null = null;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot(): boolean {
  cached ??= readAgeConsent();
  return cached;
}

/**
 * The server assumes consent is absent, so the gate is present in the streamed
 * HTML. The head script hides it before paint for returning visitors, so this
 * pessimistic default costs nothing visually.
 */
function getServerSnapshot(): boolean {
  return false;
}

function grantConsent(): void {
  writeAgeConsent();
  cached = true;
  for (const listener of listeners) listener();
}

export function AgeGate() {
  const consented = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [declined, setDeclined] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!consented && !dialog.open) dialog.showModal();
    if (consented && dialog.open) dialog.close();
  }, [consented]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    // Escape must not dismiss an age gate.
    const block = (event: Event) => event.preventDefault();
    dialog.addEventListener('cancel', block);
    return () => dialog.removeEventListener('cancel', block);
  }, []);

  // Lock the page behind the gate; `<dialog>` alone does not stop iOS scrolling.
  useEffect(() => {
    if (consented) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [consented]);

  if (consented) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="age-gate-title"
      aria-describedby="age-gate-description"
      // `data-age-gate` is the hook the head script's CSS rule targets, so a
      // returning visitor never sees this even for one frame.
      data-age-gate=""
      className="w-[calc(100vw-2rem)] max-w-md rounded-2xl bg-surface p-0 text-foreground shadow-xl backdrop:bg-ink-900/80 backdrop:backdrop-blur-md"
    >
      <div className="p-7 text-center sm:p-9">
        <span
          aria-hidden="true"
          className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent-text"
        >
          <ShieldCheck className="size-6" strokeWidth={1.75} />
        </span>

        <p className="mt-6 font-display text-xl tracking-tight text-foreground">
          {siteConfig.name}
        </p>

        {declined ? (
          <>
            <h2 id="age-gate-title" className="mt-4 text-display-sm text-foreground">
              Come back when you&apos;re {siteConfig.minimumAge}
            </h2>

            <p
              id="age-gate-description"
              className="mt-3 text-body-sm leading-relaxed text-foreground-muted"
            >
              This shop sells products intended for adults only, so we can&apos;t let you browse
              yet. Thanks for being honest.
            </p>

            <Button variant="outline" fullWidth className="mt-7" onClick={() => setDeclined(false)}>
              I entered that by mistake
            </Button>
          </>
        ) : (
          <>
            <h2 id="age-gate-title" className="mt-4 text-display-sm text-foreground">
              Are you {siteConfig.minimumAge} or older?
            </h2>

            <p
              id="age-gate-description"
              className="mt-3 text-body-sm leading-relaxed text-foreground-muted"
            >
              This shop sells sex toys and is intended for adults. Please confirm your age to
              continue.
            </p>

            <div className="mt-7 flex flex-col gap-3">
              {/* Primary action first in the DOM, so it is the first tab stop. */}
              <Button size="lg" fullWidth onClick={grantConsent}>
                Yes, I&apos;m {siteConfig.minimumAge} or older
              </Button>

              <Button size="lg" variant="ghost" fullWidth onClick={() => setDeclined(true)}>
                No, I&apos;m under {siteConfig.minimumAge}
              </Button>
            </div>

            <p className="mt-6 text-xs leading-relaxed text-foreground-subtle">
              By continuing you agree to our{' '}
              <Link
                href={ROUTES.page('terms')}
                className="underline underline-offset-2 hover:text-foreground"
              >
                terms
              </Link>{' '}
              and{' '}
              <Link
                href={ROUTES.page('privacy')}
                className="underline underline-offset-2 hover:text-foreground"
              >
                privacy policy
              </Link>
              . We store a single cookie to remember this answer.
            </p>
          </>
        )}
      </div>
    </dialog>
  );
}

/** Re-exported so the root layout can stamp the attribute name into its script. */
export { AGE_OK_ATTRIBUTE };
