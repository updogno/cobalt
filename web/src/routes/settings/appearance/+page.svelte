<script lang="ts">
    import settings from "$lib/state/settings";

    import { device } from "$lib/device";
    import { themeOptions } from "$lib/types/settings";
    import { t, locales } from "$lib/i18n/translations";

    import Switcher from "$components/buttons/Switcher.svelte";
    import SettingsButton from "$components/buttons/SettingsButton.svelte";
    import SettingsToggle from "$components/buttons/SettingsToggle.svelte";
    import SettingsInput from "$components/settings/SettingsInput.svelte";
    import SettingsSlider from "$components/settings/SettingsSlider.svelte";
    import SettingsCategory from "$components/settings/SettingsCategory.svelte";
    import SettingsDropdown from "$components/settings/SettingsDropdown.svelte";
    import SettingsColorPicker from "$components/settings/SettingsColorPicker.svelte";

    const dropdownItems = () => {
        return $locales.reduce((obj, lang) => {
            return {
                ...obj,
                [lang]: $t(`languages.${lang}`),
            };
        }, {});
    };
</script>

<SettingsCategory sectionId="theme" title={$t("settings.theme")}>
    <Switcher big={true} description={$t("settings.theme.description")}>
        {#each themeOptions as value}
            <SettingsButton
                settingContext="appearance"
                settingId="theme"
                settingValue={value}
            >
                {$t(`settings.theme.${value}`)}
            </SettingsButton>
        {/each}
    </Switcher>

    {#if $settings.appearance.theme === "custom"}
        <SettingsInput
            settingContext="appearance"
            settingId="customBackgroundUrl"
            type="imageUrl"
            placeholder={$t("settings.theme.custom.background_url.placeholder")}
            altText={$t("settings.theme.custom.background_url")}
        />
        {#if $settings.appearance.customBackgroundUrl}
            <SettingsSlider
                settingContext="appearance"
                settingId="customBackgroundBlur"
                title={$t("settings.theme.custom.blur")}
                description={$t("settings.theme.custom.blur.description")}
                min={0}
                max={20}
                step={1}
                unit="px"
            />
            <SettingsSlider
                settingContext="appearance"
                settingId="customBackgroundDarken"
                title={$t("settings.theme.custom.darken")}
                description={$t("settings.theme.custom.darken.description")}
                min={0}
                max={80}
                step={5}
                unit="%"
            />
        {:else}
            <SettingsColorPicker
                settingContext="appearance"
                settingId="customBackgroundColor"
                title={$t("settings.theme.custom.background_color")}
                description={$t("settings.theme.custom.background_color.description")}
            />
        {/if}
        <SettingsColorPicker
            settingContext="appearance"
            settingId="customSidebarColor"
            title={$t("settings.theme.custom.sidebar_color")}
            description={$t("settings.theme.custom.sidebar_color.description")}
        />
    {/if}
</SettingsCategory>

<SettingsCategory sectionId="language" title={$t("settings.language")}>
    <SettingsToggle
        settingContext="appearance"
        settingId="autoLanguage"
        title={$t("settings.language.auto.title")}
        description={$t("settings.language.auto.description")}
    />

    <SettingsDropdown
        title={$t("settings.language.preferred.title")}
        description={$t("settings.language.preferred.description")}
        items={dropdownItems()}
        settingContext="appearance"
        settingId="language"
        selectedOption={$settings.appearance.language}
        selectedTitle={$t(`languages.${$settings.appearance.language}`)}
        disabled={$settings.appearance.autoLanguage}
    />
</SettingsCategory>

{#if device.is.mobile}
    <SettingsCategory sectionId="tabs" title={$t("settings.tabs")}>
        <SettingsToggle
            settingContext="appearance"
            settingId="hideRemuxTab"
            title={$t("settings.tabs.hide_remux")}
            description={$t("settings.tabs.hide_remux.description")}
        />
    </SettingsCategory>
{/if}
