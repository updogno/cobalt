import type { SubtitleLang } from "$lib/settings/audio-sub-language";
import type { CobaltSettingsV5 } from "$lib/types/settings/v5";

export const youtubeVideoContainerOptions = ["auto", "mp4", "webm", "mkv"] as const;
export const localProcessingOptions = ["disabled", "preferred", "forced"] as const;

export type CobaltSettingsV6 = Omit<CobaltSettingsV5, 'schemaVersion' | 'save' | 'appearance'> & {
    schemaVersion: 6,
    appearance: CobaltSettingsV5['appearance'] & {
        customBackgroundUrl: string,
        customBackgroundColor: string,
        customSidebarColor: string,
        customBackgroundBlur: number,
        customBackgroundDarken: number,
    },
    save: Omit<CobaltSettingsV5['save'], 'localProcessing'> & {
        localProcessing: typeof localProcessingOptions[number],
        youtubeVideoContainer: typeof youtubeVideoContainerOptions[number];
        subtitleLang: SubtitleLang,
    },
};
