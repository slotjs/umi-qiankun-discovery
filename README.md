# @slotjs/umi-qiankun-discovery

Umi plugin for dynamically discovering and registering qiankun micro apps by route segment.

## Install

```bash
pnpm i @slotjs/umi-qiankun-discovery
```

## Usage

Configure in `.umirc.ts` or `config/config.ts`:

```ts
export default {
  plugins: ['@slotjs/umi-qiankun-discovery'],
  qiankunDiscovery: {
    api: '/api/micro-app/discovery',
    container: '#sub-subapp-container',
    routeLevel: 2,
    routeParam: 'path',
    requestOptions: {
      credentials: 'include',
    },
    startOptions: {
      singular: false,
      sandbox: true,
    },
  },
};
```

When the current path is `/portal/order/detail`, the default `routeLevel: 2` means the plugin will use `order` as the query value.

The plugin does two things automatically:

1. On the initial page load, it reads the configured route segment, calls the discovery API, then registers the returned micro app with qiankun.
2. When that route segment changes, it calls the discovery API again and registers the next micro app.

## Discovery API Response

The discovery API can return either the micro app object directly, or wrap it in `data`, `app`, or `microApp`.

```json
{
  "data": {
    "name": "order-subapp",
    "entry": "//localhost:7100",
    "container": "#sub-subapp-container",
    "activeRule": "/portal/order",
    "props": {
      "token": "demo"
    }
  }
}
```

Required field:

- `entry`: qiankun child app entry URL.

Optional fields:

- `name`: defaults to `qiankun-discovery-${routeSegment}`.
- `container`: defaults to `qiankunDiscovery.container`.
- `activeRule`: defaults to a function that matches the configured route segment.
- `props`: merged into qiankun child app props. The plugin also injects `__qiankunDiscovery.segment` and `__qiankunDiscovery.pathname`.

## Options

```ts
type QiankunDiscoveryConfig = {
  api: string;
  container?: string;
  autoCreateContainer?: boolean;
  routeLevel?: number;
  routeParam?: string;
  appNamePrefix?: string;
  requestOptions?: {
    method?: string;
    headers?: Record<string, string>;
    credentials?: 'include' | 'omit' | 'same-origin';
    mode?: 'cors' | 'navigate' | 'no-cors' | 'same-origin';
  };
  startOptions?: {
    prefetch?: boolean | 'all' | string[];
    singular?: boolean;
    sandbox?: boolean | Record<string, unknown>;
    urlRerouteOnly?: boolean;
  };
};
```

Defaults:

- `container`: `#umi-qiankun-discovery-container`
- `autoCreateContainer`: `true`
- `routeLevel`: `2`
- `routeParam`: `path`
- `appNamePrefix`: `qiankun-discovery`
- `requestOptions.method`: `GET`

## Notes

- `autoCreateContainer` only auto-creates id selectors like `#sub-subapp-container`.
- For `GET` requests, the plugin sends the route segment as a query string using `routeParam`.
- For non-`GET` requests, the plugin sends `{"[routeParam]": "segment"}` as JSON body.
- If the same route segment is discovered more than once, the plugin keeps the first qiankun registration and warns when the returned config changes.

## License

MIT
