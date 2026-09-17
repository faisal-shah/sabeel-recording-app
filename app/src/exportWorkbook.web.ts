// Web side of the workbook-export seam (native sibling: exportWorkbook.ts).
// A Blob + a temporary anchor is the whole browser download story.
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function saveWorkbook(filename: string, bytes: Uint8Array): Promise<void> {
  const blob = new Blob([bytes as BlobPart], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick, not synchronously: a browser that starts the
  // download after the click returns finds the URL already gone otherwise.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
