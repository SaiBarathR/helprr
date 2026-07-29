import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from '@/lib/capabilities';

const AUTH_CALLS = new Set([
  'getCurrentSession',
  'getCurrentUser',
  'getSession',
  'requireAdmin',
  'requireAuth',
  'requireCapability',
  'requireSession',
  'requireUser',
  'requireUserCapability',
]);

const POLICY_GROUPS: Readonly<Record<string, readonly string[]>> = {
  admin: [
    'GET /api/admin/support-bundle',
    'GET /api/admin/update-check',
    'GET /api/anilist/library',
    'GET /api/anilist/list-entry',
    'GET /api/anilist/viewer',
    'GET /api/anime/automap/status',
    'GET /api/file-audit',
    'GET /api/settings/anime-mappings',
    'GET /api/users/[id]/permissions',
    'GET /api/users/[id]',
    'GET /api/users',
  ],
  authenticated: [
    'GET /api/anime/[id]',
    'GET /api/anime/character/[id]',
    'GET /api/anime/home',
    'GET /api/anime/manga/[id]',
    'GET /api/anime/schedule',
    'GET /api/anime/staff/[id]',
    'GET /api/anime/studio/[id]',
    'GET /api/discover/collection/[id]',
    'GET /api/discover/filters',
    'GET /api/discover/item',
    'GET /api/discover/movie/[id]',
    'GET /api/discover/person',
    'GET /api/discover/tv/[id]',
    'GET /api/discover/tv/[id]/season/[seasonNumber]',
    'GET /api/instances',
    'GET /api/lidarr/lookup',
    'GET /api/lidarr/metadataprofiles',
    'GET /api/lidarr/qualityprofiles',
    'GET /api/radarr/credit',
    'GET /api/radarr/languages',
    'GET /api/radarr/lookup',
    'GET /api/radarr/qualitydefinitions',
    'GET /api/radarr/qualityprofiles',
    'GET /api/radarr/tags',
    'GET /api/services/anilist/callback',
    'GET /api/settings/discover-layout',
    'GET /api/settings',
    'GET /api/settings/watch-provider-regions',
    'GET /api/sonarr/[id]/credits',
    'GET /api/sonarr/languages',
    'GET /api/sonarr/lookup',
    'GET /api/sonarr/qualitydefinitions',
    'GET /api/sonarr/qualityprofiles',
    'GET /api/sonarr/tags',
  ],
  'authenticated/per-user': [
    'GET /api/badges',
    'GET /api/dashboard-layouts/active',
    'GET /api/dashboard-layouts',
    'GET /api/image',
    'GET /api/lidarr/rootfolders',
    'GET /api/me',
    'GET /api/me/settings',
    'GET /api/push/public-key',
    'GET /api/radarr/rootfolders',
    'GET /api/search/providers/[provider]',
    'GET /api/search',
    'GET /api/services/stats',
    'GET /api/sessions',
    'GET /api/sonarr/rootfolders',
    'GET /api/storage/trend',
  ],
  'cap:activity.manage': [
    'GET /api/activity/manualimport',
    'GET /api/lidarr/command/[id]',
    'GET /api/lidarr/downloadclient',
    'GET /api/lidarr/release',
    'GET /api/lidarr/rename',
    'GET /api/radarr/command/[id]',
    'GET /api/radarr/downloadclient',
    'GET /api/radarr/release',
    'GET /api/radarr/rename',
    'GET /api/sonarr/command/[id]',
    'GET /api/sonarr/downloadclient',
    'GET /api/sonarr/release',
    'GET /api/sonarr/rename',
  ],
  'cap:activity.view': [
    'GET /api/activity/history',
    'GET /api/activity/queue',
    'GET /api/activity/recent',
    'GET /api/activity/wanted',
  ],
  'cap:anime.view': [
    'GET /api/anime/[id]/sonarr',
    'GET /api/anime',
  ],
  'cap:calendar.view': [
    'GET /api/calendar',
  ],
  'cap:cleanup.view': [
    'GET /api/cleanup/download/config',
    'GET /api/cleanup/download/seeding-rules',
    'GET /api/cleanup/history',
    'GET /api/cleanup/queue/config',
    'GET /api/cleanup/queue/slow-rules',
    'GET /api/cleanup/queue/stall-rules',
    'GET /api/cleanup/scheduler-status',
    'GET /api/cleanup/scope-options',
    'GET /api/cleanup/stats',
    'GET /api/cleanup/strikes',
  ],
  'cap:discover.view': [
    'GET /api/discover',
  ],
  'cap:insights.view': [
    'GET /api/insights/downloads',
    'GET /api/insights/jellyfin-libraries',
    'GET /api/insights/library',
    'GET /api/insights/media-analysis/files',
    'GET /api/insights/media-analysis',
    'GET /api/insights/pipeline',
    'GET /api/insights/storage',
    'GET /api/insights/torrents',
  ],
  'cap:jellyfin.control': [
    'GET /api/jellyfin/activity',
    'GET /api/jellyfin/devices',
    'GET /api/jellyfin/system',
    'GET /api/jellyfin/tasks',
  ],
  'cap:jellyfin.sessions': [
    'GET /api/jellyfin/sessions',
    'GET /api/jellyfin/users',
  ],
  'cap:jellyfin.stats': [
    'GET /api/jellyfin/playback/activity',
    'GET /api/jellyfin/playback/breakdown/[type]',
    'GET /api/jellyfin/playback/custom-history',
    'GET /api/jellyfin/playback/filters',
    'GET /api/jellyfin/playback/hourly',
    'GET /api/jellyfin/playback/movies',
    'GET /api/jellyfin/playback/tv-shows',
    'GET /api/jellyfin/playback/user-list',
    'GET /api/jellyfin/playback/users',
  ],
  'cap:jellyfin.view': [
    'GET /api/jellyfin/counts',
    'GET /api/jellyfin/image',
    'GET /api/jellyfin/libraries',
    'GET /api/jellyfin/lookup',
    'GET /api/jellyfin/playback/history',
    'GET /api/jellyfin/recently-added',
    'GET /api/jellyfin/resume',
    'GET /api/jellyfin/watch-status',
    'GET /api/jellyfin/watch-status/series',
  ],
  'cap:logs.view': [
    'GET /api/logs/download',
    'GET /api/logs/files',
    'GET /api/logs/search',
  ],
  'cap:movies.manageFiles': [
    'GET /api/radarr/config',
    'GET /api/radarr/manualimport/scan',
  ],
  'cap:movies.view': [
    'GET /api/radarr/[id]',
    'GET /api/radarr/collections',
    'GET /api/radarr/history/movie',
    'GET /api/radarr/moviefile',
    'GET /api/radarr',
  ],
  'cap:music.view': [
    'GET /api/lidarr/[id]/albums',
    'GET /api/lidarr/[id]',
    'GET /api/lidarr/album/[albumId]',
    'GET /api/lidarr/album/[albumId]/tracks',
    'GET /api/lidarr/health',
    'GET /api/lidarr/history/artist',
    'GET /api/lidarr',
    'GET /api/lidarr/tags',
    'GET /api/lidarr/trackfile',
    'GET /api/lidarr/wanted',
  ],
  'cap:notifications.view': [
    'GET /api/notifications/event-types',
    'GET /api/notifications',
  ],
  'cap:prowlarr.view': [
    'GET /api/prowlarr/appprofile',
    'GET /api/prowlarr/history',
    'GET /api/prowlarr/indexers',
    'GET /api/prowlarr/schema',
    'GET /api/prowlarr/stats',
    'GET /api/prowlarr/status',
  ],
  'cap:random.view': [
    'GET /api/random-watch',
  ],
  'cap:recommendations.view': [
    'GET /api/recommendations/feed',
    'GET /api/recommendations/for-you',
    'GET /api/recommendations',
    'GET /api/recommendations/trailer',
  ],
  'cap:requests.approve': [
    'GET /api/seerr/requests/count',
    'GET /api/seerr/users',
  ],
  'cap:requests.create': [
    'GET /api/seerr/service/[service]',
  ],
  'cap:requests.view': [
    'GET /api/seerr/pending-requests',
    'GET /api/seerr/requests/[id]',
    'GET /api/seerr/requests',
    'GET /api/seerr/tv/[tmdbId]',
    'GET /api/seerr/users/[id]/quota',
    'GET /api/seerr/users/[id]/requests',
  ],
  'cap:scheduledAlerts.view': [
    'GET /api/scheduled-alerts',
  ],
  'cap:series.manageFiles': [
    'GET /api/sonarr/config',
    'GET /api/sonarr/manualimport/scan',
  ],
  'cap:series.view': [
    'GET /api/library-gaps',
    'GET /api/sonarr/[id]/anime/candidates',
    'GET /api/sonarr/[id]/anime',
    'GET /api/sonarr/[id]/episodes',
    'GET /api/sonarr/[id]',
    'GET /api/sonarr/episodefile',
    'GET /api/sonarr',
  ],
  'cap:settings.instances': [
    'GET /api/services',
  ],
  'cap:settings.notifications': [
    'GET /api/notifications/preferences',
    'GET /api/notifications/subscriptions',
  ],
  'cap:settings.storage': [
    'GET /api/settings/cache',
    'GET /api/settings/disk-thresholds',
  ],
  'cap:torrents.view': [
    'GET /api/qbittorrent/[hash]/details',
    'GET /api/qbittorrent/[hash]/files',
    'GET /api/qbittorrent/bandwidth-schedule',
    'GET /api/qbittorrent/categories',
    'GET /api/qbittorrent',
    'GET /api/qbittorrent/summary',
    'GET /api/qbittorrent/transfer/limits',
    'GET /api/qbittorrent/transfer',
  ],
  'cap:watchlist.view': [
    'GET /api/watchlist',
    'GET /api/watchlist/tags',
  ],
  'filtered-capability': [
    'GET /api/services/external-urls',
    'GET /api/services/health',
    'GET /api/services/widget-availability',
  ],
  public: [
    'GET /api/health',
    'GET /api/ready',
  ],
};

