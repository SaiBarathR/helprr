# Context Actions

Helprr adds native-style quick actions to entity surfaces through right-click on desktop and
long-press on touch or pen devices. These menus are shortcuts: visible buttons, links, drawers,
and confirmation dialogs remain the primary, discoverable controls.

## Interaction policy

- Add a context menu when an entity has at least two useful actions that already exist in the
  product. Do not invent a second action only to make a menu appear.
- **Entity-first:** Build each menu from that item's real product surface (detail-page operations,
  APIs, dialogs), not a generic template copied across unrelated entities.
- **Anti-redundancy:** Do not put an action in the context menu when the same control is already a
  visible icon on that entity's card or hero (for example schedule bell, watchlist bookmark). Prefer
  promoting detail-only or list shortcuts instead. After demoting redundant overlay actions, if fewer
  than two useful actions remain, the menu correctly stays hidden — poster icons still work.
- **Shortcut value:** Prefer actions that avoid opening the entity: Edit, Mark watched (Jellyfin),
  Interactive search, Manage files, Request, AniList score/status. Library list menus should expose
  Edit and Jellyfin watched when capabilities and data allow.
- Keep actions specific to the pressed entity. Typical groups are navigation, state changes, and
  destructive actions, with destructive actions last.
- Preserve native browser behavior for text, inputs, forms, media, and other surfaces where text
  selection or the browser menu is more useful than entity actions.
- Keep existing click, keyboard, swipe-row, selection-mode, and overflow-menu behavior intact.
  Opening a context menu closes any open swipe row, and selection modes disable conflicting entity
  menus.
- Long-press provides light haptic feedback only after the menu opens and suppresses the synthetic
  click that can follow the gesture. Entity triggers also suppress native text selection and the
  iOS touch callout during the gesture so PWA long-press does not highlight labels under the menu.
- Every menu includes a bottom icon toolbar for Back, Forward, and Reload. When the pressed entity
  has a navigable destination (an enabled action `href`, or a link trigger such as a media card),
  an Open in new tab control is included as well. Destinations are chosen from a primary open/go-to
  action when present, otherwise the first internal href, otherwise the trigger href.
- Context menus stay compact on touch (dense rows, content-width popover, slim toolbar). Fine-pointer
  desktop uses roomier padding, type, and icons, with the same Liquid Glass treatment as other
  Helprr floating surfaces.

## Safety rules

- Build menu actions from the same handlers, mutations, dialogs, and query invalidation paths used
  by visible controls. Do not duplicate business logic.
- Apply the same `useCan` capability checks as the visible action. The API remains the
  authoritative authorization boundary.
- Preserve the selected Sonarr, Radarr, or Lidarr `instanceId` through every context action.
- Destructive actions use the existing confirmation or undo flow. A context menu must never turn a
  confirmed operation into a one-click destructive operation.
- Show pending and disabled states truthfully and do not count them toward the minimum of two
  currently available actions.

## Current coverage

Context actions are available on qualifying media library cards, rows, overviews, detail entities,
collections, discovery and random results, anime results and library items, watchlist and calendar
items, requests, notifications, activity and history entries, torrents and torrent files, Prowlarr
entities, logs and log files, cleanup rules and history, library gaps, dashboard widgets, selected
Jellyfin entities, and qualifying settings administration rows.

**Library lists (movies, series, music):** Open, Edit (when edit caps allow), Mark watched (movies/
series, Jellyfin-matched), Monitor, Automatic search, Interactive search (movies only — single-item
releases), Preview rename (when `activity.manage`), Manage files/episodes or Files, Select, Delete
(confirmed).

Interactive search on series belongs on season and episode context menus; on music it belongs on
album, track, and artist file (single) context menus — not on the top-level series or artist library
lists.

**Discover / anime cards:** Open, Add or Open in library, Request (when applicable). Watchlist and
Schedule are omitted from the menu when poster icon buttons already expose them.

**Detail heroes:** Mark watched, Interactive search, Edit, Monitor, Refresh, Manage, Open in Jellyfin,
Delete. Watchlist and Schedule are omitted from the menu when hero icon buttons already expose them.

Static information, charts, credits and person/studio/character pages, form-only settings,
single-action rows, and surfaces where the browser's text/media menu is more valuable are
intentionally excluded.

## Checklist for new surfaces

1. Confirm the entity has at least two existing, useful actions.
2. Reuse existing handlers and permission gates; verify multi-instance routing.
3. Apply anti-redundancy: omit menu actions duplicated by visible poster/hero icons.
4. Prefer shortcut-value actions (Edit, watched, interactive search) over generic duplicates.
5. Put navigation first, mutations second, and destructive actions last.
6. Preserve confirmations, undo, pending states, selection mode, nested controls, and swipe rows.
7. Test desktop right-click and touch long-press at a mobile viewport, plus normal click and keyboard
   operation.
8. Add or update focused tests when shared action filtering or gesture behavior changes.
