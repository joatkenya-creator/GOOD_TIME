import 'server-only';

import { v2 as cloudinary } from 'cloudinary';

import { errors } from '@/lib/api/errors';
import { env, integrations } from '@/lib/env';

/**
 * Cloudinary — configuration only in phase 1.
 *
 * Uploads are signed server-side and performed by the browser directly against
 * Cloudinary, so large product images never pass through a serverless function
 * (and never hit Vercel's request body limit).
 */
let configured = false;

function client(): typeof cloudinary {
  if (!integrations.cloudinary) throw errors.integrationUnavailable('Cloudinary');

  if (!configured) {
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    configured = true;
  }

  return cloudinary;
}

export interface UploadSignature {
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
  folder: string;
}

/** Short-lived signature the admin uploader hands to the browser. */
export function createUploadSignature(folder = 'products'): UploadSignature {
  const timestamp = Math.round(Date.now() / 1000);
  const signature = client().utils.api_sign_request(
    { timestamp, folder },
    env.CLOUDINARY_API_SECRET!,
  );

  return {
    signature,
    timestamp,
    apiKey: env.CLOUDINARY_API_KEY!,
    cloudName: env.CLOUDINARY_CLOUD_NAME!,
    folder,
  };
}

export async function deleteAsset(publicId: string): Promise<void> {
  await client().uploader.destroy(publicId, { invalidate: true });
}
