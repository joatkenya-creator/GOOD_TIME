import { z } from 'zod';

import { PERMISSIONS } from '@/constants/permissions';
import { readJson, withRoute } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import { createUploadSignature } from '@/lib/integrations/cloudinary';
import { assertPermission } from '@/server/auth/session';

/**
 * `POST /api/admin/media/signature` — signs a direct-to-Cloudinary upload.
 *
 * The browser uploads straight to Cloudinary with this signature, so a 20MB
 * product photo never passes through a serverless function (which caps request
 * bodies at 4.5MB on Vercel).
 */
const bodySchema = z.object({
  folder: z.enum(['products', 'brands', 'collections', 'blog', 'pages']).default('products'),
});

export const POST = withRoute(async ({ request }) => {
  await assertPermission(PERMISSIONS.productWrite);
  const { folder } = await readJson(request, bodySchema);

  return jsonOk(createUploadSignature(folder), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
});
