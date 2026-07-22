/**
 * Native side of the audio-picker seam (web sibling: filePicker.web.ts).
 *
 * Uploading is deliberately web-only for now. It needs a document-picker native
 * module, and the brief describes upload as the staff exception path done from
 * the recording library — not something anyone does from a phone. The screen
 * checks `canPickAudio` and explains rather than showing a button that cannot
 * work.
 *
 * Adding expo-document-picker later is a small change confined to this file —
 * and note it would need a `prebuild`, since config plugins do not run on their
 * own in the bare workflow.
 */
export const canPickAudio = false;

export async function pickAudioFile(): Promise<Blob | null> {
  return null;
}
