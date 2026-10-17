import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * A route that reads a paging parameter straight from the query string is how
 * the unbounded list routes came about: a raw parse beside a shared helper that
 * nothing made it use. Every read of page, pageSize, skip, take or limit in an
 * API route must go through `parsePageParams` / `parseSkipTake` /
 * `parsePageNumber` (which take the whole URLSearchParams) or be the first
 * argument of `parseInt32(..., { max })`, or the route must be listed below with
 * the reason it is bounded. Read from the syntax tree, so quoting, spacing and
 * comments make no difference.
 */

const API_DIR = join(process.cwd(), 'src/app/api');
const PARAMS = new Set(['page', 'pageSize', 'skip', 'take', 'limit']);

/** Routes that bound these values themselves, and how. */
const EXEMPT: Record<string, string> = {
  'activity/history/route.ts': 'own strict parser that answers 400 (owner decision, audit-w6-invalid-input-contract)',
  'discover/route.ts': 'limit: clampInt(limit, 1, BROWSE_LIMIT_MAX)',
  'insights/media-analysis/files/route.ts': 'pageSize clamped to MAX_PAGE_SIZE and page to the page count',
  'jellyfin/activity/route.ts': 'limit clamped to 1..MAX_LIMIT',
  'jellyfin/catalog/browse/route.ts': 'clampInt(limit, 1, 200)',
  'jellyfin/catalog/items/route.ts': 'clampInt(limit, 1, 200)',
  'jellyfin/playback/custom-history/route.ts': 'limit clamped to 1..200',
  'jellyfin/recently-added/route.ts': 'limit clamped to 1..100',
  'logs/search/route.ts': 'parseLimit clamps to MIN_LIMIT..MAX_LIMIT',
  'recommendations/for-you/route.ts': 'limit used only when finite, above 0 and at most 50',
  'search/route.ts': 'limit clamped to 1..MAX_LIMIT',
  'search/providers/[provider]/route.ts': 'limit clamped to 1..MAX_LIMIT',
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === 'route.ts' ? [path] : [];
  });
}

function literalText(node: ts.Node | undefined): string | null {
  if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) return node.text;
  return null;
}

/** Whether `read` is the first argument of parseInt32 with a `max` option. */
function boundedByParseInt32(read: ts.CallExpression): boolean {
  const parent = read.parent;
  if (!parent || !ts.isCallExpression(parent) || parent.arguments[0] !== read) return false;
  if (!ts.isIdentifier(parent.expression) || parent.expression.text !== 'parseInt32') return false;
  const options = parent.arguments[1];
  return Boolean(options && ts.isObjectLiteralExpression(options) && options.properties.some((property) =>
    (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property))
    && ts.isIdentifier(property.name) && property.name.text === 'max'));
}

/** The paging parameters this source reads without a bound. */
function unboundedReads(source: string): string[] {
  const file = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'get') {
      const param = literalText(node.arguments[0]);
      if (param && PARAMS.has(param) && !boundedByParseInt32(node)) found.push(param);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe('API route paging parameters', () => {
  const files = routeFiles(API_DIR).map((path) => ({
    route: relative(API_DIR, path).split('\\').join('/'),
    source: readFileSync(path, 'utf8'),
  }));

  it('are read through a bounding helper or listed as bounded inline', () => {
    const offenders = files
      .filter(({ route }) => !(route in EXEMPT))
      .map(({ route, source }) => ({ route, params: unboundedReads(source) }))
      .filter(({ params }) => params.length > 0)
      .map(({ route, params }) => `${route}: ${params.join(', ')}`);
    expect(offenders).toEqual([]);
  });

  it('keeps no exemption for a route that no longer needs one', () => {
    const stale = Object.keys(EXEMPT).filter((route) => {
      const file = files.find((candidate) => candidate.route === route);
      return !file || unboundedReads(file.source).length === 0;
    });
    expect(stale).toEqual([]);
  });

  it.each([
    ["const n = parseInt(sp.get('limit') ?? '10', 10);", ['limit']],
    ['const n = Number(searchParams.get("pageSize"));', ['pageSize']],
    ['const n = parseInt(sp.get(`limit`) ?? "10", 10);', ['limit']],
    ['const n = Number(sp.get ("take"));', ['take']],
    ['const n = Number(sp.get(/* comment */ "skip"));', ['skip']],
    ["const n = parseInt32(sp.get('take'));", ['take']],
    ['const n = parseInt32(sp.get("limit"), { min: 1 /* max: 100 */ });', ['limit']],
    ["const n = parseInt32(sp.get('take'), { min: 1, max: 100 }) ?? 20;", []],
    ["const n = parseInt32(\n  q.get('limit'),\n  {\n    min: 1,\n    max: LIMIT,\n  },\n);", []],
    ["// const n = parseInt(sp.get('limit'), 10);", []],
    ["const { page } = parsePageParams(sp, { maxSize: 100 });", []],
    ["const page = parsePageNumber(sp, { max: 500 });", []],
  ] as Array<[string, string[]]>)('reads %j as unbounded %j', (source, expected) => {
    expect(unboundedReads(source)).toEqual(expected);
  });
});
