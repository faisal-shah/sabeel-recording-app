// Web side of the CSV-export seam (native sibling: exportCsv.ts).
// A Blob + a temporary anchor is the whole browser download story.
import { csvFilename, toCsv } from '@sabeel/shared';

export async function exportCsv(filename: string, rows: string[][]): Promise<void> {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = csvFilename(filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick, not synchronously: a browser that starts the
  // download after the click returns finds the URL already gone otherwise.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
