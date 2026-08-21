// apps/desktop/src/components/workflows/RecordToWorkflow.tsx
//
// In-canvas "record a desktop task" flow for the Workflows surface. This is the
// merge of the old standalone Recipes page into Workflows: you record a native
// task once (ghost observes each click/type/scroll with accessibility context),
// and instead of an opaque recipe blob it becomes a **visible step-per-node
// workflow** (Input → action → action → … → Output) you can review and edit on
// the canvas. On-disk recipes still exist and replay via the `Recipe` node; this
// flow produces `ghost_action` nodes that run through the same ghost engine.

import { RecordIcon, StopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useState } from "react";
import {
	draftRecipeFromEvents,
	type Recipe,
	type RecipeStep,
} from "./bridge.ts";
import { useRecipes } from "./hooks.ts";
import { sileo } from "./sileo.ts";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
	Spinner,
} from "./ui";

/** A Core workflow definition in wire form (matches `canvasToDefinition`). */
type WorkflowDefinition = Record<string, unknown>;

/** Slugify a step into a unique, valid node id (letters/digits/underscore). */
function nodeId(action: string, index: number, used: Set<string>): string {
	const base =
		`${action || "action"}_${index + 1}`.replace(/[^a-zA-Z0-9_]/g, "_") ||
		`step_${index + 1}`;
	let id = base;
	while (used.has(id)) {
		id = `${id}_`;
	}
	used.add(id);
	return id;
}

/** Convert a recorded recipe draft into a linear step-per-node workflow:
 *  Input → one `ghost_action` node per step → Output. Each node carries the
 *  step's action verb, target locator, and params verbatim so it runs through
 *  the same ghost primitives the recipe replay loop uses. */
export function workflowFromDraft(draft: Recipe): WorkflowDefinition {
	const used = new Set<string>(["input", "output"]);
	const nodes: Record<string, unknown>[] = [
		{ id: "input", type: "input", key: null },
	];
	const edges: { from: string; to: string }[] = [];
	let prev = "input";

	const steps: RecipeStep[] = draft.steps ?? [];
	for (const [i, step] of steps.entries()) {
		const id = nodeId(step.action, i, used);
		nodes.push({
			id,
			type: "ghost_action",
			action: step.action,
			target: step.target ?? {},
			params: step.params ?? {},
		});
		edges.push({ from: prev, to: id });
		prev = id;
	}

	nodes.push({ id: "output", type: "output", key: null });
	edges.push({ from: prev, to: "output" });

	return {
		id: "",
		name: draft.name || "Recorded workflow",
		description: draft.description || "Recorded desktop automation",
		nodes,
		edges,
		triggers: [],
	};
}

export function RecordToWorkflow({
	open,
	onOpenChange,
	onCreate,
}: {
	onCreate: (definition: WorkflowDefinition) => Promise<unknown>;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const { recording, startRecord, stopRecord, recordBusy } = useRecipes();
	const [task, setTask] = useState("");
	const isRecording = recording?.recording ?? false;

	// Live counters from the `ghost_learn_status` payload.
	const live = (recording?.status ?? {}) as {
		elapsed_secs?: number;
		event_count?: number;
	};

	const handleStart = useCallback(async () => {
		try {
			await startRecord(task.trim());
		} catch (e) {
			sileo.error({
				title: e instanceof Error ? e.message : "Could not start the recorder",
			});
		}
	}, [task, startRecord]);

	const handleStop = useCallback(async () => {
		try {
			const result = await stopRecord();
			const events = Array.isArray(result.events) ? result.events : [];
			const draft =
				result.draft ?? draftRecipeFromEvents(result.task || task, events);
			await onCreate(workflowFromDraft(draft));
			onOpenChange(false);
			setTask("");
			sileo.success({
				title: `Built a workflow from ${events.length} action(s)`,
			});
		} catch (e) {
			sileo.error({
				title: e instanceof Error ? e.message : "Could not build the workflow",
			});
		}
	}, [stopRecord, onCreate, onOpenChange, task]);

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<HugeiconsIcon className="size-4" icon={RecordIcon} />
						Record a task
					</DialogTitle>
					<DialogDescription>
						Demonstrate a native-desktop task once. Ghost captures each action
						with accessibility context and turns it into an editable
						step-by-step workflow you can review on the canvas.
					</DialogDescription>
				</DialogHeader>

				{isRecording ? (
					<div className="space-y-4">
						<div className="flex items-center gap-2">
							<span className="inline-block size-2.5 animate-pulse rounded-full bg-destructive" />
							<span className="font-medium text-sm">Recording…</span>
						</div>
						<p className="text-muted-foreground text-sm">
							Perform the task now: click, type, and switch apps. Stop when
							you're done.
						</p>
						<div className="flex gap-6 rounded-lg border p-4">
							<div>
								<div className="font-semibold text-2xl tabular-nums">
									{live.event_count ?? 0}
								</div>
								<div className="text-muted-foreground text-xs">Actions</div>
							</div>
							<div>
								<div className="font-semibold text-2xl tabular-nums">
									{live.elapsed_secs ?? 0}s
								</div>
								<div className="text-muted-foreground text-xs">Elapsed</div>
							</div>
						</div>
						<Button
							disabled={recordBusy}
							onClick={handleStop}
							variant="destructive"
						>
							{recordBusy ? (
								<Spinner className="size-4" />
							) : (
								<HugeiconsIcon className="size-4" icon={StopIcon} />
							)}
							Stop & build workflow
						</Button>
					</div>
				) : (
					<div className="space-y-4">
						<div className="space-y-1.5">
							<Label htmlFor="record-task">What are you doing?</Label>
							<Input
								id="record-task"
								onChange={(e) => setTask(e.target.value)}
								placeholder="e.g. Send an email in Gmail"
								value={task}
							/>
						</div>
						<Button disabled={recordBusy} onClick={handleStart}>
							{recordBusy ? (
								<Spinner className="size-4" />
							) : (
								<HugeiconsIcon className="size-4" icon={RecordIcon} />
							)}
							Start recording
						</Button>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
