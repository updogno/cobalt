<script lang="ts">
    import SectionHeading from "$components/misc/SectionHeading.svelte";
</script>

<section id="hosting">
<SectionHeading
    title="about this instance"
    sectionId="hosting"
/>

this is a community instance of cobalt, hosted at [cobalt.updog.no](https://cobalt.updog.no). it is not affiliated with imput, the authors of cobalt.

the frontend you're looking at runs on cloudflare workers as static files. saving itself is handled by separate api instances running on dedicated machines, since that part needs ffmpeg and can't run at the edge.

requests are spread across those api instances, so consecutive saves may be handled by different machines. if something fails, trying again will usually land you on a different one.

the source for this instance is on [github](https://github.com/updogno/cobalt).
</section>

<section id="playlist">
<SectionHeading
    title="playlist saving"
    sectionId="playlist"
/>

this instance can save entire playlists, which upstream cobalt doesn't do. youtube and soundcloud are supported.

paste a playlist link into the playlist tab and every item is added to the processing queue, then saved one at a time. there's a cap on how many items a single playlist may have, so very long playlists are rejected rather than partially saved.

the playlist code is based on [hyperdefined's playlist downloader](https://github.com/hyperdefined/playlist.cobalt.directory).

pointing the app at a custom instance in processing settings will break playlist saving, unless that instance also runs this fork.
</section>

<section id="credits">
<SectionHeading
    title="credits"
    sectionId="credits"
/>

this fork builds on work from several people:

[imput](https://github.com/imputnet) — cobalt itself

[hyperdefined](https://hyper.lol) — playlist downloading

[br0k3x](https://github.com/br0k3x) and [clxxped](https://github.com/clxxped) — playlist integration this port is based on

[zImPatrick](https://github.com/zImPatrick) — fixes for youtube and other services
</section>
