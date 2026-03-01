import { writable } from "svelte/store";
import type { ServiceStatusCache } from "$lib/types/service-status";

export default writable<ServiceStatusCache | undefined>();
