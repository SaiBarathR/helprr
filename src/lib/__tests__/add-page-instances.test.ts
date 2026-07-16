import { describe, expect, it } from 'vitest';
import { resolveAddPageInstance, type AddPageInstance } from '@/lib/add-page-instances';

const instances: AddPageInstance[] = [
  { id: 'radarr-english', label: 'English', isDefault: true },
  { id: 'radarr-tamil', label: 'Tamil', isDefault: false },
];

describe('resolveAddPageInstance', () => {
  it('uses a valid instance requested by an add-page link', () => {
    expect(resolveAddPageInstance(instances, 'radarr-tamil')).toBe('radarr-tamil');
  });

  it('falls back to the default instance when the request is invalid', () => {
    expect(resolveAddPageInstance(instances, 'missing')).toBe('radarr-english');
  });

  it('falls back to the first instance when none is marked as default', () => {
    const withoutDefault = instances.map((instance) => ({ ...instance, isDefault: false }));
    expect(resolveAddPageInstance(withoutDefault)).toBe('radarr-english');
  });

  it('returns undefined when no service instances are configured', () => {
    expect(resolveAddPageInstance([])).toBeUndefined();
  });
});
