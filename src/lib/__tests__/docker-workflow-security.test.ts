import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Docker publish security gate', () => {
  const workflow = readFileSync(
    path.join(process.cwd(), '.github/workflows/docker-publish.yml'),
    'utf8',
  );

  it('scans each platform digest before it can reach the manifest job', () => {
    const build = workflow.indexOf('- name: Build and push by digest');
    const scan = workflow.indexOf('- name: Scan image for fixable high/critical vulnerabilities');
    const exportDigest = workflow.indexOf('- name: Export digest');

    expect(build).toBeGreaterThan(-1);
    expect(scan).toBeGreaterThan(build);
    expect(exportDigest).toBeGreaterThan(scan);
    expect(workflow).toContain('image-ref: ${{ env.IMAGE }}@${{ steps.build.outputs.digest }}');
    expect(workflow).toContain('TRIVY_PLATFORM: ${{ matrix.platform }}');
  });

  it('pins a safe Trivy action and fails on fixable high/critical OS or library findings', () => {
    expect(workflow).toContain(
      'aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25 # v0.36.0',
    );
    expect(workflow).toContain('version: v0.70.0');
    expect(workflow).toContain('scanners: vuln');
    expect(workflow).toContain('vuln-type: os,library');
    expect(workflow).toContain('severity: HIGH,CRITICAL');
    expect(workflow).toContain('ignore-unfixed: true');
    expect(workflow).toContain("exit-code: '1'");
    expect(workflow).toContain("TRIVY_EXIT_ON_EOL: '1'");

    const scanBlock = workflow.slice(
      workflow.indexOf('- name: Scan image for fixable high/critical vulnerabilities'),
      workflow.indexOf('- name: Export digest'),
    );
    expect(scanBlock).not.toContain('continue-on-error');
  });

  it('keeps package managers out of the final runtime image', () => {
    const dockerfile = readFileSync(path.join(process.cwd(), 'Dockerfile'), 'utf8');
    const entrypoint = readFileSync(path.join(process.cwd(), 'docker-entrypoint.sh'), 'utf8');

    expect(dockerfile).toContain('rm -rf /usr/local/lib/node_modules/npm');
    expect(dockerfile).toContain('/usr/local/lib/node_modules/corepack');
    expect(entrypoint).toContain('./node_modules/.bin/prisma migrate deploy');
    expect(entrypoint).not.toContain('npx prisma migrate deploy');
  });
});

describe('PR CI gates', () => {
  const ci = readFileSync(path.join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
  const imageScan = ci.slice(ci.indexOf('\n  image-scan:'));

  it('checks the whole change for whitespace errors and conflict markers', () => {
    expect(ci).toContain('fetch-depth: 2');
    expect(ci).toContain('run: git diff --check HEAD^1 HEAD');
  });

  it('validates both Compose scopes, then builds and scans the final image', () => {
    const compose = imageScan.indexOf('- name: Validate Compose files');
    const build = imageScan.indexOf('- name: Build image (amd64, not pushed)');
    const scan = imageScan.indexOf('- name: Scan image for fixable high/critical vulnerabilities');

    expect(imageScan).toContain("if: github.event_name == 'pull_request'");
    expect(compose).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(compose);
    expect(scan).toBeGreaterThan(build);
    expect(imageScan).toContain('docker compose --env-file .env -f docker-compose.yml config --quiet');
    expect(imageScan).toContain('docker compose --env-file .env.dev -f docker-compose.dev.yml config --quiet');
    expect(imageScan.slice(build, scan)).toContain('load: true');
    expect(imageScan).not.toContain('continue-on-error');
  });
});

describe('GitHub Actions pins', () => {
  it('pins every action to a full commit SHA with its version', () => {
    const dir = path.join(process.cwd(), '.github/workflows');
    for (const file of readdirSync(dir).filter((name) => /\.ya?ml$/.test(name))) {
      const uses = readFileSync(path.join(dir, file), 'utf8')
        .split('\n')
        .filter((line) => /^\s*(- )?uses:/.test(line));
      for (const line of uses) {
        expect(line, `${file}: ${line.trim()}`).toMatch(/uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
      }
    }
  });
});
