import { get } from "svelte/store";
import { currentApiURL } from "$lib/api/api-url";
import cachedServiceStatus from "$lib/state/service-status";
import type { ServiceStatusResponse, ServiceInstance, ServiceTestResult } from "$lib/types/service-status";

const SERVICE_STATUS_API = "https://cobalt.directory/api/tests";
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

const getCurrentApiHostname = (): string => {
    try {
        const apiUrl = currentApiURL();
        return new URL(apiUrl).hostname;
    } catch {
        return "";
    }
};

const findMatchingInstance = (data: ServiceInstance[]): ServiceInstance | undefined => {
    const hostname = getCurrentApiHostname();
    if (!hostname) return undefined;
    
    return data.find(instance => instance.api === hostname);
};

const request = async (): Promise<ServiceStatusResponse | null> => {
    try {
        const response = await fetch(SERVICE_STATUS_API, {
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

    if (cache && (now - cache.fetchedAt) < CACHE_DURATION_MS) {
        return true;
    }

    const freshStatus = await request();

    if (!freshStatus || !freshStatus.data) {
        return false;
    }

    cachedServiceStatus.set({
        status: freshStatus,
        fetchedAt: now,
    });

    return true;
};

export type ServiceStatus = {
    status: boolean | null;
    message?: string;
};

export const getServiceStatusForName = (serviceName: string): ServiceStatus => {
    const cache = get(cachedServiceStatus);
    
    if (!cache || !cache.status.data) {
        return { status: null };
    }

    const instance = findMatchingInstance(cache.status.data);
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
    
    if (!cache || !cache.status.data) {
        return {};
    }

    const instance = findMatchingInstance(cache.status.data);
    if (!instance || !instance.online || !instance.tests) {
        return {};
    }

    const results: Record<string, ServiceStatus> = {};

    for (const [key, test] of Object.entries(instance.tests) as [string, ServiceTestResult][]) {
        if (key === "Frontend" || !test.friendly) continue;
        
        const friendlyLower = test.friendly.toLowerCase();
        results[friendlyLower] = {
            status: test.status,
            message: test.message,
        };
    }

    return results;
};

export type AggregatedServiceStatus = ServiceStatus;
