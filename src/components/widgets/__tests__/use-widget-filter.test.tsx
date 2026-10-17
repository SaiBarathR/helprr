// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useWidgetFilter } from '../use-widget-filter';

type Filters = { service: string; limit: number };
let root: Root;

function Widget({ id }: { id: string }) {
  // A new defaults object every render, as several call sites pass inline.
  const [filters, update, reset] = useWidgetFilter<Filters>(id, { service: 'all', limit: 10 });
  return <>
    <p>{JSON.stringify(filters)}</p>
    <button onClick={() => update({ service: 'sonarr', limit: 5 })}>choose</button>
    <button onClick={reset}>reset</button>
  </>;
}
const render = (id: string) => act(async () => root.render(<Widget id={id} />));
const shown = () => JSON.parse(document.querySelector('p')!.textContent!) as Filters;
const click = (label: string) => act(async () => {
  [...document.querySelectorAll('button')].find((b) => b.textContent === label)!.click();
});

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(() => act(() => root.unmount()));

it('renders the defaults on the server, then the stored filters in the browser', async () => {
  window.localStorage.setItem('helprr-widget-filters:queue', JSON.stringify({ service: 'radarr' }));
  expect(renderToString(<Widget id="queue" />)).toContain(JSON.stringify({ service: 'all', limit: 10 }).replace(/"/g, '&quot;'));

  await render('queue');
  expect(shown()).toEqual({ service: 'radarr', limit: 10 });
});

it('keeps a choice when the defaults arrive as a new object on every render', async () => {
  await render('queue');
  await click('choose');
  await render('queue');
  await render('queue');

  expect(shown()).toEqual({ service: 'sonarr', limit: 5 });
});

it("reads the new widget's own filters when the widget id changes", async () => {
  window.localStorage.setItem('helprr-widget-filters:history', JSON.stringify({ limit: 50 }));
  await render('queue');
  await click('choose');

  await render('history');
  expect(shown()).toEqual({ service: 'all', limit: 50 });
  await render('queue');
  expect(shown()).toEqual({ service: 'sonarr', limit: 5 });
});

it("resets to the defaults, and follows another tab's change", async () => {
  await render('queue');
  await click('choose');
  await click('reset');
  expect(shown()).toEqual({ service: 'all', limit: 10 });
  expect(window.localStorage.getItem('helprr-widget-filters:queue')).toBeNull();

  window.localStorage.setItem('helprr-widget-filters:queue', JSON.stringify({ service: 'lidarr' }));
  await act(async () => {
    window.dispatchEvent(new StorageEvent('storage', { key: 'helprr-widget-filters:queue' }));
  });
  expect(shown()).toEqual({ service: 'lidarr', limit: 10 });
});
