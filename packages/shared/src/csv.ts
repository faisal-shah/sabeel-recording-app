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
