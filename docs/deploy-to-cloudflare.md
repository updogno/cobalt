# deploying cobalt to cloudflare

this describes the split deployment used by this fork: the frontend and a load
balancer run on cloudflare workers, while the api instances stay on your own
machines.

```
                    browser
                       │
        ┌──────────────┴──────────────┐
        │                             │
   cobalt-web                    cobalt-lb            (cloudflare workers)
  (static assets)          (picks an instance)
                                      │
                        ┌─────────────┼─────────────┐
                        │             │             │
                   one.example   two.example   three.example   (your machines)
                        └─────────────┴─────────────┘
                                      │
                              tunnels/downloads
                             go straight to the
                            instance, not the lb
```

## why the api isn't on workers

the api spawns `ffmpeg` via `child_process` and uses `isolated-vm`. neither
exists in the workers runtime, so it has to run on real machines — follow
[run-an-instance.md](run-an-instance.md) as usual. cloudflare only handles the
static frontend and the load balancer in front of your instances.

## 1. the api instances

run two or more instances as normal, each on its own public hostname within a
single cloudflare zone (`one.example.com`, `two.example.com`, …).

they must share:

- the same `JWT_SECRET` — a request can land on a different instance than the
  one that issued the session token
- the same turnstile keys, if you use turnstile

each instance keeps its **own** `API_URL`, pointing at its own hostname. that is
what makes tunnel links resolve directly to the instance that prepared them.

## 2. the load balancer

set `ORIGINS` in [`loadbalancer/wrangler.jsonc`](../loadbalancer/wrangler.jsonc)
to your instance list, then deploy it on the hostname you want clients to use
(for example `cobalt-api.example.com`):

```sh
cd loadbalancer
npx wrangler deploy
```

the worker **must** sit on the same cloudflare zone as the instances, otherwise
cloudflare rewrites the visitor ip on its subrequests and every session token
fails to verify.

by default it picks a random instance per request and fails over when one is
unreachable. it also supports health check based selection, geo steering, a
recovery webhook and trace headers — see
[loadbalancer/README.md](../loadbalancer/README.md) for the full configuration.

## 3. the frontend

[`web/wrangler.jsonc`](../web/wrangler.jsonc) serves the built site as
[workers static assets](https://developers.cloudflare.com/workers/static-assets/).
the `_headers` file cobalt generates is honoured by the assets runtime, so the
cross-origin isolation headers that ffmpeg.wasm needs are applied for you.

build and deploy:

```sh
cd web
WEB_DEFAULT_API=https://cobalt-api.example.com pnpm build
npx wrangler deploy
```

`WEB_DEFAULT_API` points at the **load balancer**, not an individual instance.
the frontend then discovers which instance it actually reached by reading
`cobalt.url` from the response, in `web/src/lib/api/api-url-lb.ts`.

## 4. github actions

two `workflow_dispatch` workflows are included:

| workflow | what it deploys |
| --- | --- |
| **Deploy Worker** (`deploy.yml`) | the frontend |
| **Deploy Load Balancer** (`deploy-lb.yml`) | the load balancer |

both need these repository secrets:

- `CLOUDFLARE_API_TOKEN` — with the *Edit Cloudflare Workers* permission
- `CLOUDFLARE_ACCOUNT_ID`

the frontend workflow also reads these repository *variables* at build time:

- `WEB_DEFAULT_API` — your load balancer url
- `WEB_HOST` — the frontend's own hostname (optional, used for the sitemap and
  plausible)
