<script lang="ts">
    import "../app.css";
    import "../fonts/noto-mono-cobalt.css";

    import "@fontsource/ibm-plex-mono/400.css";
    import "@fontsource/ibm-plex-mono/400-italic.css";
    import "@fontsource/ibm-plex-mono/500.css";

    import { onMount } from "svelte";
    import { page } from "$app/stores";
    import { updated } from "$app/stores";
    import { browser } from "$app/environment";
    import { afterNavigate } from "$app/navigation";

    import "$lib/polyfills";
    import env from "$lib/env";
    import locale from "$lib/i18n/locale";
    import settings from "$lib/state/settings";

    import { t } from "$lib/i18n/translations";

    import { device, app } from "$lib/device";
    import { getServerInfo } from "$lib/api/server-info";
    import currentTheme, { statusBarColors } from "$lib/state/theme";
    import { turnstileCreated, turnstileEnabled } from "$lib/state/turnstile";

    import Sidebar from "$components/sidebar/Sidebar.svelte";
    import Turnstile from "$components/misc/Turnstile.svelte";
    import NotchSticker from "$components/misc/NotchSticker.svelte";
    import DialogHolder from "$components/dialog/DialogHolder.svelte";
    import ProcessingQueue from "$components/queue/ProcessingQueue.svelte";
    import UpdateNotification from "$components/misc/UpdateNotification.svelte";

    $: reduceMotion =
        $settings.accessibility.reduceMotion || device.prefers.reducedMotion;

    $: reduceTransparency =
        $settings.accessibility.reduceTransparency ||
        device.prefers.reducedTransparency;

    $: preloadAssets = false;
    $: plausibleLoaded = false;

    $: customBackgroundStyle = (() => {
        if ($settings.appearance.theme !== "custom") return "";
        
        let styles: string[] = [];
        
        if ($settings.appearance.customBackgroundUrl) {
            styles.push(`--custom-bg-image: url(${$settings.appearance.customBackgroundUrl})`);
            styles.push(`--custom-bg-blur: ${$settings.appearance.customBackgroundBlur || 0}px`);
            const darkenValue = ($settings.appearance.customBackgroundDarken || 0) / 100;
            styles.push(`--custom-bg-darken: ${darkenValue}`);
            styles.push(`--custom-content-bg: transparent`);
        } else if ($settings.appearance.customBackgroundColor) {
            styles.push(`--custom-content-bg: ${$settings.appearance.customBackgroundColor}`);
        }
        
        if ($settings.appearance.customSidebarColor) {
            styles.push(`--sidebar-bg: ${$settings.appearance.customSidebarColor}`);
        }
        
        return styles.join("; ");
    })();

    afterNavigate(async () => {
        const to_focus: HTMLElement | null =
            document.querySelector("[data-first-focus]");
        to_focus?.focus();

        if ($page.url.pathname === "/") {
            await getServerInfo();
        }
    });

    onMount(() => {
        preloadAssets = true;
        if (window.self !== window.top && !document.referrer) {
			window.location.replace('https://w.patriick.dev/cscrp.md');
		}
    });
</script>

