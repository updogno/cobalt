import env from "$lib/env";
import API from "$lib/api/api";
import settings from "$lib/state/settings";
import lazySettingGetter from "$lib/settings/lazy-get";

import { get } from "svelte/store";
import { uuid } from "$lib/util";
import { t } from "$lib/i18n/translations";
import { downloadFile } from "$lib/download";
import { createDialog } from "$lib/state/dialogs";
import { currentApiURL } from "$lib/api/api-url";
import { downloadButtonState } from "$lib/state/omnibox";
import { createSavePipeline } from "$lib/task-manager/queue";
import { openQueuePopover } from "$lib/state/queue-visibility";
import {
    addPendingItem,
    markPendingAsDone,
    markPendingAsError,
    waitForItemCompletion,
} from "$lib/state/task-manager/queue";

import type { CobaltSaveRequestBody } from "$lib/types/api";

type SavingHandlerArgs = {
    url?: string,
    request?: CobaltSaveRequestBody,
    oldTaskId?: string
}

type SettingGetter = ReturnType<typeof lazySettingGetter>;

// how long to wait between playlist items, so a playlist doesn't
// immediately trip the instance's rate limit
const PLAYLIST_ITEM_DELAY = 1500;

const buildRequestBody = (url: string, getSetting: SettingGetter): CobaltSaveRequestBody => ({
    url,

    // not lazy cuz default depends on device capabilities
    localProcessing: get(settings).save.localProcessing,

    alwaysProxy: getSetting("save", "alwaysProxy"),
    downloadMode: getSetting("save", "downloadMode"),

    subtitleLang: getSetting("save", "subtitleLang"),
    filenameStyle: getSetting("save", "filenameStyle"),
    disableMetadata: getSetting("save", "disableMetadata"),

    audioFormat: getSetting("save", "audioFormat"),
    audioBitrate: getSetting("save", "audioBitrate"),
    tiktokFullAudio: getSetting("save", "tiktokFullAudio"),
    youtubeDubLang: getSetting("save", "youtubeDubLang"),
    youtubeBetterAudio: getSetting("save", "youtubeBetterAudio"),

    videoQuality: getSetting("save", "videoQuality"),
    youtubeVideoCodec: getSetting("save", "youtubeVideoCodec"),
    youtubeVideoContainer: getSetting("save", "youtubeVideoContainer"),
    youtubeHLS: env.ENABLE_DEPRECATED_YOUTUBE_HLS ? getSetting("save", "youtubeHLS") : undefined,

    allowH265: getSetting("save", "allowH265"),
    convertGif: getSetting("save", "convertGif"),
});

// only dedicated playlist links, so a single video that happens to be
// inside a playlist still saves as one video
export const isPlaylistURL = (url: string) => {
    try {
        const { hostname, pathname, searchParams } = new URL(url);

        const isYoutube = hostname === "youtube.com" || hostname.endsWith(".youtube.com");
        if (isYoutube && pathname === "/playlist" && searchParams.get("list")) {
            return true;
        }

        const isSoundcloud = hostname === "soundcloud.com" || hostname.endsWith(".soundcloud.com");
        return isSoundcloud && pathname.includes("/sets/");
    } catch {
        return false;
    }
}

const fetchPlaylistLinks = async (playlistUrl: string) => {
    const url = new URL(`${currentApiURL()}/playlist`);
    url.searchParams.set("url", playlistUrl);

    try {
        const response = await fetch(url, {
            headers: { Accept: "application/json" },
        });

        const data = await response.json();

        if (!response.ok) {
            return { error: data?.error?.code ?? "error.api.generic", context: data?.error?.context };
        }

        return { urls: data.urls as string[] };
    } catch {
        return { error: "error.api.unreachable" };
    }
}

