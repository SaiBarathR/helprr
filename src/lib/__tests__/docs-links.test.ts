import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { connectionFailure } from '@/lib/connection-hints';
import { DOCS_URL, TROUBLESHOOTING_SECTIONS, troubleshootingUrl } from '@/lib/docs-links';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

// The anchor Starlight gives a plain heading (github-slugger, for ASCII text).
const slug = (heading: string) => heading.trim().toLowerCase().replace(/[^a-z0-9 _-]/g, '').replace(/ /g, '-');

describe('links from the app into the guides', () => {
  it('lands every troubleshooting link on a heading that exists', () => {
    const page = read('docs-site/src/content/docs/troubleshooting.md');
    const anchors = new Set([...page.matchAll(/^#{2,4} (.+)$/gm)].map((m) => slug(m[1])));
    for (const section of TROUBLESHOOTING_SECTIONS) expect(anchors, section).toContain(section);
  });

  it('points at the address the guides site is published to', () => {
    const config = read('docs-site/astro.config.mjs');
    const site = config.match(/site: '([^']+)'/)?.[1];
    const base = config.match(/base: '([^']+)'/)?.[1];
    expect(DOCS_URL).toBe(`${site}${base}/`);
    expect(troubleshootingUrl('nothing-is-answering')).toBe(`${site}${base}/troubleshooting/#nothing-is-answering`);
  });

  it('lands every link to the guides, from the app, scripts and README, on a page and section that exist', () => {
    const files = [
      ...readdirSync(path.join(process.cwd(), 'scripts')).filter((name) => name.endsWith('.sh')).map((name) => `scripts/${name}`),
      'README.md',
      ...readdirSync(path.join(process.cwd(), 'src'), { recursive: true, encoding: 'utf8' })
        .filter((name) => /\.(ts|tsx)$/.test(name) && !name.includes('__tests__'))
        .map((name) => `src/${name}`),
    ];
    const links = files.flatMap((file) => [...read(file).matchAll(/https:\/\/saibarathr\.github\.io\/helprr\/([a-z0-9/-]*)(?:#([a-z0-9_-]+))?/g)]
      .map((m) => ({ file, page: m[1].replace(/\/$/, ''), section: m[2] })));
    expect(links.length).toBeGreaterThan(10);
    for (const { file, page, section } of links) {
      const source = page === '' ? 'index.mdx' : `${page}.md`;
      const at = path.join(process.cwd(), 'docs-site/src/content/docs', source);
      expect(existsSync(at), `${file} -> ${page}`).toBe(true);
      if (section) {
        const anchors = [...readFileSync(at, 'utf8').matchAll(/^#{2,4} (.+)$/gm)].map((m) => slug(m[1]));
        expect(anchors, `${file} -> ${page}#${section}`).toContain(section);
      }
    }
  });

  it('gives each kind of failure its section', () => {
    const fail = (code: string) => Object.assign(new Error(code), { code });
    const docker = { inDocker: true, hostGatewayResolves: true };
    const cases: [unknown, string, string][] = [
      [fail('ERR_INVALID_URL'), 'nonsense', 'not-a-valid-address'],
      [fail('ECONNREFUSED'), 'http://localhost:8989', 'localhost-does-not-reach-your-server'],
      [fail('ECONNREFUSED'), 'http://192.168.1.10:8989', 'nothing-is-answering'],
      [Object.assign(new Error('404'), { response: { status: 404 } }), 'http://192.168.1.10:8989', 'it-answered-but-not-as-that-app'],
      [fail('ENOTFOUND'), 'http://sonarr.lan:8989', 'the-name-is-not-found'],
      [fail('ETIMEDOUT'), 'http://192.168.1.10:8989', 'no-answer-in-time'],
      [fail('EHOSTUNREACH'), 'http://192.168.1.10:8989', 'the-address-cannot-be-reached'],
      [fail('ECONNRESET'), 'http://192.168.1.10:8989', 'the-connection-was-cut-off'],
      [fail('EPROTO'), 'https://192.168.1.10:8989', 'that-port-speaks-plain-http'],
      [fail('DEPTH_ZERO_SELF_SIGNED_CERT'), 'https://192.168.1.10:8989', 'the-certificate-was-refused'],
    ];
    for (const [error, url, section] of cases) expect(connectionFailure(error, url, docker)?.section, section).toBe(section);
  });
});
