// The Workflows companion shell. This is now the PRIMARY visual canvas surface
// (S3 cutover): the shell's `/workflows/:id` + `/workflows/new` routes mount this
// companion via PluginCompanionPage, and the deep-linked workflow id arrives as
// `window.ryu.context.workflowId`. It reproduces the desktop `WorkflowsPage`
// canvas role — select/create a workflow, drive the React Flow canvas, run +
// resume, record → workflow — self-contained inside the sandbox: it carries its
// OWN workflow switcher (there is no shell sidebar in the frame).
//
// It DROPS the natural-language builder, which is architecturally shell-only:
// `host.runAgent`'s fixed PermissionPreset never exposes the `workflow_builder.*`
// tools to a sandboxed frame (Track E spec crux #1), and the builder needs the
// shell's Ask Ryu panel + assistant store. The builder therefore stays in the
// shell permanently (`apps/desktop/src/pages/WorkflowsPage.tsx`, reached via the
// Create menu's "Build with AI" → `/workflows/build`). Documented limitation of
// that split: because the shell and this sandboxed frame are isolated, a builder
// edit does NOT live-refresh an already-open canvas tab — the builder page's
// "Open in canvas" reopens this companion to show the new graph.
//
// Everything else round-trips to Core over the `window.ryu` bridge.

import {
	PlusSignIcon,
	RecordIcon,
	WorkflowSquare01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Button, Input, Spinner } from "./ui.tsx";
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

	const handleSave = useCallback(
		async (definition: Record<string, unknown>) => {
			const wf = await createWorkflow({ url: "", token: null }, definition);
			setSelected(wf);
			await reload();
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
			{/* Left rail: the in-app workflow switcher (the shell sidebar isn't in the
			    sandbox). Pick one to edit, or start a fresh canvas. */}
			<aside className="flex w-56 shrink-0 flex-col border-border border-r">
				<div className="flex items-center gap-2 border-border border-b px-3 py-2.5">
					<HugeiconsIcon
						className="size-4 opacity-70"
						icon={WorkflowSquare01Icon}
					/>
					<span className="font-semibold text-sm">Workflows</span>
				</div>
				<div className="flex flex-col gap-1 p-2">
					<Button
						className="justify-start"
						onClick={() => setSelected(null)}
						size="sm"
						variant={selected === null ? "secondary" : "ghost"}
					>
						<HugeiconsIcon className="size-3.5" icon={PlusSignIcon} />
						New workflow
					</Button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
					{loading ? (
						<div className="flex items-center gap-2 px-2 py-3 text-muted-foreground text-xs">
							<Spinner className="size-3" />
							Loading…
						</div>
					) : error ? (
						<div className="flex flex-col gap-2 px-2 py-3">
							<p className="text-destructive text-xs">{error}</p>
							<Button onClick={() => reload()} size="sm" variant="outline">
								Try again
							</Button>
						</div>
					) : workflows.length === 0 ? (
						<p className="px-2 py-3 text-muted-foreground text-xs">
							No workflows yet. Build one on the canvas and save it.
						</p>
					) : (
						<ul className="flex flex-col gap-0.5">
							{workflows.map((w) => (
								<li key={w.id}>
									<Button
										className="w-full justify-start truncate"
										onClick={() => setSelected(w)}
										size="sm"
										variant={selected?.id === w.id ? "secondary" : "ghost"}
									>
										<span className="truncate">{w.name || "Untitled"}</span>
									</Button>
								</li>
							))}
						</ul>
					)}
				</div>
				<div className="border-border border-t p-2">
					<Button
						className="w-full justify-start"
						onClick={() => setRecordOpen(true)}
						size="sm"
						variant="ghost"
					>
						<HugeiconsIcon className="size-3.5" icon={RecordIcon} />
						Record a task
					</Button>
				</div>
			</aside>

			{/* Right: the canvas (+ resume bar when a run suspends). */}
			<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
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
