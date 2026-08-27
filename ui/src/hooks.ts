// Bridge-backed replacements for the desktop shell hooks the ported components
// consume. Each mirrors the shell hook's RETURN SHAPE (so the copied component
// call-sites need no edits) but loads over `window.ryu` with plain
// `useEffect`+`useState` polling — no `@tanstack/react-query`, no shell stores,
// nothing that reaches outside the sandbox.

import { useCallback, useEffect, useRef, useState } from "react";
import {
	type ApiTarget,
	type AppInfo,
	type ComposioStatus,
	type ComposioToolkit,
	type ComposioTrigger,
	fetchApps,
	fetchComposioStatus,
	fetchComposioToolkits,
	fetchComposioTriggers,
	fetchHookEvents,
	fetchJobs,
	fetchMcp,
	type HookEventInfo,
	listRecipes,
	type McpServer,
	type McpTool,
	type RecipeSummary,
	type RecordingState,
	type RecordingStopResult,
	type ScheduledJob,
	startRecording,
	stopRecording,
} from "./bridge.ts";

/** Inert node target — the host owns the real token; the frame never sees it.
 *  Kept so ported call-sites (`{ url: activeNode.url, token: activeNode.token }`)
 *  type-check unchanged. */
export function useActiveNode(): ApiTarget {
	return { url: "", token: null };
}

/** Load a bridge resource once; expose the value with a safe default. */
function useBridgeResource<T>(load: () => Promise<T>, fallback: T): T {
	const [value, setValue] = useState<T>(fallback);
	const loadRef = useRef(load);
	loadRef.current = load;
	useEffect(() => {
		let alive = true;
		loadRef
			.current()
			.then((v) => {
				if (alive) {
					setValue(v);
				}
			})
			.catch(() => {
				/* leave the fallback in place; the bridge surfaces the error */
			});
		return () => {
			alive = false;
		};
	}, []);
	return value;
}

export function useApps(): { apps: AppInfo[] } {
	const apps = useBridgeResource<AppInfo[]>(() => fetchApps(), []);
	return { apps };
}

export function useMcp(): { servers: McpServer[]; tools: McpTool[] } {
	return useBridgeResource<{ servers: McpServer[]; tools: McpTool[] }>(
		() => fetchMcp(),
		{ servers: [], tools: [] }
	);
}

export function useSchedules(): { jobs: ScheduledJob[] } {
	const jobs = useBridgeResource<ScheduledJob[]>(() => fetchJobs(), []);
	return { jobs };
}

/** Recipes + live recording control (drives the recipe-node picker + the
 *  RecordToWorkflow flow). Polls the recorder status once/second while active. */
export function useRecipes(): {
	recipes: RecipeSummary[];
	recording: RecordingState | null;
	recordBusy: boolean;
	startRecord: (task: string) => Promise<RecordingState>;
	stopRecord: () => Promise<RecordingStopResult>;
} {
	const recipes = useBridgeResource<RecipeSummary[]>(() => listRecipes(), []);
	const [recording, setRecording] = useState<RecordingState | null>(null);
	const [recordBusy, setRecordBusy] = useState(false);

	// Poll the recorder status while a recording is live so the counters update.
	useEffect(() => {
		if (!recording?.recording) {
			return;
		}
		const id = setInterval(() => {
			void import("./bridge.ts").then(({ getRecordingStatus }) =>
				getRecordingStatus()
					.then(setRecording)
					.catch(() => {
						/* transient */
					})
			);
		}, 1000);
		return () => clearInterval(id);
	}, [recording?.recording]);

	const startRecord = useCallback(async (task: string) => {
		setRecordBusy(true);
		try {
			const state = await startRecording({ url: "", token: null }, task);
			setRecording(state);
			return state;
		} finally {
			setRecordBusy(false);
		}
	}, []);

	const stopRecord = useCallback(async () => {
		setRecordBusy(true);
		try {
			const result = await stopRecording();
			setRecording(null);
			return result;
		} finally {
			setRecordBusy(false);
		}
	}, []);

	return { recipes, recording, recordBusy, startRecord, stopRecord };
}

/** No paywall inside the sandbox — background-run gating is a shell concern; the
 *  app lets the user configure any trigger and Core/the shell governs execution. */
export function useEntitlementContext(): {
	canUse: (_feature: string) => boolean;
	requestUpgrade: () => void;
} {
	return { canUse: () => true, requestUpgrade: () => undefined };
}

// ── Composio catalog hooks (react-query-shaped `{ data }` the trigger UI reads) ─

export function useComposioStatus(): { data: ComposioStatus | undefined } {
	const [data, setData] = useState<ComposioStatus | undefined>(undefined);
	useEffect(() => {
		let alive = true;
		fetchComposioStatus()
			.then((d) => {
				if (alive) {
					setData(d);
				}
			})
			.catch(() => {
				if (alive) {
					setData({ configured: false });
				}
			});
		return () => {
			alive = false;
		};
	}, []);
	return { data };
}

/** Every app event an enabled app declares it emits, for the `event` trigger's
 *  picker. Empty is a legitimate steady state (no installed app emits anything
 *  yet), so the caller must render a "nothing to subscribe to" hint rather than a
 *  spinner. */
export function useHookEvents(enabled: boolean): {
	data: HookEventInfo[] | undefined;
} {
	const [data, setData] = useState<HookEventInfo[] | undefined>(undefined);
	useEffect(() => {
		if (!enabled) {
			return;
		}
		let alive = true;
		fetchHookEvents()
			.then((d) => {
				if (alive) {
					setData(d);
				}
			})
			.catch(() => {
				/* leave undefined */
			});
		return () => {
			alive = false;
		};
	}, [enabled]);
	return { data };
}

export function useComposioToolkits(enabled: boolean): {
	data: ComposioToolkit[] | undefined;
} {
	const [data, setData] = useState<ComposioToolkit[] | undefined>(undefined);
	useEffect(() => {
		if (!enabled) {
			return;
		}
		let alive = true;
		fetchComposioToolkits()
			.then((d) => {
				if (alive) {
					setData(d);
				}
			})
			.catch(() => {
				/* leave undefined */
			});
		return () => {
			alive = false;
		};
	}, [enabled]);
	return { data };
}

export function useComposioTriggers(toolkit: string | null): {
	data: ComposioTrigger[] | undefined;
} {
	const [data, setData] = useState<ComposioTrigger[] | undefined>(undefined);
	useEffect(() => {
		if (!toolkit) {
			return;
		}
		let alive = true;
		fetchComposioTriggers({ url: "", token: null }, toolkit)
			.then((d) => {
				if (alive) {
					setData(d);
				}
			})
			.catch(() => {
				/* leave undefined */
			});
		return () => {
			alive = false;
		};
	}, [toolkit]);
	return { data };
}
