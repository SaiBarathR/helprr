import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('local Prisma commands', () => {
  it('load the Node development database target explicitly from .env.local', () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };

    for (const scriptName of ['db:migrate', 'db:deploy']) {
      const command = packageJson.scripts?.[scriptName];
      expect(command, `${scriptName} must exist`).toBeTypeOf('string');
      expect(command).toContain('node --env-file=.env.local');
      expect(command).toContain('./node_modules/prisma/build/index.js');
      expect(command).not.toContain('npx prisma');
    }
  });
});
