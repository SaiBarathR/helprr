import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, type Capability } from '@/lib/capabilities';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const AUTH_CALLS = new Set([
  'getCurrentSid',
  'requireAdmin',
  'requireAuth',
  'requireCapability',
  'requireSession',
  'requireUser',
  'requireUserCapability',
]);

const POLICY_GROUPS: Record<string, readonly string[]> = {
  public: [
    'POST /api/auth/jellyfin',
    'POST /api/auth/login',
  ],
  'optional-session': [
    'POST /api/auth/logout',
  ],
  authenticated: [
    'POST /api/logs/client',
    'PATCH /api/me/settings',
    'POST /api/notifications/subscription/check',
    'POST /api/push/subscribe',
    'DELETE /api/push/subscribe',
    'POST /api/sessions/[id]/revoke',
    'PATCH /api/sessions/[id]',
    'POST /api/sessions/revoke-others',
    'POST /api/share',
  ],
  admin: [
    'POST /api/anilist/list-entry',
    'DELETE /api/anilist/list-entry',
    'POST /api/anime/automap/run',
    'POST /api/anime/automap/stop',
    'DELETE /api/settings/anime-mappings/[seriesId]',
    'DELETE /api/settings/anime-mappings',
    'PUT /api/settings/discover-layout',
    'PUT /api/settings',
    'POST /api/sonarr/[id]/anime',
    'PATCH /api/sonarr/[id]/anime',
    'DELETE /api/sonarr/[id]/anime',
    'PUT /api/users/[id]/permissions',
    'PATCH /api/users/[id]',
    'DELETE /api/users/[id]',
    'POST /api/users',
  ],
  'cap:activity.manage': [
    'POST /api/activity/manualimport',
    'DELETE /api/activity/queue/[id]',
    'POST /api/lidarr/command',
    'POST /api/lidarr/release',
    'POST /api/radarr/command',
    'POST /api/radarr/release',
    'POST /api/sonarr/command',
    'POST /api/sonarr/release',
  ],
  'cap:cleanup.manage': [
    'PUT /api/cleanup/download/config',
    'POST /api/cleanup/download/preview',
    'POST /api/cleanup/download/run',
    'POST /api/cleanup/download/save-all',
    'PUT /api/cleanup/download/seeding-rules/[id]',
    'DELETE /api/cleanup/download/seeding-rules/[id]',
    'POST /api/cleanup/download/seeding-rules/reorder',
    'POST /api/cleanup/download/seeding-rules',
    'DELETE /api/cleanup/history',
    'PUT /api/cleanup/queue/config',
    'POST /api/cleanup/queue/preview',
    'POST /api/cleanup/queue/run',
    'POST /api/cleanup/queue/save-all',
    'PUT /api/cleanup/queue/slow-rules/[id]',
    'DELETE /api/cleanup/queue/slow-rules/[id]',
    'POST /api/cleanup/queue/slow-rules',
    'PUT /api/cleanup/queue/stall-rules/[id]',
    'DELETE /api/cleanup/queue/stall-rules/[id]',
    'POST /api/cleanup/queue/stall-rules',
  ],
  'cap:dashboard.customize': [
    'POST /api/dashboard-layouts/[id]/copy',
    'POST /api/dashboard-layouts/[id]/reset',
    'PUT /api/dashboard-layouts/[id]',
    'DELETE /api/dashboard-layouts/[id]',
    'PUT /api/dashboard-layouts/defaults',
    'POST /api/dashboard-layouts',
  ],
  'cap:jellyfin.control': [
    'DELETE /api/jellyfin/devices',
    'POST /api/jellyfin/system/control',
    'POST /api/jellyfin/tasks/[taskId]',
    'DELETE /api/jellyfin/tasks/[taskId]',
  ],
  'cap:jellyfin.watchedState': ['POST /api/jellyfin/watch-status'],
  'cap:logs.manage': ['DELETE /api/logs/files'],
  'cap:movies.add': [
    'POST /api/radarr/collections',
    'POST /api/radarr',
  ],
  'cap:movies.delete': [
    'DELETE /api/radarr/[id]',
    'DELETE /api/radarr/editor',
    'DELETE /api/radarr/moviefile',
  ],
  'cap:movies.editMonitoring': ['PUT /api/radarr/collections'],
  'cap:movies.editTags': ['POST /api/radarr/tags'],
  'cap:movies.manageFiles': [
    'POST /api/radarr/manualimport/import',
    'POST /api/radarr/manualimport/scan',
    'PUT /api/radarr/moviefile',
  ],
  'cap:music.add': ['POST /api/lidarr'],
  'cap:music.delete': [
    'DELETE /api/lidarr/[id]',
    'DELETE /api/lidarr/album/[albumId]',
    'DELETE /api/lidarr/editor',
    'DELETE /api/lidarr/trackfile',
  ],
  'cap:music.editMonitoring': [
    'PUT /api/lidarr/album/[albumId]',
    'PUT /api/lidarr/album/monitor',
  ],
  'cap:music.editTags': ['POST /api/lidarr/tags'],
  'cap:notifications.view': [
    'PUT /api/notifications/[id]',
    'DELETE /api/notifications/[id]',
    'POST /api/notifications/read-all',
    'DELETE /api/notifications',
  ],
  'cap:prowlarr.manage': [
    'POST /api/prowlarr/command',
    'DELETE /api/prowlarr/indexers/[id]',
    'POST /api/prowlarr/indexers/[id]/test',
    'POST /api/prowlarr/indexers',
    'POST /api/prowlarr/indexers/testall',
  ],
  'cap:recommendations.view': [
    // Events/rebuild are per-user writes scoped to the caller (no ownership
    // params to escalate), so the read capability is the right gate.
    'POST /api/recommendations/events',
    'POST /api/recommendations/rebuild',
  ],
  'cap:requests.approve': [
    'POST /api/seerr/pending-requests/[id]/approve',
    'POST /api/seerr/requests/[id]/approve',
    'POST /api/seerr/requests/[id]/decline',
    'POST /api/seerr/requests/[id]/retry',
    'PUT /api/seerr/requests/[id]',
    'DELETE /api/seerr/requests/[id]',
  ],
  'cap:requests.create': ['POST /api/seerr/requests'],
  'cap:scheduledAlerts.edit': [
    'DELETE /api/scheduled-alerts/[id]/occurrences/[occurrenceId]',
    'PATCH /api/scheduled-alerts/[id]',
    'DELETE /api/scheduled-alerts/[id]',
    'POST /api/scheduled-alerts',
  ],
  'cap:scheduledAlerts.view': ['POST /api/scheduled-alerts/preview'],
  'cap:series.add': ['POST /api/sonarr'],
  'cap:series.delete': [
    'DELETE /api/sonarr/[id]',
    'DELETE /api/sonarr/editor',
    'DELETE /api/sonarr/episodefile',
  ],
  'cap:series.editMonitoring': ['PUT /api/sonarr/episode/monitor'],
  'cap:series.editTags': ['POST /api/sonarr/tags'],
  'cap:series.manageFiles': [
    'PUT /api/sonarr/episodefile',
    'POST /api/sonarr/manualimport/import',
    'POST /api/sonarr/manualimport/scan',
  ],
  'cap:settings.backup': [
    'POST /api/settings/export',
    'POST /api/settings/import',
  ],
  'cap:settings.instances': [
    'DELETE /api/services/[id]',
    'PATCH /api/services/[id]',
    'POST /api/services/anilist/authorize',
    'POST /api/services/anilist/disconnect',
    'PUT /api/services/external-url',
    'POST /api/services',
    'POST /api/services/test',
  ],
  'cap:settings.notifications': [
    'POST /api/notifications/preferences',
    'DELETE /api/notifications/subscriptions',
    'POST /api/notifications/test',
  ],
  'cap:settings.storage': [
    'DELETE /api/settings/cache',
    'PUT /api/settings/disk-thresholds',
  ],
  'cap:torrents.add': ['POST /api/qbittorrent'],
  'cap:torrents.bandwidth': [
    'PUT /api/qbittorrent/bandwidth-schedule',
    'POST /api/qbittorrent/transfer/limits',
  ],
  'cap:torrents.manage': ['POST /api/qbittorrent/[hash]/files/priority'],
  'cap:watchlist.edit': [
    'DELETE /api/watchlist/[id]',
    'PATCH /api/watchlist/[id]',
    'PATCH /api/watchlist/bulk',
    'DELETE /api/watchlist/bulk',
    'POST /api/watchlist',
    'DELETE /api/watchlist',
    'PATCH /api/watchlist/tags/[id]',
    'DELETE /api/watchlist/tags/[id]',
  ],
};

