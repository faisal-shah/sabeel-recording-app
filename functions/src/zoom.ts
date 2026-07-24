import { defineSecret } from 'firebase-functions/params';
import { getStorage } from 'firebase-admin/storage';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';

/**
 * Zoom cloud-recording import — the Server-to-Server OAuth client.
 *
 * The three credentials live in Secret Manager and are bound to the Zoom
 * callables; `process.env.ZOOM_*` is populated at runtime only there. Nothing
 * here logs a secret or a token. The network surface is behind `ZoomClient` so
 * the import logic can take a fake in emulator tests (there is no real Zoom in
 * the emulator).
 */
const ZOOM_ACCOUNT_ID = defineSecret('ZOOM_ACCOUNT_ID');
const ZOOM_CLIENT_ID = defineSecret('ZOOM_CLIENT_ID');
const ZOOM_CLIENT_SECRET = defineSecret('ZOOM_CLIENT_SECRET');
export const ZOOM_SECRETS = [ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET];

/** The single central Sabeel Zoom user whose recordings we import (locked decision). */
const ZOOM_SOURCE_EMAIL = 'marketing@oursabeel.com';

/** A meeting that has an audio-only M4A, normalized to what the picker + import need. */
export interface ZoomAudioRecording {
  meetingUuid: string;
  topic: string;
  startTime: string; // ISO 8601
  durationSec: number;
  fileId: string; // the audio_only M4A file's id
  sizeBytes: number;
}

export interface ZoomClient {
  /** Recordings (with an audio-only M4A) for the source user, newest first. */
  listAudioRecordings(fromDate: string, toDate: string): Promise<ZoomAudioRecording[]>;
  /** Re-read one meeting at import time for a FRESH download URL (they expire). */
  freshAudioFile(
    meetingUuid: string,
    fileId: string,
  ): Promise<{ rec: ZoomAudioRecording; downloadUrl: string }>;
  /** Stream the file straight into Storage (bounded copy — never buffered whole). */
  streamToStorage(downloadUrl: string, storagePath: string): Promise<void>;
}

// ---- Zoom response shapes (only the fields we read) ----
interface ZoomFile {
  id?: string;
  status?: string;
  recording_type?: string;
  file_type?: string;
  file_extension?: string;
  file_size?: number;
  recording_start?: string;
  recording_end?: string;
  download_url?: string;
}
export interface ZoomMeeting {
  uuid?: string;
  topic?: string;
  start_time?: string;
  duration?: number; // minutes
  recording_files?: ZoomFile[];
}
interface ZoomListResp {
  meetings?: ZoomMeeting[];
  next_page_token?: string;
}

// ---- token, cached in module memory across warm invocations ----
let cachedToken: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - Date.now() > 5 * 60_000) return cachedToken.token;
  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  if (!accountId || !clientId || !clientSecret) throw new Error('Zoom secrets are not configured.');
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    { method: 'POST', headers: { Authorization: `Basic ${basic}` } },
  );
  if (!res.ok) throw new Error(`Zoom token mint failed (HTTP ${res.status}).`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.token;
}

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) throw new Error(`Zoom API ${res.status} for ${new URL(url).pathname}.`);
  return (await res.json()) as T;
}

/** Pick the audio-only M4A out of a meeting's files, or null if there isn't one. */
function audioFileOf(m: ZoomMeeting): ZoomFile | null {
  const files = m.recording_files ?? [];
  return (
    files.find(
      (f) =>
        (f.status ?? 'completed') === 'completed' &&
        (f.recording_type === 'audio_only' || (f.file_extension ?? f.file_type) === 'M4A'),
    ) ?? null
  );
}

function fileDurationSec(f: ZoomFile, m: ZoomMeeting): number {
  if (f.recording_start && f.recording_end) {
    const d = (Date.parse(f.recording_end) - Date.parse(f.recording_start)) / 1000;
    if (Number.isFinite(d) && d > 0) return Math.round(d);
  }
  return Math.round((m.duration ?? 0) * 60);
}

function toRecording(m: ZoomMeeting, f: ZoomFile): ZoomAudioRecording {
  return {
    meetingUuid: m.uuid ?? '',
    topic: m.topic ?? '',
    startTime: m.start_time ?? '',
    durationSec: fileDurationSec(f, m),
    fileId: f.id ?? '',
    sizeBytes: f.file_size ?? 0,
  };
}

/**
 * A meeting → a normalized audio row, or null if it has no audio-only file.
 * Pure (no network) — the one bit of Zoom-JSON parsing worth unit-testing, since
 * the fake client used in integration tests hands back already-normalized rows.
 */
export function pickAudioRecording(m: ZoomMeeting): ZoomAudioRecording | null {
  const f = audioFileOf(m);
  return f ? toRecording(m, f) : null;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export const zoomClient: ZoomClient = {
  async listAudioRecordings(fromDate, toDate) {
    const from = new Date(`${fromDate}T00:00:00Z`);
    const to = new Date(`${toDate}T00:00:00Z`);
    const byUuid = new Map<string, ZoomAudioRecording>();
    // Zoom caps each query at ~1 month, so walk the range in 30-day windows.
    for (let start = new Date(from); start < to; ) {
      const end = new Date(Math.min(to.getTime(), start.getTime() + 30 * 86_400_000));
      let pageToken = '';
      do {
        const url = new URL(
          `https://api.zoom.us/v2/users/${encodeURIComponent(ZOOM_SOURCE_EMAIL)}/recordings`,
        );
        url.searchParams.set('from', ymd(start));
        url.searchParams.set('to', ymd(end));
        url.searchParams.set('page_size', '300');
        if (pageToken) url.searchParams.set('next_page_token', pageToken);
        const body = await api<ZoomListResp>(url.toString());
        for (const m of body.meetings ?? []) {
          const rec = pickAudioRecording(m);
          if (rec && rec.meetingUuid) byUuid.set(rec.meetingUuid, rec);
        }
        pageToken = body.next_page_token ?? '';
      } while (pageToken);
      start = new Date(end.getTime() + 86_400_000);
    }
    return [...byUuid.values()].sort((a, b) => b.startTime.localeCompare(a.startTime));
  },

  async freshAudioFile(meetingUuid, fileId) {
    // A UUID with a leading '/' or an embedded '//' must be DOUBLE url-encoded.
    const encoded = encodeURIComponent(encodeURIComponent(meetingUuid));
    const m = await api<ZoomMeeting>(`https://api.zoom.us/v2/meetings/${encoded}/recordings`);
    const files = m.recording_files ?? [];
    const f = files.find((x) => x.id === fileId) ?? audioFileOf(m);
    if (!f || !f.download_url) throw new Error('That Zoom recording no longer has a downloadable audio file.');
    return { rec: toRecording(m, f), downloadUrl: f.download_url };
  },

  async streamToStorage(downloadUrl, storagePath) {
    let res = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${await accessToken()}` } });
    if (res.status === 401) {
      const u = new URL(downloadUrl);
      u.searchParams.set('access_token', await accessToken());
      res = await fetch(u.toString());
    }
    if (!res.ok || !res.body) throw new Error(`Zoom download failed (HTTP ${res.status}).`);
    const file = getStorage().bucket().file(storagePath);
    await pipeline(
      Readable.fromWeb(res.body as ReadableStream<Uint8Array>),
      file.createWriteStream({ resumable: false, metadata: { contentType: 'audio/mp4' } }),
    );
  },
};
