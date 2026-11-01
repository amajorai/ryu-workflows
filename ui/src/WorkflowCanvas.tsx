// apps/desktop/src/components/workflows/WorkflowCanvas.tsx
//
// React Flow canvas for the WorkflowsPage. Each NodeKind variant from Core
// (apps/core/src/workflow/mod.rs, serde tag="type", rename_all="snake_case")
// maps to a distinct node colour and icon in the palette. Serialization note:
// Core flattens NodeKind onto WorkflowNode via #[serde(flatten)], so the wire
// shape is {id, type, ...kindFields}. React Flow node position is UI-only and
// is persisted to localStorage keyed by workflow id; on reload the graph
// topology is reconstructed from Core and positions are restored from
// localStorage (or auto-laid-out when absent).
//
// Spike result: @xyflow/react v12 (React 19 compatible) renders correctly in
// Tauri's webview via the Vite bundle. No issues with Tailwind v4 or the ESM
// build. @xyflow/react/dist/base.css is imported in index.css for minimal
// required styles; Tailwind classes override visual styling. AI SDK Elements
// does not expose a workflow/DAG canvas primitive; React Flow is the correct
// choice for this surface.
import type { RyuCatalogSnapshot } from "@ryu/app-host/app-bridge";
import { sandboxSileo as sileo } from "@ryu/ui/components/sandbox-toast.ts";
import { useQuery } from "@ryu/ui/hooks/use-query.ts";
import {
	Background,
	Controls,
	type Edge,
	Panel,
	ReactFlow,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	fetchRuntimeCatalog,
	type Workflow,
	type WorkflowRun,
	type WorkflowTrigger,
} from "./bridge.ts";
import { useActiveNode, useSchedules } from "./hooks.ts";
import {
	type AgentOption,
	NodeConfigPanel,
	type WorkflowOption,
} from "./node-config.tsx";
import { RuntimeCatalogContext } from "./node-config-model.ts";
import { Palette, RunPanel } from "./palette-run-panel.tsx";
import { parseNodeNumber, parseNodeText } from "./schemas.ts";
import { TriggerConfig } from "./TriggerConfig.tsx";
import { useDisplayNodes } from "./WorkflowCanvas-display-nodes.ts";
import { useCanvasGraphHandlers } from "./WorkflowCanvas-graph-handlers.ts";
import {
	FIT_VIEW_OPTIONS,
	NODE_TYPES,
	PRO_OPTIONS,
	TRIGGER_NODE_ID,
} from "./WorkflowCanvas-nodes.tsx";
import {
	WorkflowActionsPanel,
	WorkflowTitlePanel,
} from "./WorkflowCanvas-panels.tsx";
import type { WorkflowCanvasProps } from "./WorkflowCanvas-props.ts";
import { WorkflowReloadDialog } from "./WorkflowCanvas-reload-dialog.tsx";
import { useVariableTokens } from "./WorkflowCanvas-variable-tokens.ts";
import { useWorkflowVersionSource } from "./WorkflowCanvas-version-source.ts";
import type { CanvasWorkflowNode } from "./workflow-serialization.ts";
import {
	canvasToDefinition,
	normalizedWorkflowJson,
	savePositions,
	workflowToCanvas,
} from "./workflow-serialization.ts";

export type { WorkflowCanvasProps } from "./WorkflowCanvas-props.ts";
export { canvasToDefinition } from "./workflow-serialization.ts";