interface SpecialPolicy {
  readonly kind: 'dynamic-capability' | 'field-capability' | 'owned-or-capability';
  readonly marker: string;
  readonly capabilities: readonly Capability[];
}

const SPECIAL_POLICIES: Record<string, SpecialPolicy> = {
  'POST /api/qbittorrent/[hash]': {
    kind: 'dynamic-capability',
    marker: 'actionCapability',
    capabilities: ['torrents.delete', 'torrents.bandwidth', 'torrents.manage'],
  },
  'PUT /api/sonarr/editor': {
    kind: 'field-capability',
    marker: 'guardBulkEdit',
    capabilities: ['series.editMonitoring', 'series.editTags'],
  },
  'PUT /api/radarr/editor': {
    kind: 'field-capability',
    marker: 'guardBulkEdit',
    capabilities: ['movies.editMonitoring', 'movies.editTags'],
  },
  'PUT /api/lidarr/editor': {
    kind: 'field-capability',
    marker: 'guardBulkEdit',
    capabilities: ['music.editMonitoring', 'music.editTags'],
  },
  'PUT /api/sonarr/[id]': {
    kind: 'field-capability',
    marker: 'guardLibraryEdit',
    capabilities: ['series.editTags', 'series.changePath', 'series.editMonitoring'],
  },
  'PUT /api/radarr/[id]': {
    kind: 'field-capability',
    marker: 'guardLibraryEdit',
    capabilities: ['movies.editTags', 'movies.changePath', 'movies.editMonitoring'],
  },
  'PUT /api/lidarr/[id]': {
    kind: 'field-capability',
    marker: 'guardLibraryEdit',
    capabilities: ['music.editTags', 'music.changePath', 'music.editMonitoring'],
  },
  'DELETE /api/seerr/pending-requests/[id]': {
    kind: 'owned-or-capability',
    marker: 'isOwner',
    capabilities: ['requests.approve'],
  },
};

