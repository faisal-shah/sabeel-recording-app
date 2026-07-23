// Web side of the CSV-export seam (native sibling: exportCsv.ts).
// A Blob + a temporary anchor is the whole browser download story.
import { toCsv } from '@sabeel/shared';

export async function exportCsv(filename: string, rows: string[][]): Promise<void> {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