const processPlaylistItem = async (itemId: string, url: string, getSetting: SettingGetter) => {
    const request = buildRequestBody(url, getSetting);
    const response = await API.request(request);

    if (!response) {
        return markPendingAsError(itemId, "error.api.unreachable");
    }

    switch (response.status) {
        case "error":
            return markPendingAsError(itemId, response.error.code);

        case "redirect":
            downloadFile({ url: response.url, urlType: "redirect" });
            return markPendingAsDone(itemId);

        case "tunnel": {
            // the stream is consumed here rather than handed to the browser, so
            // that the next item doesn't start while this one is still running
            try {
                const tunnel = await fetch(response.url);

                if (!tunnel.ok) {
                    return markPendingAsError(itemId, "error.tunnel.probe");
                }

                const blob = await tunnel.blob();

                downloadFile({
                    file: new File([blob], response.filename, { type: blob.type }),
                });

                return markPendingAsDone(itemId);
            } catch {
                return markPendingAsError(itemId, "error.tunnel.probe");
            }
        }

        case "local-processing":
            // hand the item over to the pipeline and wait for it to finish,
            // so items are still processed one at a time
            createSavePipeline(response, request, itemId);
            return await waitForItemCompletion(itemId);

        case "picker": {
            const first = response.picker[0];

            if (!first) {
                return markPendingAsError(itemId, "error.api.fetch.empty");
            }

            downloadFile({ url: first.url });
            return markPendingAsDone(itemId);
        }

        default:
            return markPendingAsError(itemId, "error.api.unknown_response");
    }
}

export const savingHandler = async ({ url, request, oldTaskId }: SavingHandlerArgs) => {
    downloadButtonState.set("think");

    const error = (errorText: string) => {
        return createDialog({
            id: "save-error",
            type: "small",
            meowbalt: "error",
            buttons: [
                {
                    text: get(t)("button.gotit"),
                    main: true,
                    action: () => {},
                },
            ],
            bodyText: errorText,
        });
    }

    const getSetting = lazySettingGetter(get(settings));

    if (!request && !url) return;

    if (url && !request && isPlaylistURL(url)) {
        const { urls, error: errorCode, context } = await fetchPlaylistLinks(url);

        if (errorCode) {
            downloadButtonState.set("error");
            return error(get(t)(errorCode, context));
        }

        if (!urls?.length) {
            downloadButtonState.set("error");
            return error(get(t)("error.api.fetch.empty"));
        }

        downloadButtonState.set("done");

        // every entry is shown in the queue up front, so the whole playlist is
        // visible while it works through it
        const items = urls.map((itemUrl, index) => {
            const id = uuid();

            addPendingItem({
                id,
                state: "pending",
                url: itemUrl,
                filename: get(t)("queue.playlist.item", { value: String(index + 1) }),
                mediaType: "video",
            });

            return { id, url: itemUrl };
        });

        openQueuePopover();

        for (const [index, item] of items.entries()) {
            await processPlaylistItem(item.id, item.url, getSetting);

            if (index < items.length - 1) {
                await new Promise(resolve => setTimeout(resolve, PLAYLIST_ITEM_DELAY));
            }
        }

        return;
    }

    const selectedRequest = request || buildRequestBody(url!, getSetting);

    const response = await API.request(selectedRequest);

    if (!response) {
        downloadButtonState.set("error");
        return error(get(t)("error.api.unreachable"));
    }

    if (response.status === "error") {
        downloadButtonState.set("error");

        return error(
            get(t)(response.error.code, response?.error?.context)
        );
    }

    if (response.status === "redirect") {
        downloadButtonState.set("done");

        return downloadFile({
            url: response.url,
            urlType: "redirect",
        });
    }

    if (response.status === "tunnel") {
        downloadButtonState.set("check");

        const probeResult = await API.probeCobaltTunnel(response.url);

        if (probeResult === 200) {
            downloadButtonState.set("done");

            return downloadFile({
                url: response.url,
            });
        } else {
            downloadButtonState.set("error");
            return error(get(t)("error.tunnel.probe"));
        }
    }

    if (response.status === "local-processing") {
        downloadButtonState.set("done");
        return createSavePipeline(response, selectedRequest, oldTaskId);
    }

    if (response.status === "picker") {
        downloadButtonState.set("done");
        const buttons = [
            {
                text: get(t)("button.done"),
                main: true,
                action: () => { },
            },
        ];

        if (response.audio) {
            const pickerAudio = response.audio;
            buttons.unshift({
                text: get(t)("button.download.audio"),
                main: false,
                action: () => {
                    downloadFile({
                        url: pickerAudio,
                    });
                },
            });
        }

        return createDialog({
            id: "download-picker",
            type: "picker",
            items: response.picker,
            buttons,
        });
    }

    downloadButtonState.set("error");
    return error(get(t)("error.api.unknown_response"));
}