interface CallEvidence {
  readonly name: string;
  readonly stringArguments: readonly string[];
}

interface HandlerEvidence {
  readonly calls: readonly CallEvidence[];
  readonly fileText: string;
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

function discoverMutatingHandlers(): Map<string, HandlerEvidence> {
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

    const add = (method: string, node: ts.Node | undefined) => {
      if (!node) throw new Error(`Could not resolve ${method} ${route}`);
      const key = `${method} ${route}`;
      if (handlers.has(key)) throw new Error(`Duplicate mutating handler: ${key}`);
      handlers.set(key, {
        calls: collectCalls(node),
        fileText,
        handlerText: node.getText(source),
      });
    };

    for (const statement of source.statements) {
      if (
        ts.isFunctionDeclaration(statement)
        && statement.name
        && MUTATING_METHODS.has(statement.name.text)
        && hasExportModifier(statement)
      ) {
        add(statement.name.text, statement);
      }
      if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && MUTATING_METHODS.has(declaration.name.text)) {
            add(declaration.name.text, resolveWrappedHandler(declaration.initializer, functions));
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
  for (const route of Object.keys(SPECIAL_POLICIES)) {
    if (assignments.has(route)) throw new Error(`Duplicate policy assignment: ${route}`);
    assignments.set(route, SPECIAL_POLICIES[route].kind);
  }
  return assignments;
}

function hasCall(evidence: HandlerEvidence, name: string, stringArgument?: string): boolean {
  return evidence.calls.some((call) =>
    call.name === name && (stringArgument === undefined || call.stringArguments.includes(stringArgument))
  );
}

describe('mutating API route capability matrix', () => {
  const handlers = discoverMutatingHandlers();
  const assignments = policyAssignments();

  it('explicitly assigns every mutating handler exactly once', () => {
    expect(handlers.size).toBe(150);
    expect([...assignments.keys()].sort()).toEqual([...handlers.keys()].sort());
  });

  it('uses valid capabilities and enforces each direct capability assignment', () => {
    const known = new Set<string>(CAPABILITIES);
    for (const [policy, routes] of Object.entries(POLICY_GROUPS)) {
      if (!policy.startsWith('cap:')) continue;
      const capability = policy.slice(4);
      expect(known.has(capability), `Unknown matrix capability: ${capability}`).toBe(true);
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

  it('keeps public, session-owned, authenticated, and admin exceptions explicit', () => {
    for (const route of POLICY_GROUPS.public) {
      expect(handlers.get(route)!.calls, `${route} unexpectedly gained an inline auth policy`).toEqual([]);
    }

    const logout = handlers.get('POST /api/auth/logout')!;
    expect(hasCall(logout, 'getCurrentSid')).toBe(true);
    expect(logout.handlerText).toContain('revokeSession');

    for (const route of POLICY_GROUPS.authenticated) {
      const calls = handlers.get(route)!.calls.map((call) => call.name);
      expect(
        calls.some((call) => ['requireAuth', 'requireSession', 'requireUser'].includes(call)),
        `${route} must authenticate the actor`,
      ).toBe(true);
    }

    for (const route of POLICY_GROUPS.admin) {
      expect(hasCall(handlers.get(route)!, 'requireAdmin'), `${route} must require an admin`).toBe(true);
    }
  });

  it('locks dynamic, field-level, and ownership-aware policies to their fail-closed guards', () => {
    const known = new Set<string>(CAPABILITIES);
    for (const [route, policy] of Object.entries(SPECIAL_POLICIES)) {
      const evidence = handlers.get(route)!;
      expect(evidence.fileText).toContain(policy.marker);
      for (const capability of policy.capabilities) {
        expect(known.has(capability)).toBe(true);
        expect(evidence.fileText, `${route} must map ${capability}`).toContain(`'${capability}'`);
      }

      if (policy.kind === 'dynamic-capability') {
        expect(hasCall(evidence, 'requireUserCapability')).toBe(true);
        expect(evidence.fileText).toContain('return null; // unknown/unmapped action');
      } else if (policy.kind === 'field-capability') {
        expect(
          hasCall(evidence, 'requireAuth') || hasCall(evidence, 'requireCapability'),
          `${route} must authenticate before applying its field guard`,
        ).toBe(true);
      } else {
        expect(hasCall(evidence, 'requireUser')).toBe(true);
        expect(evidence.fileText).toContain("can(auth.user, 'requests.approve')");
      }
    }
  });
});
