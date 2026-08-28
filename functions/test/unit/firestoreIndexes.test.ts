import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every live query that needs a composite index must have one declared.
 *
 * This exists because the emulator does NOT enforce composite indexes: it will
 * happily serve any query shape, so the whole test suite and the e2e can pass
 * while a screen is broken in production with `failed-precondition`. That is
 * exactly what happened — the class→course rework removed the old
 * `recordings (classId, createdAt)` index as dead (correct, the field was gone)
 * without adding the `courseId` replacement, and nothing caught it until someone
 * opened the screen against real Firestore.
 *
 * So the check has to be static: parse the query shapes out of the app and
 * cross-reference `firestore.indexes.json`. It is deliberately CONSERVATIVE —
 * it only demands an index where Firestore genuinely requires one — because a
 * check that cries wolf gets deleted.
 *
 * Firestore needs a composite index when a query combines a filter with an
 * `orderBy` on a DIFFERENT field. It does not need one for equality filters
 * alone, however many: those are served by merging single-field indexes.
 */

const APP_SRC = new URL('../../../app/src/', import.meta.url).pathname;
const INDEX_FILE = new URL('../../../firestore.indexes.json', import.meta.url).pathname;

interface QueryShape {
  label: string;
  collection: string;
  whereFields: string[];
  orderBys: { field: string; dir: string }[];
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(entry) ? [p] : [];
  });
}

/**
 * Pull the shapes out of
 * `useLiveQuery(() => query(collection(db, COLLECTIONS.x), …), [deps], { label: 'l', … })`.
 *
 * The query body comes FIRST and the label last, because `make` and `deps` have
 * to sit at arguments 0 and 1 for react-hooks/exhaustive-deps to read them (see
 * app/src/liveQuery.ts). So each call is isolated by splitting on the call
 * itself, and within a chunk the query is everything before its `label:`.
 */
function parseQueries(): QueryShape[] {
  const out: QueryShape[] = [];
  for (const file of sourceFiles(APP_SRC)) {
    const src = readFileSync(file, 'utf8');
    // Split ON the call, so each chunk ends where the next call begins. A
    // fixed-size window cannot do that: a wrapper whose label is a parameter has
    // no literal to stop at, so its window ran on into the following call and
    // fused the two queries into one shape that exists nowhere (auditLog
    // acquiring a studentUid filter it has never had).
    //
    // The split also tolerates `>` inside the generic argument
    // (`useLiveQuery<Map<string, V>>`); insisting on `<[^>]*>` silently skipped
    // every such call — two of them — while still reporting a healthy count.
    for (const chunk of src.split(/useLiveQuery\s*[<(]/).slice(1)) {
      const label = /\blabel:\s*'([^']+)'/.exec(chunk)?.[1];
      if (!label) continue; // parameterised label; see the call-site count test
      const body = chunk.slice(0, chunk.indexOf('label:'));
      const coll = /COLLECTIONS\.(\w+)/.exec(body)?.[1];
      if (!coll) continue;
      out.push({
        label,
        collection: coll,
        whereFields: [...body.matchAll(/where\(\s*'([^']+)'/g)].map((w) => w[1]),
        orderBys: [...body.matchAll(/orderBy\(\s*'([^']+)'(?:\s*,\s*'(\w+)')?/g)].map((o) => ({
          field: o[1],
          dir: (o[2] ?? 'asc').toUpperCase() === 'DESC' ? 'DESCENDING' : 'ASCENDING',
        })),
      });
    }
  }
  return out;
}

interface DeclaredIndex {
  collectionGroup: string;
  fields: { fieldPath: string; order?: string }[];
}

describe('firestore composite indexes cover the app’s queries', () => {
  const queries = parseQueries();
  const declared: DeclaredIndex[] = JSON.parse(readFileSync(INDEX_FILE, 'utf8')).indexes;

  it('parses EVERY useLiveQuery call, not just most of them', () => {
    // "More than ten" is not a guard: the parser once matched 21 of 25 calls and
    // looked perfectly healthy. Count the call sites independently, with a regex
    // too simple to be wrong, and demand the parser account for all of them.
    //
    // The two exemptions are the generic wrappers in ledger.ts
    // (useScopedMap, useStudentCourseMap): their label is a parameter, so
    // there is no literal to capture. Neither can need a composite index — both
    // build equality-only filters with no orderBy, which Firestore serves by
    // merging single-field indexes.
    const DYNAMIC_LABEL_WRAPPERS = 2;
    const callSites = sourceFiles(APP_SRC)
      .filter((f) => !f.endsWith('liveQuery.ts'))
      .reduce((n, f) => n + (readFileSync(f, 'utf8').match(/useLiveQuery\s*[<(]/g)?.length ?? 0), 0);

    expect(queries.length).toBe(callSites - DYNAMIC_LABEL_WRAPPERS);
    expect(queries.map((q) => q.label)).toContain('courseRecordings');
  });

  it('declares a composite index for every filter + orderBy-on-another-field query', () => {
    const missing: string[] = [];
    for (const q of queries) {
      // `__name__` equality is a document lookup, not a filter needing an index.
      const filters = q.whereFields.filter((f) => f !== '__name__');
      if (filters.length === 0 || q.orderBys.length === 0) continue;
      const order = q.orderBys[0];
      if (filters.every((f) => f === order.field)) continue; // orderBy on the filtered field

      const covered = declared.some(
        (idx) =>
          idx.collectionGroup === q.collection &&
          filters.every((f) => idx.fields.some((x) => x.fieldPath === f)) &&
          idx.fields.some((x) => x.fieldPath === order.field && x.order === order.dir),
      );
      if (!covered) {
        missing.push(
          `${q.label}: ${q.collection}(${filters.join(', ')}) orderBy ${order.field} ${order.dir}`,
        );
      }
    }
    expect(missing, `no composite index declared for:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  // Deliberately NOT asserting the converse (that every declared index is used).
  // Queries also live in `functions/`, written in Admin-SDK syntax this parser
  // does not read, so an "unused index" assertion would fail on indexes that are
  // in fact used — a false alarm on the check people would then stop trusting.
});
