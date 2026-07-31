import { get } from "svelte/store";
import { currentApiURL } from "$lib/api/api-url-lb";
import cachedServiceStatus from "$lib/state/service-status";
import type {
    ServiceStatusResponse,
    ServiceInstance,
    ServiceTestResult,
} from "$lib/types/service-status";

const CACHE_DURATION_MS = 5 * 60 * 1000;

const serviceNameToTestKey: Record<string, string> = {
    "bluesky": "bluesky",
    "twitch clips": "twitch-clips",
    "youtube": "youtube",
    "youtube music": "youtube-music",
    "youtube shorts": "youtube-shorts",
};

const normalizeServiceName = (name: string): string => {
    return serviceNameToTestKey[name.toLowerCase()] || name.toLowerCase();
};

const getCurrentInstance = (data: ServiceInstance[]): ServiceInstance | undefined => {
    return data[0];
};

const request = async (): Promise<ServiceStatusResponse | null> => {
    try {
        const apiUrl = await currentApiURL();

        if (!apiUrl) {
            return null;
        }

        const response = await fetch(`${apiUrl}service-status`, {
            signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
            return null;
        }

        return await response.json();
    } catch {
        return null;
    }
};

export const getServiceStatus = async (): Promise<boolean> => {
    const cache = get(cachedServiceStatus);
    const now = Date.now();

    const origin = await currentApiURL();

    if (!origin) {
        return false;
    }

    if (cache && cache.origin === origin && (now - cache.fetchedAt) < CACHE_DURATION_MS) {
        return true;
    }

    const freshStatus = await request();

    if (!freshStatus || !freshStatus.data) {
        return false;
    }

    cachedServiceStatus.set({
        status: freshStatus,
        fetchedAt: now,
        origin,
    });

    return true;
};

export type ServiceStatus = {
    status: boolean | null;
    message?: string;
};

export const getServiceStatusForName = (serviceName: string): ServiceStatus => {
    const cache = get(cachedServiceStatus);

    if (!cache || !cache.status.data.length) {
        return { status: null };
    }

    const instance = getCurrentInstance(cache.status.data);

    if (!instance || !instance.online || !instance.tests) {
        return { status: null };
    }

    const testKey = normalizeServiceName(serviceName);
    const test = instance.tests[testKey];

    if (!test) {
        return { status: null };
    }

    return {
        status: test.status,
        message: test.message,
    };
};

export const getAllServiceTests = (): Record<string, ServiceStatus> => {
    const cache = get(cachedServiceStatus);

    if (!cache || !cache.status.data.length) {
        return {};
    }

    const instance = getCurrentInstance(cache.status.data);

    if (!instance || !instance.online || !instance.tests) {
        return {};
    }

    const results: Record<string, ServiceStatus> = {};

    for (const [key, test] of Object.entries(instance.tests) as [string, ServiceTestResult][]) {
        if (key === "Frontend" || !test.friendly) continue;

        results[test.friendly.toLowerCase()] = {
            status: test.status,
            message: test.message,
        };
    }

    return results;
};

export type AggregatedServiceStatus = ServiceStatus;