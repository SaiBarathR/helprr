// @vitest-environment jsdom

import { act, createElement, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface CapturedCreditsProps {
  loading?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
}

interface QueryResult {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  capturedProps: undefined as CapturedCreditsProps | undefined,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: mocks.useQuery,
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '1' }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/media/credits-list-page', () => ({
  CreditsListPage: (props: CapturedCreditsProps) => {
    mocks.capturedProps = props;
    return null;
  },
}));

import DiscoverMovieCreditsPage from '@/app/(app)/discover/movie/[id]/credits/page';
import DiscoverTvCreditsPage from '@/app/(app)/discover/tv/[id]/credits/page';
import MovieCreditsPage from '@/app/(app)/movies/[id]/credits/page';
import SeriesCreditsPage from '@/app/(app)/series/[id]/credits/page';

const routes: {
  name: string;
  Page: ComponentType;
  cachedData: unknown;
}[] = [
  { name: 'movie credits', Page: MovieCreditsPage, cachedData: [] },
  {
    name: 'series credits',
    Page: SeriesCreditsPage,
    cachedData: { cast: [], crew: [] },
  },
  {
    name: 'discover movie credits',
    Page: DiscoverMovieCreditsPage,
    cachedData: { title: 'Movie', cast: [], crew: [] },
  },
  {
    name: 'discover TV credits',
    Page: DiscoverTvCreditsPage,
    cachedData: { title: 'Series', cast: [], crew: [] },
  },
];

let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
});

function queryResult(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

async function renderRoute(Page: ComponentType, creditsResult: QueryResult) {
  mocks.useQuery.mockImplementation(
    ({ queryKey }: { queryKey: readonly unknown[] }) =>
      queryKey.includes('credits')
        ? creditsResult
        : queryResult({ data: { title: 'Title' } }),
  );
  await act(async () => {
    root.render(createElement(Page));
  });
  return mocks.capturedProps;
}

describe.each(routes)('$name query states', ({ Page, cachedData }) => {
  it('shows a retryable error only when the initial request fails', async () => {
    const result = queryResult({ isError: true, error: new Error('upstream failed') });
    const props = await renderRoute(Page, result);

    expect(props?.loading).toBe(false);
    expect(props?.errorMessage).toBe("Couldn't load credits. Try again.");
    props?.onRetry?.();
    expect(result.refetch).toHaveBeenCalledOnce();
  });

  it('shows a spinner only while the initial request is pending', async () => {
    const props = await renderRoute(Page, queryResult({ isLoading: true }));

    expect(props?.loading).toBe(true);
    expect(props?.errorMessage).toBeNull();
  });

  it('preserves successful empty data', async () => {
    const props = await renderRoute(Page, queryResult({ data: cachedData }));

    expect(props?.loading).toBe(false);
    expect(props?.errorMessage).toBeNull();
  });

  it('keeps cached data visible after a background-refetch failure', async () => {
    const props = await renderRoute(Page, queryResult({
      data: cachedData,
      isError: true,
      error: new Error('background refresh failed'),
    }));

    expect(props?.loading).toBe(false);
    expect(props?.errorMessage).toBeNull();
  });

  it('reports retry progress from the active query', async () => {
    const props = await renderRoute(Page, queryResult({
      isError: true,
      isFetching: true,
      error: new Error('upstream failed'),
    }));

    expect(props?.retrying).toBe(true);
  });
});
