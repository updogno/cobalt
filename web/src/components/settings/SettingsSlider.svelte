<script
    lang="ts"
    generics="
        Context extends Exclude<keyof CobaltSettings, 'schemaVersion'>,
        Id extends keyof CobaltSettings[Context]
    "
>
    import { get } from "svelte/store";
    import type { CobaltSettings } from "$lib/types/settings";

    import settings, { updateSetting } from "$lib/state/settings";

    export let settingId: Id;
    export let settingContext: Context;
    export let title: string;
    export let description: string = "";
    export let min: number = 0;
    export let max: number = 100;
    export let step: number = 1;
    export let unit: string = "";

    let value: number = Number(get(settings)[settingContext][settingId]) || 0;

    const save = (newValue: number) => {
        updateSetting({
            [settingContext]: {
                [settingId]: newValue,
            },
        });
    };
</script>

<div class="slider-container">
    <div class="slider-info">
        <span class="slider-title">{title}</span>
        {#if description}
            <span class="slider-description">{description}</span>
        {/if}
    </div>
    <div class="slider-controls">
        <input
            type="range"
            class="slider-input"
            bind:value
            on:input={() => save(value)}
            {min}
            {max}
            {step}
        />
        <span class="slider-value">{value}{unit}</span>
    </div>
</div>

<style>
    .slider-container {
        display: flex;
        flex-direction: column;
        padding: 12px 16px;
        gap: 12px;
        background: var(--button);
        border-radius: 12px;
    }

    .slider-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .slider-title {
        font-size: 14.5px;
        font-weight: 500;
        color: var(--secondary);
    }

    .slider-description {
        font-size: 12.5px;
        color: var(--gray);
        white-space: pre-line;
    }

    .slider-controls {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 12px;
    }

    .slider-input {
        flex: 1;
        height: 6px;
        border-radius: 3px;
        background: var(--button-hover);
        appearance: none;
        cursor: pointer;
    }

    .slider-input::-webkit-slider-thumb {
        appearance: none;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: var(--secondary);
        cursor: pointer;
    }

    .slider-input::-moz-range-thumb {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: var(--secondary);
        cursor: pointer;
        border: none;
    }

    .slider-value {
        font-size: 13px;
        font-weight: 500;
        color: var(--secondary);
        min-width: 45px;
        text-align: right;
    }
</style>
