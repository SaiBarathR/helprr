import { readFileSync } from 'node:fs';
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
