/**
 * Links from the app into its guides (docs-site/, published at DOCS_URL). Every section
 * named here is a heading on docs-site/src/content/docs/troubleshooting.md; a test
 * (src/lib/__tests__/docs-links.test.ts) checks each one exists.
 */
export const DOCS_URL = 'https://saibarathr.github.io/helprr/';

export const TROUBLESHOOTING_SECTIONS = [
  'not-a-valid-address',
  'localhost-does-not-reach-your-server',
  'it-answered-but-not-as-that-app',
  'nothing-is-answering',
  'the-name-is-not-found',
  'no-answer-in-time',
  'the-address-cannot-be-reached',
  'the-connection-was-cut-off',
  'that-port-speaks-plain-http',
  'the-certificate-was-refused',
  'the-key-was-refused',
  'qbittorrent-blocks-helprr',
  'the-address-redirects',
] as const;

/** Which address to type for an app: the same stack, this machine, another machine. */
export const WHICH_ADDRESS_URL = 'https://saibarathr.github.io/helprr/connect/#which-address-to-use';

/** How to get back in: ask an admin, or recover the admin account from the server. */
export const SIGN_IN_HELP_URL = 'https://saibarathr.github.io/helprr/troubleshooting/#signing-in';

/** Backing up the database (backup.sh), keeping a copy off the host, and restoring. */
export const BACKUP_GUIDE_URL = 'https://saibarathr.github.io/helprr/maintain/backup/';

/** The privacy statement: no telemetry, and every outbound request Helprr makes. */
export const PRIVACY_URL = 'https://saibarathr.github.io/helprr/reference/privacy/';

export type TroubleshootingSection = (typeof TROUBLESHOOTING_SECTIONS)[number];

export function isTroubleshootingSection(value: unknown): value is TroubleshootingSection {
  return typeof value === 'string' && (TROUBLESHOOTING_SECTIONS as readonly string[]).includes(value);
}

export function troubleshootingUrl(section: TroubleshootingSection): string {
  return `${DOCS_URL}troubleshooting/#${section}`;
}
