# cobalt load balancer

a cloudflare worker that spreads api requests across several self-hosted cobalt
instances. it is a transparent reverse proxy: whatever the picked instance
answers is what the client gets, unmodified.

it covers the same ground as [worker-lb](https://github.com/lawgdev/worker-lb)
— failover, health checks, geo steering, a recovery hook, trace headers — with
the behaviour cobalt needs on top (see [differences](#differences-from-worker-lb)).

## why it looks like this

the api itself cannot run on workers — it spawns `ffmpeg` through
`child_process` and uses `isolated-vm`, neither of which exist in the workers
runtime. so the api stays on your own machines, and only the frontend and this
load balancer run on cloudflare.

because the proxy is transparent, `GET /` returns the *picked instance's* server
info, including its own `url` field rather than the load balancer's. the
frontend depends on this in `web/src/lib/api/api-url-lb.ts`, which reads
`cobalt.url` to find out which instance it actually got, so it can query that
instance's `/service-status` directly.

tunnels are unaffected: each instance builds tunnel links from its own
`API_URL`, so downloads go straight to the instance and never stream back
through the worker.

## requirements

these are not optional — sessions break without them.

1. **every instance must share the same `JWT_SECRET`.** a request can land on a
   different instance than the one that issued the session token, and the token
   is verified with `JWT_SECRET`.

2. **the worker and every instance must be on the same cloudflare zone.**
   cobalt binds each session token to a hash of the client ip
   (`api/src/security/jwt.js`). cloudflare only preserves the visitor ip on
   same-zone subrequests — for cross-zone ones it [replaces the value with an
   internal address](https://developers.cloudflare.com/rules/transform/request-header-modification/)
   to prevent spoofing, so every request would look like it came from somewhere
   new and every token would fail to verify.

   in practice: put the worker on `cobalt-api.example.com` and the instances on
   `one.example.com`, `two.example.com`, … all within `example.com`.

3. **instances must be publicly reachable**, since tunnel links point at them
   directly.

if you use turnstile, all instances also need the same turnstile keys.

## configuration

everything is set through `vars` in [`wrangler.jsonc`](./wrangler.jsonc).

| variable | default | description |
| --- | --- | --- |
| `ORIGINS` | — | comma separated instance urls |
| `ENDPOINTS` | — | json array, for per-instance config. replaces `ORIGINS` |
| `AVAILABILITY` | `random` | how an instance is picked |
| `STEERING` | — | set to `geo` to route by the request's location |
| `FAILOVER_ON_STATUSES` | `502,503,504,521,522,523,524` | statuses that trigger a failover |
| `HEALTH_CHECK_TTL` | `30000` | how long a health result stays valid, in ms |
| `HEALTH_CHECK_TIMEOUT` | `5000` | health check timeout, in ms |
| `DEBUG_HEADERS` | off | adds `X-Load-Balancer-*` response headers |
| `RECOVERY_WEBHOOK` | — | url notified when every instance failed |

the simple case is just:

```jsonc
"vars": {
    "ORIGINS": "https://one.example.com,https://two.example.com"
}
```

### availability methods

| method | behaviour |
| --- | --- |
| `random` *(default)* | picks a random instance per request, so traffic cycles between them |
| `fail-forward` | always prefers the first instance, moves on only when it fails |
| `async-block` | health checks instances in order, prefers the first healthy one |
| `promise.any` | health checks all at once, prefers the first to answer |

health results are cached per isolate for `HEALTH_CHECK_TTL`, and every real
request updates them, so `async-block` and `promise.any` don't double the
request volume hitting each instance.

### geo steering

use `ENDPOINTS` instead of `ORIGINS` and set `STEERING` to `geo`. each instance
may constrain `continents`, `countries`, `regions` and `colos`; every constraint
that is set has to match.

```jsonc
"vars": {
    "ENDPOINTS": "[{\"url\":\"https://eu.example.com\",\"geo\":{\"continents\":[\"EU\"]}},{\"url\":\"https://us.example.com\",\"geo\":{\"continents\":[\"NA\"]}}]",
    "STEERING": "geo"
}
```

instances that don't match are kept behind the ones that do, rather than
dropped, so a regional outage falls back instead of failing outright.

### trace headers

with `DEBUG_HEADERS` set, responses carry `X-Load-Balancer-Endpoint`,
`X-Load-Balancer-Latency` and `X-Load-Balancer-Endpoint-Gather-Latency`, plus
`X-Load-Balancer-Tried-Count` and `X-Load-Balancer-Tried-Endpoints` when a
failover happened. it is off by default, so the proxy stays transparent and
doesn't advertise your instance hostnames on every response.

## behaviour

- if an instance is unreachable or answers with a failover status, the next one
  is tried, until every instance has been tried once.
- anything the instance answers itself is returned as-is and **never** retried —
  retrying would burn single-use turnstile tokens and double-count rate limits.
- if every instance fails, `RECOVERY_WEBHOOK` is notified and the worker returns
  cobalt's own error shape: `{"status":"error","error":{"code":"error.api.generic"}}`
  with status 502.

## differences from worker-lb

worker-lb is a general purpose library; a few of its choices don't survive
contact with cobalt, so this implementation differs deliberately:

- **request bodies are buffered before dispatch.** worker-lb forwards
  `request.body` as a stream, which the first attempt consumes — so a failover
  on any `POST` (`/`, `/session`) re-sends a body that can no longer be read.
  cobalt caps request bodies at 1024 bytes, so buffering them is cheap and makes
  failover actually work.
- **redirects are not followed.** cobalt redirects unknown paths to `/`, and
  `redirect: "follow"` would turn that 302 into the instance's server info.
- **there is a `random` method.** worker-lb's methods all prefer one instance in
  a fixed order, which never spreads load.
- **a total outage answers instead of throwing**, in cobalt's error shape and
  with CORS headers, so the frontend can parse it rather than showing
  cloudflare's error page.
- **health results are cached** and refreshed from real traffic, and an instance
  believed unhealthy is still tried when nothing else is left.

## developing

```sh
cd loadbalancer
npm install
npm test        # 21 checks, no network required
npm run check   # typecheck
npm run dev     # wrangler dev
```

## deploying

```sh
npx wrangler deploy
```

or run the **Deploy Load Balancer** github action, which typechecks and tests
before deploying. it needs the `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` repository secrets.

point the worker at the hostname your frontend uses as `WEB_DEFAULT_API` by
uncommenting the `routes` block in `wrangler.jsonc`.
