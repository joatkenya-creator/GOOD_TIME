import { pageQuerySchema } from '@/lib/api/pagination';
import { errors, readQuery, withRoute } from '@/lib/api/handler';

/**
 * `GET /api/blog` — published journal posts.
 *
 * Must filter on `status = PUBLISHED AND publishedAt <= now()`; a scheduled post
 * leaking early through the API is the classic embargo bug.
 */
export const GET = withRoute(
  async ({ request }) => {
    const query = readQuery(request, pageQuerySchema);
    void query;

    throw errors.notImplemented('Blog listing');
  },
  { rateLimit: { bucket: 'blog', limit: 120, windowSeconds: 60 } },
);
