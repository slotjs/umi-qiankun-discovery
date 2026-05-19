import { dirname, join } from 'path';
import type { IApi } from 'umi';

const PLUGIN_KEY = 'qiankunDiscovery';
const QIANKUN_ALIAS = '@slotjs/umi-qiankun-discovery/qiankun';
const DEFAULT_CONTAINER = '#umi-qiankun-discovery-container';
const DEFAULT_APP_NAME_PREFIX = 'qiankun-discovery';

type RequestCredentials = 'include' | 'omit' | 'same-origin';
type RequestMode = 'cors' | 'navigate' | 'no-cors' | 'same-origin';

export interface QiankunDiscoveryRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  mode?: RequestMode;
}

export interface QiankunDiscoveryStartOptions {
  prefetch?: boolean | 'all' | string[];
  singular?: boolean;
  sandbox?: boolean | Record<string, unknown>;
  urlRerouteOnly?: boolean;
}

export interface QiankunDiscoveryConfig {
  api: string;
  container?: string;
  autoCreateContainer?: boolean;
  routeLevel?: number;
  routeParam?: string;
  appNamePrefix?: string;
  requestOptions?: QiankunDiscoveryRequestOptions;
  startOptions?: QiankunDiscoveryStartOptions;
}

interface NormalizedQiankunDiscoveryConfig {
  api: string;
  container: string;
  autoCreateContainer: boolean;
  routeLevel: number;
  routeParam: string;
  appNamePrefix: string;
  requestOptions: QiankunDiscoveryRequestOptions;
  startOptions: QiankunDiscoveryStartOptions;
}

function toWinPath(value: string) {
  return value.replace(/\\/g, '/');
}

function normalizeConfig(
  config: QiankunDiscoveryConfig,
): NormalizedQiankunDiscoveryConfig {
  return {
    api: config.api,
    container: config.container || DEFAULT_CONTAINER,
    autoCreateContainer: config.autoCreateContainer ?? true,
    routeLevel: config.routeLevel ?? 2,
    routeParam: config.routeParam || 'path',
    appNamePrefix: config.appNamePrefix || DEFAULT_APP_NAME_PREFIX,
    requestOptions: {
      ...(config.requestOptions || {}),
      method: config.requestOptions?.method || 'GET',
    },
    startOptions: config.startOptions || {},
  };
}

function getQiankunPackagePath() {
  try {
    return dirname(require.resolve('qiankun/package.json'));
  } catch (error) {
    throw new Error(
      '[umi-qiankun-discovery] Cannot resolve "qiankun". Make sure it is installed as a production dependency of this plugin package.',
      { cause: error },
    );
  }
}

