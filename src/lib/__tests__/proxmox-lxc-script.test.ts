import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

// scripts/proxmox-lxc.sh against stand-ins for Proxmox's tools (pct, pveam, pvesm, pvesh),
// which log what they are asked. The real run is tested on Proxmox VE in a VM.
const script = path.join(process.cwd(), 'scripts/proxmox-lxc.sh');
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function host({ existing = '', root = true, proxmox = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'helprr-pve-'));
  dirs.push(dir);
  const log = path.join(dir, 'calls.log');
  const tool = (name: string, body: string) => {
    writeFileSync(path.join(dir, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`);
    chmodSync(path.join(dir, name), 0o755);
  };
  tool('id', `echo ${root ? 0 : 1000}`);
  tool('ip', 'exit 0');
  if (proxmox) {
    tool('pct', `case "$1" in
  list) echo 'VMID       Status     Lock         Name'; ${existing ? `echo '${existing}      running                 helprr'` : ':'} ;;
  status) exit 2 ;;
  exec) case "$*" in *hostname*) echo 10.0.0.9 ;; esac ;;
esac`);
    tool('pveam', `case "$1" in
  available) echo 'system          debian-12-standard_12.12-1_amd64.tar.zst'; echo 'system          debian-13-standard_13.1-2_amd64.tar.zst' ;;
esac`);
    tool('pvesm', `case "$*" in
  *rootdir*) echo 'Name Type Status'; echo 'local-lvm lvmthin active' ;;
  *vztmpl*) echo 'Name Type Status'; echo 'local dir active' ;;
esac`);
    tool('pvesh', 'echo 105');
  }
  return {
    log,
    run: (...args: string[]) =>
      spawnSync('/bin/bash', [script, ...args], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${dir}:/usr/bin:/bin`, HOME: dir, LANG: 'C' },
        input: '',
      }),
    calls: () => {
      try {
        return readFileSync(log, 'utf8');
      } catch {
        return '';
      }
    },
  };
}

describe('proxmox-lxc.sh', () => {
  it('creates an unprivileged Debian 13 container with nesting, then runs Helprr\'s installer in it', () => {
    const pve = host();
    const result = pve.run('--yes', '--version', '1.13.0');
    expect(result.status, result.stderr).toBe(0);
    const calls = pve.calls();
    expect(calls).toContain('pveam download local debian-13-standard_13.1-2_amd64.tar.zst');
    const create = calls.split('\n').find((line) => line.startsWith('pct create')) ?? '';
    for (const part of [
      'pct create 105 local:vztmpl/debian-13-standard_13.1-2_amd64.tar.zst',
      '--hostname helprr', '--unprivileged 1', '--features nesting=1,keyctl=1',
      '--rootfs local-lvm:8', '--net0 name=eth0,bridge=vmbr0,ip=dhcp', '--timezone host', '--onboot 1',
    ]) expect(create).toContain(part);
    expect(calls).toContain('pct start 105');
    expect(calls).toMatch(/pct exec 105 -- .*https:\/\/github\.com\/SaiBarathR\/helprr\/releases\/download\/v1\.13\.0 --yes --dir \/opt\/helprr --version 1\.13\.0/);
    expect(result.stdout).toContain('Open http://10.0.0.9:3050');
  });

  it('stops before changing anything when a container named helprr exists', () => {
    const pve = host({ existing: '101' });
    const result = pve.run('--yes');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Container 101 is already named helprr');
    expect(pve.calls()).not.toMatch(/pct (create|start)|pveam download/);
  });

  it('runs only as root on a Proxmox host', () => {
    expect(host({ root: false }).run('--yes').stderr).toContain('Run this as root on the Proxmox VE host');
    expect(host({ proxmox: false }).run('--yes').stderr).toContain('This is not a Proxmox VE host');
  });

  it('refuses options that are not what they claim', () => {
    const pve = host();
    expect(pve.run('--disk', '8G').stderr).toContain('"8G" is not a number');
    expect(pve.run('--version', '1.0;rm').stderr).toContain('is not a Helprr version');
    expect(pve.run('--bridge', 'vmbr0 x').stderr).toContain('letters, digits');
    expect(pve.calls()).not.toMatch(/pct (create|start)/);
  });

  it('shows its options', () => {
    const result = host().run('--help');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--ctid ID');
  });
});
