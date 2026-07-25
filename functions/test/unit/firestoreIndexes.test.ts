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

/** Pull `useLiveQuery('label', () => query(collection(db, COLLECTIONS.x), …))` shapes. */
function parseQueries(): QueryShape[] {
  const out: QueryShape[] = [];
  for (const file of sourceFiles(APP_SRC)) {
    const src = readFileSync(file, 'utf8');
    // matchAll only — calling exec() first on the same /g regex advances
    // lastIndex and silently drops the FIRST match in every file, which is how
    // this check managed to miss the very query it was written for.
    const re = /useLiveQuery<[^>]*>\(\s*'([^']+)'([\s\S]{0,900}?)\n\s{4}\[/g;
    for (const m of src.matchAll(re)) {
      const [, label, body] = m;
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

  it('finds the query shapes at all (guards against the parser silently matching nothing)', () => {
    // A parser that matches nothing would make every assertion below vacuous —
    // the failure mode this whole file exists to prevent.
    expect(queries.length).toBeGreaterThan(10);
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
