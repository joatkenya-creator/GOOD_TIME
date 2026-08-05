'use client';

import { useActionState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  saveNotificationPreferencesAction,
  unsubscribeAllAction,
  type ActionResult,
} from '@/server/actions/account';
import type { TopicPreference } from '@/services/account/notification.service';

/**
 * Notification preferences.
 *
 * A grid of topics down and channels across. SMS and push are rendered but
 * disabled: showing them greyed out sets the expectation that they are coming,
 * where hiding them entirely means nobody knows to ask.
 *
 * Essential topics are marked but not locked. A customer who insists on switching
 * off shipping emails is entitled to — what is not acceptable is switching them
 * off by accident, which the badge and the copy guard against.
 */

const EMPTY: ActionResult = { ok: false, message: '' };

export function NotificationPreferences({ preferences }: { preferences: TopicPreference[] }) {
  const [result, action, pending] = useActionState(
    async (_previous: ActionResult, formData: FormData) =>
      saveNotificationPreferencesAction(formData),
    EMPTY,
  );

  const [unsubResult, unsubscribe, unsubPending] = useActionState(
    async () => unsubscribeAllAction(),
    EMPTY,
  );

  return (
    <div className="space-y-6">
      <form action={action}>
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Choose how you would like to hear from us about each topic.
            </caption>

            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-5 py-3 text-body-sm font-semibold text-foreground">
                  Topic
                </th>
                <th
                  scope="col"
                  className="px-3 py-3 text-center text-body-sm font-semibold text-foreground"
                >
                  Email
                </th>
                <th
                  scope="col"
                  className="px-3 py-3 text-center text-body-sm font-medium text-foreground-subtle"
                >
                  SMS
                </th>
                <th
                  scope="col"
                  className="px-3 py-3 text-center text-body-sm font-medium text-foreground-subtle"
                >
                  Push
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border">
              {preferences.map((preference) => (
                <tr key={preference.topic}>
                  <th scope="row" className="px-5 py-4 font-normal">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-body-sm font-medium text-foreground">
                        {preference.label}
                      </span>
                      {preference.essential ? <Badge variant="neutral">Recommended</Badge> : null}
                    </span>
                    <span className="text-body-xs mt-0.5 block text-foreground-subtle">
                      {preference.description}
                    </span>
                  </th>

                  <td className="px-3 py-4 text-center">
                    <Checkbox
                      name={`${preference.topic}.email`}
                      defaultChecked={preference.email}
                      aria-label={`Email me about ${preference.label}`}
                    />
                  </td>

                  <td className="px-3 py-4 text-center">
                    <Checkbox
                      name={`${preference.topic}.sms`}
                      defaultChecked={preference.sms}
                      disabled
                      aria-label={`Text me about ${preference.label} (not available yet)`}
                    />
                  </td>

                  <td className="px-3 py-4 text-center">
                    <Checkbox
                      name={`${preference.topic}.push`}
                      defaultChecked={preference.push}
                      disabled
                      aria-label={`Push notifications about ${preference.label} (not available yet)`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-body-xs mt-3 text-foreground-subtle">
          SMS and push notifications are not available yet. Email is the only channel we can deliver
          on today.
        </p>

        {result.message ? (
          <div role={result.ok ? 'status' : 'alert'} className="mt-4">
            <Alert variant={result.ok ? 'success' : 'danger'}>{result.message}</Alert>
          </div>
        ) : null}

        <Button type="submit" className="mt-5" isLoading={pending}>
          Save preferences
        </Button>
      </form>

      <form action={unsubscribe} className="rounded-2xl border border-border bg-surface-muted p-5">
        <h2 className="text-body font-semibold text-foreground">Unsubscribe from everything</h2>
        <p className="mt-1 text-body-sm text-foreground-muted">
          Turns off every marketing email in one go. Order, shipping and security messages keep
          coming — you still need to know when something you paid for is on its way.
        </p>

        {unsubResult.message ? (
          <div role="status" className="mt-4">
            <Alert variant={unsubResult.ok ? 'success' : 'danger'}>{unsubResult.message}</Alert>
          </div>
        ) : null}

        <Button type="submit" variant="outline" className="mt-4" isLoading={unsubPending}>
          Unsubscribe from marketing
        </Button>
      </form>
    </div>
  );
}
