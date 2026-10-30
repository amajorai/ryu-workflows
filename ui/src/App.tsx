import { RyuAppToolbar } from "@ryu/blocks/companion/app-ui";
import {
	isViewVisible,
	subscribeViewVisibility,
} from "@ryu/ui/lib/view-visibility.ts";
import type { WorkflowDefinition } from "./schemas.ts";
// The Workflows companion shell. This is now the PRIMARY visual canvas surface
// (S3 cutover): the shell's `/workflows/:id` + `/workflows/new` routes mount this
// companion via PluginCompanionPage, and the deep-linked workflow id arrives as
// `window.ryu.context.workflowId`. It reproduces the desktop `WorkflowsPage`
// canvas role — select/create a workflow, drive the React Flow canvas, run +
// resume, record → workflow — self-contained inside the sandbox while the host
// owns the workflow record picker through `sidebar_sections`.
//
// It DROPS the natural-language builder, which is architecturally shell-only:
// `host.runAgent`'s fixed PermissionPreset never exposes the `workflow_builder.*`
// tools to a sandboxed frame (Track E spec crux #1), and the builder needs the
// shell's Ask Ryu panel + assistant store. The builder therefore stays in the
// shell permanently (`apps/desktop/src/pages/WorkflowsPage.tsx`, reached via the
// Create menu's "Build with AI" → `/workflows/build`). Documented limitation of
// that split: the shell and sandbox stay process-isolated, while the app realtime
// room invalidates an already-open canvas after either side saves the workflow.
//
// Everything else round-trips to Core over the `window.ryu` bridge.

import {
	PlusSignIcon,
	RecordIcon,
	WorkflowSquare01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	openRealtimeResource,
	type RealtimeResourceChannel,
} from "@ryu/app-host/realtime";
import { Button, Spinner } from "@ryu/blocks/companion/controls";
import { useLiteralMessages } from "@ryu/i18n/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LimitWaitPanel, ResumePanel } from "./App-run-panels.tsx";
import {
	createWorkflow,
	fetchWorkflow,
	fetchWorkflows,
	getWorkflowRun,
	type NodeRunState,
	resumeWorkflow,
	runWorkflow,
	type Workflow,
	type WorkflowRun,
} from "./bridge.ts";
import { RecordToWorkflow } from "./RecordToWorkflow.tsx";
import { WorkflowCanvas } from "./WorkflowCanvas.tsx";

/**
 * The definition the editor opens. `GET /workflows` masks the webhook signing
 * secret, so the editor reads the single-workflow view (which keeps it for the
 * reveal/copy control). If that read fails it falls back to the list entry: a
 * save then echoes the placeholder and Core keeps the stored secret.
 */
async function loadForEditor(
	id: string,
	list: Workflow[]
): Promise<Workflow | null> {
	const listed = list.find((workflow) => workflow.id === id) ?? null;
	if (!listed) {
		return null;
	}
	try {
		return await fetchWorkflow({ url: "", token: null }, id);
	} catch {
		return listed;
	}
}

