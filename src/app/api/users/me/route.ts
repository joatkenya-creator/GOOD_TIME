import { z } from 'zod';

import { errors, readJson, withRoute } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import { assertUser } from '@/server/auth/session';

/**
 * `/api/users/me` — the signed-in customer's own profile.
 *
 * `GET` is implemented because the session already holds everything it returns;
 * `PATCH` waits for the account area in phase 4.
 */
const profileUpdateSchema = z.object({
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  phone: z.string().trim().max(32).optional(),
  acceptsMarketing: z.boolean().optional(),
});

export const GET = withRoute(async () => {
  const user = await assertUser();

  return jsonOk(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      roles: user.roles,
      emailVerified: user.isEmailVerified,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
});

export const PATCH = withRoute(async ({ request }) => {
  await assertUser();
  const update = await readJson(request, profileUpdateSchema);
  void update;

  throw errors.notImplemented('Profile updates');
});
