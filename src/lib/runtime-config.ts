import { localPasswordValidationError } from '@/lib/password-policy';

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export interface StartupConfigurationIssue {
  variable: string;
  message: string;
}

const DOCUMENTED_PLACEHOLDERS = new Set([
  'password-add-here',
  'use-a-long-unique-password',
  'use-a-different-long-unique-password',
  'choose-the-first-admin-password',
  'paste-the-32-or-more-character-value-generated-above',
]);

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

export function isKnownPlaceholderSecret(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (DOCUMENTED_PLACEHOLDERS.has(normalized)) return true;
  return /^(?:change[-_ ]?me|replace[-_ ]?me)(?:$|[-_ ])/.test(normalized);
}

function decodeUrlPassword(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function validateUrl(
  issues: StartupConfigurationIssue[],
  variable: string,
  value: string | undefined,
  protocols: ReadonlySet<string>,
  description: string,
): URL | null {
  if (isBlank(value)) {
    issues.push({ variable, message: 'is required' });
    return null;
  }

  try {
    const parsed = new URL(value!);
    if (!protocols.has(parsed.protocol) || !parsed.hostname) {
      issues.push({ variable, message: `must be a valid ${description} URL` });
      return null;
    }
    return parsed;
  } catch {
    issues.push({ variable, message: `must be a valid ${description} URL` });
    return null;
  }
}

function jwtSecretIssue(value: string | undefined): StartupConfigurationIssue | null {
  if (isBlank(value)) {
    return { variable: 'JWT_SECRET', message: 'is required' };
  }
  if (value!.length < 32) {
    return { variable: 'JWT_SECRET', message: 'must be at least 32 characters' };
  }
  if (isKnownPlaceholderSecret(value!)) {
    return { variable: 'JWT_SECRET', message: 'must not use an example or change-me value' };
  }
  return null;
}

export class StartupConfigurationError extends Error {
  readonly issues: readonly StartupConfigurationIssue[];

  constructor(issues: readonly StartupConfigurationIssue[]) {
    const details = issues.map((issue) => `- ${issue.variable}: ${issue.message}`).join('\n');
    super(
      `Invalid startup configuration:\n${details}\n` +
        'Set valid values in your environment (see .env.example). Secret values are intentionally omitted.',
    );
    this.name = 'StartupConfigurationError';
    this.issues = issues;
  }
}

export function getValidatedJwtSecret(value: string | undefined): string {
  const issue = jwtSecretIssue(value);
  if (issue) throw new StartupConfigurationError([issue]);
  return value!;
}

export function validateRuntimeConfig(env: RuntimeEnvironment = process.env): void {
  const issues: StartupConfigurationIssue[] = [];

  const databaseUrl = validateUrl(
    issues,
    'DATABASE_URL',
    env.DATABASE_URL,
    new Set(['postgres:', 'postgresql:']),
    'PostgreSQL',
  );
  if (
    databaseUrl?.password &&
    isKnownPlaceholderSecret(decodeUrlPassword(databaseUrl.password))
  ) {
    issues.push({
      variable: 'DATABASE_URL',
      message:
        'contains an example or change-me database password (replace POSTGRES_PASSWORD when using Compose)',
    });
  }

  validateUrl(
    issues,
    'REDIS_URL',
    env.REDIS_URL,
    new Set(['redis:', 'rediss:']),
    'Redis',
  );

  if (isBlank(env.REDIS_PASSWORD)) {
    issues.push({ variable: 'REDIS_PASSWORD', message: 'is required' });
  } else if (isKnownPlaceholderSecret(env.REDIS_PASSWORD!)) {
    issues.push({
      variable: 'REDIS_PASSWORD',
      message: 'must not use an example or change-me value',
    });
  }

  const jwtIssue = jwtSecretIssue(env.JWT_SECRET);
  if (jwtIssue) issues.push(jwtIssue);

  if (!isBlank(env.APP_PASSWORD) && isKnownPlaceholderSecret(env.APP_PASSWORD!)) {
    issues.push({
      variable: 'APP_PASSWORD',
      message: 'must not use an example or change-me value',
    });
  }
  if (env.HELPRR_ADMIN_PASSWORD_RESET === 'true' && isBlank(env.APP_PASSWORD)) {
    issues.push({
      variable: 'APP_PASSWORD',
      message: 'is required while HELPRR_ADMIN_PASSWORD_RESET=true',
    });
  } else if (env.HELPRR_ADMIN_PASSWORD_RESET === 'true') {
    const passwordError = localPasswordValidationError(env.APP_PASSWORD!);
    if (passwordError) {
      issues.push({
        variable: 'APP_PASSWORD',
        message: passwordError.slice('Password '.length).toLowerCase(),
      });
    }
  }

  if (issues.length > 0) throw new StartupConfigurationError(issues);
}
