import { registerSchema } from '@/features/auth/schemas';
import { readJson, withRoute } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import { registerUser } from '@/services/user.service';

/**
 * Account creation for API clients (the future mobile app).
 *
 * The web form uses `registerAction` instead — same service, same rules, but a
 * server action avoids the extra round trip and works without JavaScript.
 */
export const POST = withRoute(
  async ({ request }) => {
    const input = await readJson(request, registerSchema);
    const { userId } = await registerUser(input);

    return jsonOk({ userId, verificationRequired: true }, { status: 201 });
  },
  { rateLimit: { bucket: 'auth:register', limit: 5, windowSeconds: 3600 } },
);
