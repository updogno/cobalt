import { test } from "node:test";
import assert from "node:assert";

import worker from "./index.ts";
import { Endpoint } from "./endpoint.ts";
import { LoadBalancer } from "./load-balancer.ts";

const ORIGINS = "https://a.example.com,https://b.example.com , https://c.example.com/";

type Call = { url: string; method: string; headers: Headers; origin: string; body: string };

let calls: Call[] = [];
const realFetch = globalThis.fetch;

/** replace fetch with a stub that lets each origin behave differently */
const stub = (handler: (url: URL, request: Request) => Promise<Response> | Response) => {
    calls = [];
    globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);

        // recorded before reading the body, so a call is visible even if the
        // caller never awaits the response
        const entry: Call = {
            url: request.url, method: request.method,
            headers: request.headers, origin: url.origin, body: "",
        };
        calls.push(entry);

        if (request.method !== "GET" && request.method !== "HEAD") {
            entry.body = await request.clone().text();
        }

        return handler(url, request);
    }) as typeof fetch;
};

// the real runtime awaits waitUntil work after the response is returned;
// `flush` lets a test do the same before asserting on it
let pending: Promise<unknown>[] = [];
const flush = async () => {
    await Promise.allSettled(pending);
    pending = [];
};

const ctx = {
    waitUntil: (p: Promise<unknown>) => { pending.push(p); },
    passThroughOnException: () => {},
} as unknown as ExecutionContext;
const req = (url: string, init?: RequestInit) => new Request(url, init);
const call = (url: string, env: Record<string, string>, init?: RequestInit) =>
    worker.fetch(req(url, init), env, ctx);

const ok = () => new Response("ok", { status: 200 });

test.after(() => { globalThis.fetch = realFetch; });

// ---------------------------------------------------------------- passthrough

test("passes path, query, status and headers through untouched", async () => {
    stub((url) => new Response(JSON.stringify({ path: url.pathname }), {
        status: 418, headers: { "x-from-origin": "yes" },
    }));

    const res = await call("https://lb.example.com/service-status?x=1", { ORIGINS });

    assert.equal(res.status, 418);
    assert.equal(res.headers.get("x-from-origin"), "yes");
    assert.equal((await res.json() as { path: string }).path, "/service-status");
    assert.equal(new URL(calls[0]!.url).search, "?x=1");
});

test("passes redirects through instead of following them", async () => {
    // cobalt redirects unknown paths to `/`; following it would turn a 302
    // into the instance's server info
    stub(() => new Response(null, { status: 302, headers: { location: "/" } }));

    const res = await call("https://lb.example.com/nonsense", { ORIGINS });

    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/");
});

test("adds no X-Load-Balancer headers unless asked", async () => {
    stub(ok);

    const quiet = await call("https://lb.example.com/", { ORIGINS });
    assert.equal(quiet.headers.get("x-load-balancer-endpoint"), null);

    const loud = await call("https://lb.example.com/", { ORIGINS, DEBUG_HEADERS: "1" });
    assert.ok(loud.headers.get("x-load-balancer-endpoint"));
    assert.ok(Number(loud.headers.get("x-load-balancer-latency")) >= 0);
    assert.ok(Number(loud.headers.get("x-load-balancer-endpoint-gather-latency")) >= 0);
});

// ------------------------------------------------------------------- steering

test("random (default) spreads requests over every instance", async () => {
    const seen = new Set<string>();

    for (let i = 0; i < 60; i++) {
        stub(ok);
        await call("https://lb.example.com/", { ORIGINS });
        seen.add(calls[0]!.origin);
    }

    assert.equal(seen.size, 3, `expected all 3 instances, saw ${[...seen]}`);
    // trailing slashes and whitespace in ORIGINS are normalised away
    assert.ok(seen.has("https://c.example.com"));
});

test("fail-forward always prefers the first instance", async () => {
    for (let i = 0; i < 10; i++) {
        stub(ok);
        await call("https://lb.example.com/", { ORIGINS, AVAILABILITY: "fail-forward" });
        assert.equal(calls[0]!.origin, "https://a.example.com");
    }
});

