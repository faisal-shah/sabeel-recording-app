import { randomUUID } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';
import { EMULATOR_PROJECT_ID, EMULATOR_STORAGE_BUCKET, SIGNED_URL_TTL_MS } from '@sabeel/shared';

/**
 * Mint a time-limited URL for a stored audio object.
 *
 * Two paths, and the difference between them is the single most dangerous seam
 * in this codebase:
 *
 *  - **Production** signs a V4 URL with the runtime service account, through the
 *    IAM Credentials API. It expires, which is the whole requirement:
 *    `getDownloadURL()` was rejected precisely because its token never does.
 *  - **Emulator** returns the emulator's own object URL, because the Storage
 *    emulator has NO signing service. There is nothing to sign with, and a URL
 *    it did produce would point at real GCS where the object does not exist.
 *
 * That means the production path is unexercised by every local test — the
 * canonical "works in dev, 403s in production" shape. Two things guard it:
 *
 *  1. The branch keys off the running project being the DEMO project, not off a
 *     bare env var, so the emulator path cannot be reached against a real one.
 *  2. It THROWS rather than falling back if signing fails. A silent fallback to
 *     an unsigned or permanent URL would be a data leak wearing the costume of
 *     a working feature.
 */
function isEmulatorProject(): boolean {
  return (process.env.GCLOUD_PROJECT ?? '') === EMULATOR_PROJECT_ID;
}

export interface SignedPlayback {
  url: string;
  expiresAt: number;
}

export async function signedPlaybackUrl(
  path: string,
  ttlMs: number = SIGNED_URL_TTL_MS,
): Promise<SignedPlayback> {
  const expiresAt = Date.now() + ttlMs;

  if (isEmulatorProject()) {
    const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199';
    const file = getStorage().bucket().file(path);

    // A plain `?alt=media` URL is RULES-GOVERNED, and storage.rules denies all
    // reads — deliberately, since production playback bypasses rules by being
    // signed. So the emulator needs the one thing that also bypasses them: a
    // download token.
    //
    // That token is exactly the mechanism rejected for production, because it
    // never expires. It is acceptable here only because this branch cannot run
    // against a real project. Do not be tempted to reuse it there — a
    // non-expiring link is the single requirement the threat model rules out.
    const [meta] = await file.getMetadata();
    let token = (meta.metadata?.firebaseStorageDownloadTokens as string | undefined) ?? '';
    if (!token) {
      token = randomUUID();
      await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
    }

    return {
      url: `http://${host}/v0/b/${EMULATOR_STORAGE_BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=${token}`,
      expiresAt,
    };
  }

  const [url] = await getStorage()
    .bucket()
    .file(path)
    .getSignedUrl({ version: 'v4', action: 'read', expires: expiresAt });
  return { url, expiresAt };
}