interface CallEvidence {
  readonly name: string;
  readonly stringArguments: readonly string[];
}

interface HandlerEvidence {
  readonly calls: readonly CallEvidence[];
  readonly handlerText: string;
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function findRouteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return findRouteFiles(target);
    return entry.name === 'route.ts' ? [target] : [];
  });
}

function collectStringLiterals(node: ts.Node): string[] {
  const values: string[] = [];
  const visit = (child: ts.Node) => {
    if (ts.isStringLiteral(child)) values.push(child.text);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return values;
}

function collectCalls(node: ts.Node): CallEvidence[] {
  const calls: CallEvidence[] = [];
  const visit = (child: ts.Node) => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && AUTH_CALLS.has(child.expression.text)) {
      calls.push({
        name: child.expression.text,
        stringArguments: child.arguments.flatMap(collectStringLiterals),
      });
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return calls;
}

function resolveWrappedHandler(
  initializer: ts.Expression | undefined,
  functions: Map<string, ts.FunctionDeclaration>,
): ts.Node | undefined {
  if (!initializer) return undefined;
  if (ts.isIdentifier(initializer)) return functions.get(initializer.text) ?? initializer;
  if (ts.isCallExpression(initializer)) {
    const handler = initializer.arguments.find(
      (argument): argument is ts.Identifier => ts.isIdentifier(argument) && functions.has(argument.text),
    );
    if (handler) return functions.get(handler.text);
  }
  return initializer;
}

function discoverGetHandlers(): Map<string, HandlerEvidence> {
  const apiRoot = path.join(process.cwd(), 'src/app/api');
  const handlers = new Map<string, HandlerEvidence>();

  for (const file of findRouteFiles(apiRoot).sort()) {
    const fileText = readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, fileText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const functions = new Map(
      source.statements
        .filter(ts.isFunctionDeclaration)
        .filter((statement): statement is ts.FunctionDeclaration & { name: ts.Identifier } => Boolean(statement.name))
        .map((statement) => [statement.name.text, statement]),
    );
    const route = `/api/${path.relative(apiRoot, path.dirname(file)).split(path.sep).join('/')}`
      .replace(/\/\.$/, '');

    const add = (node: ts.Node | undefined) => {
      if (!node) throw new Error(`Could not resolve GET ${route}`);
      const key = `GET ${route}`;
      if (handlers.has(key)) throw new Error(`Duplicate GET handler: ${key}`);
      handlers.set(key, {
        calls: collectCalls(node),
        handlerText: node.getText(source),
      });
    };

    for (const statement of source.statements) {
      if (
        ts.isFunctionDeclaration(statement)
        && statement.name?.text === 'GET'
        && hasExportModifier(statement)
      ) {
        add(statement);
      }
      if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === 'GET') {
            add(resolveWrappedHandler(declaration.initializer, functions));
          }
        }
      }
    }
  }

  return handlers;
}

