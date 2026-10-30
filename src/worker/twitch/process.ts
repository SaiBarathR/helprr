import { spawn } from 'node:child_process';
import readline from 'node:readline';

const KILL_GRACE_MS = 5_000;
const MAX_KEPT_OUTPUT = 8_000;

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onLine?: (line: string) => void;
  /** Return stdout in full. It stays out of error messages: yt-dlp's JSON holds signed URLs. */
  captureStdout?: boolean;
  signal?: AbortSignal;
  nice?: number;
}

export class ProcessFailedError extends Error {
  constructor(command: string, code: number | null, output: string) {
    super(`${command} exited with ${code ?? 'a signal'}: ${output.slice(-1000)}`);
    this.name = 'ProcessFailedError';
  }
}

/** Not a failure: the job goes back to wait, at no cost to its attempts. */
export class DeferJobError extends Error {
  readonly runAfter: Date;
  readonly stage: string;

  constructor(stage: string, delayMs: number) {
    super(stage);
    this.name = 'DeferJobError';
    this.stage = stage;
    this.runAfter = new Date(Date.now() + delayMs);
  }
}

/** Another worker holds this job now: stop, and leave everything to it. */
export class LeaseLostError extends Error {
  constructor() {
    super('Lease lost');
    this.name = 'LeaseLostError';
  }
}

export class JobCancelledError extends Error {
  constructor() {
    super('Job cancelled');
    this.name = 'JobCancelledError';
  }
}

/**
 * Arguments go as an array with no shell, so a stream title can never be a command.
 * The child leads its own process group: killing only yt-dlp leaves ffmpeg running.
 */
export function run(command: string, args: readonly string[], options: RunOptions = {}): Promise<string> {
  const [file, argv] = options.nice === undefined
    ? [command, args]
    : ['nice', ['-n', String(options.nice), command, ...args]];

  return new Promise((resolve, reject) => {
    const child = spawn(file, argv as string[], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let tail = '';
    const stdout: string[] = [];
    const keep = (line: string) => {
      tail = (tail + line + '\n').slice(-MAX_KEPT_OUTPUT);
      options.onLine?.(line);
    };
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      if (options.captureStdout) stdout.push(line);
      else keep(line);
    });
    readline.createInterface({ input: child.stderr }).on('line', keep);

    let killTimer: NodeJS.Timeout | undefined;
    const stop = () => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        return;
      }
      killTimer = setTimeout(() => {
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {
          // Already gone.
        }
      }, KILL_GRACE_MS);
    };
    if (options.signal?.aborted) stop();
    options.signal?.addEventListener('abort', stop, { once: true });

    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', stop);
      if (options.signal?.aborted) reject(new JobCancelledError());
      else if (code === 0) resolve(options.captureStdout ? stdout.join('\n') : tail);
      else reject(new ProcessFailedError(command, code, tail));
    });
  });
}
