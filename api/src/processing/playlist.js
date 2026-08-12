import { env } from "../config.js";

// both clients are lazily loaded so that instances which never receive a
// playlist request don't pay for them at startup
let youtubeClient;
let soundcloudClient;

const getYoutubeClient = async () => {
    if (!youtubeClient) {
        const { Innertube } = await import("youtubei.js");

        // listing a playlist doesn't need the player, and fetching it
        // is the slow part of creating an instance
        youtubeClient = await Innertube.create({ retrieve_player: false });
    }

    return youtubeClient;
}

const getSoundcloudClient = async () => {
    if (!soundcloudClient) {
        const { Soundcloud } = await import("soundcloud.ts");
        soundcloudClient = new Soundcloud();
    }

    return soundcloudClient;
}

const extractYoutubePlaylistId = (url) => {
    try {
        return new URL(url).searchParams.get("list");
    } catch {
        return null;
    }
}

const isSoundcloudPlaylist = (url) => {
    return /soundcloud\.com\/[a-z0-9-_]+\/sets\/[a-z0-9-_]+/i.test(url);
}

const tooManyItems = () => ({
    error: "error.api.playlist.too_many_items",
    context: { limit: env.playlistMaxItems },
    status: 400,
});

const getYoutubeVideos = async (playlistId) => {
    const client = await getYoutubeClient();

    let page;

    try {
        page = await client.getPlaylist(playlistId);
    } catch {
        // the playlist doesn't exist, or is private
        return { error: "error.api.link.invalid", status: 400 };
    }

    if (!page) {
        return { error: "error.api.link.invalid", status: 400 };
    }

    const urls = [];

    // a playlist is paginated, so it's walked until the limit is exceeded
    // rather than trusting the item count youtube reports up front
    while (true) {
        for (const item of page.videos) {
            // playlists can also contain shorts and nested playlists
            if (item.content_type && item.content_type !== "VIDEO") {
                continue;
            }

            // 17.x returns LockupView, older versions returned PlaylistVideo
            const id = item.content_id ?? item.id;
            if (!id) continue;

            if (urls.length >= env.playlistMaxItems) {
                return tooManyItems();
            }

            urls.push(`https://youtu.be/${id}`);
        }

        if (!page.has_continuation) break;

        page = await page.getContinuation();
    }

    if (urls.length === 0) {
        return { error: "error.api.link.invalid", status: 400 };
    }

    return { urls };
}

const getSoundcloudTracks = async (playlistUrl) => {
    const client = await getSoundcloudClient();

    let playlist;

    try {
        playlist = await client.playlists.getAlt(playlistUrl);
    } catch {
        // the set doesn't exist, or is private
        return { error: "error.api.link.invalid", status: 400 };
    }

    if (!playlist?.tracks) {
        return { error: "error.api.link.invalid", status: 400 };
    }

    if (playlist.tracks.length > env.playlistMaxItems) {
        return tooManyItems();
    }

    return { urls: playlist.tracks.map(track => track.permalink_url) };
}

export const getPlaylistLinks = async (playlistUrl) => {
    if (!playlistUrl) {
        return { error: "error.api.link.invalid", status: 400 };
    }

    try {
        const youtubePlaylistId = extractYoutubePlaylistId(playlistUrl);

        if (youtubePlaylistId) {
            return await getYoutubeVideos(youtubePlaylistId);
        }

        if (isSoundcloudPlaylist(playlistUrl)) {
            return await getSoundcloudTracks(playlistUrl);
        }

        return { error: "error.api.link.invalid", status: 400 };
    } catch {
        return { error: "error.api.generic", status: 500 };
    }
}