function getRuntimeContent(config: NormalizedQiankunDiscoveryConfig) {
  return `// @ts-nocheck
import React from 'react';
import { registerMicroApps, start } from '${QIANKUN_ALIAS}';

const discoveryConfig = ${JSON.stringify(config, null, 2)};
const registeredApps = new Map();

let lastRouteSegment = null;
let currentRequestId = 0;
let qiankunStarted = false;

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function getRouteSegment(pathname) {
  const segments = String(pathname || '/')
    .split('/')
    .filter(Boolean);

  return segments[discoveryConfig.routeLevel - 1] || '';
}

function getContainerId(selector) {
  if (typeof selector !== 'string' || !selector.startsWith('#')) {
    return null;
  }

  const id = selector.slice(1);

  return /^[A-Za-z][-A-Za-z0-9_:.]*$/.test(id) ? id : null;
}

function ensureContainer(selector) {
  const containerId = getContainerId(selector);

  if (!containerId || document.getElementById(containerId)) {
    return;
  }

  const element = document.createElement('div');
  element.id = containerId;
  element.setAttribute('data-qiankun-discovery-container', 'true');

  const root = document.getElementById('root');
  const parent = root?.parentElement || document.body;

  parent.appendChild(element);
}

function buildRequest(segment) {
  const requestOptions = {
    ...discoveryConfig.requestOptions,
    headers: {
      ...(discoveryConfig.requestOptions.headers || {}),
    },
  };
  const method = String(requestOptions.method || 'GET').toUpperCase();
  const url = new URL(discoveryConfig.api, window.location.origin);

  if (method === 'GET') {
    url.searchParams.set(discoveryConfig.routeParam, segment);
    return {
      url: url.toString(),
      init: {
        ...requestOptions,
        method,
      },
    };
  }

  if (!requestOptions.headers['Content-Type']) {
    requestOptions.headers['Content-Type'] = 'application/json';
  }

  return {
    url: url.toString(),
    init: {
      ...requestOptions,
      method,
      body: JSON.stringify({
        [discoveryConfig.routeParam]: segment,
      }),
    },
  };
}

function unwrapResponse(payload) {
  if (Array.isArray(payload)) {
    return payload[0] || null;
  }

  if (isPlainObject(payload) && payload.data != null) {
    return unwrapResponse(payload.data);
  }

  if (isPlainObject(payload) && payload.app != null) {
    return unwrapResponse(payload.app);
  }

  if (isPlainObject(payload) && payload.microApp != null) {
    return unwrapResponse(payload.microApp);
  }

  return payload;
}

function normalizeMicroApp(payload, segment, pathname) {
  const rawApp = unwrapResponse(payload);

  if (rawApp == null) {
    return null;
  }

  if (!isPlainObject(rawApp)) {
    throw new Error(
      '[umi-qiankun-discovery] Discovery API must return an object, or an object wrapped in { data } / { app } / { microApp }.',
    );
  }

  const entry =
    typeof rawApp.entry === 'string'
      ? rawApp.entry
      : typeof rawApp.url === 'string'
        ? rawApp.url
        : '';

  if (!entry) {
    throw new Error(
      '[umi-qiankun-discovery] Discovery API response is missing the "entry" field.',
    );
  }

  const container =
    typeof rawApp.container === 'string' && rawApp.container
      ? rawApp.container
      : discoveryConfig.container;

  if (!container) {
    throw new Error(
      '[umi-qiankun-discovery] No qiankun container was provided.',
    );
  }

  const name =
    typeof rawApp.name === 'string' && rawApp.name
      ? rawApp.name
      : \`\${discoveryConfig.appNamePrefix}-\${segment}\`;

  const props = isPlainObject(rawApp.props) ? rawApp.props : {};

  return {
    segment,
    name,
    entry,
    container,
    activeRule:
      typeof rawApp.activeRule === 'string' && rawApp.activeRule
        ? rawApp.activeRule
        : (location) => getRouteSegment(location.pathname) === segment,
    props: {
      ...props,
      __qiankunDiscovery: {
        segment,
        pathname,
      },
    },
  };
}

async function requestMicroApp(segment, pathname) {
  const request = buildRequest(segment);
  const response = await fetch(request.url, request.init);

  if (!response.ok) {
    const message = await response.text().catch(() => '');

    throw new Error(
      \`[umi-qiankun-discovery] Discovery API request failed: \${response.status} \${response.statusText}\${message ? \` - \${message}\` : ''}\`,
    );
  }

  const payload = await response.json();

  return normalizeMicroApp(payload, segment, pathname);
}

function ensureRegistered(app) {
  const existingApp = registeredApps.get(app.segment);

  if (existingApp) {
    if (
      existingApp.name !== app.name ||
      existingApp.entry !== app.entry ||
      existingApp.container !== app.container
    ) {
      console.warn(
        '[umi-qiankun-discovery] The same route segment was discovered with a different micro app config. Keeping the first registration.',
        existingApp,
        app,
      );
    }

    return;
  }

  ensureContainer(app.container);
  registerMicroApps([app]);
  registeredApps.set(app.segment, app);
}

function ensureStarted() {
  if (qiankunStarted) {
    return;
  }

  start(discoveryConfig.startOptions);
  qiankunStarted = true;
}

export async function onRouteChange({ location }) {
  const pathname = location?.pathname || '/';
  const routeSegment = getRouteSegment(pathname);

  if (!routeSegment) {
    lastRouteSegment = null;
    return;
  }

  if (routeSegment === lastRouteSegment) {
    return;
  }

  lastRouteSegment = routeSegment;
  currentRequestId += 1;
  const requestId = currentRequestId;

  try {
    const microApp = await requestMicroApp(routeSegment, pathname);

    if (requestId !== currentRequestId || !microApp) {
      return;
    }

    ensureRegistered(microApp);
    ensureStarted();
  } catch (error) {
    if (requestId !== currentRequestId) {
      return;
    }

    console.error(
      \`[umi-qiankun-discovery] Failed to discover micro app for route segment "\${routeSegment}".\`,
      error,
    );
  }
}

export function rootContainer(container) {
  if (!discoveryConfig.autoCreateContainer) {
    return container;
  }

  const containerId = getContainerId(discoveryConfig.container);

  if (!containerId) {
    console.warn(
      '[umi-qiankun-discovery] autoCreateContainer only supports id selectors like "#subapp-container".',
    );
    return container;
  }

  return React.createElement(
    React.Fragment,
    null,
    container,
    React.createElement('div', {
      id: containerId,
      'data-qiankun-discovery-container': 'true',
    }),
  );
}
`;
}

export default (api: IApi) => {
  api.describe({
    key: PLUGIN_KEY,
    config: {
      schema({ zod }) {
        return zod.object({
          api: zod.string().min(1).describe('Discovery API URL'),
          container: zod.string().optional(),
          autoCreateContainer: zod.boolean().optional(),
          routeLevel: zod.number().int().positive().optional(),
          routeParam: zod.string().optional(),
          appNamePrefix: zod.string().optional(),
          requestOptions: zod
            .object({
              method: zod.string().optional(),
              headers: zod.record(zod.string()).optional(),
              credentials: zod
                .enum(['include', 'omit', 'same-origin'])
                .optional(),
              mode: zod
                .enum(['cors', 'navigate', 'no-cors', 'same-origin'])
                .optional(),
            })
            .optional(),
          startOptions: zod
            .object({
              prefetch: zod
                .union([
                  zod.boolean(),
                  zod.literal('all'),
                  zod.array(zod.string()),
                ])
                .optional(),
              singular: zod.boolean().optional(),
              sandbox: zod
                .union([zod.boolean(), zod.record(zod.unknown())])
                .optional(),
              urlRerouteOnly: zod.boolean().optional(),
            })
            .optional(),
        });
      },
    },
    enableBy: api.EnableBy.config,
  });

  api.modifyConfig((memo) => {
    memo.alias = memo.alias || {};
    memo.alias[QIANKUN_ALIAS] = getQiankunPackagePath();
    return memo;
  });

  api.onGenerateFiles({
    name: PLUGIN_KEY,
    fn: () => {
      const userConfig = (api.config as Record<string, QiankunDiscoveryConfig>)[
        PLUGIN_KEY
      ];
      const config = normalizeConfig(userConfig);

      api.writeTmpFile({
        path: `plugin-${PLUGIN_KEY}/runtime.tsx`,
        content: getRuntimeContent(config),
      });
    },
  });

  api.addRuntimePlugin(() => [
    toWinPath(join(api.paths.absTmpPath, `plugin-${PLUGIN_KEY}/runtime.tsx`)),
  ]);
};
