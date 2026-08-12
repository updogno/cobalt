<script lang="ts">
    import { t } from "$lib/i18n/translations";
    import settings from "$lib/state/settings";
    import { createDialog } from "$lib/state/dialogs";

    import Omnibox from "$components/playlist/Omnibox.svelte";
    import Meowbalt from "$components/misc/Meowbalt.svelte";
    import SupportedServices from "$components/playlist/SupportedServices.svelte";

    let warned = false;

    // playlists need the /playlist endpoint, which only instances running
    // this fork have. the default instance always does, a custom one may not
    $effect(() => {
        const customInstance = $settings.processing.enableCustomInstances
            && $settings.processing.customInstanceURL.length > 0;

        if (customInstance && !warned) {
            warned = true;

            createDialog({
                id: "playlist-instance-warning",
                title: $t("playlist.instance.warning.title"),
                bodyText: $t("playlist.instance.warning"),
                dismissable: true,
                leftAligned: true,
                type: "small",
            });
        }
    });
</script>

<svelte:head>
    <title>{$t("general.cobalt")}</title>
    <meta property="og:title" content={$t("general.cobalt")} />
</svelte:head>

<div id="cobalt-playlist-container" class="center-column-container">
    <SupportedServices />
    <main
        id="cobalt-playlist"
        tabindex="-1"
        data-first-focus
    >
        <Meowbalt emotion="smile" />
        <Omnibox />
    </main>

    <div class="page-note">
        {$t("playlist.source.credit")}
        <a href="https://github.com/hyperdefined/playlist.cobalt.directory">
            {$t("playlist.source.credit.link")}
        </a>
    </div>
    <div class="page-note">
        {$t("save.terms.note.agreement")}
        <a href="/about/terms">{$t("save.terms.note.link")}</a>
    </div>
</div>

<style>
    #cobalt-playlist-container {
        padding: var(--padding);
        overflow: hidden;
    }

    #cobalt-playlist {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        gap: 15px;
    }

    .page-note {
        bottom: 0;
        color: var(--gray);
        font-size: 12px;
        text-align: center;
        padding-bottom: 6px;
        font-weight: 500;
    }

    @media screen and (max-width: 535px) {
        #cobalt-playlist-container {
            padding-top: calc(var(--padding) / 2);
        }

        .page-note {
            font-size: 11px;
            padding-bottom: 0;
        }
    }
</style>
