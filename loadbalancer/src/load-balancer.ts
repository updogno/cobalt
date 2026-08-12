import { Endpoint, type HealthCheckOptions } from "./endpoint.ts";

/**
 * how an instance is picked, and how failure is handled.
 *
 * `random` – pick a random instance per request, so traffic cycles between
 * them. this is the default, and the only method that actually spreads load.
 *
 * `fail-forward` – always prefer the first instance, move to the next only on
 * a failure condition.
 *
 * `async-block` – health check instances one by one, prefer the first healthy.
 *
 * `promise.any` – health check all instances at once, prefer the first to
 * answer.
 */
export type AvailabilityMethodType =
    | "random"
    | "fail-forward"
    | "async-block"
    | "promise.any";

export type AvailabilityMethod = {
    type: AvailabilityMethodType;
    options?: {
        /**
         * statuses that should result in a failover.
         * @default [502, 503, 504, 521, 522, 523, 524]
         */
        failoverOnStatuses?: number[];
    };
};

export type RecoveryContext = {
    /** the instances that were tried before all of them failed */
    triedEndpoints: Endpoint[];
};

export type RecoveryFn = (
    request: Request,
    context: RecoveryContext,
) => Promise<Response | undefined | void>;

export type LoadBalancerOptions = {
    endpoints: Endpoint[];
    /** @default { type: "random" } */
    availability?: AvailabilityMethod;
    /** route to instances matching the request's location, when configured */
    steering?: { type: "geo"; defaultEndpoints?: Endpoint[] };
    healthCheck?: HealthCheckOptions;
    /** adds X-Load-Balancer-* response headers. off by default */
    debugHeaders?: boolean;
    /** runs when every instance failed */
    recoveryFn?: RecoveryFn;
};

// 502-504 are gateway errors; 521-524 are cloudflare's own origin errors
export const DEFAULT_FAILOVER_STATUSES = [502, 503, 504, 521, 522, 523, 524];

const shuffle = <T>(items: T[]): T[] => {
    const array = [...items];

    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j]!, array[i]!];
    }

    return array;
}

const cobaltError = (code: string, status: number) =>
    Response.json(
        { status: "error", error: { code } },
        {
            status,
            // the frontend has to be able to read this cross-origin, the same
            // way it reads errors coming from an instance directly
            headers: { "access-control-allow-origin": "*" },
        }
    );

export class LoadBalancer {
    #endpoints: Endpoint[];
    #availability: AvailabilityMethod;
    #steering?: LoadBalancerOptions["steering"];
    #healthCheck: HealthCheckOptions;
    #debugHeaders: boolean;
    #recoveryFn?: RecoveryFn;

    constructor(options: LoadBalancerOptions) {
        this.#endpoints = options.endpoints;
        this.#availability = options.availability ?? { type: "random" };
        this.#steering = options.steering;
        this.#healthCheck = options.healthCheck ?? {};
        this.#debugHeaders = options.debugHeaders ?? false;
        this.#recoveryFn = options.recoveryFn;

        this.#availability.options ??= {};
        this.#availability.options.failoverOnStatuses ??= DEFAULT_FAILOVER_STATUSES;
    }

    /** order instances by geo match, keeping the rest as failover candidates */
    #applySteering(request: Request): Endpoint[] {
        const random = this.#availability.type === "random";

        if (this.#steering?.type !== "geo") {
            return random ? shuffle(this.#endpoints) : this.#endpoints;
        }

        const cf = (request as { cf?: Record<string, string> }).cf;
        const matched = this.#endpoints.filter(e => e.matchesRequest(cf));
        const seen = new Set(matched);

        for (const endpoint of this.#steering.defaultEndpoints ?? []) {
            if (!seen.has(endpoint)) seen.add(endpoint);
        }

        const fallback = [
            ...(this.#steering.defaultEndpoints ?? []),
            ...this.#endpoints.filter(e => !seen.has(e)),
        ];

        // matched instances first, everything else kept behind them so a
        // regional outage still falls back instead of failing outright
        return random
            ? [...shuffle(matched), ...shuffle(fallback)]
            : [...matched, ...fallback];
    }

    /**
     * order instances by health, when the availability method asks for it.
     *
     * unhealthy instances are kept at the back rather than dropped: a stale
     * health result should never be the reason a request fails outright.
     */
    async #applyAvailability(candidates: Endpoint[]): Promise<Endpoint[]> {
        if (this.#availability.type === "random" || this.#availability.type === "fail-forward") {
            return candidates;
        }

        if (this.#availability.type === "async-block") {
            const unhealthy: Endpoint[] = [];

            for (const endpoint of candidates) {
                if (await endpoint.healthCheck(this.#healthCheck)) {
                    return [
                        endpoint,
                        ...candidates.filter(e => e !== endpoint && !unhealthy.includes(e)),
                        ...unhealthy,
                    ];
                }

                unhealthy.push(endpoint);
            }

            return candidates;
        }

        // promise.any: whichever instance reports healthy first goes to the front
        try {
            const winner = await Promise.any(
                candidates.map(async endpoint => {
                    if (await endpoint.healthCheck(this.#healthCheck)) return endpoint;
                    throw new Error(`${endpoint.url} is unhealthy`);
                })
            );

            return [winner, ...candidates.filter(e => e !== winner)];
        } catch {
            return candidates;
        }
    }

    async handleRequest(request: Request): Promise<Response> {
        if (this.#endpoints.length === 0) {
            return cobaltError("error.api.generic", 500);
        }

        const startTime = Date.now();

        // buffered up front so a retry can replay it. cobalt caps request
        // bodies at 1024 bytes, so this is cheap
        const body = request.method === "GET" || request.method === "HEAD"
            ? null
            : await request.arrayBuffer();

        const candidates = await this.#applyAvailability(this.#applySteering(request));
        const gatherLatency = Date.now() - startTime;
        const failoverOn = this.#availability.options?.failoverOnStatuses ?? [];
        const tried: Endpoint[] = [];

        for (const endpoint of candidates) {
            tried.push(endpoint);

            let response: Response;

            try {
                response = await endpoint.commitRequest(request, body);
            } catch {
                // unreachable, try the next instance
                endpoint.reportHealth(false);
                continue;
            }

            if (failoverOn.includes(response.status)) {
                endpoint.reportHealth(false);
                continue;
            }

            // the instance answered for itself. that response is final, even
            // if it's an error: retrying it elsewhere would burn single-use
            // turnstile tokens and double-count rate limits
            endpoint.reportHealth(true);

            if (!this.#debugHeaders) {
                return response;
            }

            const headers = new Headers(response.headers);
            headers.set("X-Load-Balancer-Endpoint", endpoint.url);
            headers.set("X-Load-Balancer-Latency", String(Date.now() - startTime));
            headers.set("X-Load-Balancer-Endpoint-Gather-Latency", String(gatherLatency));

            if (tried.length > 1) {
                headers.set("X-Load-Balancer-Tried-Count", String(tried.length));
                headers.set("X-Load-Balancer-Tried-Endpoints", tried.map(e => e.url).join(", "));
            }

            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers,
            });
        }

        const recovered = await this.#recoveryFn?.(request, { triedEndpoints: tried });

        // unlike worker-lb, a total outage still answers in cobalt's error
        // shape instead of throwing, so the frontend can parse it
        return recovered ?? cobaltError("error.api.generic", 502);
    }
}
