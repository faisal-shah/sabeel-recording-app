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
  /** Which `useLiveQuery` call this came from — one call can build several. */
  site: number;
  collection: string;
  /** Fields under an equality-shaped filter: `==`, `in`, `array-contains`… */
  whereFields: string[];
  /** Fields under a range filter: `<`, `<=`, `>`, `>=`, `!=`, `not-in`. */
  rangeFields: string[];
  orderBys: { field: string; dir: string }[];
}

const RANGE_OPS = new Set(['<', '<=', '>', '>=', '!=', 'not-in']);

/** The filters in a query body, split by whether they are equality or range. */
function classify(body: string): { whereFields: string[]; rangeFields: string[] } {
  const wheres = [...body.matchAll(/where\(\s*'([^']+)'\s*,\s*'([^']+)'/g)].map((w) => ({
    field: w[1],
    op: w[2],
  }));
  return {
    whereFields: wheres.filter((w) => !RANGE_OPS.has(w.op)).map((w) => w.field),
    rangeFields: wheres.filter((w) => RANGE_OPS.has(w.op)).map((w) => w.field),
  };
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
  let site = 0;
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
      site += 1;
      /*
       * ONE SHAPE PER `query(`, not per call. A hook that chooses between two
       * queries — the audit view's "everything" for an admin and "this class"
       * for a manager — writes both in one `make`, and reading the whole body
       * as one shape fused their `orderBy`s into a sequence no query sends.
       * Each `query(` is its own shape; a body with none has no filter to
       * need an index, and still counts as a site.
       */
      const variants = body.split(/\bquery\(/).slice(1);
      for (const variant of variants.length > 0 ? variants : [body]) {
        out.push({
          label,
          site,
          collection: coll,
          ...classify(variant),
          orderBys: [...variant.matchAll(/orderBy\(\s*'([^']+)'(?:\s*,\s*'(\w+)')?/g)].map((o) => ({
            field: o[1],
            dir: (o[2] ?? 'asc').toUpperCase() === 'DESC' ? 'DESCENDING' : 'ASCENDING',
          })),
        });
      }
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

    expect(new Set(queries.map((q) => q.site)).size).toBe(callSites - DYNAMIC_LABEL_WRAPPERS);
    expect(queries.map((q) => q.label)).toContain('courseRecordings');
    // And the one hook that builds two queries yields two shapes, so a merge
    // of its branches back into one would be noticed.
    expect(queries.filter((q) => q.label === 'audit')).toHaveLength(2);
  });

  it('declares a composite index for every filter + order-on-another-field query', () => {
    const missing: string[] = [];
    for (const q of queries) {
      const filters = q.whereFields;
      /*
       * THE ORDER THE INDEX HAS TO CONTINUE IN, after the equalities. Every
       * `orderBy`, in sequence — a second one is as much a part of the shape
       * as the first, and a check that read only `orderBys[0]` passed an
       * index that stopped there. A RANGE filter with no `orderBy` orders by
       * its own field ascending, implicitly, and needs the same index an
       * explicit one would: `where a == … where date <= …` is served by no
       * merge of single-field indexes.
       */
      const sequence =
        q.orderBys.length > 0
          ? q.orderBys
          : q.rangeFields.map((field) => ({ field, dir: 'ASCENDING' }));
      // No filter and one order is a single-field index's job; no filter and
      // two orders on different fields is not — that needs a composite too.
      if (sequence.length === 0) continue;
      if (filters.length === 0 && sequence.length === 1) continue;
      // An order on the filtered field alone is a single-field index's job.
      if (sequence.length === 1 && filters.every((f) => f === sequence[0].field)) continue;

      /*
       * FIELD ORDER IS THE WHOLE OF WHAT FIRESTORE MATCHES ON, and set
       * membership cannot see it. An index declaring `createdAt DESC, courseId
       * ASC` contains both fields and the right direction, so the old
       * membership test passed — while the query `where courseId == …
       * orderBy createdAt desc` throws `failed-precondition` in production.
       * That is the exact incident this file's header recounts, passing the
       * check written to prevent it.
       *
       * Firestore's rule: every equality filter first, in any order among
       * themselves, then the ordered fields in sequence with matching
       * directions, and nothing before them. So the equality fields must be a
       * prefix, and the sequence must follow immediately.
       */
      const covered = declared.some((idx) => {
        if (idx.collectionGroup !== q.collection) return false;
        const prefix = idx.fields.slice(0, filters.length);
        const equalitiesFirst =
          prefix.length === filters.length &&
          filters.every((f) => prefix.some((x) => x.fieldPath === f));
        const rest = idx.fields.slice(filters.length, filters.length + sequence.length);
        return (
          equalitiesFirst &&
          rest.length === sequence.length &&
          sequence.every((o, i) => rest[i].fieldPath === o.field && rest[i].order === o.dir)
        );
      });
      if (!covered) {
        const order = sequence.map((o) => `${o.field} ${o.dir}`).join(', ');
        missing.push(`${q.label}: ${q.collection}(${filters.join(', ')}) orderBy ${order}`);
      }
    }
    expect(missing, `no composite index declared for:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('reads the operator of every filter, so a range is not mistaken for an equality', () => {
    // A guard on the parser: the sweep's own shape is in `functions/`, which
    // this parser does not read, so nothing in the app exercises the range
    // branch today. Parse a literal instead and hold the classifier to it.
    const shape = classify(
      "where('attendanceSubmittedAt', '==', null), where('date', '<=', cutoff)",
    );
    expect(shape).toEqual({ whereFields: ['attendanceSubmittedAt'], rangeFields: ['date'] });
  });

  // Deliberately NOT asserting the converse (that every declared index is used).
  // Queries also live in `functions/`, written in Admin-SDK syntax this parser
  // does not read, so an "unused index" assertion would fail on indexes that are
  // in fact used — a false alarm on the check people would then stop trusting.
});

/**
 * Collection-group queries, which Firestore indexes differently.
 *
 * A single-field index is created automatically at COLLECTION scope and NOT at
 * COLLECTION_GROUP scope — so a `collectionGroup('x').where('f', ...)` needs an
 * explicit `fieldOverrides` entry, and without one it fails in production with
 * `failed-precondition` while the emulator serves it happily. Exactly the gap
 * the composite check above exists for, in the one shape that check cannot see.
 *
 * Both source trees, because the only such query in this repo is in a TRIGGER:
 * `onDeviceRegistered` sweeps a push token off every other account, and a
 * missing index there is silent — the symptom is a device staying registered to
 * a previous account, which is the leak the trigger exists to close.
 */
describe('firestore collection-group indexes', () => {
  const overrides: {
    collectionGroup: string;
    fieldPath: string;
    indexes: { queryScope?: string }[];
  }[] = JSON.parse(readFileSync(INDEX_FILE, 'utf8')).fieldOverrides ?? [];

  const FUNCTIONS_SRC = new URL('../../src/', import.meta.url).pathname;
  const groupQueries = [...sourceFiles(APP_SRC), ...sourceFiles(FUNCTIONS_SRC)].flatMap((file) => {
    const src = readFileSync(file, 'utf8');
    return [
      ...src.matchAll(/collectionGroup\(\s*'([^']+)'\s*\)[\s\S]{0,120}?\.where\(\s*'([^']+)'/g),
    ].map((m) => ({ group: m[1], field: m[2], file }));
  });

  it('found the one this repo has', () => {
    // A guard on the guard: a parser that matched nothing would make the
    // assertion below vacuous, and it is the whole check.
    expect(groupQueries.length).toBeGreaterThan(0);
  });

  it('declares a COLLECTION_GROUP index for each one', () => {
    const missing = groupQueries
      .filter(
        (q) =>
          !overrides.some(
            (o) =>
              o.collectionGroup === q.group &&
              o.fieldPath === q.field &&
              o.indexes.some((i) => i.queryScope === 'COLLECTION_GROUP'),
          ),
      )
      .map((q) => `${q.group}.${q.field}`);
    expect(missing, `no COLLECTION_GROUP index declared for:\n  ${missing.join('\n  ')}`).toEqual(
      [],
    );
  });
});