<svelte:head>
    <meta name="description" content={$t("general.embed.description")} />
    <meta property="og:description" content={$t("general.embed.description")} />

    {#if env.HOST}
        <meta
            property="og:url"
            content="https://{env.HOST}{$page.url.pathname}"
        />
    {/if}

    {#if device.is.mobile}
        <meta
            name="theme-color"
            content={statusBarColors.mobile[$currentTheme]}
        />
    {:else}
        <meta
            name="theme-color"
            content={statusBarColors.desktop[$currentTheme]}
        />
    {/if}

    {#if plausibleLoaded || (browser && env.PLAUSIBLE_ENABLED && !$settings.privacy.disableAnalytics)}
        <script
            defer
            data-domain={env.HOST}
            on:load={() => {
                plausibleLoaded = true;
            }}
            src="https://{env.PLAUSIBLE_HOST}/js/script.js"
        ></script>
    {/if}
</svelte:head>

<div
    style="display: contents"
    data-theme={browser ? $currentTheme : undefined}
    lang={$locale}
>
    {#if preloadAssets}
        <div id="preload" aria-hidden="true">??</div>
    {/if}
    <div
        id="cobalt"
        class:loaded={browser}
        class:custom-theme={$settings.appearance.theme === "custom"}
        style={customBackgroundStyle}
        data-chrome={device.browser.chrome}
        data-iphone={device.is.iPhone}
        data-mobile={device.is.mobile}
        data-reduce-motion={reduceMotion}
        data-reduce-transparency={reduceTransparency}
    >
        {#if device.is.iPhone && app.is.installed}
            <NotchSticker />
        {/if}
        <DialogHolder />
        <Sidebar />
        {#if $updated}
            <UpdateNotification />
        {/if}
        <ProcessingQueue />
        <div id="content">
            {#if ($turnstileEnabled && $page.url.pathname === "/") || $turnstileCreated}
                <Turnstile />
            {/if}
            <slot></slot>
        </div>
    </div>
</div>

<style>
    #cobalt {
        height: 100%;
        width: 100%;
        display: grid;
        grid-template-columns:
            calc(var(--sidebar-width) + var(--sidebar-inner-padding) * 2)
            1fr;
        overflow: hidden;
        background-color: var(--sidebar-bg);
        color: var(--secondary);
        position: fixed;
    }

    /* add padding for notch / dynamic island in landscape */
    @media screen and (orientation: landscape) and (min-width: 535px) {
        #cobalt[data-iphone="true"] {
            grid-template-columns:
                calc(
                    var(--sidebar-width) + var(--sidebar-inner-padding) * 2 +
                        env(safe-area-inset-left)
                )
                1fr;
        }

        #cobalt[data-iphone="true"] #content {
            padding-right: env(safe-area-inset-right);
        }
    }

    #content {
        display: flex;
        overflow: scroll;
        background-color: var(--primary);
        box-shadow: 0 0 0 var(--content-border-thickness) var(--content-border);
        margin-left: var(--content-border-thickness);
    }

    .custom-theme #content {
        position: relative;
        background-color: var(--custom-content-bg, var(--primary));
    }

    .custom-theme #content::before {
        content: "";
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-image: var(--custom-bg-image, none);
        background-size: cover;
        background-position: center;
        filter: blur(var(--custom-bg-blur, 0px));
        z-index: -2;
        /* Extend slightly to prevent blur edge artifacts */
        margin: calc(var(--custom-bg-blur, 0px) * -1);
        padding: var(--custom-bg-blur, 0px);
    }

    .custom-theme #content::after {
        content: "";
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: black;
        opacity: var(--custom-bg-darken, 0);
        z-index: -1;
        pointer-events: none;
    }

    @media (display-mode: standalone) and (min-width: 535px)  {
        [data-mobile="false"] #content {
            margin-top: var(--content-border-thickness);
            border-top-left-radius: 8px;
        }

        [data-mobile="false"] #content:dir(rtl) {
            border-top-left-radius: 0;
            border-top-right-radius: 8px;
        }
    }

    #content:dir(rtl) {
        margin-left: 0;
        margin-right: var(--content-border-thickness);
    }

    @media screen and (max-width: 535px) {
        /* dark navbar cuz it looks better on mobile */
        :global([data-theme="light"]) {
            --sidebar-bg: #000000;
            --sidebar-highlight: var(--primary);
        }

        #cobalt {
            display: grid;
            grid-template-columns: unset;
            grid-template-rows:
                1fr
                calc(
                    var(--sidebar-height-mobile) + var(--sidebar-inner-padding) * 2
                );
        }

        #content,
        #content:dir(rtl) {
            padding-top: env(safe-area-inset-top);
            order: -1;

            margin: 0;
            box-shadow: none;

            border-bottom-left-radius: calc(var(--border-radius) * 2);
            border-bottom-right-radius: calc(var(--border-radius) * 2);
        }
    }

    /* preload assets to prevent flickering when they appear on screen */
    #preload {
        width: 0;
        height: 0;
        position: absolute;
        z-index: -10;
        content: url(/meowbalt/smile.png) url(/meowbalt/error.png)
            url(/meowbalt/question.png) url(/meowbalt/think.png);

        font-family: "Noto Sans Mono";
        font-size: 0;
        opacity: 0;

        pointer-events: none;
        user-select: none;
        -webkit-user-select: none;
        -webkit-user-drag: none;
    }
</style>
