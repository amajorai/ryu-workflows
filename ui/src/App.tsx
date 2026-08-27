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
import { Button, Input, Spinner } from "@ryu/blocks/companion/controls";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	createWorkflow,
	fetchWorkflows,
	type NodeRunState,
	resumeWorkflow,
	runWorkflow,
	type Workflow,
	type WorkflowRun,
} from "./bridge.ts";
import { RecordToWorkflow } from "./RecordToWorkflow.tsx";
import { WorkflowCanvas } from "./WorkflowCanvas.tsx";

/** Human-in-the-loop resume bar shown when a run suspends at an Awakeable gate.
 *  Ported from `WorkflowsPage.ResumePanel`. */
function ResumePanel({
	run,
	workflow,
	onResume,
}: {
	run: WorkflowRun;
	workflow: Workflow;
	onResume: (payload: string) => Promise<void>;
}) {
	const [payload, setPayload] = useState("");
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	const gateNode = workflow.nodes.find((n) => n.id === run.awaitingNode);
	const prompt =
		(gateNode?.prompt as string | undefined) ??
		"This workflow is paused and needs your input to continue.";

	const handle = async () => {
		setBusy(true);
		setErr(null);
		try {
			await onResume(payload);
			setPayload("");
		} catch (e) {
			setErr(e instanceof Error ? e.message : "Resume failed");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="bg-warning/10 px-4 py-3">
			<p className="mb-2 font-medium text-sm text-warning">
				Awaiting input: {prompt}
			</p>
			<div className="flex items-center gap-2">
				<Input
					className="max-w-md"
					onChange={(e) => setPayload(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !busy) {
							handle();
						}
					}}
					placeholder="Type your response…"
					value={payload}
				/>
				<Button disabled={busy} onClick={() => handle()} size="sm">
					{busy ? "Resuming…" : "Resume"}
				</Button>
			</div>
			{err ? <p className="mt-1 text-destructive text-xs">{err}</p> : null}
		</div>
	);
}

export function App() {
	const [workflows, setWorkflows] = useState<Workflow[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState<Workflow | null>(null);
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
			return [] as Workflow[];
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
			const wanted =
				typeof window === "undefined"
					? undefined
					: window.ryu?.context?.workflowId;
			if (wanted) {
				const match = list.find((w) => w.id === wanted);
				if (match) {
					setSelected(match);
				}
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
				if (!cancelled) {
					setSelected(
						list.find((workflow) => workflow.id === workflowId) ?? null
					);
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

	const handleSave = useCallback(
		async (definition: Record<string, unknown>) => {
			const wf = await createWorkflow({ url: "", token: null }, definition);
			setSelected(wf);
			await reload();
			await realtimeRef.current?.publishChanged();
			return wf;
		},
		[reload]
	);

	const handleRun = useCallback(
		async (inputs: Record<string, string>) => {
			if (!selected) {
				throw new Error("Save the workflow before running it");
			}
			const result = await runWorkflow(
				{ url: "", token: null },
				selected.id,
				inputs
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

	const awaitingRun =
		selected && lastRunByWorkflow[selected.id]?.status === "awaiting_input"
			? lastRunByWorkflow[selected.id]
			: null;

	return (
		<div className="flex h-full w-full overflow-hidden bg-background text-foreground">
			<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
				<header className="flex shrink-0 items-center gap-2 border-border border-b px-3 py-2">
					<HugeiconsIcon
						className="size-4 opacity-70"
						icon={WorkflowSquare01Icon}
					/>
					<span className="min-w-0 flex-1 truncate font-semibold text-sm">
						{selected?.name || "New workflow"}
					</span>
					{loading ? <Spinner className="size-3" /> : null}
					{error ? (
						<>
							<span className="text-destructive text-xs">{error}</span>
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
				</header>

				{/* The shell sidebar owns the workflow picker; this area is only the
				    selected workflow's canvas and actions. */}
				{awaitingRun && selected ? (
					<ResumePanel
						onResume={handleResume}
						run={awaitingRun}
						workflow={selected}
					/>
				) : null}
				<div className="flex min-h-0 flex-1 overflow-hidden">
					<WorkflowCanvas
						allWorkflows={workflowOptions}
						key={selected?.id ?? "new"}
						onRecord={() => setRecordOpen(true)}
						onRun={handleRun}
						onSave={handleSave}
						runNodes={selected ? runNodesByWorkflow[selected.id] : undefined}
						workflow={selected}
					/>
				</div>
			</div>

			<RecordToWorkflow
				onCreate={handleSave}
				onOpenChange={setRecordOpen}
				open={recordOpen}
			/>
		</div>
	);
}
