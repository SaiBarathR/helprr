// @vitest-environment jsdom
import { render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CreatorPlatformProvider, useCreatorPlatform } from './platform';

function Name() {
  return <p>{useCreatorPlatform().name}</p>;
}

describe('useCreatorPlatform', () => {
  it('names the section it is in', () => {
    render(<CreatorPlatformProvider platform="twitch"><Name /></CreatorPlatformProvider>);
    expect(screen.getByText('Twitch')).toBeTruthy();
  });

  it('builds links to the platform', () => {
    const { result } = renderHook(useCreatorPlatform, {
      wrapper: ({ children }) => <CreatorPlatformProvider platform="twitch">{children}</CreatorPlatformProvider>,
    });
    expect(result.current.externalVideoUrl('123')).toBe('https://www.twitch.tv/videos/123');
    expect(result.current.creatorsPath).toBe('/twitch/streamers');
  });

  it('fails outside a section rather than showing another platform', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Name />)).toThrow('CreatorPlatformProvider');
    quiet.mockRestore();
  });
});
