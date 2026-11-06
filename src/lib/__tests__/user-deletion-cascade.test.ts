import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Deleting a user (Settings -> Users or Settings -> Account) relies on the
// schema to remove everything they own. Every relation to User must cascade,
// or the delete fails (a restrict) or leaves their rows behind (set null).
describe('user deletion cascade', () => {
  it('cascades every relation to User', () => {
    const schema = readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    const relations = schema
      .split('\n')
      .filter((line) => /^\s+\w+\s+User\??\s+@relation\(/.test(line));
    expect(relations.length).toBeGreaterThan(10);
    for (const line of relations) expect(line, line.trim()).toMatch(/onDelete:\s*Cascade/);
  });
});
