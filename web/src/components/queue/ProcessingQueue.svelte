<script lang="ts">
    import { onMount } from "svelte";
    import { t } from "$lib/i18n/translations";
    import { beforeNavigate, onNavigate } from "$app/navigation";

    import { openFile } from "$lib/download";
    import { clearFileStorage } from "$lib/storage/opfs";
    import { savingHandler } from "$lib/api/saving-handler";

    import { getProgress } from "$lib/task-manager/queue";
    import { queueVisible } from "$lib/state/queue-visibility";
    import { currentTasks } from "$lib/state/task-manager/current-tasks";
    import { clearQueue, removeItem, queue as readableQueue } from "$lib/state/task-manager/queue";

    import SectionHeading from "$components/misc/SectionHeading.svelte";
    import PopoverContainer from "$components/misc/PopoverContainer.svelte";
    import ProcessingStatus from "$components/queue/ProcessingStatus.svelte";
    import ProcessingQueueItem from "$components/queue/ProcessingQueueItem.svelte";
    import ProcessingQueueStub from "$components/queue/ProcessingQueueStub.svelte";

    import IconX from "@tabler/icons-svelte/IconX.svelte";
    import IconReload from "@tabler/icons-svelte/IconReload.svelte";
    import IconDownload from "@tabler/icons-svelte/IconDownload.svelte";

    const popoverAction = () => {
        $queueVisible = !$queueVisible;
    };

    let queue = $derived(Object.entries($readableQueue));

    let totalProgress = $derived(queue.length ? queue.map(
        ([, item]) => getProgress(item, $currentTasks) * 100
    ).reduce((a, b) => a + b) / (100 * queue.length) : 0);

    let indeterminate = $derived(queue.length > 0 && totalProgress === 0);

    let failedItems = $derived(
        queue.filter(([, item]) => item.state === "error" && item.canRetry)
    );

    let doneItems = $derived(
        queue.filter(([, item]) => item.state === "done" && item.resultFile)
    );

    let allDone = $derived(queue.length > 0 && doneItems.length === queue.length);

    let retryingAll = $state(false);
    let savingAll = $state(false);

    const MAX_RETRIES = 3;
    const BACKOFF_TIME_MS = 5000;

    // track retry counts per item id
    let retryCounts: Record<string, number> = $state({});

    // filter out items that have exceeded max retries
    let retryableItems = $derived(
        failedItems.filter(([id]) => (retryCounts[id] ?? 0) < MAX_RETRIES)
    );

    const retryFailed = async () => {
        retryingAll = true;
        const itemsToRetry = [...retryableItems];
        for (let i = 0; i < itemsToRetry.length; i++) {
            const [id, item] = itemsToRetry[i];
            if (item.state === "error" && item.canRetry && item.originalRequest) {
                retryCounts[id] = (retryCounts[id] ?? 0) + 1;
                await savingHandler({
                    request: item.originalRequest,
                    oldTaskId: id,
                });
                // backoff time between retries to prevent frequent failures
                if (i < itemsToRetry.length - 1) {
                    await new Promise(r => setTimeout(r, BACKOFF_TIME_MS));
                }
            }
        }
        retryingAll = false;
    };

    const saveAll = async () => {
        savingAll = true;
        for (const [id, item] of doneItems) {
            if (item.state === "done" && item.resultFile) {
                openFile(new File([item.resultFile], item.filename, {
                    type: item.mimeType,
                }));
                removeItem(id);
                // small delay between downloads to avoid browser blocking
                await new Promise(r => setTimeout(r, 300));
            }
        }
        savingAll = false;
    };

    onNavigate(() => {
        $queueVisible = false;
    });

    onMount(() => {
        // clear old files from storage on first page load
        clearFileStorage();
    });

    beforeNavigate((event) => {
        if (event.type === "leave" && (totalProgress > 0 && totalProgress < 1)) {
            event.cancel();
        }
    });
</script>

<div id="processing-queue">
    <ProcessingStatus
        progress={totalProgress * 100}
        {indeterminate}
        expandAction={popoverAction}
    />

    <PopoverContainer
        id="processing-popover"
        expanded={$queueVisible}
        expandStart="right"
    >
        <div id="processing-header">
            <div class="header-top">
                <SectionHeading
                    title={$t("queue.title")}
                    sectionId="queue"
                    beta
                    nolink
                />
                <div class="header-buttons">
                    {#if retryableItems.length > 0}
                        <button
                            class="retry-button"
                            onclick={retryFailed}
                            disabled={retryingAll}
                            tabindex={!$queueVisible ? -1 : undefined}
                        >
                            <IconReload />
                            {$t("button.retry")} ({retryableItems.length})
                        </button>
                    {/if}
                    {#if allDone}
                        <button
                            class="save-button"
                            onclick={saveAll}
                            disabled={savingAll}
                            tabindex={!$queueVisible ? -1 : undefined}
                        >
                            <IconDownload />
                            {$t("button.save")} ({doneItems.length})
                        </button>
                    {/if}
                    {#if queue.length}
                        <button
                            class="clear-button"
                            onclick={clearQueue}
                            tabindex={!$queueVisible ? -1 : undefined}
                        >
                            <IconX />
                            {$t("button.clear")}
                        </button>
                    {/if}
                </div>
            </div>
        </div>

        <div id="processing-list" role="list" aria-labelledby="queue-title">
            {#each queue as [id, item]}
                <ProcessingQueueItem {id} info={item} />
            {/each}
            {#if queue.length === 0}
                <ProcessingQueueStub />
            {/if}
        </div>
    </PopoverContainer>
</div>

<style>
    #processing-queue {
        --holder-padding: 12px;
        position: absolute;
        right: 0;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        justify-content: end;
        z-index: 9;
        pointer-events: none;
        padding: var(--holder-padding);
        width: calc(100% - var(--holder-padding) * 2);
    }

    #processing-queue :global(#processing-popover) {
        gap: 12px;
        padding: 16px;
        padding-bottom: 0;
        width: calc(100% - 16px * 2);
        max-width: 425px;
    }

    #processing-header {
        display: flex;
        flex-direction: column;
        flex-wrap: wrap;
        gap: 3px;
    }

    .header-top {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
    }

    .header-buttons {
        display: flex;
        flex-direction: row;
        gap: var(--padding);
    }

    .header-buttons button {
        font-size: 13px;
        font-weight: 500;
        padding: 0;
        background: none;
        box-shadow: none;
        text-align: left;
        border-radius: 3px;
        outline-offset: 5px;
    }

    .header-buttons button :global(svg) {
        height: 16px;
        width: 16px;
    }

    .clear-button {
        color: var(--medium-red);
    }

    .retry-button {
        color: var(--secondary);
    }

    .save-button {
        color: var(--medium-green);
    }

    .header-buttons button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    #processing-list {
        display: flex;
        flex-direction: column;
        max-height: 65vh;
        overflow-y: scroll;
        overflow-x: hidden;
    }

    @media screen and (max-width: 535px) {
        #processing-queue {
            --holder-padding: 8px;
            padding-top: 4px;
            top: env(safe-area-inset-top);
        }
    }
</style>