function policyAssignments(): Map<string, string> {
  const assignments = new Map<string, string>();
  for (const [policy, routes] of Object.entries(POLICY_GROUPS)) {
    for (const route of routes) {
      if (assignments.has(route)) throw new Error(`Duplicate policy assignment: ${route}`);
      assignments.set(route, policy);
    }
  }
  return assignments;
}

function hasCall(evidence: HandlerEvidence, name: string, stringArgument?: string): boolean {
  return evidence.calls.some((call) =>
    call.name === name
    && (stringArgument === undefined || call.stringArguments.includes(stringArgument))
  );
}

describe('GET API route capability matrix', () => {
  const handlers = discoverGetHandlers();
  const assignments = policyAssignments();

  it('explicitly assigns every GET handler exactly once', () => {
    expect(handlers.size).toBe(195);
    expect([...assignments.keys()].sort()).toEqual([...handlers.keys()].sort());
  });

  it('uses valid capabilities and enforces every direct capability policy', () => {
    const known = new Set<string>(CAPABILITIES);
    for (const [policy, routes] of Object.entries(POLICY_GROUPS)) {
      if (!policy.startsWith('cap:')) continue;
      const capability = policy.slice(4);
      expect(known.has(capability), `Unknown GET matrix capability: ${capability}`).toBe(true);
      for (const route of routes) {
        const evidence = handlers.get(route)!;
        expect(
          hasCall(evidence, 'requireCapability', capability)
            || hasCall(evidence, 'requireUserCapability', capability),
          `${route} must require ${capability}`,
        ).toBe(true);
      }
    }
  });

  it('enforces the declared admin, authenticated, per-user, and public policies', () => {
    for (const route of POLICY_GROUPS.admin) {
      expect(hasCall(handlers.get(route)!, 'requireAdmin'), route).toBe(true);
    }
    for (const route of POLICY_GROUPS.authenticated) {
      expect(hasCall(handlers.get(route)!, 'requireAuth'), route).toBe(true);
    }
    for (const route of POLICY_GROUPS['authenticated/per-user']) {
      const evidence = handlers.get(route)!;
      expect(
        hasCall(evidence, 'requireUser') || hasCall(evidence, 'requireSession'),
        route,
      ).toBe(true);
    }
    for (const route of POLICY_GROUPS.public) {
      expect(handlers.get(route)!.calls, `${route} must remain dependency-free/public`).toEqual([]);
    }
  });

  it('keeps filtered connection reads user-resolved and capability-filtered', () => {
    for (const route of POLICY_GROUPS['filtered-capability']) {
      const evidence = handlers.get(route)!;
      expect(hasCall(evidence, 'requireUser'), route).toBe(true);
      expect(
        evidence.handlerText.includes('SERVICE_VIEW_CAPABILITY')
          || evidence.handlerText.includes('filterVisibleServiceTypes'),
        route,
      ).toBe(true);
    }
  });
});
