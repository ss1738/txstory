/**
 * The HTTP API matches its OpenAPI contract, and every example in docs/api.md
 * runs with the documented status. Recorded mode: no network.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';
import { OPENAPI } from '../../src/server/openapi.js';

let base = ''; let server: Server;
beforeAll(async () => {
  server = createServer(createApp({ config: loadConfig({ mode: 'recorded', fixturesDir: 'fixtures/synthetic,fixtures/devnet', staticDir: null, logRequests: false }) }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

type Schema = { $ref?: string; required?: string[]; properties?: Record<string, Schema> };
const components = OPENAPI.components.schemas as unknown as Record<string, Schema>;
const resolve = (s: Schema | undefined): Schema | undefined => (s?.$ref ? components[s.$ref.split('/').pop()!] : s);
/** Checks required fields (recursively through documented properties). */
function conforms(value: unknown, schema: Schema | undefined, path = '$'): string[] {
  const s = resolve(schema);
  if (!s || typeof value !== 'object' || value === null) return [];
  const errs: string[] = [];
  for (const k of s.required ?? []) if (!(k in (value as object))) errs.push(`${path}.${k} missing`);
  for (const [k, sub] of Object.entries(s.properties ?? {})) if (k in (value as object)) errs.push(...conforms((value as Record<string, unknown>)[k], sub, `${path}.${k}`));
  return errs;
}
const responseSchema = (route: string, status: number) => {
  const op = (OPENAPI.paths as unknown as Record<string, { get: { responses: Record<string, { content?: { 'application/json'?: { schema: Schema } } }> } }>)[route]?.get;
  return { documented: !!op?.responses[String(status)], schema: op?.responses[String(status)]?.content?.['application/json']?.schema };
};
const routeOf = (path: string) => {
  for (const r of Object.keys(OPENAPI.paths)) {
    const re = new RegExp('^' + r.replace(/\{[^}]+\}/g, '[^/]+') + '$');
    if (re.test(path)) return r;
  }
  return null;
};

describe('docs/api.md examples run as documented', () => {
  const doc = readFileSync('docs/api.md', 'utf8');
  const examples = [...doc.matchAll(/curl -s "\$TXSTORY(\/[^"]+)"[^\n#]*# → (\d{3})/g)].map((m) => ({ path: m[1]!, status: Number(m[2]) }));
  it('found the examples', () => expect(examples.length).toBeGreaterThanOrEqual(10));
  for (const ex of examples) {
    it(`${ex.path} → ${ex.status}`, async () => {
      const r = await fetch(base + ex.path);
      expect(r.status).toBe(ex.status);
      const route = routeOf(new URL(base + ex.path).pathname);
      const body = await r.json();
      if (route) {
        const { documented, schema } = responseSchema(route, r.status);
        expect(documented, `${route} does not document ${r.status}`).toBe(true);
        expect(conforms(body, schema)).toEqual([]);
      } else {
        expect(body.code).toBe('unknown-route');
      }
    });
  }
});

describe('OpenAPI contract', () => {
  it('error bodies use only documented codes', async () => {
    const codes = (components.Error!.properties!.code as unknown as { enum: string[] }).enum;
    for (const p of ['/api/story/ethereum/0x12', '/api/nope', '/api/story/zz/0x' + '1'.repeat(64)]) {
      const body = await (await fetch(base + p)).json();
      expect(codes).toContain(body.code);
    }
    const post = await fetch(`${base}/api/health`, { method: 'POST' });
    expect(post.status).toBe(405);
    expect(codes).toContain((await post.json()).code);
  });
  it('stories carry every documented required field, at the documented schema version', async () => {
    const body = await (await fetch(`${base}/api/example/ethereum/0xefb65ab1ab71b94063c0ee8e8c7bdde47b808c19f4e653ed931e3006f4983112`)).json();
    expect(conforms(body, responseSchema('/api/example/{network}/{hash}', 200).schema)).toEqual([]);
    expect(body.story.schemaVersion).toBe(3);
  });
  it('the served document is this contract', async () => {
    expect(await (await fetch(`${base}/api/openapi.json`)).json()).toEqual(JSON.parse(JSON.stringify(OPENAPI)));
  });
});

describe('CI workflow references', () => {
  it('only references transactions whose recordings ship with the repository', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    const shipped = new Set(['fixtures/synthetic', 'fixtures/devnet'].flatMap((d) => readdirSync(d)).map((f) => /0x[0-9a-f]{64}/.exec(f)?.[0]).filter(Boolean));
    const referenced = [...new Set(workflow.match(/0x[0-9a-f]{64}/g) ?? [])];
    expect(referenced.length).toBeGreaterThan(0);
    for (const h of referenced) expect(shipped.has(h), h).toBe(true);
  });
});

