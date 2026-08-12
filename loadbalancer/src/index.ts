import { Endpoint, type EndpointOptions } from "./endpoint.ts";
import {
    LoadBalancer,
    type AvailabilityMethodType,
    type RecoveryFn,
} from "./load-balancer.ts";

export { Endpoint, LoadBalancer };

export type Env = {
    /** comma separated instance urls, for setups without per-instance config */
    ORIGINS?: string;
    /** json array of instances, for geo steering or custom health check paths */
    ENDPOINTS?: string;
    /** @default "random" */
    AVAILABILITY?: AvailabilityMethodType;
    /** set to "geo" to route by the request's location */
    STEERING?: string;
    /** comma separated statuses that trigger failover */
    FAILOVER_ON_STATUSES?: string;
    /** how long a health result stays valid, in ms */
    HEALTH_CHECK_TTL?: string;
    /** health check timeout, in ms */
    HEALTH_CHECK_TIMEOUT?: string;
    /** any non-empty value adds X-Load-Balancer-* response headers */
    DEBUG_HEADERS?: string;
    /** url notified when every instance failed */
    RECOVERY_WEBHOOK?: string;
};

type EndpointConfig = EndpointOptions & { url: string };

// endpoints carry cached health state, so they have to outlive a single
// request. the isolate keeps them alive between requests it serves
let cachedEndpoints: Endpoint[] | undefined;
let cachedEndpointsKey: string | undefined;

const getEndpoints = (env: Env): Endpoint[] => {
    const key = `${env.ENDPOINTS ?? ""}|${env.ORIGINS ?? ""}`;

    if (!cachedEndpoints || cachedEndpointsKey !== key) {
        cachedEndpoints = parseEndpoints(env);
        cachedEndpointsKey = key;
    }

    return cachedEndpoints;
}

const parseEndpoints = (env: Env): Endpoint[] => {
    if (env.ENDPOINTS) {
        const parsed = JSON.parse(env.ENDPOINTS) as EndpointConfig[];

        return parsed.map(({ url, ...options }) => new Endpoint(url, options));
    }

    return (env.ORIGINS ?? "")
        .split(",")
        .map(origin => origin.trim())
        .filter(origin => origin.length > 0)
        .map(origin => new Endpoint(origin));
}

const parseNumbers = (value?: string) => {
    const numbers = (value ?? "")
        .split(",")
        .map(entry => entry.trim())
        // `Number("")` is 0, so empty entries have to go before converting
        .filter(entry => entry.length > 0)
        .map(Number)
        .filter(entry => Number.isFinite(entry));

    return numbers.length > 0 ? numbers : undefined;
}

const parseNumber = (value?: string) => {
    if (!value?.trim()) return undefined;

    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

const makeRecoveryFn = (env: Env, ctx: ExecutionContext): RecoveryFn | undefined => {
    if (!env.RECOVERY_WEBHOOK) return undefined;

    return async (request, { triedEndpoints }) => {
        // fire and forget: the client shouldn't wait on our own alerting
        ctx.waitUntil(
            fetch(env.RECOVERY_WEBHOOK!, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    url: request.url,
                    method: request.method,
                    triedEndpoints: triedEndpoints.map(endpoint => endpoint.url),
                }),
            }).catch(() => {})
        );
    };
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const lb = new LoadBalancer({
            endpoints: getEndpoints(env),
            availability: {
                type: env.AVAILABILITY ?? "random",
                options: {
                    failoverOnStatuses: parseNumbers(env.FAILOVER_ON_STATUSES),
                },
            },
            steering: env.STEERING === "geo" ? { type: "geo" } : undefined,
            healthCheck: {
                ttl: parseNumber(env.HEALTH_CHECK_TTL),
                timeout: parseNumber(env.HEALTH_CHECK_TIMEOUT),
            },
            debugHeaders: Boolean(env.DEBUG_HEADERS),
            recoveryFn: makeRecoveryFn(env, ctx),
        });

        return lb.handleRequest(request);
    }
} satisfies ExportedHandler<Env>;