test("geo steering prefers an instance serving the request's location", async () => {
    const ENDPOINTS = JSON.stringify([
        { url: "https://us.example.com", geo: { continents: ["NA"] } },
        { url: "https://eu.example.com", geo: { continents: ["EU"] } },
    ]);

    stub(ok);
    const request = req("https://lb.example.com/");
    Object.defineProperty(request, "cf", { value: { continent: "EU", country: "NO" } });
    await worker.fetch(request, { ENDPOINTS, STEERING: "geo", AVAILABILITY: "fail-forward" }, ctx);

    assert.equal(calls[0]!.origin, "https://eu.example.com");
});

test("geo steering still falls back when no instance matches", async () => {
    const ENDPOINTS = JSON.stringify([
        { url: "https://us.example.com", geo: { continents: ["NA"] } },
        { url: "https://eu.example.com", geo: { continents: ["EU"] } },
    ]);

    stub(ok);
    const request = req("https://lb.example.com/");
    Object.defineProperty(request, "cf", { value: { continent: "AS" } });
    const res = await worker.fetch(request, { ENDPOINTS, STEERING: "geo" }, ctx);

    assert.equal(res.status, 200, "a request from an unserved region must still be answered");
});

// ------------------------------------------------------------------- failover

test("retries past unreachable instances", async () => {
    stub((url) => {
        if (url.origin !== "https://b.example.com") throw new Error("ECONNREFUSED");
        return new Response("survived", { status: 200 });
    });

    const res = await call("https://lb.example.com/", { ORIGINS });

    assert.equal(res.status, 200);
    assert.equal(await res.text(), "survived");
});

test("retries gateway errors, including cloudflare's 52x", async () => {
    for (const status of [502, 503, 504, 521, 522, 523, 524]) {
        stub((url) => url.origin === "https://a.example.com"
            ? ok()
            : new Response("bad gateway", { status }));

        const res = await call("https://lb.example.com/", { ORIGINS });
        assert.equal(res.status, 200, `${status} should have failed over`);
    }
});

test("never retries a response the instance produced itself", async () => {
    // retrying would burn the single-use turnstile token and double-count
    // rate limits
    for (const status of [400, 401, 429, 500]) {
        stub(() => new Response(JSON.stringify({ status: "error" }), { status }));

        const res = await call("https://lb.example.com/session", { ORIGINS }, { method: "POST", body: "{}" });

        assert.equal(res.status, status);
        assert.equal(calls.length, 1, `${status} must not be retried`);
    }
});

test("failoverOnStatuses is configurable", async () => {
    stub((url) => url.origin === "https://a.example.com" ? ok() : new Response("", { status: 500 }));

    const res = await call("https://lb.example.com/", { ORIGINS, FAILOVER_ON_STATUSES: "500" });
    assert.equal(res.status, 200);
});

