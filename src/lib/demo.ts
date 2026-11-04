// The local demo (docker-compose.demo.yml): fake apps, fake data, one public account.
// The account is fixed here, never read from APP_PASSWORD, so turning HELPRR_DEMO on in a
// real install can only show these words, never that install's password.
export const DEMO_USERNAME = 'demo';
export const DEMO_PASSWORD = 'helprr-demo-password';

export function isDemo(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HELPRR_DEMO === 'true';
}
