import { Container } from '@/components/layout/container';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';

/** Default suspense fallback. Route segments override it with a shape-matched one. */
export default function Loading() {
  return (
    <Container as="main" className="py-16" aria-busy="true">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-8 w-56" />
      <SkeletonText className="mt-6 max-w-2xl" lines={3} />
      <Skeleton className="mt-10 h-64 w-full" />
    </Container>
  );
}