test("POST bodies are forwarded and survive a failover", async () => {
    // regression: streaming request.body makes it unusable after the first
    // attempt, which silently breaks failover for POSTs
    stub((url, request) => {
        if (url.origin !== "https://c.example.com") throw new Error("down");
        return new Response(null, { status: 200, headers: { "x-echo": request.headers.get("x-echo") ?? "" } });
    });

    const payload = JSON.stringify({ url: "https://youtube.com/watch?v=x" });
    const res = await call("https://lb.example.com/", { ORIGINS }, {
        method: "POST", body: payload, headers: { "x-echo": "kept" },
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-echo"), "kept");
    assert.ok(calls.length >= 1);
    assert.ok(calls.every(c => c.body === payload), `body must survive retries, got ${JSON.stringify(calls.map(c => c.body))}`);
});

test("tried instances are reported when debug headers are on", async () => {
    stub((url) => url.origin === "https://a.example.com" ? ok() : new Response("", { status: 502 }));

    const res = await call("https://lb.example.com/", {
        ORIGINS, AVAILABILITY: "fail-forward", FAILOVER_ON_STATUSES: "502", DEBUG_HEADERS: "1",
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-load-balancer-endpoint"), "https://a.example.com");
});

// --------------------------------------------------------------- health checks

test("async-block prefers the first healthy instance", async () => {
    const endpoints = [
        new Endpoint("https://dead.example.com"),
        new Endpoint("https://live.example.com"),
    ];
    stub((url) => url.origin === "https://live.example.com" ? ok() : new Response("", { status: 500 }));

    const lb = new LoadBalancer({ endpoints, availability: { type: "async-block" } });
    const res = await lb.handleRequest(req("https://lb.example.com/"));

    assert.equal(res.status, 200);
    assert.equal(calls.at(-1)!.origin, "https://live.example.com");
});

test("promise.any prefers whichever instance answers first", async () => {
    const endpoints = [new Endpoint("https://slow.example.com"), new Endpoint("https://fast.example.com")];
    stub(async (url) => {
        if (url.origin === "https://slow.example.com") await new Promise(r => setTimeout(r, 50));
        return ok();
    });

    const lb = new LoadBalancer({ endpoints, availability: { type: "promise.any" } });
    const res = await lb.handleRequest(req("https://lb.example.com/"));

    assert.equal(res.status, 200);
    assert.equal(calls.at(-1)!.origin, "https://fast.example.com");
});

test("health results are cached, so checks don't double origin traffic", async () => {
    const endpoints = [new Endpoint("https://a.example.com"), new Endpoint("https://b.example.com")];
    const lb = new LoadBalancer({ endpoints, availability: { type: "async-block" }, healthCheck: { ttl: 60000 } });

    stub(ok);
    await lb.handleRequest(req("https://lb.example.com/"));
    const afterFirst = calls.length;

    stub(ok);
    await lb.handleRequest(req("https://lb.example.com/"));

    assert.ok(afterFirst > 1, "first request performs a health check");
    assert.equal(calls.length, 1, "second request reuses the cached health result");
});

test("an unhealthy instance is still tried when nothing else is left", async () => {
    // a stale health result must never be the reason a request fails outright
    const endpoints = [new Endpoint("https://only.example.com")];
    endpoints[0]!.reportHealth(false);

    stub(ok);
    const lb = new LoadBalancer({ endpoints, availability: { type: "async-block" }, healthCheck: { ttl: 60000 } });
    const res = await lb.handleRequest(req("https://lb.example.com/"));

    assert.equal(res.status, 200);
});

// -------------------------------------------------------------------- failure

test("a total outage answers in cobalt's error shape", async () => {
    stub(() => { throw new Error("down"); });

    const res = await call("https://lb.example.com/", { ORIGINS });

    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { status: "error", error: { code: "error.api.generic" } });
    assert.equal(res.headers.get("access-control-allow-origin"), "*", "frontend must be able to read this");
    assert.equal(calls.length, 3, "every instance should be tried exactly once");
});

test("missing configuration fails as a readable error", async () => {
    stub(ok);
    const res = await call("https://lb.example.com/", {});

    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { status: "error", error: { code: "error.api.generic" } });
});

test("the recovery webhook is notified when everything fails", async () => {
    stub((url) => {
        if (url.origin === "https://hook.example.com") return ok();
        throw new Error("down");
    });

    const res = await call("https://lb.example.com/", { ORIGINS, RECOVERY_WEBHOOK: "https://hook.example.com/alert" });
    await flush();

    assert.equal(res.status, 502);
    const hook = calls.find(c => c.origin === "https://hook.example.com");
    assert.ok(hook, "webhook should have been called");
    assert.deepEqual(JSON.parse(hook!.body).triedEndpoints.sort(), [
        "https://a.example.com", "https://b.example.com", "https://c.example.com",
    ]);
});

// --------------------------------------------------------------------- client

test("forwards the client ip", async () => {
    // cobalt binds session tokens to a hash of the client ip
    stub(ok);
    await call("https://lb.example.com/", { ORIGINS }, { headers: { "cf-connecting-ip": "203.0.113.7" } });

    assert.equal(calls[0]!.headers.get("x-forwarded-for"), "203.0.113.7");
});
