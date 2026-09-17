// Native side of the workbook-export seam (web sibling: exportWorkbook.web.ts).
// A phone cannot download a file: the workbook is written to a temp file and
// handed to the OS share sheet (save to Files, email, open in Sheets).
import * as FileSystem from 'expo-file-system/legacy';
import { isAvailableAsync, shareAsync } from 'expo-sharing';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Base64 without `Buffer`, which React Native does not have. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export async function saveWorkbook(filename: string, bytes: Uint8Array): Promise<void> {
  const uri = (FileSystem.cacheDirectory ?? '') + filename;
  await FileSystem.writeAsStringAsync(uri, toBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (await isAvailableAsync()) {
    await shareAsync(uri, { mimeType: XLSX_MIME, dialogTitle: filename, UTI: 'org.openxmlformats.spreadsheetml.sheet' });
  }
}
