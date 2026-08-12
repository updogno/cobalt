import { readable, type Updater } from "svelte/store";

import { schedule } from "$lib/task-manager/scheduler";
import { clearFileStorage, removeFromFileStorage } from "$lib/storage/opfs";
import { clearCurrentTasks, removeWorkerFromQueue } from "$lib/state/task-manager/current-tasks";

import type {
    CobaltQueue,
    CobaltQueueItem,
    CobaltQueueItemPending,
    CobaltQueueItemRunning,
    UUID,
} from "$lib/types/queue";

const clearPipelineCache = (queueItem: CobaltQueueItem) => {
    if (queueItem.state === "running") {
        for (const [ workerId, item ] of Object.entries(queueItem.pipelineResults)) {
            removeFromFileStorage(item.name);
            delete queueItem.pipelineResults[workerId];
        }
    } else if (queueItem.state === "done") {
        removeFromFileStorage(queueItem.resultFile.name);
    }

    return queueItem;
}

let update: (_: Updater<CobaltQueue>) => void;

export const queue = readable<CobaltQueue>(
    {},
    (_, _update) => { update = _update }
);

export function addItem(item: CobaltQueueItem) {
    update(queueData => {
        queueData[item.id] = item;
        return queueData;
    });

    schedule();
}

export function addPendingItem(item: CobaltQueueItemPending) {
    update(queueData => {
        queueData[item.id] = item;
        return queueData;
    });
}

// pending items never enter the pipeline, so they're swapped out wholesale
// rather than spread over a base item that doesn't exist
export function markPendingAsDone(id: UUID) {
    update(queueData => {
        const item = queueData[id];

        if (item?.state === "pending") {
            queueData[id] = {
                id: item.id,
                state: "done",
                resultFile: new File([], item.filename),
                pipeline: [],
                filename: item.filename,
                mediaType: item.mediaType,
            }
        }

        return queueData;
    });
}

export function markPendingAsError(id: UUID, errorCode: string) {
    update(queueData => {
        const item = queueData[id];

        if (item?.state === "pending") {
            queueData[id] = {
                id: item.id,
                state: "error",
                errorCode,
                pipeline: [],
                canRetry: false,
                filename: item.filename,
                mediaType: item.mediaType,
            }
        }

        return queueData;
    });
}

// resolves once an item reaches a terminal state, so playlist entries can be
// processed one at a time instead of all at once
export function waitForItemCompletion(id: UUID): Promise<{ success: boolean, errorCode?: string }> {
    return new Promise(resolve => {
        let unsubscribe: (() => void) | undefined;
        let settled = false;

        const finish = (result: { success: boolean, errorCode?: string }) => {
            settled = true;
            unsubscribe?.();
            resolve(result);
        }

        unsubscribe = queue.subscribe(queueData => {
            const item = queueData[id];

            if (!item) {
                return finish({ success: false, errorCode: "error.queue.item_not_found" });
            }

            if (item.state === "done") {
                return finish({ success: true });
            }

            if (item.state === "error") {
                return finish({ success: false, errorCode: item.errorCode });
            }
        });

        // subscribe runs synchronously, so it may have already resolved
        // before `unsubscribe` was assigned
        if (settled) unsubscribe();
    });
}

export function itemError(id: UUID, workerId: UUID, error: string) {
    update(queueData => {
        const item = queueData[id];

        if (item && item.state !== "pending") {
            queueData[id] = clearPipelineCache(item);

            queueData[id] = {
                ...item,
                state: "error",
                errorCode: error,
            }
        }
        return queueData;
    });

    removeWorkerFromQueue(workerId);
    schedule();
}

export function itemDone(id: UUID, file: File) {
    update(queueData => {
        const item = queueData[id];

        if (item && item.state !== "pending") {
            queueData[id] = clearPipelineCache(item);

            queueData[id] = {
                ...item,
                state: "done",
                resultFile: file,
            }
        }
        return queueData;
    });

    schedule();
}

export function pipelineTaskDone(id: UUID, workerId: UUID, file: File) {
    update(queueData => {
        const item = queueData[id];

        if (item && item.state === 'running') {
            item.pipelineResults[workerId] = file;
        }

        return queueData;
    });

    removeWorkerFromQueue(workerId);
    schedule();
}

export function itemRunning(id: UUID) {
    update(queueData => {
        const data = queueData[id] as CobaltQueueItemRunning;

        if (data) {
            data.state = 'running';
            data.pipelineResults ??= {};
        }

        return queueData;
    });

    schedule();
}

export function removeItem(id: UUID) {
    update(queueData => {
        const item = queueData[id];
        if (!item) return queueData;

        // pending items never got a pipeline to tear down
        if (item.state !== "pending") {
            for (const worker of item.pipeline) {
                removeWorkerFromQueue(worker.workerId);
            }
            clearPipelineCache(item);
        }

        delete queueData[id];
        return queueData;
    });

    schedule();
}

export function clearQueue() {
    update(() => ({}));
    clearCurrentTasks();
    clearFileStorage();
}
