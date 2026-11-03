import { describe, expect, it } from 'vitest';
import { cleanCookiesFile } from './cookies';

const row = (domain: string, name: string, value = 'not-a-real-value') => [domain, 'TRUE', '/', 'TRUE', '0', name, value].join('\t');
const signedIn = row('.youtube.com', '__Secure-3PSID');

describe('cleanCookiesFile', () => {
  it('keeps a signed-in YouTube export', () => {
    const result = cleanCookiesFile(`# Netscape HTTP Cookie File\n${signedIn}\n${row('.google.com', 'SID')}\n`);
    expect(result).toEqual({ cookies: `# Netscape HTTP Cookie File\n${signedIn}\n${row('.google.com', 'SID')}\n` });
  });

  it('accepts the HttpOnly form exports use', () => {
    expect(cleanCookiesFile(row('#HttpOnly_.youtube.com', 'LOGIN_INFO'))).toHaveProperty('cookies');
  });

  it('drops every other site, so a whole-browser export keeps nothing else', () => {
    const result = cleanCookiesFile(`${signedIn}\n${row('.bank.example', 'session', 'private')}\n${row('.youtube.com.evil.example', 'SID')}\n`);
    expect(result).toEqual({ cookies: `# Netscape HTTP Cookie File\n${signedIn}\n` });
  });

  it.each([
    ['anything else', 'hello there', 'not a cookies.txt'],
    ['no YouTube cookies', row('.google.com', 'SID'), 'no youtube.com'],
    ['a signed-out export', row('.youtube.com', 'VISITOR_INFO1_LIVE'), 'not signed in'],
    ['an oversized file', 'x'.repeat(70_000), 'too large'],
  ])('refuses %s', (_label, text, message) => {
    expect((cleanCookiesFile(text) as { error: string }).error).toContain(message);
  });

  it('never repeats what it was given in an error', () => {
    const { error } = cleanCookiesFile(row('.youtube.com', 'other', 'secret-value')) as { error: string };
    expect(error).not.toContain('secret-value');
  });
});