export function App() {
	const tl = useLiteralMessages();
	const [workflows, setWorkflows] = useState<Workflow[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState<Workflow | null>(null);
	const [canvasGeneration, setCanvasGeneration] = useState(0);
	const selectedIdRef = useRef<string | null>(null);
	selectedIdRef.current = selected?.id ?? null;
	const selectedWorkflowRef = useRef(selected);
	selectedWorkflowRef.current = selected;
	const reloadLatestRequestRef = useRef(0);
	const realtimeRef = useRef<RealtimeResourceChannel | null>(null);
	const [recordOpen, setRecordOpen] = useState(false);
	const [runNodesByWorkflow, setRunNodesByWorkflow] = useState<
		Record<string, Record<string, NodeRunState>>
	>({});
	const [lastRunByWorkflow, setLastRunByWorkflow] = useState<
		Record<string, WorkflowRun>
	>({});

	const reload = useCallback(async () => {
		try {
			const list = await fetchWorkflows();
			setWorkflows(list);
			setError(null);
			return list;
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to load workflows");
			return [];
		} finally {
			setLoading(false);
		}
	}, []);

	// Initial load + preselect the workflow the host deep-linked (context.workflowId).
	useEffect(() => {
		let alive = true;
		reload().then((list) => {
			if (!alive) {
				return;
			}
			const wanted = globalThis.window?.ryu?.context?.workflowId;
			if (wanted && list.some((w) => w.id === wanted)) {
				// The list masks the webhook signing secret; the editor opens the
				// single-workflow view so its reveal/copy control has the real one.
				loadForEditor(wanted, list).then((full) => {
					if (alive && full) {
						setSelected(full);
					}
				});
			}
		});
		return () => {
			alive = false;
		};
	}, [reload]);

	useEffect(() => {
		const workflowId = selected?.id;
		if (!workflowId) {
			return;
		}
		let cancelled = false;
		let channel: RealtimeResourceChannel | null = null;
		openRealtimeResource({
			onChanged: async () => {
				const list = await reload();
				const full = await loadForEditor(workflowId, list);
				if (!cancelled) {
					setSelected(full);
				}
			},
			roomId: workflowId,
		})
			.then((connected) => {
				if (cancelled) {
					void connected.close();
					return;
				}
				channel = connected;
				realtimeRef.current = connected;
				void connected.publishPresence({ surface: "workflow-canvas" });
			})
			.catch(() => {
				// Offline workflow editing continues through the governed bridge.
			});
		return () => {
			cancelled = true;
			realtimeRef.current = null;
			if (channel) {
				void channel.close();
			}
		};
	}, [reload, selected?.id]);

	const activeRun = selected ? lastRunByWorkflow[selected.id] : undefined;
	const awaitingRunId =
		activeRun?.status === "awaiting_input" ? activeRun.runId : null;
	const selectedWorkflowId = selected?.id;
	useEffect(() => {
		if (!(selectedWorkflowId && awaitingRunId)) {
			return;
		}
		const workflowId = selectedWorkflowId;
		let alive = true;
		let pending = false;
		const refresh = async () => {
			if (!alive || pending || !isViewVisible()) {
				return;
			}
			pending = true;
			try {
				const result = await getWorkflowRun(
					{ url: "", token: null },
					awaitingRunId
				);
				if (!alive) {
					return;
				}
				setRunNodesByWorkflow((prev) => ({
					...prev,
					[workflowId]: result.nodes,
				}));
				setLastRunByWorkflow((prev) => ({ ...prev, [workflowId]: result }));
			} catch {
				// A transient poll failure leaves the current run state visible.
			} finally {
				pending = false;
			}
		};
		const unsubscribe = subscribeViewVisibility(() => void refresh());
		void refresh();
		const interval = window.setInterval(() => void refresh(), 2500);
		return () => {
			alive = false;
			unsubscribe();
			window.clearInterval(interval);
		};
	}, [awaitingRunId, selectedWorkflowId]);

	const saveWorkflow = useCallback(
		async (definition: WorkflowDefinition, openSaved: boolean) => {
			const wf = await createWorkflow({ url: "", token: null }, definition);
			// A new canvas serializes an empty id. It still owns the selection when
			// nothing else was selected while its first save was in flight. A
			// recording always opens the workflow it just built.
			if (openSaved || selectedIdRef.current === (definition.id || null)) {
				setSelected(wf);
			}
			await reload();
			try {
				await realtimeRef.current?.publishChanged();
			} catch (error) {
				setError(
					error instanceof Error
						? tl(
								"Workflow saved, but notifying other views failed: {message}",
								{ message: error.message }
							)
						: "Workflow saved, but notifying other views failed"
				);
			}
			return wf;
		},
		[reload, tl]
	);
	const handleSave = useCallback(
		(definition: WorkflowDefinition) => saveWorkflow(definition, false),
		[saveWorkflow]
	);
	const handleCreateFromRecording = useCallback(
		(definition: WorkflowDefinition) => saveWorkflow(definition, true),
		[saveWorkflow]
	);

	const handleReloadLatest = useCallback(async () => {
		if (!selected) {
			throw new Error("Select a saved workflow before reloading");
		}
		const workflowId = selected.id;
		const request = ++reloadLatestRequestRef.current;
		const latest = await fetchWorkflow({ url: "", token: null }, workflowId);
		if (
			selectedWorkflowRef.current !== selected ||
			reloadLatestRequestRef.current !== request
		) {
			throw new Error("The selected workflow changed while reloading");
		}
		if (latest.id !== workflowId) {
			throw new Error(
				"The loaded workflow does not match the selected workflow"
			);
		}
		setWorkflows((list) =>
			list.map((item) => (item.id === latest.id ? latest : item))
		);
		setSelected(latest);
		setCanvasGeneration((generation) => generation + 1);
	}, [selected]);

	const handleRun = useCallback(
		async (inputs: Record<string, string>, dryRun: boolean) => {
			if (!selected) {
				throw new Error("Save the workflow before running it");
			}
			const result = await runWorkflow(
				{ url: "", token: null },
				selected.id,
				inputs,
				{ dryRun }
			);
			setRunNodesByWorkflow((prev) => ({
				...prev,
				[selected.id]: result.nodes,
			}));
			setLastRunByWorkflow((prev) => ({ ...prev, [selected.id]: result }));
			return result;
		},
		[selected]
	);

	const handleResume = useCallback(
		async (payload: string) => {
			if (!selected) {
				return;
			}
			const runId = lastRunByWorkflow[selected.id]?.runId;
			if (!runId) {
				return;
			}
			const result = await resumeWorkflow(
				{ url: "", token: null },
				runId,
				payload
			);
			setRunNodesByWorkflow((prev) => ({
				...prev,
				[selected.id]: result.nodes,
			}));
			setLastRunByWorkflow((prev) => ({ ...prev, [selected.id]: result }));
		},
		[selected, lastRunByWorkflow]
	);

	const workflowOptions = useMemo(
		() => workflows.map((w) => ({ id: w.id, name: w.name })),
		[workflows]
	);

	const awaitingRun = activeRun?.status === "awaiting_input" ? activeRun : null;

	return (
		<div className="flex h-full w-full overflow-hidden bg-background text-foreground">
			<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
				<RyuAppToolbar>
					<HugeiconsIcon
						className="size-4 opacity-70"
						icon={WorkflowSquare01Icon}
					/>
					<span
						className="min-w-0 flex-1 truncate font-medium text-sm"
						title={selected?.name || "New workflow"}
					>
						{selected?.name || "New workflow"}
					</span>
					{loading ? <Spinner className="size-3" /> : null}
					{error ? (
						<>
							<span className="text-status-destructive text-xs">{error}</span>
							<Button onClick={() => reload()} size="sm" variant="outline">
								Try again
							</Button>
						</>
					) : null}
					<Button onClick={() => setSelected(null)} size="sm" variant="outline">
						<HugeiconsIcon className="size-3.5" icon={PlusSignIcon} />
						New workflow
					</Button>
					<Button onClick={() => setRecordOpen(true)} size="sm" variant="ghost">
						<HugeiconsIcon className="size-3.5" icon={RecordIcon} />
						Record a task
					</Button>
				</RyuAppToolbar>

				{/* The shell sidebar owns the workflow picker; this area is only the
				    selected workflow's canvas and actions. */}
				{awaitingRun && selected ? (
					<ResumePanel
						onResume={handleResume}
						run={awaitingRun}
						workflow={selected}
					/>
				) : null}
				{activeRun?.status === "waiting" ? (
					<LimitWaitPanel resumeAt={activeRun.resumeAt} />
				) : null}
				<div className="flex min-h-0 flex-1 overflow-hidden">
					<WorkflowCanvas
						allWorkflows={workflowOptions}
						key={`${selected?.id ?? "new"}:${canvasGeneration}`}
						latestRun={activeRun}
						onRecord={() => setRecordOpen(true)}
						onReloadLatest={handleReloadLatest}
						onRun={handleRun}
						onSave={handleSave}
						runNodes={selected ? runNodesByWorkflow[selected.id] : undefined}
						workflow={selected}
					/>
				</div>
			</div>

			<RecordToWorkflow
				onCreate={handleCreateFromRecording}
				onOpenChange={setRecordOpen}
				open={recordOpen}
			/>
		</div>
	);
}
