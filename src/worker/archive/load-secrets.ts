import { readFileSync } from 'node:fs';
import path from 'node:path';

function readCopy(dir: string, name: string): string {
  try {
    return readFileSync(path.join(dir, name), 'utf8').trim();
  } catch {
    // No volume, or nothing generated: the environment must provide it, as before.
    return '';
  }
}

/**
 * The worker's copies of what helprr-init made, used only for what the environment
 * does not set. Imported first by main.ts, before anything reads the environment.
 * Without the helprr-secrets volume there are no files and nothing changes.
 *
 * DATABASE_URL: an explicit one, else built from POSTGRES_PASSWORD, else from the
 * generated password (the same order as docker-entrypoint.sh for the app).
 */
export function loadWorkerSecrets(dir = process.env.HELPRR_WORKER_SECRETS_DIR ?? '/secrets/worker'): void {
  if (!process.env.JWT_SECRET) {
    const value = readCopy(dir, 'jwt_secret');
    if (value) process.env.JWT_SECRET = value;
  }
  if (!process.env.DATABASE_URL) {
    const password = process.env.POSTGRES_PASSWORD || readCopy(dir, 'postgres_password');
    if (password) process.env.DATABASE_URL = `postgresql://postgres:${password}@helprr-db:5432/helprr`;
  }
  delete process.env.POSTGRES_PASSWORD;
}

loadWorkerSecrets();
