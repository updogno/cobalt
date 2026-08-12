<script
    lang="ts"
    generics="
        Context extends Exclude<keyof CobaltSettings, 'schemaVersion'>,
        Id extends keyof CobaltSettings[Context]
    "
>
    import { get } from "svelte/store";
    import { t } from "$lib/i18n/translations";
    import type { CobaltSettings } from "$lib/types/settings";

    import settings, { updateSetting } from "$lib/state/settings";

    import IconX from "@tabler/icons-svelte/IconX.svelte";

    export let settingId: Id;
    export let settingContext: Context;
    export let title: string;
    export let description: string = "";

    let colorValue: string = String(get(settings)[settingContext][settingId]) || "#000000";

    const save = (value: string) => {
        updateSetting({
            [settingContext]: {
                [settingId]: value,
            },
        });
    };

    const clear = () => {
        colorValue = "";
        save("");
    };
</script>

<div class="color-picker-container">
    <div class="color-picker-info">
        <span class="color-picker-title">{title}</span>
        {#if description}
            <span class="color-picker-description">{description}</span>
        {/if}
    </div>
    <div class="color-picker-controls">
        <input
            type="color"
            class="color-input"
            bind:value={colorValue}
            on:change={() => save(colorValue)}
        />
        {#if colorValue}
            <button
                class="button clear-button"
                on:click={clear}
                aria-label={$t("button.clear")}
            >
                <IconX />
            </button>
        {/if}
    </div>
</div>

<style>
    .color-picker-container {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        gap: 16px;
        background: var(--button);
        border-radius: 12px;
    }

    .color-picker-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .color-picker-title {
        font-size: 14.5px;
        font-weight: 500;
        color: var(--secondary);
    }

    .color-picker-description {
        font-size: 12.5px;
        color: var(--gray);
        white-space: pre-line;
    }

    .color-picker-controls {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 8px;
    }

    .color-input {
        width: 48px;
        height: 36px;
        padding: 2px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        background: var(--button-hover);
    }

    .color-input::-webkit-color-swatch-wrapper {
        padding: 0;
    }

    .color-input::-webkit-color-swatch {
        border: none;
        border-radius: 6px;
    }

    .color-input::-moz-color-swatch {
        border: none;
        border-radius: 6px;
    }

    .clear-button {
        padding: 6px;
        background: var(--button-hover);
        border-radius: 8px;
    }

    .clear-button :global(svg) {
        width: 18px;
        height: 18px;
    }
</style>
