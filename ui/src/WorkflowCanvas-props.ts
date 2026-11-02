import type { NodeRunState, Workflow, WorkflowRun } from "./bridge.ts";
import type { WorkflowOption } from "./node-config.tsx";
import type { WorkflowDefinition } from "./schemas.ts";

export interface WorkflowCanvasProps {
	/** All saved workflows, used to populate the Sub-workflow / While-loop-body
	 *  pickers. The current workflow is filtered out internally so it can't pick
	 *  itself (Core rejects a self-referential loop body at run time). */
	allWorkflows?: WorkflowOption[];
	/** Latest host-owned run, including updates after approval or resume. */
	latestRun?: WorkflowRun;
	/** Called when the user clicks Record (opens the record-to-workflow flow). */
	onRecord?: () => void;
	onReloadLatest?: () => Promise<void>;
	/** Called when the user clicks Run. */
	onRun: (
		inputs: Record<string, string>,
		dryRun: boolean
	) => Promise<WorkflowRun>;
	/** Called with the Core-serializable definition object when user saves;
	 *  resolves to the persisted workflow (Core mints the id for new ones). */
	onSave: (definition: WorkflowDefinition) => Promise<Workflow>;
	/** Bumped by the natural-language builder after it mutates the persisted
	 *  definition, to force the canvas to re-materialise even when the workflow id
	 *  is unchanged (the `loadedIdRef` guard would otherwise skip same-id reloads).
	 *  Unsaved manual canvas edits are intentionally clobbered — the builder writes
	 *  the persisted definition; save canvas edits before driving the chat. */
	reloadSignal?: number;
	/** Per-node run state to overlay (from the last run). */
	runNodes?: Record<string, NodeRunState>;
	/** Existing workflow to edit, or null to create a new one. */
	workflow: Workflow | null;
}
