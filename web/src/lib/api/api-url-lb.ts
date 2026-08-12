import env from "$lib/env";

export const currentApiURL = async (): Promise<string | null> => {
    if (!env.DEFAULT_API) {
        return null;
    }

    try {
        const response = await fetch(env.DEFAULT_API, {
            signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
            return null;
        }

        const data = await response.json();

        return data.cobalt.url;
    } catch {
        return null;
    }
};