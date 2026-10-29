import {
	canvasNodeDataSchema,
	parseNodeNumber,
	parseNodeRecord,
	parseNodeText,
	type WorkflowDefinition,
	type WorkflowJsonRecord,
} from "./schemas.ts";
import type { CanvasWorkflowNode } from "./workflow-serialization.ts";
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

import {
	Add01Icon,
	PlayIcon,
	RecordIcon,
	SaveIcon,
	ZapIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { RyuCatalogSnapshot } from "@ryu/app-host/app-bridge";
import {
	Badge,
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	Input,
	Spinner,
} from "@ryu/blocks/companion/controls";
import { sandboxSileo as sileo } from "@ryu/ui/components/sandbox-toast.ts";
import { useQuery } from "@ryu/ui/hooks/use-query.ts";
import {
	addEdge,
	applyEdgeChanges,
	applyNodeChanges,
	Background,
	type Connection,
	Controls,
	type Edge,
	type EdgeChange,
	Handle,
	MarkerType,
	type Node,
	type NodeChange,
	type NodeTypes,
	Panel,
	Position,
	ReactFlow,
} from "@xyflow/react";
import {
	type ChangeEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	createWorkflowVersion,
	fetchRuntimeCatalog,
	getWorkflowVersionDefinition,
	listWorkflowVersions,
	type NodeRunState,
	restoreWorkflowVersion,
	type Workflow,
	type WorkflowRun,
	type WorkflowTrigger,
} from "./bridge.ts";
import { codeNodeSummary } from "./code-node-model.ts";
import { useActiveNode, useSchedules } from "./hooks.ts";
import { TriggerConfig } from "./TriggerConfig.tsx";
import { VersionHistory, type VersionSource } from "./VersionHistory.tsx";
import {
	type CanvasNodeData,
	type CoreNodeType,
	NODE_META,
	nodeMeta,
	nodeRingClass,
	STATUS_RING,
	statusBadgeVariant,
} from "./workflow-model.tsx";
import {
	canvasToDefinition,
	normalizedWorkflowJson,
	savePositions,
	workflowToCanvas,
} from "./workflow-serialization.ts";

export { canvasToDefinition } from "./workflow-serialization.ts";

// --- React Flow custom node -----------------------------------------------

/** A short "click → Compose" summary for a ghost_action node, read from its
 *  config so the canvas shows the actual recorded step, not just "Action". */
function ghostActionSummary(extra: WorkflowJsonRecord | undefined): string {
	const e = extra ?? {};
	const action = parseNodeText(e.action) || "action";
	const target = parseNodeRecord(e.target) ?? {};
	const params = parseNodeRecord(e.params) ?? {};
	const detail =
		parseNodeText(target?.query) ||
		parseNodeText(params?.text) ||
		parseNodeText(params?.key) ||
		parseNodeText(params?.keys) ||
		parseNodeText(params?.direction) ||
		"";
	return detail ? `${action} → ${detail}` : action;
}

/** The line under a node's id: the recorded step for ghost actions, the
 *  language and mode for code steps, otherwise the kind label. */
function nodeSubtitle(data: CanvasNodeData, label: string): string {
	if (data.coreType === "ghost_action") {
		return ghostActionSummary(data.extra);
	}
	if (data.coreType === "code") {
		return codeNodeSummary(data.extra);
	}
	return label;
}

function CanvasNode({
	data,
	selected,
}: {
	data: CanvasNodeData;
	selected: boolean;
}) {
	const meta = nodeMeta(data.coreType);
	const subtitle = nodeSubtitle(data, meta.label);
	const ring = data.runStatus ? STATUS_RING[data.runStatus] : "";
	return (
		<div
			className={`min-w-[140px] rounded-xl bg-card px-3 py-2 shadow-md ring-1 transition-shadow ${nodeRingClass(
				selected,
				ring
			)}`}
		>
			<Handle
				className="!size-2 !border-0 !bg-muted-foreground/50"
				position={Position.Left}
				type="target"
			/>
			<div className="flex items-center gap-2">
				<span
					aria-hidden
					className={`flex size-5 shrink-0 items-center justify-center rounded ${meta.color} text-white`}
				>
					{meta.icon}
				</span>
				<div className="flex min-w-0 flex-1 flex-col">
					<span className="truncate font-medium text-xs" title={data.label}>
						{data.label}
					</span>
					<span
						className="truncate text-muted-foreground text-xs"
						title={subtitle}
					>
						{subtitle}
					</span>
				</div>
				{data.runStatus ? (
					<Badge
						className="shrink-0"
						variant={statusBadgeVariant(data.runStatus)}
					>
						{data.runStatus}
					</Badge>
				) : null}
			</div>
			<Handle
				className="!size-2 !border-0 !bg-muted-foreground/50"
				position={Position.Right}
				type="source"
			/>
		</div>
	);
}

// --- Trigger entry node ---------------------------------------------------

// The pinned "Trigger" node is a UI-only entry marker: it represents the
// workflow's trigger (which Core models as a separate `triggers` array, NOT a
// graph node), so it is injected at render time and never lives in `nodes`
// state — it can't be serialized into Core's node list or deleted, and its
// source handle is non-connectable so it can't sprout an edge Core wouldn't
// understand. Clicking it opens the same right-side config panel every other
// node uses (TriggerConfig), which writes back to the `trigger` state.
const TRIGGER_NODE_ID = "__trigger__";
const TRIGGER_NODE_POSITION = { x: 0, y: -110 } as const;

/** One-line summary of a trigger for the entry node's subtitle. */
function triggerSummary(t: WorkflowTrigger): string {
	switch (t.type) {
		case "manual":
			return "Manual";
		case "schedule":
			return t.every ? `Every ${t.every}` : `Cron ${t.cron ?? ""}`.trim();
		case "webhook":
			return "Webhook";
		case "composio":
			return t.trigger_slug ? `Composio · ${t.trigger_slug}` : "Composio event";
		case "event":
			// Show the event NAME rather than the fully-qualified id: the namespace
			// half is the app, which the node subtitle has no room for.
			return t.event
				? `On ${t.event.split("#").pop() ?? t.event}`
				: "App event";
		default:
			return "Trigger";
	}
}

interface TriggerNodeData extends Record<string, unknown> {
	label: string;
	trigger: WorkflowTrigger;
}

function TriggerNode({
	data,
	selected,
}: {
	data: TriggerNodeData;
	selected: boolean;
}) {
	return (
		<div
			className={`min-w-[140px] rounded-xl bg-card px-3 py-2 shadow-md ring-1 transition-shadow ${selected ? "ring-2 ring-primary" : "ring-warning/40"}`}
		>
			<div className="flex items-center gap-2">
				<span
					aria-hidden
					className="flex size-5 shrink-0 items-center justify-center rounded bg-warning text-white"
				>
					<HugeiconsIcon className="size-3" icon={ZapIcon} />
				</span>
				<div className="flex min-w-0 flex-1 flex-col">
					<span className="truncate font-medium text-xs">Trigger</span>
					<span className="truncate text-muted-foreground text-xs">
						{triggerSummary(data.trigger)}
					</span>
				</div>
			</div>
			<Handle
				className="!size-2 !border-0 !bg-muted-foreground/50"
				isConnectable={false}
				position={Position.Bottom}
				type="source"
			/>
		</div>
	);
}

const NODE_TYPES: NodeTypes = {
	canvasNode: CanvasNode,
	triggerNode: TriggerNode,
};

// Stable references for React Flow props. React Flow subscribes to its internal
// store via useSyncExternalStore and re-derives from these; passing fresh object
// literals every render can churn the snapshot ("getSnapshot should be cached")
// and spin into an update loop. Hoisting them keeps the identity stable.
const PRO_OPTIONS = { hideAttribution: true } as const;
const FIT_VIEW_OPTIONS = { maxZoom: 1, padding: 0.25 } as const;

// --- Node config panel ----------------------------------------------------

/** A pickable agent for the Agent / Agent-Delegate node config. */
import {
	type AgentOption,
	NodeConfigPanel,
	type NodeConfigValue,
	type VariableToken,
	type WorkflowOption,
} from "./node-config.tsx";
import { LOOP_VARIABLE_TOKENS } from "./node-config-control.tsx";
import { RuntimeCatalogContext } from "./node-config-model.ts";
import { Palette, RunPanel } from "./palette-run-panel.tsx";

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

let _nodeCounter = 0;

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

	// Overlay run status onto nodes
	const nodesWithStatus = useMemo<CanvasWorkflowNode[]>(() => {
		if (!runNodes) {
			return nodes;
		}
		return nodes.map((n) => ({
			...n,
			data: {
				...n.data,
				runStatus: runNodes[n.id]?.status ?? null,
			},
		}));
	}, [nodes, runNodes]);

	// Prepend the pinned, UI-only trigger entry node. It is driven by `trigger`
	// state (not `nodes`), is non-draggable/non-deletable, and is selected via our
	// own `selectedNodeId` so clicking it opens TriggerConfig in the side panel.
	const displayNodes = useMemo<Node[]>(() => {
		const triggerNode: Node = {
			height: 56,
			id: TRIGGER_NODE_ID,
			type: "triggerNode",
			position: TRIGGER_NODE_POSITION,
			width: 140,
			draggable: false,
			deletable: false,
			selected: selectedNodeId === TRIGGER_NODE_ID,
			data: { label: "Trigger", trigger },
		};
		return [triggerNode, ...nodesWithStatus];
	}, [trigger, nodesWithStatus, selectedNodeId]);

	const onNodesChange = useCallback((changes: NodeChange[]) => {
		setNodes((ns) =>
			applyNodeChanges(changes, ns).map((node) => ({
				...node,
				data: canvasNodeDataSchema.parse(node.data),
			}))
		);
	}, []);

	const onEdgesChange = useCallback((changes: EdgeChange[]) => {
		setEdges((es) => applyEdgeChanges(changes, es));
	}, []);

	const onConnect = useCallback((connection: Connection) => {
		setEdges((es) =>
			addEdge(
				{
					...connection,
					markerEnd: { type: MarkerType.ArrowClosed },
					type: "straight",
				},
				es
			)
		);
	}, []);

	const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
		setSelectedNodeId(node.id);
	}, []);

	const onPaneClick = useCallback(() => {
		setSelectedNodeId(null);
	}, []);

	// Add a node from the palette
	const handleAddNode = useCallback((kind: CoreNodeType) => {
		_nodeCounter += 1;
		const id = `${kind}_${_nodeCounter}`;
		const meta = NODE_META[kind];
		const newNode: CanvasWorkflowNode = {
			id,
			type: "canvasNode",
			position: {
				x: 100 + (_nodeCounter % 5) * 200,
				y: 80 + Math.floor(_nodeCounter / 5) * 100,
			},
			data: {
				coreType: kind,
				label: id,
				extra: { ...meta.defaults },
			},
		};
		setNodes((ns) => [...ns, newNode]);
		setSelectedNodeId(id);
	}, []);

	// Update node data from the config panel
	const handleNodeConfigChange = useCallback(
		(nodeId: string, cfg: NodeConfigValue) => {
			const nextId = cfg.label;
			setNodes((ns) =>
				ns.map((n) =>
					n.id === nodeId
						? {
								...n,
								id: nextId === n.id ? n.id : nextId,
								data: {
									...n.data,
									coreType: cfg.coreType,
									label: nextId,
									extra: cfg.extra,
								},
							}
						: n
				)
			);
			if (nextId !== nodeId) {
				setEdges((es) =>
					es.map((edge) => ({
						...edge,
						source: edge.source === nodeId ? nextId : edge.source,
						target: edge.target === nodeId ? nextId : edge.target,
					}))
				);
				setSelectedNodeId(nextId);
			}
		},
		[]
	);

	const handleDeleteNode = useCallback((nodeId: string) => {
		setNodes((ns) => ns.filter((n) => n.id !== nodeId));
		setEdges((es) =>
			es.filter((e) => e.source !== nodeId && e.target !== nodeId)
		);
		setSelectedNodeId(null);
	}, []);

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

	const versionSource = useMemo<VersionSource>(() => {
		const target = { token: activeNode.token ?? null, url: activeNode.url };
		const wfId = workflow?.id ?? "";
		return {
			list: () =>
				listWorkflowVersions(target, wfId).then((vs) =>
					vs.map((v) => ({
						createdAt: v.createdAt,
						id: v.id,
						label: v.label,
						title: v.name,
					}))
				),
			getValue: (versionId) =>
				getWorkflowVersionDefinition(target, wfId, versionId).then((obj) =>
					normalizedWorkflowJson(obj)
				),
			snapshot: async (label) => {
				if (saveInFlightRef.current) {
					throw new Error(
						"Wait for the current save to finish before saving a version"
					);
				}
				saveInFlightRef.current = true;
				setSaving(true);
				try {
					// Persist the on-screen canvas first so the snapshot captures the
					// current (possibly unsaved) state, not the last-saved file.
					const def = canvasToDefinition(
						name,
						description,
						nodes,
						edges,
						[trigger, ...extraTriggers],
						maxConcurrency
					);
					def.id = wfId;
					def.updated_at = baseUpdatedAtRef.current;
					let saved: Workflow;
					try {
						saved = await onSave(def);
						setSaveError(null);
					} catch (error) {
						setSaveError(
							error instanceof Error ? error.message : "Save failed"
						);
						throw error;
					}
					savePositions(saved.id, currentNodesRef.current);
					baseUpdatedAtRef.current = saved.updatedAt ?? null;
					try {
						await createWorkflowVersion(
							target,
							saved.id,
							label,
							saved.updatedAt ?? undefined
						);
					} catch (error) {
						setSaveError(
							`Workflow saved, but the version was not saved: ${error instanceof Error ? error.message : "Version failed"}`
						);
						throw error;
					}
				} finally {
					saveInFlightRef.current = false;
					setSaving(false);
				}
			},
			restore: async (versionId) => {
				restoredWorkflowRef.current = await restoreWorkflowVersion(
					target,
					wfId,
					versionId
				);
			},
		};
	}, [
		activeNode.token,
		activeNode.url,
		workflow?.id,
		name,
		description,
		nodes,
		edges,
		trigger,
		extraTriggers,
		maxConcurrency,
		onSave,
	]);

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

	// Variable tokens offered by the per-field "Insert variable" menu: the live
	// input, every node id as an upstream-output ref, any state keys declared by
	// SetState nodes, and a trigger-field hint. No autocomplete engine — just a
	// menu sourced from the current graph.
	const variableTokens = useMemo<VariableToken[]>(() => {
		const tokens: VariableToken[] = [
			{ token: "{{input}}", label: "incoming value" },
		];
		for (const n of nodes) {
			tokens.push({ token: `{{nodes.${n.id}}}`, label: "node output" });
		}
		const stateKeys = new Set<string>();
		for (const n of nodes) {
			const d = n.data;
			if (d.coreType !== "set_state") {
				continue;
			}
			const extra = d.extra ?? {};
			const key = parseNodeText(extra.key)?.trim() ?? "";
			if (key) {
				stateKeys.add(key);
			}
		}
		for (const key of stateKeys) {
			tokens.push({ token: `{{state.${key}}}`, label: "run state" });
		}
		tokens.push({ token: "{{trigger.}}", label: "trigger field (add path)" });
		const selected = nodes.find((n) => n.id === selectedNodeId);
		if (selected?.data.extra?.repeat != null) {
			tokens.push(...LOOP_VARIABLE_TOKENS);
		}
		return tokens;
	}, [nodes, selectedNodeId]);

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

					{/* Floating title — name + description, borderless */}
					<Panel position="top-left">
						<div className="flex w-56 flex-col rounded-xl bg-popover/80 px-3 py-1.5 ring-1 ring-border backdrop-blur">
							<Input
								aria-label="Workflow name"
								className="h-6 border-0 bg-transparent p-0 font-medium text-sm shadow-none focus-visible:ring-0"
								onChange={(e: ChangeEvent<HTMLInputElement>) =>
									setName(e.target.value)
								}
								value={name}
							/>
							<Input
								aria-label="Description"
								className="h-5 border-0 bg-transparent p-0 text-muted-foreground text-xs shadow-none focus-visible:ring-0"
								onChange={(e: ChangeEvent<HTMLInputElement>) =>
									setDescription(e.target.value)
								}
								placeholder="Add a description"
								value={description}
							/>
							<Input
								aria-label="Steps that run at once"
								className="h-5 border-0 bg-transparent p-0 text-muted-foreground text-xs shadow-none focus-visible:ring-0"
								max={16}
								min={1}
								onChange={(e: ChangeEvent<HTMLInputElement>) => {
									const next = Number.parseInt(e.target.value, 10);
									setMaxConcurrency(
										Number.isFinite(next)
											? Math.min(Math.max(next, 1), 16)
											: null
									);
								}}
								placeholder="Parallel steps: 4"
								title="How many independent steps run at the same time (1 to 16)"
								type="number"
								value={maxConcurrency === null ? "" : String(maxConcurrency)}
							/>
						</div>
					</Panel>

					{/* Floating actions — Add / Run / Save */}
					<Panel position="top-right">
						<div className="flex items-center gap-1 rounded-full bg-popover/90 p-1 shadow-lg ring-1 ring-border backdrop-blur">
							{saveError ? (
								<span
									className="px-2 text-status-destructive text-xs"
									role="alert"
								>
									{saveError}
								</span>
							) : null}
							{saveError && workflow && onReloadLatest ? (
								<Button
									disabled={saving || reloading}
									onClick={() => {
										setReloadError(null);
										setReloadConfirmationOpen(true);
									}}
									size="sm"
									variant="outline"
								>
									Reload latest workflow
								</Button>
							) : null}
							<Button
								className="rounded-full"
								onClick={togglePalette}
								size="sm"
								variant="ghost"
							>
								<HugeiconsIcon className="size-3.5" icon={Add01Icon} />
								Add
							</Button>
							{onRecord ? (
								<Button
									className="rounded-full"
									onClick={onRecord}
									size="sm"
									variant="ghost"
								>
									<HugeiconsIcon className="size-3.5" icon={RecordIcon} />
									Record
								</Button>
							) : null}
							{workflow ? (
								<Button
									className="rounded-full"
									onClick={() => setShowRun((p) => !p)}
									size="sm"
									variant="ghost"
								>
									<HugeiconsIcon className="size-3.5" icon={PlayIcon} />
									Run
								</Button>
							) : null}
							{workflow ? (
								<VersionHistory
									currentValue={currentDefString}
									onRestored={handleVersionRestored}
									source={versionSource}
								/>
							) : null}
							<Button
								className="rounded-full"
								disabled={saving}
								onClick={handleSave}
								size="sm"
							>
								{saving ? (
									<Spinner className="size-3.5" />
								) : (
									<HugeiconsIcon className="size-3.5" icon={SaveIcon} />
								)}
								Save
							</Button>
						</div>
					</Panel>

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
				<Dialog
					onOpenChange={(open) => {
						if (!reloading) {
							setReloadConfirmationOpen(open);
						}
					}}
					open={reloadConfirmationOpen}
				>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Discard edits and reload?</DialogTitle>
							<DialogDescription>
								Reloading replaces your unsaved graph and trigger edits with the
								latest saved workflow. Your current edits will be lost.
							</DialogDescription>
						</DialogHeader>
						{reloadError ? (
							<p className="text-sm text-status-destructive" role="alert">
								{reloadError}
							</p>
						) : null}
						<div className="flex justify-end gap-2">
							<Button
								disabled={reloading}
								onClick={() => setReloadConfirmationOpen(false)}
								variant="outline"
							>
								Keep editing
							</Button>
							<Button
								disabled={reloading}
								onClick={async () => {
									setReloadError(null);
									setReloading(true);
									try {
										await onReloadLatest?.();
										setReloadConfirmationOpen(false);
									} catch (error) {
										setReloadError(
											error instanceof Error ? error.message : "Reload failed"
										);
									} finally {
										setReloading(false);
									}
								}}
							>
								{reloading ? "Reloading…" : "Discard edits and reload"}
							</Button>
						</div>
					</DialogContent>
				</Dialog>
			</div>
		</div>
	);
}
