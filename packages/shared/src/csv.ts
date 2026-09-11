/**
 * CSV serialisation, RFC 4180. Pure and shared so web and native produce
 * byte-identical files and the escaping can be unit-tested once.
 *
 * A field is quoted only when it must be — it contains a comma, a quote, a CR or
 * an LF — and an embedded quote is doubled. Rows are joined with CRLF, which is
 * what spreadsheets expect. `rows[0]` is the header by convention; this function
 * does not care, it just serialises whatever it is given.
 */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n');
}

/**
 * A file name built from things people typed — a course name, a recording's
 * title, a student's name — made safe for every file system the export lands
 * on. On the phone the CSV is written under the cache directory BY NAME, so a
 * course called "Fiqh/Usul" asked for a subdirectory that does not exist and
 * the share sheet never opened; a colon does the same on iOS and Windows.
 * Whitespace is collapsed so the name reads as one line in a file picker.
 * Applied inside the export seam, so every caller gets it.
 */
export function csvFilename(name: string): string {
  const stem = name
    .replace(/\.csv$/i, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return `${stem || 'export'}.csv`;
}