export function WorkflowCanvas({
	workflow,
	onSave,
	onReloadLatest,
	onRun,
	onRecord,
	runNodes,
	latestRun,
	reloadSignal,
	allWorkflows,
}: WorkflowCanvasProps) {
	const { data: runtimeCatalog } = useQuery<RyuCatalogSnapshot>({
		queryKey: ["runtime-catalog"],
		queryFn: fetchRuntimeCatalog,
	});
	const agentOptions = useMemo<AgentOption[]>(
		() =>
			runtimeCatalog?.agents.map((agent) => ({
				id: agent.id,
				name: agent.title || agent.name,
			})) ?? [],
		[runtimeCatalog]
	);

	const { jobs: scheduleJobs } = useSchedules();
	const activeNode = useActiveNode();

	// Workflows offered to the Sub-workflow / While-loop-body pickers: every saved
	// workflow except the one being edited (Core rejects a self-referential loop
	// body, and a sub-workflow pointing at itself would recurse).
	const pickableWorkflows = useMemo<WorkflowOption[]>(
		() => (allWorkflows ?? []).filter((w) => w.id !== workflow?.id),
		[allWorkflows, workflow?.id]
	);

	const [name, setName] = useState(workflow?.name ?? "New workflow");
	const [description, setDescription] = useState(workflow?.description ?? "");
	// The single trigger this workflow declares in the UI. Core supports a list;
	// the panel edits the first for parity with OpenAI's trigger-on-Start,
	// defaulting to Manual.
	const [trigger, setTrigger] = useState<WorkflowTrigger>(
		() => workflow?.triggers?.[0] ?? { type: "manual" }
	);
	// Any further triggers Core declared (a workflow may carry several, e.g. a
	// Schedule + a Composio trigger). The panel only edits the first, so we carry
	// the rest through untouched on save instead of silently dropping them (which
	// would unschedule/unsubscribe them server-side).
	const [extraTriggers, setExtraTriggers] = useState<WorkflowTrigger[]>(
		() => workflow?.triggers?.slice(1) ?? []
	);
	// How many independent steps Core runs at once (absent = Core's default).
	const [maxConcurrency, setMaxConcurrency] = useState<number | null>(
		() => parseNodeNumber(workflow?.max_concurrency) ?? null
	);
	const [nodes, setNodes] = useState<CanvasWorkflowNode[]>([]);
	const [edges, setEdges] = useState<Edge[]>([]);
	const currentNodesRef = useRef(nodes);
	currentNodesRef.current = nodes;
	const saveInFlightRef = useRef(false);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [reloadConfirmationOpen, setReloadConfirmationOpen] = useState(false);
	const [reloading, setReloading] = useState(false);
	const [reloadError, setReloadError] = useState<string | null>(null);
	const [showPalette, setShowPalette] = useState(true);
	const [showRun, setShowRun] = useState(false);
	const [running, setRunning] = useState(false);
	const [runResult, setRunResult] = useState<WorkflowRun | null>(null);
	const [runError, setRunError] = useState<string | null>(null);

	const reactFlowWrapper = useRef<HTMLDivElement>(null);
	// The workflow id currently materialised on the canvas. Lets us skip the
	// reconstruct effect when the parent re-selects the workflow we just saved
	// (which would otherwise reset positions to the auto-layout and blank the
	// viewport).
	const loadedIdRef = useRef<string | null>(null);
	// The revision the on-screen graph was loaded from. Saves send it so Core can
	// refuse to overwrite a newer save by another member of a shared node.
	const baseUpdatedAtRef = useRef<string | null>(null);
	// Last builder reload signal we materialised for. A change forces a re-read of
	// the workflow even when its id is unchanged (the NL builder mutated it on disk).
	const reloadSignalRef = useRef<number | undefined>(reloadSignal);

	// Initialise canvas from workflow on mount / workflow change
	useEffect(() => {
		const builderReloaded = reloadSignalRef.current !== reloadSignal;
		reloadSignalRef.current = reloadSignal;
		if (workflow) {
			// Already materialised (e.g. the post-save re-selection) — keep the
			// canvas as-is so node positions and viewport survive the save. A builder
			// edit (reloadSignal change) bypasses this guard to pull the new graph.
			if (loadedIdRef.current === workflow.id && !builderReloaded) {
				return;
			}
			const { nodes: n, edges: e } = workflowToCanvas(workflow);
			setNodes(n);
			setEdges(e);
			setName(workflow.name);
			setDescription(workflow.description ?? "");
			setTrigger(workflow.triggers?.[0] ?? { type: "manual" });
			setExtraTriggers(workflow.triggers?.slice(1) ?? []);
			setMaxConcurrency(parseNodeNumber(workflow.max_concurrency) ?? null);
			loadedIdRef.current = workflow.id;
			baseUpdatedAtRef.current = workflow.updatedAt ?? null;
		} else {
			setNodes([]);
			setEdges([]);
			setTrigger({ type: "manual" });
			setExtraTriggers([]);
			setMaxConcurrency(null);
			loadedIdRef.current = null;
			baseUpdatedAtRef.current = null;
		}
		setSelectedNodeId(null);
		setRunResult(null);
		setRunError(null);
	}, [workflow, reloadSignal]);

	const displayNodes = useDisplayNodes(
		nodes,
		runNodes,
		trigger,
		selectedNodeId
	);

	const {
		handleAddNode,
		handleDeleteNode,
		handleNodeConfigChange,
		onConnect,
		onEdgesChange,
		onNodeClick,
		onNodesChange,
		onPaneClick,
	} = useCanvasGraphHandlers(setNodes, setEdges, setSelectedNodeId);

	// Save: serialise canvas → Core shape → call onSave
	const handleSave = useCallback(async () => {
		if (saveInFlightRef.current) {
			return;
		}
		saveInFlightRef.current = true;
		setSaveError(null);
		setSaving(true);
		try {
			// Emit the panel-edited trigger plus any further triggers Core declared
			// (which the panel doesn't edit) so an unrelated save doesn't drop them.
			const def = canvasToDefinition(
				name,
				description,
				nodes,
				edges,
				[trigger, ...extraTriggers],
				maxConcurrency
			);
			if (workflow) {
				def.id = workflow.id;
				def.updated_at = baseUpdatedAtRef.current;
			}
			const saved = await onSave(def);
			// Persist node positions under the (possibly newly-minted) id and mark it
			// as the loaded workflow so the parent's re-selection doesn't reset the
			// canvas.
			savePositions(saved.id, currentNodesRef.current);
			loadedIdRef.current = saved.id;
			baseUpdatedAtRef.current = saved.updatedAt ?? null;
		} catch (e) {
			setSaveError(e instanceof Error ? e.message : "Save failed");
		} finally {
			saveInFlightRef.current = false;
			setSaving(false);
		}
	}, [
		name,
		description,
		nodes,
		edges,
		trigger,
		extraTriggers,
		maxConcurrency,
		workflow,
		onSave,
	]);

	// ── Version history (server-backed snapshot / diff / restore) ─────────────
	// The last restored definition, stashed by the version source's `restore` so
	// `handleVersionRestored` can re-materialise the canvas from it.
	const restoredWorkflowRef = useRef<Workflow | null>(null);

	// The current canvas serialised for diffing. Both sides are normalised to the
	// same editable subset so volatile fields (id, created_at, updated_at) don't
	// show as spurious diff lines.
	const currentDefString = useMemo(
		() =>
			normalizedWorkflowJson(
				canvasToDefinition(
					name,
					description,
					nodes,
					edges,
					[trigger, ...extraTriggers],
					maxConcurrency
				)
			),
		[name, description, nodes, edges, trigger, extraTriggers, maxConcurrency]
	);
	const versionSource = useWorkflowVersionSource({
		activeNode,
		baseUpdatedAtRef,
		currentNodesRef,
		description,
		edges,
		extraTriggers,
		maxConcurrency,
		name,
		nodes,
		onSave,
		restoredWorkflowRef,
		saveInFlightRef,
		setSaveError,
		setSaving,
		trigger,
		workflow,
	});

	// After a restore, re-materialise the canvas from the restored definition.
	const handleVersionRestored = useCallback(() => {
		const restored = restoredWorkflowRef.current;
		if (!restored) {
			return;
		}
		const { nodes: n, edges: e } = workflowToCanvas(restored);
		setNodes(n);
		setEdges(e);
		setName(restored.name);
		setDescription(restored.description ?? "");
		setTrigger(restored.triggers?.[0] ?? { type: "manual" });
		setExtraTriggers(restored.triggers?.slice(1) ?? []);
		setMaxConcurrency(parseNodeNumber(restored.max_concurrency) ?? null);
		loadedIdRef.current = restored.id;
		baseUpdatedAtRef.current = restored.updatedAt ?? null;
		savePositions(restored.id, n);
		restoredWorkflowRef.current = null;
	}, []);

	// Derive input keys for run panel
	const inputKeys = useMemo(
		() =>
			nodes
				.filter((n) => n.data.coreType === "input")
				.map((n) => {
					const extra = n.data.extra ?? {};
					return parseNodeText(extra.key) || n.id;
				}),
		[nodes]
	);

	const handleRun = useCallback(
		async (inputs: Record<string, string>, dryRun: boolean) => {
			setRunning(true);
			setRunError(null);
			setRunResult(null);
			try {
				const result = await onRun(inputs, dryRun);
				setRunResult(result);
				if (result.status === "failed") {
					sileo.error({ title: result.error ?? "Workflow run failed" });
				} else if (result.status === "completed") {
					sileo.success({
						title: result.dryRun
							? "Read-only dry run completed"
							: "Workflow run completed",
					});
				}
			} catch (e) {
				setRunError(e instanceof Error ? e.message : "Run failed");
			} finally {
				setRunning(false);
			}
		},
		[onRun]
	);
	const variableTokens = useVariableTokens(nodes, selectedNodeId);

	const selectedNode = selectedNodeId
		? nodes.find((n) => n.id === selectedNodeId)
		: null;
	const selectedNodeData = selectedNode ? selectedNode.data : null;

	const togglePalette = useCallback(() => {
		setShowPalette((p) => !p);
	}, []);

	return (
		<div className="flex size-full flex-1 flex-col overflow-hidden">
			<div
				className="relative size-full flex-1 overflow-hidden"
				ref={reactFlowWrapper}
			>
				<ReactFlow
					edges={edges}
					fitView
					fitViewOptions={FIT_VIEW_OPTIONS}
					nodes={displayNodes}
					nodeTypes={NODE_TYPES}
					onConnect={onConnect}
					onEdgesChange={onEdgesChange}
					onNodeClick={onNodeClick}
					onNodesChange={onNodesChange}
					onPaneClick={onPaneClick}
					proOptions={PRO_OPTIONS}
				>
					<Controls
						orientation="horizontal"
						position="bottom-center"
						showInteractive={false}
					/>
					<Background gap={20} size={1} />

					<WorkflowTitlePanel
						description={description}
						maxConcurrency={maxConcurrency}
						name={name}
						setDescription={setDescription}
						setMaxConcurrency={setMaxConcurrency}
						setName={setName}
					/>

					<WorkflowActionsPanel
						currentDefString={currentDefString}
						handleSave={handleSave}
						handleVersionRestored={handleVersionRestored}
						onRecord={onRecord}
						onReloadLatest={onReloadLatest}
						reloading={reloading}
						saveError={saveError}
						saving={saving}
						setReloadConfirmationOpen={setReloadConfirmationOpen}
						setReloadError={setReloadError}
						setShowRun={setShowRun}
						togglePalette={togglePalette}
						versionSource={versionSource}
						workflow={workflow}
					/>

					{/* Persistent node palette — searchable, grouped, sits below the title */}
					{showPalette ? (
						<Panel className="!top-16" position="top-left">
							<Palette
								onAdd={handleAddNode}
								onClose={() => setShowPalette(false)}
							/>
						</Panel>
					) : null}

					{/* Trigger config panel — same slot, shown when the entry node is selected */}
					{selectedNodeId === TRIGGER_NODE_ID ? (
						<Panel className="!top-14" position="top-right">
							<TriggerConfig
								nodeUrl={activeNode.url}
								onChange={setTrigger}
								scheduleJobs={scheduleJobs}
								trigger={trigger}
								workflowId={workflow?.id ?? ""}
							/>
						</Panel>
					) : null}

					{/* Node config panel — sits below the action pill */}
					{selectedNodeData && selectedNodeId ? (
						<Panel className="!top-14" position="top-right">
							<RuntimeCatalogContext.Provider value={runtimeCatalog ?? null}>
								<NodeConfigPanel
									agents={agentOptions}
									onChange={(v) => handleNodeConfigChange(selectedNodeId, v)}
									onDelete={() => handleDeleteNode(selectedNodeId)}
									value={{
										coreType: selectedNodeData.coreType,
										label: selectedNodeData.label,
										extra: selectedNodeData.extra ?? {},
									}}
									variables={variableTokens}
									workflows={pickableWorkflows}
								/>
							</RuntimeCatalogContext.Provider>
						</Panel>
					) : null}

					{/* Run panel */}
					{showRun ? (
						<Panel position="bottom-right">
							<RunPanel
								inputKeys={inputKeys}
								onClose={() => setShowRun(false)}
								onRun={handleRun}
								result={running || runError ? null : (latestRun ?? runResult)}
								runError={runError}
								running={running}
							/>
						</Panel>
					) : null}
				</ReactFlow>
				<WorkflowReloadDialog
					onReloadLatest={onReloadLatest}
					reloadConfirmationOpen={reloadConfirmationOpen}
					reloadError={reloadError}
					reloading={reloading}
					setReloadConfirmationOpen={setReloadConfirmationOpen}
					setReloadError={setReloadError}
					setReloading={setReloading}
				/>
			</div>
		</div>
	);
}
