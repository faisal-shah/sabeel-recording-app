import * as DocumentPicker from 'expo-document-picker';

/**
 * Native side of the audio-picker seam (web sibling: filePicker.web.ts).
 *
 * Uploading from a phone is supported: `expo-document-picker` opens the system
 * file browser, and we read the picked file into a Blob the same upload path the
 * web uses. `copyToCacheDirectory` gives a stable `file://` URI that RN's fetch
 * can turn into a Blob for Firebase Storage.
 *
 * (This module is autolinked; no config plugin, so no prebuild is needed — but a
 * native rebuild is, since a new native module was added.)
 */
export const canPickAudio = true;

export async function pickAudioFile(): Promise<Blob | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: 'audio/*',
    copyToCacheDirectory: true,
    multiple: false,
  });
  const asset = res.canceled ? null : res.assets?.[0];
  if (!asset) return null; // user backed out
  const blob = await (await fetch(asset.uri)).blob();
  // Some pickers hand back a typeless blob; carry the picker's mime type so the
  // Storage upload records the right contentType instead of octet-stream.
  if (asset.mimeType && (!blob.type || blob.type === 'application/octet-stream')) {
    return blob.slice(0, blob.size, asset.mimeType);
  }
  return blob;
}
