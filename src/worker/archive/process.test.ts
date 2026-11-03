import { describe, expect, it } from 'vitest';
import { JobCancelledError, ProcessFailedError, run } from './process';

describe('run', () => {
  it('returns long stdout in full when capturing', async () => {
    const output = await run('node', ['-e', "console.log('x'.repeat(50000))"], { captureStdout: true });
    expect(output).toHaveLength(50000);
  });

  it('keeps captured stdout out of the error message', async () => {
    const failure = run('node', ['-e', "console.log('signed-url'); console.error('real reason'); process.exit(3)"], { captureStdout: true });
    await expect(failure).rejects.toBeInstanceOf(ProcessFailedError);
    const message = await failure.catch((error: Error) => error.message);
    expect(message).toContain('real reason');
    expect(message).not.toContain('signed-url');
  });

  it('passes arguments without a shell', async () => {
    const hostile = '$(touch /tmp/pwned); `id` | cat';
    const output = await run('node', ['-e', 'console.log(process.argv[1])', hostile], { captureStdout: true });
    expect(output).toBe(hostile);
  });

  it('kills the whole process group on cancel, children included', async () => {
    const abort = new AbortController();
    const lines: string[] = [];
    const script = `
      const { spawn } = require('child_process');
      const child = spawn('sleep', ['30'], { stdio: 'ignore' });
      console.log(child.pid);
      setInterval(() => {}, 1000);
    `;
    const running = run('node', ['-e', script], {
      signal: abort.signal,
      onLine: (line) => {
        lines.push(line);
        abort.abort();
      },
    });
    await expect(running).rejects.toBeInstanceOf(JobCancelledError);

    const childPid = Number(lines[0]);
    const alive = () => {
      try {
        process.kill(childPid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let i = 0; i < 40 && alive(); i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(alive()).toBe(false);
  });
});
