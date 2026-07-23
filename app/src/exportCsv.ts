// Native side of the CSV-export seam (web sibling: exportCsv.web.ts).
// The browser can download a file; a phone cannot, so the CSV is written to a
// temp file and handed to the OS share sheet (save to Files, email, etc.).
import * as FileSystem from 'expo-file-system/legacy';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { toCsv } from '@sabeel/shared';

export async function exportCsv(filename: string, rows: string[][]): Promise<void> {
  const uri = (FileSystem.cacheDirectory ?? '') + filename;
  await FileSystem.writeAsStringAsync(uri, toCsv(rows), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  if (await isAvailableAsync()) {
    await shareAsync(uri, { mimeType: 'text/csv', dialogTitle: filename, UTI: 'public.comma-separated-values-text' });
  }
}
