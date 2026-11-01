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

  it('builds YouTube links from a handle, or from an id when there is no handle', () => {
    const { result } = renderHook(useCreatorPlatform, {
      wrapper: ({ children }) => <CreatorPlatformProvider platform="youtube">{children}</CreatorPlatformProvider>,
    });
    expect(result.current.externalVideoUrl('z7rgGfE8sug')).toBe('https://www.youtube.com/watch?v=z7rgGfE8sug');
    expect(result.current.externalCreatorUrl({ login: 'wanshowyt' })).toBe('https://www.youtube.com/@wanshowyt');
    expect(result.current.externalCreatorUrl({ login: 'UCVlfe3MRSCZSeIWByrWHhkg' })).toBe('https://www.youtube.com/channel/UCVlfe3MRSCZSeIWByrWHhkg');
    expect(result.current.followBody('wanshowyt')).toEqual({ input: '@wanshowyt' });
  });

  it('offers no rules on YouTube until they exist', () => {
    const { result } = renderHook(useCreatorPlatform, {
      wrapper: ({ children }) => <CreatorPlatformProvider platform="youtube">{children}</CreatorPlatformProvider>,
    });
    expect(result.current.downloads).toBe(true);
    expect(result.current.autoDownload).toBe(false);
  });

  it('fails outside a section rather than showing another platform', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Name />)).toThrow('CreatorPlatformProvider');
    quiet.mockRestore();
  });
});
