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

function host({ existing = '', root = true, proxmox = true, taken = false, noTemplate = false, failInstall = false, storages = 'local-lvm' } = {}) {
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
  status) exit ${taken ? 0 : 2} ;;
  exec) case "$*" in *install.sh*) ${failInstall ? "echo 'curl: (22) 404' >&2; exit 22" : ':'} ;; esac ;;
esac`);
    tool('pveam', `case "$1" in
  available) echo 'system          debian-12-standard_12.12-1_amd64.tar.zst'; ${noTemplate ? ':' : "echo 'system          debian-13-standard_13.1-2_amd64.tar.zst'"} ;;
esac`);
    tool('pvesm', `case "$*" in
  *rootdir*) echo 'Name Type Status'; for s in ${storages}; do echo "$s lvmthin active"; done ;;
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
    expect(calls).toContain(' https://github.com/SaiBarathR/helprr/releases/download/v1.13.0 --yes --dir /opt/helprr --version 1.13.0\n');
    expect(result.stdout).toContain('Helprr is installed in container 105');
  });

  it('takes the latest release, and passes a test release folder on to the installer', () => {
    const latest = host();
    expect(latest.run('--yes').status).toBe(0);
    expect(latest.calls()).toContain(' https://github.com/SaiBarathR/helprr/releases/latest/download --yes --dir /opt/helprr\n');
    const local = host();
    const result = local.run('--yes', '--asset-base', 'http://10.0.2.2:3198');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('is not https');
    expect(local.calls()).toContain(' http://10.0.2.2:3198 --yes --dir /opt/helprr --asset-base http://10.0.2.2:3198\n');
  });

  it('says so, and does not claim success, when the installer cannot be downloaded', () => {
    const pve = host({ failInstall: true });
    const result = pve.run('--yes', '--version', '1.0.0');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('the install stopped. Container 105 is left as it is');
    expect(result.stdout).not.toContain('Helprr is installed');
  });

  it('explains a missing template or a taken ID before creating anything', () => {
    const noTemplate = host({ noTemplate: true });
    expect(noTemplate.run('--yes').stderr).toContain('Proxmox lists no Debian 13 template');
    expect(noTemplate.calls()).not.toContain('pct create');
    const taken = host({ taken: true });
    expect(taken.run('--yes', '--ctid', '200').stderr).toContain('Container ID 200 is taken');
    expect(taken.calls()).not.toContain('pct create');
  });

  it('puts the disk on local-zfs, or the first storage, when there is no local-lvm', () => {
    const zfs = host({ storages: 'tank local-zfs' });
    expect(zfs.run('--yes').status).toBe(0);
    expect(zfs.calls()).toContain('--rootfs local-zfs:8');
    const other = host({ storages: 'tank' });
    expect(other.run('--yes').status).toBe(0);
    expect(other.calls()).toContain('--rootfs tank:8');
    expect(host().run('--storage', 'nfs-backup').stderr).toContain('cannot hold containers');
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
