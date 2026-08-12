/**
 * geographic constraints for an endpoint. every constraint that is set has to
 * match for the endpoint to be considered a match.
 */
export type GeoConfig = {
    continents?: string[];
    countries?: string[];
    regions?: string[];
    colos?: string[];
};

export type EndpointOptions = {
    /** path used for health checks. @default "/" */
    healthCheckPathname?: `/${string}`;
    /** geographic constraints, only used when geo steering is enabled */
    geo?: GeoConfig;
};

export type HealthCheckOptions = {
    /** how long a health result stays valid, in ms. @default 30000 */
    ttl?: number;
    /** health check timeout, in ms. @default 5000 */
    timeout?: number;
};

/** request.cf, absent when not running on cloudflare */
type RequestGeo = {
    continent?: string;
    country?: string;
    region?: string;
    colo?: string;
};

const GEO_FIELDS = {
    continents: "continent",
    countries: "country",
    regions: "region",
    colos: "colo",
} as const satisfies Record<keyof GeoConfig, keyof RequestGeo>;

/** a single cobalt api instance behind the load balancer. */
export class Endpoint {
    readonly url: string;
    readonly healthCheckPathname: `/${string}`;
    readonly geo?: GeoConfig;

    #healthy = true;
    #checkedAt = 0;

    constructor(url: string, options: EndpointOptions = {}) {
        this.url = new URL(url).origin;
        this.healthCheckPathname = options.healthCheckPathname ?? "/";
        this.geo = options.geo;
    }

    matchesRequest(cf?: RequestGeo): boolean {
        if (!this.geo || !cf) return false;

        return Object.entries(GEO_FIELDS).every(([key, field]) => {
            const allowed = this.geo?.[key as keyof GeoConfig];
            if (!allowed?.length) return true;

            const actual = cf[field];
            if (!actual) return false;

            return allowed.some(
                value => value.toUpperCase() === actual.toUpperCase()
            );
        });
    }

    /**
     * results are cached for `ttl` ms per isolate, so enabling health checks
     * doesn't double the request volume hitting each instance.
     */
    async healthCheck({ ttl = 30000, timeout = 5000 }: HealthCheckOptions = {}): Promise<boolean> {
        const now = Date.now();

        if (this.#checkedAt && now - this.#checkedAt < ttl) {
            return this.#healthy;
        }

        this.#checkedAt = now;

        try {
            const response = await fetch(this.url + this.healthCheckPathname, {
                method: "GET",
                signal: AbortSignal.timeout(timeout),
            });

            this.#healthy = response.ok;
        } catch {
            this.#healthy = false;
        }

        return this.#healthy;
    }

    /**
     * record health from a real request, so health state stays fresh without
     * spending a separate request on it.
     */
    reportHealth(healthy: boolean): void {
        this.#healthy = healthy;
        this.#checkedAt = Date.now();
    }

    /**
     * forward a request to this instance.
     *
     * `body` is a buffered copy so the request can be replayed on another
     * instance: streaming the original body would make it unusable after the
     * first attempt, which silently breaks failover for POSTs.
     */
    commitRequest(request: Request, body: BodyInit | null): Promise<Response> {
        const url = new URL(request.url);
        const target = new URL(this.url);

        url.protocol = target.protocol;
        url.hostname = target.hostname;
        url.port = target.port;

        const headers = new Headers(request.headers);
        const clientIP = request.headers.get("cf-connecting-ip");

        // best effort: cloudflare re-adds this itself for same-zone
        // subrequests, and overrides it entirely for cross-zone ones
        if (clientIP) {
            headers.set("x-forwarded-for", clientIP);
        }

        return fetch(new Request(url, {
            method: request.method,
            headers,
            body,
            // cobalt redirects unknown paths to `/`; pass that through
            // instead of resolving it against the instance
            redirect: "manual",
        }));
    }

    toString(): string {
        return this.url;
    }
}
