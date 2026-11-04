import { readFileSync } from 'node:fs';

/**
 * The worker's copy of the session secret that helprr-init made, used only when the
 * environment has no JWT_SECRET. Imported first by main.ts, before anything reads
 * the environment. Without the helprr-secrets volume there is no file and nothing
 * changes.
 */
export function loadWorkerSecrets(file = process.env.HELPRR_WORKER_SECRETS_FILE ?? '/secrets/worker/jwt_secret'): void {
  if (process.env.JWT_SECRET) return;
  try {
    const value = readFileSync(file, 'utf8').trim();
    if (value) process.env.JWT_SECRET = value;
  } catch {
    // No volume, or no generated secret: the environment must provide it, as before.
  }
}

loadWorkerSecrets();
