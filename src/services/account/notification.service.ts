import 'server-only';

import type { NotificationTopic } from '@/generated/prisma/enums';
import { NOTIFICATION_TOPICS } from '@/features/account/schemas';
import { prisma } from '@/lib/prisma';

/**
 * Notification preferences.
 *
 * A missing row means "the default for that topic", never "off". That distinction
 * is the whole design: an account created before a topic existed must keep
 * receiving its order confirmations, and it would not if absence meant silence.
 */

export interface TopicPreference {
  topic: NotificationTopic;
  label: string;
  description: string;
  essential: boolean;
  email: boolean;
  sms: boolean;
  push: boolean;
}

/** Defaults by topic: transactional on, marketing off until asked for. */
function defaultsFor(topic: (typeof NOTIFICATION_TOPICS)[number]): {
  email: boolean;
  sms: boolean;
  push: boolean;
} {
  return { email: topic.essential, sms: false, push: false };
}

/**
 * Every topic, with the customer's setting or the default.
 *
 * Returns the full list rather than only the stored rows, so the UI renders the
 * same set of switches for a brand-new account as for a ten-year-old one.
 */
export async function getPreferences(userId: string): Promise<TopicPreference[]> {
  const stored = await prisma.notificationPreference.findMany({ where: { userId } });
  const byTopic = new Map(stored.map((row) => [row.topic, row]));

  return NOTIFICATION_TOPICS.map((topic) => {
    const row = byTopic.get(topic.key as NotificationTopic);
    const fallback = defaultsFor(topic);

    return {
      topic: topic.key as NotificationTopic,
      label: topic.label,
      description: topic.description,
      essential: topic.essential,
      email: row?.email ?? fallback.email,
      sms: row?.sms ?? fallback.sms,
      push: row?.push ?? fallback.push,
    };
  });
}

export async function setPreference(
  userId: string,
  topic: NotificationTopic,
  channels: { email: boolean; sms: boolean; push: boolean },
): Promise<void> {
  await prisma.notificationPreference.upsert({
    where: { userId_topic: { userId, topic } },
    update: channels,
    create: { userId, topic, ...channels },
  });

  // The marketing flag on `User` is what the newsletter and any future ESP sync
  // read. Keeping it in step here means there is one answer to "may we market to
  // this person", not two that can disagree.
  if (topic === 'PROMOTIONS' || topic === 'NEWSLETTER') {
    const marketing = await prisma.notificationPreference.findMany({
      where: { userId, topic: { in: ['PROMOTIONS', 'NEWSLETTER'] } },
    });

    await prisma.user.update({
      where: { id: userId },
      data: { acceptsMarketing: marketing.some((row) => row.email) },
    });
  }
}

/** Bulk save from the preferences form. */
export async function setPreferences(
  userId: string,
  preferences: { topic: NotificationTopic; email: boolean; sms: boolean; push: boolean }[],
): Promise<void> {
  for (const preference of preferences) {
    await setPreference(userId, preference.topic, {
      email: preference.email,
      sms: preference.sms,
      push: preference.push,
    });
  }
}

/**
 * Turns off every non-essential topic.
 *
 * The one-click exit that CAN-SPAM effectively requires. Transactional topics
 * survive it — someone who unsubscribes from marketing still needs to be told
 * their order shipped, and stopping that is a support burden, not compliance.
 */
export async function unsubscribeFromMarketing(userId: string): Promise<void> {
  const optional = NOTIFICATION_TOPICS.filter((topic) => !topic.essential);

  for (const topic of optional) {
    await setPreference(userId, topic.key as NotificationTopic, {
      email: false,
      sms: false,
      push: false,
    });
  }

  await prisma.user.update({ where: { id: userId }, data: { acceptsMarketing: false } });
}

/**
 * Whether a given message may be sent.
 *
 * The single gate every send should pass through. Nothing calls it for
 * transactional order mail yet, and that is intentional: a receipt for money
 * taken is not marketing, and making it optional invites someone to switch it off
 * and then dispute the charge.
 */
export async function mayNotify(
  userId: string,
  topic: NotificationTopic,
  channel: 'email' | 'sms' | 'push' = 'email',
): Promise<boolean> {
  const preferences = await getPreferences(userId);
  const match = preferences.find((preference) => preference.topic === topic);
  return match ? match[channel] : false;
}
