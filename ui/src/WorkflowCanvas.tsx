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
	ArrowDown01Icon,
	ArrowRight01Icon,
	BotIcon,
	Cancel01Icon,
	CircleIcon,
	Clock01Icon,
	CodeIcon,
	Database01Icon,
	Delete01Icon,
	GitBranchIcon,
	Note01Icon,
	Notification01Icon,
	PauseIcon,
	PlayIcon,
	PlugSocketIcon,
	PuzzleIcon,
	RecordIcon,
	RepeatIcon,
	RoboticIcon,
	SaveIcon,
	Shield01Icon,
	SparklesIcon,
	WebhookIcon,
	WorkflowSquare01Icon,
	ZapIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
	getWorkflowVersionDefinition,
	listSkills,
	listWorkflowVersions,
	type NodeRunState,
	type NodeStatus,
	restoreWorkflowVersion,
	type Workflow,
	type WorkflowRun,
	type WorkflowTrigger,
} from "./bridge.ts";
import {
	useActiveNode,
	useAgents,
	useApps,
	useMcp,
	useRecipes,
	useSchedules,
} from "./hooks.ts";
import { useQuery } from "./query.ts";
import { sileo } from "./sileo.ts";
import { TriggerConfig } from "./TriggerConfig.tsx";
import {
	Badge,
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Input,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Spinner,
	Switch,
	Textarea,
	ToggleGroup,
	ToggleGroupItem,
} from "./ui";
import { VersionHistory, type VersionSource } from "./VersionHistory.tsx";

// --- Node kind metadata ---------------------------------------------------

/** Every NodeKind variant Core supports, serialised as snake_case. */
export type CoreNodeType =
	| "input"
	| "output"
	| "prompt"
	| "condition"
	| "transform"
	| "set_state"
	| "tool"
	| "webhook"
	| "delay"
	| "sub_workflow"
	| "agent_delegate"
	| "note"
	| "while"
	| "guardrails"
	| "recipe"
	| "ghost_action"
	| "awakeable"
	| "agent"
	| "skill"
	| "mcp"
	| "plugin"
	| "notify_user"
	| "channel_send";

interface NodeMeta {
	color: string;
	/** Default extra fields when adding a new node of this kind. */
	defaults: Record<string, unknown>;
	icon: React.ReactNode;
	label: string;
}

const NODE_META: Record<CoreNodeType, NodeMeta> = {
	input: {
		label: "Input",
		color: "bg-info",
		icon: <HugeiconsIcon className="size-3" icon={ArrowRight01Icon} />,
		defaults: { key: null },
	},
	output: {
		label: "Output",
		color: "bg-success",
		icon: <HugeiconsIcon className="size-3" icon={ArrowDown01Icon} />,
		defaults: { key: null },
	},
	prompt: {
		// Labelled "Agent": the underlying NodeKind wire shape stays `prompt` so
		// existing saved workflows continue to load. When an agent is picked the node
		// routes to the real configured agent; otherwise it falls back to the default
		// LLM via the gateway.
		label: "Agent",
		color: "bg-purple-500",
		icon: <HugeiconsIcon className="size-3" icon={BotIcon} />,
		defaults: { prompt: "Summarise: {{input}}", agent_id: null },
	},
	condition: {
		label: "Condition",
		color: "bg-warning",
		icon: <HugeiconsIcon className="size-3" icon={GitBranchIcon} />,
		defaults: { expr: 'input != ""' },
	},
	transform: {
		label: "Transform",
		color: "bg-orange-500",
		icon: <HugeiconsIcon className="size-3" icon={CodeIcon} />,
		defaults: { op: "uppercase", template: null },
	},
	set_state: {
		label: "Set State",
		color: "bg-cyan-500",
		icon: <HugeiconsIcon className="size-3" icon={Database01Icon} />,
		defaults: { key: "", value: "{{input}}" },
	},
	tool: {
		label: "Tool",
		color: "bg-teal-500",
		icon: <HugeiconsIcon className="size-3" icon={ZapIcon} />,
		defaults: { name: "ghost", args: {} },
	},
	webhook: {
		label: "Webhook",
		color: "bg-pink-500",
		icon: <HugeiconsIcon className="size-3" icon={WebhookIcon} />,
		defaults: { url: "https://example.com/hook", method: "POST" },
	},
	delay: {
		label: "Delay",
		color: "bg-slate-500",
		icon: <HugeiconsIcon className="size-3" icon={Clock01Icon} />,
		defaults: { ms: 1000 },
	},
	sub_workflow: {
		label: "Sub-workflow",
		color: "bg-indigo-500",
		icon: <HugeiconsIcon className="size-3" icon={WorkflowSquare01Icon} />,
		defaults: { workflow_id: "" },
	},
	agent_delegate: {
		label: "Agent Delegate",
		color: "bg-destructive",
		icon: <HugeiconsIcon className="size-3" icon={CircleIcon} />,
		defaults: { delegates: [], caps: null },
	},
	note: {
		label: "Note",
		color: "bg-warning",
		icon: <HugeiconsIcon className="size-3" icon={Note01Icon} />,
		defaults: { text: "" },
	},
	while: {
		label: "While",
		color: "bg-warning",
		icon: <HugeiconsIcon className="size-3" icon={RepeatIcon} />,
		defaults: { expr: 'input != ""' },
	},
	guardrails: {
		label: "Guardrails",
		color: "bg-destructive",
		icon: <HugeiconsIcon className="size-3" icon={Shield01Icon} />,
		defaults: { checks: ["pii"] },
	},
	recipe: {
		// Replays a recorded ghost desktop-automation recipe (ghost-os parity).
		// Params are templates resolved against the run context before replay.
		label: "Recipe",
		color: "bg-success",
		icon: <HugeiconsIcon className="size-3" icon={RecordIcon} />,
		defaults: { recipe: "", params: {} },
	},
	ghost_action: {
		// A single recorded desktop action (one click/type/scroll). Produced by the
		// in-canvas record flow so a recording shows up as a visible step-per-node
		// chain; runs through the matching ghost action tool.
		label: "Action",
		color: "bg-success",
		icon: <HugeiconsIcon className="size-3" icon={ZapIcon} />,
		defaults: { action: "click", target: {}, params: {} },
	},
	awakeable: {
		// Human-in-the-loop pause/resume gate. Core suspends the run here until the
		// resume endpoint is called; the canvas must round-trip the variant so an
		// open+save never corrupts an Awakeable node into a no-op transform.
		label: "Pause for review",
		color: "bg-fuchsia-600",
		icon: <HugeiconsIcon className="size-3" icon={PauseIcon} />,
		defaults: { prompt: null },
	},
	agent: {
		// Runs a single configured agent on a task (agent runner). Unlike the
		// Prompt node you pick an agent and give it a task rather than authoring a
		// raw LLM prompt; unlike Agent Delegate it is one in-context step.
		label: "Agent",
		color: "bg-violet-600",
		icon: <HugeiconsIcon className="size-3" icon={RoboticIcon} />,
		defaults: { agent_id: "", task: "{{input}}" },
	},
	skill: {
		// Applies an installed Agent Skill: its instruction body + the task run
		// through the chosen agent (or the default gateway LLM when none is set).
		label: "Skill",
		color: "bg-amber-500",
		icon: <HugeiconsIcon className="size-3" icon={SparklesIcon} />,
		defaults: { skill: "", agent_id: null, task: "{{input}}" },
	},
	mcp: {
		// Explicit server + tool form of a Tool node; joined into `<server>__<tool>`
		// for the MCP registry so authors pick each part separately.
		label: "MCP",
		color: "bg-teal-600",
		icon: <HugeiconsIcon className="size-3" icon={PlugSocketIcon} />,
		defaults: { server: "", tool: "", args: {} },
	},
	plugin: {
		// Invokes a Runnable an installed plugin bundles (tool/agent/skill/workflow);
		// dispatched to that kind's execution path by the Core executor.
		label: "Plugin",
		color: "bg-indigo-600",
		icon: <HugeiconsIcon className="size-3" icon={PuzzleIcon} />,
		defaults: { plugin_id: "", runnable_id: "", args: {} },
	},
	notify_user: {
		// Writes an app-inbox notification to the target audience (org/team/members).
		// With ack_mode "none" it is fire-and-forget; any other mode makes it a HITL
		// gate that suspends the run until the ack policy (first/all/quorum) is met.
		label: "Notify user",
		color: "bg-sky-500",
		icon: <HugeiconsIcon className="size-3" icon={Notification01Icon} />,
		defaults: {
			target: { kind: "org" },
			title: "",
			body: "",
			ack_mode: { mode: "none" },
		},
	},
	channel_send: {
		// Sends a message OUT to an external chat channel (Telegram/Slack/Discord/
		// webhook), addressed by recipient. Distinct from notify_user, which pings
		// org members through the in-app inbox.
		label: "Send to channel",
		color: "bg-emerald-600",
		icon: <HugeiconsIcon className="size-3" icon={WebhookIcon} />,
		defaults: {
			platform: "telegram",
			recipient: "",
			text: "",
		},
	},
};

// Neutral fallback for a node whose `type` is not (yet) in NODE_META — e.g. a
// future Core variant this desktop build doesn't know. Rendered as "Unknown" and
// its original `type` is carried through verbatim on save so it round-trips
// losslessly instead of being silently rewritten.
const UNKNOWN_NODE_META: NodeMeta = {
	label: "Unknown",
	color: "bg-zinc-500",
	icon: <HugeiconsIcon className="size-3" icon={CircleIcon} />,
	defaults: {},
};

// --- Per-run node status colours ------------------------------------------

const STATUS_RING: Record<NodeStatus, string> = {
	pending: "ring-muted",
	running: "ring-warning animate-pulse",
	completed: "ring-success",
	failed: "ring-destructive",
	skipped: "ring-slate-400",
};

/** Badge variant for a workflow node/run status. */
function statusBadgeVariant(
	status: string
): "default" | "destructive" | "secondary" {
	if (status === "completed") {
		return "default";
	}
	if (status === "failed") {
		return "destructive";
	}
	return "secondary";
}

/** Outer ring class for a canvas node based on selection + run status. */
function nodeRingClass(selected: boolean, ring: string): string {
	if (selected) {
		return "ring-2 ring-primary";
	}
	if (ring) {
		return `ring-2 ${ring}`;
	}
	return "ring-white/10";
}

// --- React Flow custom node -----------------------------------------------

interface CanvasNodeData extends Record<string, unknown> {
	coreType: CoreNodeType;
	isSelected?: boolean;
	label: string;
	runStatus?: NodeStatus | null;
}

/** A short "click → Compose" summary for a ghost_action node, read from its
 *  config so the canvas shows the actual recorded step, not just "Action". */
function ghostActionSummary(
	extra: Record<string, unknown> | undefined
): string {
	const e = extra ?? {};
	const action = typeof e.action === "string" && e.action ? e.action : "action";
	const target = e.target as { query?: string } | undefined;
	const params = e.params as
		| { text?: string; key?: string; keys?: string; direction?: string }
		| undefined;
	const detail =
		target?.query ||
		params?.text ||
		params?.key ||
		params?.keys ||
		params?.direction ||
		"";
	return detail ? `${action} → ${detail}` : action;
}

function CanvasNode({
	data,
	selected,
}: {
	data: CanvasNodeData;
	selected: boolean;
}) {
	const meta = NODE_META[data.coreType] ?? UNKNOWN_NODE_META;
	const subtitle =
		data.coreType === "ghost_action"
			? ghostActionSummary(data.extra as Record<string, unknown> | undefined)
			: meta.label;
	const ring = data.runStatus ? STATUS_RING[data.runStatus] : "";
	return (
		<div
			className={`rounded-xl bg-card px-3 py-2 shadow-md ring-1 transition-shadow ${nodeRingClass(
				selected,
				ring
			)}`}
			style={{ minWidth: 140 }}
		>
			<Handle
				className="!size-2 !border-0 !bg-muted-foreground/50"
				position={Position.Top}
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
					<span className="truncate font-medium text-xs">{data.label}</span>
					<span className="truncate text-[10px] text-muted-foreground">
						{subtitle}
					</span>
				</div>
				{data.runStatus ? (
					<Badge
						className="shrink-0 text-[9px]"
						variant={statusBadgeVariant(data.runStatus)}
					>
						{data.runStatus}
					</Badge>
				) : null}
			</div>
			<Handle
				className="!size-2 !border-0 !bg-muted-foreground/50"
				position={Position.Bottom}
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
			className={`rounded-xl bg-card px-3 py-2 shadow-md ring-1 transition-shadow ${selected ? "ring-2 ring-primary" : "ring-warning/40"}`}
			style={{ minWidth: 140 }}
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
					<span className="truncate text-[10px] text-muted-foreground">
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

// --- localStorage position persistence ------------------------------------

const POSITIONS_KEY_PREFIX = "ryu:workflow:positions:";

function loadPositions(
	workflowId: string
): Record<string, { x: number; y: number }> {
	try {
		const raw = localStorage.getItem(`${POSITIONS_KEY_PREFIX}${workflowId}`);
		return raw
			? (JSON.parse(raw) as Record<string, { x: number; y: number }>)
			: {};
	} catch {
		return {};
	}
}

function savePositions(workflowId: string, nodes: Node[]): void {
	const map: Record<string, { x: number; y: number }> = {};
	for (const n of nodes) {
		map[n.id] = n.position;
	}
	// Guarded: this app runs in a null-origin sandboxed frame (sandbox=
	// "allow-scripts", no allow-same-origin), where any `localStorage` access
	// throws a SecurityError. Position persistence is a best-effort nicety, so
	// swallow the throw rather than crash the canvas on every node move. (The
	// desktop original runs in the trusted webview where localStorage works; the
	// load path was already guarded — this matches it for the write path.)
	try {
		localStorage.setItem(
			`${POSITIONS_KEY_PREFIX}${workflowId}`,
			JSON.stringify(map)
		);
	} catch {
		// no-op: positions just won't persist across reloads in the sandbox
	}
}

/** Serialise a workflow definition to pretty JSON limited to the user-editable
 * subset, so version diffs ignore volatile fields (id, created_at, updated_at)
 * that Core stamps and the canvas never edits. */
function normalizedWorkflowJson(obj: Record<string, unknown>): string {
	return JSON.stringify(
		{
			name: obj.name ?? "",
			description: obj.description ?? "",
			triggers: obj.triggers ?? [],
			nodes: obj.nodes ?? [],
			edges: obj.edges ?? [],
		},
		null,
		2
	);
}

/** Auto-layout: left-to-right grid, 200px horizontal, 80px vertical. */
function autoPosition(idx: number): { x: number; y: number } {
	const col = idx % 4;
	const row = Math.floor(idx / 4);
	return { x: col * 220, y: row * 100 };
}

// --- Core serialization helpers -------------------------------------------

/** Convert React Flow node+edge state back to the Core Workflow {nodes,edges} shape. */
export function canvasToDefinition(
	name: string,
	description: string,
	rfNodes: Node[],
	rfEdges: Edge[],
	triggers: WorkflowTrigger[]
): {
	id: string;
	name: string;
	description?: string;
	nodes: Record<string, unknown>[];
	edges: { from: string; to: string; branch?: string }[];
	triggers: WorkflowTrigger[];
} {
	return {
		// Core's Workflow.id is a required field; an empty string tells Core to mint
		// a fresh `wf_…` id (it only generates one when the id is empty). handleSave
		// overrides this with the real id when editing an existing workflow.
		id: "",
		name,
		description: description || undefined,
		nodes: rfNodes.map((n) => {
			const d = n.data as CanvasNodeData;
			const extra = (d.extra ?? {}) as Record<string, unknown>;
			return { id: n.id, type: d.coreType, ...extra };
		}),
		edges: rfEdges.map((e) => ({
			from: e.source,
			to: e.target,
			branch: (e.label as string | undefined) ?? undefined,
		})),
		// Drop a bare Manual trigger so an unconfigured workflow stays manual-only
		// (matches Core's empty-triggers back-compat default).
		triggers: triggers.filter((t) => t.type !== "manual"),
	};
}

/** Convert a Core Workflow definition into React Flow nodes + edges. */
function workflowToCanvas(workflow: Workflow): {
	nodes: Node[];
	edges: Edge[];
} {
	const positions = loadPositions(workflow.id);

	const rfNodes: Node[] = workflow.nodes.map((cn, idx) => {
		// Carry the original `type` discriminant through VERBATIM — never coerce an
		// unrecognised kind (e.g. `awakeable` on an older build, or a future Core
		// variant) to `transform`, which would permanently rewrite the node on the
		// next save. Unknown kinds render via UNKNOWN_NODE_META and round-trip
		// losslessly because canvasToDefinition re-emits this exact string.
		const coreType = cn.type as CoreNodeType;
		const position = positions[cn.id] ?? autoPosition(idx);
		const { type: _t, id: _id, ...extra } = cn as Record<string, unknown>;
		return {
			id: cn.id,
			type: "canvasNode",
			position,
			data: {
				coreType,
				label: cn.id,
				extra,
			} as CanvasNodeData,
		};
	});

	const rfEdges: Edge[] = workflow.edges.map((ce, idx) => ({
		id: `e-${ce.from}-${ce.to}-${idx}`,
		source: ce.from,
		target: ce.to,
		label: ce.branch ?? undefined,
		markerEnd: { type: MarkerType.ArrowClosed },
		type: "smoothstep",
	}));

	return { nodes: rfNodes, edges: rfEdges };
}

// --- Node config panel ----------------------------------------------------

/** A pickable agent for the Agent / Agent-Delegate node config. */
export interface AgentOption {
	id: string;
	name: string;
}

/** A pickable workflow for the Sub-workflow / While-loop-body node config. */
export interface WorkflowOption {
	id: string;
	name: string;
}

// Sentinel for "no workflow picked" in a Select (Base UI needs the empty choice
// present in `items`); maps back to an empty string on change.
const NO_WORKFLOW_VALUE = "__none__";

/** Shared workflow-id dropdown used by the Sub-workflow node and the While
 *  loop-body picker. Falls back to a free-text input when no workflows are known
 *  yet (e.g. an unsaved canvas with an empty list), and always preserves an
 *  already-saved id even if it is not in the offered list. */
function WorkflowPicker({
	workflows,
	value,
	onChange,
	id,
	placeholder,
}: {
	workflows: WorkflowOption[];
	value: string;
	onChange: (workflowId: string) => void;
	id: string;
	placeholder?: string;
}) {
	if (workflows.length === 0) {
		return (
			<Input
				id={id}
				onChange={(e: ChangeEvent<HTMLInputElement>) =>
					onChange(e.target.value)
				}
				placeholder={placeholder ?? "wf_..."}
				value={value}
			/>
		);
	}
	const known = workflows.some((w) => w.id === value);
	const items = [
		{ value: NO_WORKFLOW_VALUE, label: "Select a workflow…" },
		...workflows.map((w) => ({ value: w.id, label: w.name || w.id })),
		// Keep a saved id selectable even if it is not in this node's list (e.g. a
		// workflow deleted since, or still loading).
		...(value && !known ? [{ value, label: value }] : []),
	];
	return (
		<Select
			items={items}
			onValueChange={(v) => onChange(v === NO_WORKFLOW_VALUE ? "" : v)}
			value={value || NO_WORKFLOW_VALUE}
		>
			<SelectTrigger id={id}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{items.map((item) => (
					<SelectItem key={item.value} value={item.value}>
						{item.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

// Sentinel option value for "no agent picked" (routes to the default LLM). Base
// UI Select needs the unset choice present in `items`; we map it back to null.
const DEFAULT_AGENT_VALUE = "__default_llm__";

// Guardrail checks offered by the Guardrails node. The names map to Gateway
// firewall categories server-side (jailbreak → prompt-injection patterns).
// `moderation` is offered but not yet enforced by the firewall (documented).
const GUARDRAIL_OPTIONS: { label: string; value: string }[] = [
	{ value: "pii", label: "PII" },
	{ value: "jailbreak", label: "Jailbreak" },
	{ value: "moderation", label: "Moderation" },
];

/** Agent dropdown shared by the Agent node and each Agent-Delegate row. Empty
 *  selection (the sentinel) serializes back to `null`. */
function AgentPicker({
	agents,
	value,
	onChange,
	id,
}: {
	agents: AgentOption[];
	value: string | null;
	onChange: (agentId: string | null) => void;
	id: string;
}) {
	const items = [
		{ value: DEFAULT_AGENT_VALUE, label: "(default LLM)" },
		...agents.map((a) => ({ value: a.id, label: a.name })),
	];
	return (
		<Select
			items={items}
			onValueChange={(v) => onChange(v === DEFAULT_AGENT_VALUE ? null : v)}
			value={value ?? DEFAULT_AGENT_VALUE}
		>
			<SelectTrigger id={id}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{items.map((item) => (
					<SelectItem key={item.value} value={item.value}>
						{item.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/** One delegate in an AgentDelegate node. Mirrors Core's `DelegateSpec`
 *  (apps/core/src/workflow/delegation.rs): `id` + `task` are required, `agent_id`
 *  is optional (null routes to the default LLM), `preset` is omitted so Core's
 *  serde default (`code_read`) applies. */
interface DelegateRow {
	agent_id: string | null;
	id: string;
	task: string;
}

let _delegateCounter = 0;

/** Editable list of AgentDelegate rows: add/remove, per-row agent picker + task
 *  template. Each row id is auto-generated and stable for its lifetime. */
function DelegateRows({
	agents,
	value,
	onChange,
}: {
	agents: AgentOption[];
	value: DelegateRow[];
	onChange: (rows: DelegateRow[]) => void;
}) {
	const addRow = () => {
		_delegateCounter += 1;
		onChange([
			...value,
			{ id: `delegate_${_delegateCounter}`, task: "", agent_id: null },
		]);
	};
	const updateRow = (index: number, patch: Partial<DelegateRow>) => {
		onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
	};
	const removeRow = (index: number) => {
		onChange(value.filter((_, i) => i !== index));
	};

	return (
		<div className="flex flex-col gap-2">
			<Label>Delegates</Label>
			{value.length === 0 ? (
				<p className="text-[11px] text-muted-foreground">
					No delegates yet. Add one to fan out a task to a sub-agent.
				</p>
			) : null}
			{value.map((row, index) => (
				<div
					className="flex flex-col gap-1.5 rounded-lg p-2 ring-1 ring-white/10"
					key={row.id}
				>
					<div className="flex items-center justify-between">
						<span className="font-mono text-[10px] text-muted-foreground">
							{row.id}
						</span>
						<Button
							aria-label="Remove delegate"
							className="size-6"
							onClick={() => removeRow(index)}
							size="icon"
							variant="ghost"
						>
							<HugeiconsIcon
								className="size-3 text-destructive"
								icon={Delete01Icon}
							/>
						</Button>
					</div>
					<AgentPicker
						agents={agents}
						id={`delegate-agent-${row.id}`}
						onChange={(agentId) => updateRow(index, { agent_id: agentId })}
						value={row.agent_id}
					/>
					<Textarea
						aria-label="Delegate task"
						className="h-14 font-mono text-xs"
						onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
							updateRow(index, { task: e.target.value })
						}
						placeholder="Task for this delegate…"
						value={row.task}
					/>
				</div>
			))}
			<Button onClick={addRow} size="sm" variant="ghost">
				<HugeiconsIcon className="size-3" icon={Add01Icon} />
				Add delegate
			</Button>
		</div>
	);
}

/** A token the user can insert into a template field, plus a human label. */
interface VariableToken {
	label: string;
	token: string;
}

/** Textarea with an "Insert variable" dropdown. Inserts the chosen `{{token}}`
 *  at the current cursor position (or appends if the field is unfocused), then
 *  reports the new value via `onChange`. Pure UI helper: no autocomplete engine,
 *  just a menu of known tokens collected from the graph. */
function TemplateField({
	id,
	value,
	onChange,
	variables,
	placeholder,
	className,
}: {
	className?: string;
	id: string;
	onChange: (next: string) => void;
	placeholder?: string;
	value: string;
	variables: VariableToken[];
}) {
	const ref = useRef<HTMLTextAreaElement>(null);

	const insert = useCallback(
		(token: string) => {
			const el = ref.current;
			if (el) {
				const start = el.selectionStart ?? value.length;
				const end = el.selectionEnd ?? value.length;
				const next = value.slice(0, start) + token + value.slice(end);
				onChange(next);
				// Restore focus + place the cursor right after the inserted token.
				requestAnimationFrame(() => {
					el.focus();
					const caret = start + token.length;
					el.setSelectionRange(caret, caret);
				});
				return;
			}
			onChange(value + token);
		},
		[value, onChange]
	);

	return (
		<div className="flex flex-col gap-1">
			<Textarea
				className={className ?? "h-20 font-mono text-xs"}
				id={id}
				onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
					onChange(e.target.value)
				}
				placeholder={placeholder}
				ref={ref}
				value={value}
			/>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							className="h-6 self-start px-2 text-[11px]"
							size="sm"
							type="button"
							variant="ghost"
						/>
					}
				>
					<HugeiconsIcon className="size-3" icon={CodeIcon} />
					Insert variable
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
					{variables.map((v) => (
						<DropdownMenuItem key={v.token} onClick={() => insert(v.token)}>
							<span className="font-mono text-xs">{v.token}</span>
							{v.label && v.label !== v.token ? (
								<span className="ml-2 text-[10px] text-muted-foreground">
									{v.label}
								</span>
							) : null}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

interface NodeConfigValue {
	coreType: CoreNodeType;
	extra: Record<string, unknown>;
	label: string;
}

interface NodeConfigPanelProps {
	agents: AgentOption[];
	onChange: (v: NodeConfigValue) => void;
	onDelete: () => void;
	value: NodeConfigValue;
	/** Variable tokens offered by the "Insert variable" menu on template fields. */
	variables: VariableToken[];
	/** Other saved workflows, offered by the Sub-workflow / While-body pickers
	 *  (the current workflow is excluded by the caller to avoid self-reference). */
	workflows: WorkflowOption[];
}

/** Config fields for an Awakeable (human-in-the-loop pause) node. */
function AwakeableFields({
	value,
	update,
}: {
	update: (key: string, val: unknown) => void;
	value: NodeConfigValue;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor="cfg-awakeable-prompt">Prompt</Label>
			<Textarea
				className="h-20 text-xs"
				id="cfg-awakeable-prompt"
				onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
					update("prompt", e.target.value || null)
				}
				placeholder="What input is expected before the run resumes?"
				value={(value.extra.prompt as string | null) ?? ""}
			/>
			<p className="text-[11px] text-muted-foreground">
				Pauses the run (human-in-the-loop) until the resume endpoint is called;
				the resume payload becomes this node's output.
			</p>
		</div>
	);
}

/** A JSON args editor shared by the MCP and Plugin nodes. Parses on every edit
 *  and only commits valid JSON, so a partial keystroke never clobbers the value. */
function JsonArgsField({
	id,
	label,
	value,
	onCommit,
}: {
	id: string;
	label: string;
	onCommit: (parsed: unknown) => void;
	value: unknown;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			<Textarea
				className="h-16 font-mono text-xs"
				id={id}
				onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
					try {
						onCommit(JSON.parse(e.target.value));
					} catch {
						// allow partial edit
					}
				}}
				value={JSON.stringify(value ?? {}, null, 2)}
			/>
		</div>
	);
}

/** Config fields for an Agent node: pick a configured agent and give it a task.
 *  The first-class "run agent X on this task" step (routes through the agent
 *  runner), distinct from a raw-prompt node. */
function AgentNodeFields({
	value,
	update,
	agents,
	variables,
}: {
	agents: AgentOption[];
	update: (key: string, val: unknown) => void;
	value: NodeConfigValue;
	variables: VariableToken[];
}) {
	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-agent-id">Agent</Label>
				<AgentPicker
					agents={agents}
					id="cfg-agent-id"
					onChange={(agentId) => update("agent_id", agentId ?? "")}
					value={(value.extra.agent_id as string | null) || null}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-agent-task">Task</Label>
				<TemplateField
					id="cfg-agent-task"
					onChange={(next) => update("task", next)}
					value={(value.extra.task as string) ?? ""}
					variables={variables}
				/>
				<p className="text-[11px] text-muted-foreground">
					Runs the agent on this task. Defaults to {"{{input}}"}.
				</p>
			</div>
		</>
	);
}

/** Config fields for a Skill node: pick an installed skill, optionally an agent
 *  to run it under, and the task. The skill's instruction body is prepended. */
function SkillFields({
	value,
	update,
	agents,
	variables,
}: {
	agents: AgentOption[];
	update: (key: string, val: unknown) => void;
	value: NodeConfigValue;
	variables: VariableToken[];
}) {
	const activeNode = useActiveNode();
	const { data: installedSkills } = useQuery({
		queryKey: ["skills", "installed", activeNode.url, activeNode.token],
		queryFn: () =>
			listSkills({ url: activeNode.url, token: activeNode.token ?? null }),
		staleTime: 30_000,
		retry: false,
	});
	const skillOptions = (installedSkills ?? []).map((s) => ({
		value: s.id,
		label: s.name || s.id,
	}));
	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-skill-id">Skill</Label>
				<CatalogSelect
					id="cfg-skill-id"
					inputPlaceholder="research"
					onChange={(v) => update("skill", v)}
					options={skillOptions as { label: string; value: string }[]}
					placeholder="Select a skill…"
					value={(value.extra.skill as string) ?? ""}
				/>
				<p className="text-[11px] text-muted-foreground">
					An installed skill (its SKILL.md stem).
				</p>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-skill-agent">Agent (optional)</Label>
				<AgentPicker
					agents={agents}
					id="cfg-skill-agent"
					onChange={(agentId) => update("agent_id", agentId)}
					value={(value.extra.agent_id as string | null) ?? null}
				/>
				<p className="text-[11px] text-muted-foreground">
					Runs under this agent, or the default LLM when unset.
				</p>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-skill-task">Task</Label>
				<TemplateField
					id="cfg-skill-task"
					onChange={(next) => update("task", next)}
					value={(value.extra.task as string) ?? ""}
					variables={variables}
				/>
			</div>
		</>
	);
}

/** A catalog-backed picker mirroring RecipeFields: a Select over `options` that
 *  always preserves the current value even when it isn't in the list yet (a remote
 *  node, or a catalog still loading), and falls back to a free-text Input when the
 *  catalog is empty so an id can always be entered by hand. */
function CatalogSelect({
	id,
	value,
	onChange,
	options,
	placeholder,
	inputPlaceholder,
}: {
	id: string;
	inputPlaceholder: string;
	onChange: (value: string) => void;
	options: { value: string; label: string }[];
	placeholder: string;
	value: string;
}) {
	if (options.length === 0) {
		return (
			<Input
				id={id}
				onChange={(e: ChangeEvent<HTMLInputElement>) =>
					onChange(e.target.value)
				}
				placeholder={inputPlaceholder}
				value={value}
			/>
		);
	}
	const items = [
		{ value: "", label: placeholder },
		...options,
		// Preserve a saved id even if it isn't in the fetched list (remote node, or
		// the catalog changed since the workflow was authored).
		...(value && !options.some((o) => o.value === value)
			? [{ value, label: value }]
			: []),
	];
	return (
		<Select items={items} onValueChange={onChange} value={value}>
			<SelectTrigger id={id}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{items.map((item) => (
					<SelectItem key={item.value} value={item.value}>
						{item.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/** Config fields for a Tool node: pick a tool from the MCP registry by its
 *  fully-qualified `<server>__<tool>` id (the shape the executor's `run_tool`
 *  expects). Reuses the shared `useMcp` hook; free-text fallback preserves manual
 *  ids on a remote node. */
function ToolFields({
	value,
	update,
}: {
	update: (key: string, val: unknown) => void;
	value: NodeConfigValue;
}) {
	const { tools } = useMcp();
	const name = (value.extra.name as string) ?? "";
	const toolOptions = tools.map((t) => ({
		value: t.id,
		label: `${t.server} · ${t.name}`,
	}));
	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-tool-name">Tool</Label>
				<CatalogSelect
					id="cfg-tool-name"
					inputPlaceholder="ghost__snapshot"
					onChange={(v) => update("name", v)}
					options={toolOptions}
					placeholder="Select a tool…"
					value={name}
				/>
				<p className="text-[11px] text-muted-foreground">
					The fully-qualified {"<server>__<tool>"} id on the MCP registry.
				</p>
			</div>
			<JsonArgsField
				id="cfg-tool-args"
				label="Args (JSON)"
				onCommit={(parsed) => update("args", parsed)}
				value={value.extra.args}
			/>
		</>
	);
}

/** Config fields for an MCP node: pick a registered server, then one of its
 *  tools (joined as `<server>__<tool>` by Core). Reuses the shared `useMcp` hook;
 *  each picker falls back to free text when the catalog is empty. */
function McpFields({
	value,
	update,
}: {
	update: (key: string, val: unknown) => void;
	value: NodeConfigValue;
}) {
	const { servers, tools } = useMcp();
	const server = (value.extra.server as string) ?? "";
	const tool = (value.extra.tool as string) ?? "";
	const serverOptions = servers.map((s) => ({ value: s.name, label: s.name }));
	const toolOptions = tools
		.filter((t) => t.server === server)
		.map((t) => ({ value: t.name, label: t.name }));
	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-mcp-server">Server</Label>
				<CatalogSelect
					id="cfg-mcp-server"
					inputPlaceholder="spider"
					onChange={(v) => update("server", v)}
					options={serverOptions}
					placeholder="Select a server…"
					value={server}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-mcp-tool">Tool</Label>
				<CatalogSelect
					id="cfg-mcp-tool"
					inputPlaceholder="crawl"
					onChange={(v) => update("tool", v)}
					options={toolOptions}
					placeholder={server ? "Select a tool…" : "Pick a server first"}
					value={tool}
				/>
				<p className="text-[11px] text-muted-foreground">
					Called as {"<server>__<tool>"} on the MCP registry.
				</p>
			</div>
			<JsonArgsField
				id="cfg-mcp-args"
				label="Args (JSON)"
				onCommit={(parsed) => update("args", parsed)}
				value={value.extra.args}
			/>
		</>
	);
}

/** Config fields for a Plugin node: pick an installed plugin + one of the
 *  runnables it bundles (tool/agent/skill/workflow). Reuses the shared `useApps`
 *  hook; the runnable list comes from the selected plugin's own `runnables`. */
function PluginFields({
	value,
	update,
}: {
	update: (key: string, val: unknown) => void;
	value: NodeConfigValue;
}) {
	const { apps } = useApps();
	const pluginId = (value.extra.plugin_id as string) ?? "";
	const runnableId = (value.extra.runnable_id as string) ?? "";
	const pluginOptions = apps.map((a) => ({
		value: a.id,
		label: a.name || a.id,
	}));
	const selectedApp = apps.find((a) => a.id === pluginId);
	const runnableOptions = (selectedApp?.runnables ?? []).map((r) => ({
		value: r.id,
		label: r.name ? `${r.name} (${r.kind})` : r.id,
	}));
	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-plugin-id">Plugin</Label>
				<CatalogSelect
					id="cfg-plugin-id"
					inputPlaceholder="com.example.my-app"
					onChange={(v) => update("plugin_id", v)}
					options={pluginOptions}
					placeholder="Select a plugin…"
					value={pluginId}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-plugin-runnable">Runnable</Label>
				<CatalogSelect
					id="cfg-plugin-runnable"
					inputPlaceholder="my-tool"
					onChange={(v) => update("runnable_id", v)}
					options={runnableOptions}
					placeholder={pluginId ? "Select a runnable…" : "Pick a plugin first"}
					value={runnableId}
				/>
				<p className="text-[11px] text-muted-foreground">
					A runnable the plugin bundles (tool/agent/skill/workflow).
				</p>
			</div>
			<JsonArgsField
				id="cfg-plugin-args"
				label="Args (JSON)"
				onCommit={(parsed) => update("args", parsed)}
				value={value.extra.args}
			/>
		</>
	);
}

// The audiences a NotifyUser node can target, mirroring Core's `NotifyTarget`
// enum (serde tag `kind`): the whole org, one team, or an explicit member list.
const NOTIFY_TARGET_OPTIONS: { value: string; label: string }[] = [
	{ value: "org", label: "Org" },
	{ value: "team", label: "Team" },
	{ value: "members", label: "Members" },
];

// The ack policies a NotifyUser node can require, mirroring Core's `AckMode`
// (serde tag `mode`). "none" is fire-and-forget; the rest suspend the run as a
// HITL gate until the policy is satisfied. `quorum` additionally carries `n`.
const NOTIFY_ACK_OPTIONS: { value: string; label: string }[] = [
	{ value: "none", label: "None (fire-and-forget)" },
	{ value: "first", label: "First ack resumes" },
	{ value: "all", label: "All must ack" },
	{ value: "quorum", label: "Quorum (n acks)" },
];

const DEFAULT_QUORUM_N = 2;

/** Config fields for a NotifyUser node: pick the audience (org/team/members), the
 *  template-aware title + body, the ack policy, and an optional ack timeout. The
 *  discriminated `target` and `ack_mode` objects are rebuilt wholesale on a kind/
 *  mode switch so a stale `team_id`/`user_ids`/`n` never leaks into the serialized
 *  shape Core deserializes. */
function NotifyUserFields({
	value,
	update,
	variables,
}: {
	update: (key: string, val: unknown) => void;
	value: NodeConfigValue;
	variables: VariableToken[];
}) {
	const target = (value.extra.target as Record<string, unknown>) ?? {
		kind: "org",
	};
	const kind = (target.kind as string) ?? "org";
	const teamId = (target.team_id as string) ?? "";
	const userIds = Array.isArray(target.user_ids)
		? (target.user_ids as string[])
		: [];
	const ackMode = (value.extra.ack_mode as Record<string, unknown>) ?? {
		mode: "none",
	};
	const mode = (ackMode.mode as string) ?? "none";
	const quorumN =
		typeof ackMode.n === "number" ? (ackMode.n as number) : DEFAULT_QUORUM_N;
	const ackTimeout = value.extra.ack_timeout_ms as number | null | undefined;

	const setKind = (nextKind: string) => {
		if (nextKind === "team") {
			update("target", { kind: "team", team_id: teamId });
		} else if (nextKind === "members") {
			update("target", { kind: "members", user_ids: userIds });
		} else {
			update("target", { kind: "org" });
		}
	};

	const setMode = (nextMode: string) => {
		if (nextMode === "quorum") {
			update("ack_mode", { mode: "quorum", n: quorumN });
		} else {
			update("ack_mode", { mode: nextMode });
		}
	};

	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-notify-target">Notify</Label>
				<ToggleGroup
					id="cfg-notify-target"
					onValueChange={(v: string) => {
						if (v) {
							setKind(v);
						}
					}}
					value={kind}
					variant="outline"
				>
					{NOTIFY_TARGET_OPTIONS.map((opt) => (
						<ToggleGroupItem key={opt.value} value={opt.value}>
							{opt.label}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</div>
			{kind === "team" ? (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="cfg-notify-team">Team id</Label>
					<Input
						id="cfg-notify-team"
						onChange={(e: ChangeEvent<HTMLInputElement>) =>
							update("target", { kind: "team", team_id: e.target.value })
						}
						placeholder="team_..."
						value={teamId}
					/>
				</div>
			) : null}
			{kind === "members" ? (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="cfg-notify-members">Member user ids</Label>
					<Input
						id="cfg-notify-members"
						onChange={(e: ChangeEvent<HTMLInputElement>) =>
							update("target", {
								kind: "members",
								user_ids: e.target.value
									.split(",")
									.map((s) => s.trim())
									.filter(Boolean),
							})
						}
						placeholder="u1, u2, u3"
						value={userIds.join(", ")}
					/>
					<p className="text-[11px] text-muted-foreground">
						Comma-separated user ids.
					</p>
				</div>
			) : null}
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-notify-title">Title</Label>
				<TemplateField
					className="h-10 text-xs"
					id="cfg-notify-title"
					onChange={(next) => update("title", next)}
					value={(value.extra.title as string) ?? ""}
					variables={variables}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-notify-body">Body</Label>
				<TemplateField
					id="cfg-notify-body"
					onChange={(next) => update("body", next)}
					value={(value.extra.body as string) ?? ""}
					variables={variables}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-notify-ack">Acknowledgement</Label>
				<Select items={NOTIFY_ACK_OPTIONS} onValueChange={setMode} value={mode}>
					<SelectTrigger id="cfg-notify-ack">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{NOTIFY_ACK_OPTIONS.map((opt) => (
							<SelectItem key={opt.value} value={opt.value}>
								{opt.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p className="text-[11px] text-muted-foreground">
					{mode === "none"
						? "Fire-and-forget — the run continues immediately."
						: "Suspends the run (HITL gate) until the ack policy is met."}
				</p>
			</div>
			{mode === "quorum" ? (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="cfg-notify-quorum">Required acks (n)</Label>
					<Input
						id="cfg-notify-quorum"
						min={1}
						onChange={(e: ChangeEvent<HTMLInputElement>) => {
							const parsed = Number.parseInt(e.target.value, 10);
							const n = Number.isNaN(parsed) || parsed < 1 ? 1 : parsed;
							update("ack_mode", { mode: "quorum", n });
						}}
						type="number"
						value={String(quorumN)}
					/>
				</div>
			) : null}
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-notify-timeout">Ack timeout (ms, optional)</Label>
				<Input
					id="cfg-notify-timeout"
					min={0}
					onChange={(e: ChangeEvent<HTMLInputElement>) =>
						update(
							"ack_timeout_ms",
							e.target.value ? Number(e.target.value) : undefined
						)
					}
					placeholder="(none)"
					type="number"
					value={ackTimeout == null ? "" : String(ackTimeout)}
				/>
				<p className="text-[11px] text-muted-foreground">
					Reserved — inert in v1, but stored for forward compatibility.
				</p>
			</div>
		</>
	);
}

const CHANNEL_PLATFORM_OPTIONS = [
	{ value: "telegram", label: "Telegram" },
	{ value: "slack", label: "Slack" },
	{ value: "discord", label: "Discord" },
	{ value: "webhook", label: "Webhook" },
];

/** Config fields for a ChannelSend node: pick the channel transport, address a
 *  recipient, and template the message. Telegram takes a bot token + chat id;
 *  Slack/Discord/webhook take an incoming-webhook URL (the URL encodes the
 *  destination, so `recipient` is hidden for those). */
function ChannelSendFields({
	value,
	update,
	variables,
}: {
	update: (key: string, val: unknown) => void;
	value: NodeConfigValue;
	variables: VariableToken[];
}) {
	const platform = (value.extra.platform as string) ?? "telegram";
	const isTelegram = platform === "telegram";

	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-channel-platform">Channel</Label>
				<Select
					items={CHANNEL_PLATFORM_OPTIONS}
					onValueChange={(v: string) => update("platform", v)}
					value={platform}
				>
					<SelectTrigger id="cfg-channel-platform">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{CHANNEL_PLATFORM_OPTIONS.map((opt) => (
							<SelectItem key={opt.value} value={opt.value}>
								{opt.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{isTelegram ? (
				<>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cfg-channel-token">Bot token</Label>
						<Input
							id="cfg-channel-token"
							onChange={(e: ChangeEvent<HTMLInputElement>) =>
								update("bot_token", e.target.value)
							}
							placeholder="123456:ABC-DEF..."
							type="password"
							value={(value.extra.bot_token as string) ?? ""}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cfg-channel-recipient">
							Send to (chat id / @username)
						</Label>
						<TemplateField
							className="h-10 text-xs"
							id="cfg-channel-recipient"
							onChange={(next) => update("recipient", next)}
							value={(value.extra.recipient as string) ?? ""}
							variables={variables}
						/>
					</div>
				</>
			) : (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="cfg-channel-webhook">Webhook URL</Label>
					<Input
						id="cfg-channel-webhook"
						onChange={(e: ChangeEvent<HTMLInputElement>) =>
							update("webhook_url", e.target.value)
						}
						placeholder="https://hooks.slack.com/..."
						value={(value.extra.webhook_url as string) ?? ""}
					/>
					<p className="text-[11px] text-muted-foreground">
						The incoming-webhook URL encodes the destination channel.
					</p>
				</div>
			)}
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-channel-text">Message</Label>
				<TemplateField
					id="cfg-channel-text"
					onChange={(next) => update("text", next)}
					value={(value.extra.text as string) ?? ""}
					variables={variables}
				/>
			</div>
		</>
	);
}

/** Config fields for a Recipe node: pick a recorded ghost recipe and map its
 *  params. Param values are templates resolved against the run context before
 *  replay (so `{{input}}`/`{{nodes.*}}` flow into a recorded action). */
function RecipeFields({
	value,
	update,
}: {
	update: (key: string, val: unknown) => void;
	value: NodeConfigValue;
}) {
	const { recipes } = useRecipes();
	const current = (value.extra.recipe as string) ?? "";
	const names = recipes.map((r) => r.name);
	const items = [
		{ value: "", label: "Select a recipe…" },
		...names.map((n) => ({ value: n, label: n })),
		// Preserve a saved name even if the recipe isn't in this node's list yet
		// (e.g. a remote node, or recipes still loading).
		...(current && !names.includes(current)
			? [{ value: current, label: current }]
			: []),
	];
	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-recipe">Recipe</Label>
				{recipes.length > 0 ? (
					<Select
						items={items}
						onValueChange={(v) => update("recipe", v)}
						value={current}
					>
						<SelectTrigger id="cfg-recipe">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{items.map((item) => (
								<SelectItem key={item.value} value={item.value}>
									{item.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : (
					<Input
						id="cfg-recipe"
						onChange={(e: ChangeEvent<HTMLInputElement>) =>
							update("recipe", e.target.value)
						}
						placeholder="recipe name"
						value={current}
					/>
				)}
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-recipe-params">Parameters (JSON)</Label>
				<Textarea
					className="h-16 font-mono text-xs"
					id="cfg-recipe-params"
					onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
						try {
							update("params", JSON.parse(e.target.value));
						} catch {
							// allow partial edit
						}
					}}
					placeholder={'{ "recipient": "{{input}}" }'}
					value={JSON.stringify(value.extra.params ?? {}, null, 2)}
				/>
				<p className="text-[11px] text-muted-foreground">
					String values may use{" "}
					<code className="text-[10px]">{"{{input}}"}</code> and other
					variables.
				</p>
			</div>
		</>
	);
}

/** The action verbs a GhostAction node can run, mirroring the Core executor's
 *  `ghost_action_call` dispatch. */
const GHOST_ACTION_OPTIONS: { value: string; label: string }[] = [
	{ value: "click", label: "Click" },
	{ value: "double_click", label: "Double-click" },
	{ value: "type", label: "Type" },
	{ value: "press", label: "Press key" },
	{ value: "hotkey", label: "Hotkey" },
	{ value: "scroll", label: "Scroll" },
	{ value: "focus", label: "Focus app" },
	{ value: "hover", label: "Hover" },
	{ value: "drag", label: "Drag" },
	{ value: "window", label: "Window" },
	{ value: "wait", label: "Wait" },
];

/** Element-targeted actions show a target-query field. */
const GHOST_TARGETED = new Set([
	"click",
	"double_click",
	"type",
	"hover",
	"drag",
]);

/** The single parameter field each action exposes (if any). */
const GHOST_PARAM_FIELD: Record<
	string,
	{ key: string; label: string; placeholder: string }
> = {
	type: { key: "text", label: "Text to type", placeholder: "{{input}}" },
	press: { key: "key", label: "Key", placeholder: "return" },
	hotkey: { key: "keys", label: "Keys", placeholder: "ctrl+c" },
	scroll: { key: "direction", label: "Direction", placeholder: "down" },
	wait: { key: "seconds", label: "Seconds", placeholder: "1" },
};

/** Config fields for a GhostAction node: the recorded action verb, its target
 *  element, app, and the per-action parameter. String values are templates
 *  resolved against the run context before the ghost call. */
function GhostActionFields({
	value,
	update,
}: {
	update: (key: string, val: unknown) => void;
	value: NodeConfigValue;
}) {
	const action = (value.extra.action as string) ?? "click";
	const target = (value.extra.target as Record<string, unknown>) ?? {};
	const params = (value.extra.params as Record<string, unknown>) ?? {};
	const query = (target.query as string) ?? "";
	const app = (target.app as string) ?? "";
	const paramField = GHOST_PARAM_FIELD[action];
	const setTarget = (key: string, val: string) =>
		update("target", { ...target, [key]: val });
	const setParam = (key: string, val: string) =>
		update("params", { ...params, [key]: val });

	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-ga-action">Action</Label>
				<Select
					items={GHOST_ACTION_OPTIONS}
					onValueChange={(v) => update("action", v)}
					value={action}
				>
					<SelectTrigger id="cfg-ga-action">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{GHOST_ACTION_OPTIONS.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{GHOST_TARGETED.has(action) && (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="cfg-ga-query">Target element</Label>
					<Input
						id="cfg-ga-query"
						onChange={(e: ChangeEvent<HTMLInputElement>) =>
							setTarget("query", e.target.value)
						}
						placeholder="button or field name"
						value={query}
					/>
				</div>
			)}
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-ga-app">App</Label>
				<Input
					id="cfg-ga-app"
					onChange={(e: ChangeEvent<HTMLInputElement>) =>
						setTarget("app", e.target.value)
					}
					placeholder="e.g. Gmail (optional)"
					value={app}
				/>
			</div>
			{paramField && (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="cfg-ga-param">{paramField.label}</Label>
					<Input
						id="cfg-ga-param"
						onChange={(e: ChangeEvent<HTMLInputElement>) =>
							setParam(paramField.key, e.target.value)
						}
						placeholder={paramField.placeholder}
						value={(params[paramField.key] as string) ?? ""}
					/>
					<p className="text-[11px] text-muted-foreground">
						String values may use{" "}
						<code className="text-[10px]">{"{{input}}"}</code> and other
						variables.
					</p>
				</div>
			)}
		</>
	);
}

/** Engine hard ceiling on While-loop iterations (mirrors Core's
 *  `MAX_WHILE_ITERATIONS`). A node's `max_iterations` is clamped to this. */
const MAX_WHILE_ITERATIONS = 100;

/** Config fields for a While node. Two real modes, switched by whether a loop
 *  body workflow is set:
 *   - **Loop** (body set): re-runs the body workflow while the condition holds
 *     against the carried value, up to a (capped) iteration limit.
 *   - **Gate** (no body): a one-shot Condition-style branch — takes the `true`
 *     edge when the condition holds, evaluated at most once.
 *  Core supports both (apps/core/src/workflow/executor.rs); this exposes the
 *  loop body + iteration cap the canvas previously hid. */
function WhileFields({
	value,
	update,
	variables,
	workflows,
}: {
	update: (key: string, val: unknown) => void;
	value: NodeConfigValue;
	variables: VariableToken[];
	workflows: WorkflowOption[];
}) {
	// Loop vs gate is distinguished by the *presence* of body_workflow_id, not its
	// value: a present-but-empty string ("") means "loop mode selected, body not
	// picked yet" so the picker stays visible. Gate mode is the field being absent
	// (null), which Core reads as `None` → the one-shot branch gate.
	const bodyRaw = value.extra.body_workflow_id;
	const isLoop = typeof bodyRaw === "string";
	const bodyId = isLoop ? (bodyRaw as string) : "";
	const maxIter = value.extra.max_iterations as number | null | undefined;
	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label
					className="text-muted-foreground text-xs"
					htmlFor="cfg-while-mode"
				>
					Mode
				</Label>
				<ToggleGroup
					id="cfg-while-mode"
					onValueChange={(v: string) => {
						// Switching to gate clears the body; switching to loop seeds an
						// empty body so the picker shows (the user then selects one).
						if (v === "gate") {
							update("body_workflow_id", null);
						} else if (v === "loop" && !isLoop) {
							update("body_workflow_id", "");
						}
					}}
					value={isLoop ? "loop" : "gate"}
					variant="outline"
				>
					<ToggleGroupItem value="gate">One-shot gate</ToggleGroupItem>
					<ToggleGroupItem value="loop">Loop</ToggleGroupItem>
				</ToggleGroup>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-while-expr">
					{isLoop ? "Repeat while" : "Condition"}
				</Label>
				<TemplateField
					className="h-16 font-mono text-xs"
					id="cfg-while-expr"
					onChange={(next) => update("expr", next)}
					value={(value.extra.expr as string) ?? ""}
					variables={variables}
				/>
				<p className="text-[11px] text-muted-foreground">
					{isLoop
						? "Evaluated against the carried value each pass (the input keyword is the carry, e.g. input < 10). Supports == != contains starts_with ends_with empty nonempty, and numeric < > <= >=."
						: "Takes the true branch when the condition holds; evaluated once. Supports == != contains starts_with ends_with empty nonempty, and numeric < > <= >=."}
				</p>
			</div>
			{isLoop ? (
				<>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cfg-while-body">Loop body workflow</Label>
						<WorkflowPicker
							id="cfg-while-body"
							onChange={(wfId) => update("body_workflow_id", wfId || "")}
							value={bodyId}
							workflows={workflows}
						/>
						<p className="text-[11px] text-muted-foreground">
							Each pass runs this workflow; its output becomes the next pass's
							input. Save the workflow first so it can be picked.
						</p>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cfg-while-max">Max iterations</Label>
						<Input
							id="cfg-while-max"
							max={MAX_WHILE_ITERATIONS}
							min={1}
							onChange={(e: ChangeEvent<HTMLInputElement>) => {
								const n = Number(e.target.value);
								update(
									"max_iterations",
									e.target.value && n > 0 ? n : undefined
								);
							}}
							placeholder={`default ${MAX_WHILE_ITERATIONS}`}
							type="number"
							value={maxIter == null ? "" : String(maxIter)}
						/>
						<p className="text-[11px] text-muted-foreground">
							Safety cap on passes (max {MAX_WHILE_ITERATIONS}). The loop also
							exits as soon as the condition is false.
						</p>
					</div>
				</>
			) : null}
		</>
	);
}

// Default Temporal-style retry policy applied when a node first opts into
// retries. Mirrors the Core `RetryPolicy` defaults (apps/core/src/workflow/mod.rs)
// except `max_attempts`, which jumps to 3 here since toggling retries on with a
// budget of 1 would be a no-op.
const DEFAULT_RETRY_POLICY = {
	max_attempts: 3,
	initial_interval_ms: 100,
	backoff_coefficient: 2,
	max_interval_ms: 60_000,
	jitter_fraction: 0,
	non_retryable_errors: [] as string[],
};

// Node kinds where a retry policy / timeout is meaningful (they make external
// calls or can fail/hang). Pure or trivial nodes (input/output/note/condition/
// transform/set_state) and the suspend gate (awakeable, never retried) are
// omitted so the panel stays honest.
const RELIABILITY_KINDS = new Set<CoreNodeType>([
	"prompt",
	"tool",
	"webhook",
	"agent_delegate",
	"ghost_action",
	"recipe",
	"sub_workflow",
	"guardrails",
	"delay",
	"while",
	"agent",
	"skill",
	"mcp",
	"plugin",
]);

interface ReliabilityFieldsProps {
	onChange: (next: NodeConfigValue) => void;
	value: NodeConfigValue;
}

// A shared "Reliability" section (retry policy + per-attempt timeout) rendered
// below a node's kind-specific fields. Writes `retry` and `timeout_ms` straight
// into `extra`, which the canvas serialises verbatim onto the WorkflowNode.
function ReliabilityFields({ value, onChange }: ReliabilityFieldsProps) {
	const setExtra = useCallback(
		(key: string, val: unknown) => {
			onChange({ ...value, extra: { ...value.extra, [key]: val } });
		},
		[value, onChange]
	);
	const retry = value.extra.retry as Record<string, unknown> | undefined;
	const retryEnabled = retry != null;
	const setRetryField = useCallback(
		(key: string, val: unknown) => {
			setExtra("retry", {
				...DEFAULT_RETRY_POLICY,
				...(retry ?? {}),
				[key]: val,
			});
		},
		[retry, setExtra]
	);
	const numRetry = (key: string, fallback: number) =>
		(retry?.[key] as number | undefined) ?? fallback;
	const timeoutMs = value.extra.timeout_ms as number | null | undefined;

	return (
		<div className="flex flex-col gap-2 border-white/10 border-t pt-3">
			<div className="flex items-center justify-between">
				<Label
					className="text-muted-foreground text-xs"
					htmlFor="cfg-retry-toggle"
				>
					Retry on failure
				</Label>
				<Switch
					checked={retryEnabled}
					id="cfg-retry-toggle"
					onCheckedChange={(on) =>
						setExtra("retry", on ? { ...DEFAULT_RETRY_POLICY } : undefined)
					}
				/>
			</div>
			{retryEnabled ? (
				<div className="flex flex-col gap-2 rounded-lg bg-black/10 p-2">
					<div className="grid grid-cols-2 gap-2">
						<div className="flex flex-col gap-1">
							<Label className="text-[11px]" htmlFor="cfg-retry-max">
								Max attempts
							</Label>
							<Input
								id="cfg-retry-max"
								min={1}
								onChange={(e: ChangeEvent<HTMLInputElement>) =>
									setRetryField("max_attempts", Number(e.target.value) || 1)
								}
								type="number"
								value={String(numRetry("max_attempts", 3))}
							/>
						</div>
						<div className="flex flex-col gap-1">
							<Label className="text-[11px]" htmlFor="cfg-retry-init">
								Initial backoff (ms)
							</Label>
							<Input
								id="cfg-retry-init"
								min={0}
								onChange={(e: ChangeEvent<HTMLInputElement>) =>
									setRetryField(
										"initial_interval_ms",
										Number(e.target.value) || 0
									)
								}
								type="number"
								value={String(numRetry("initial_interval_ms", 100))}
							/>
						</div>
						<div className="flex flex-col gap-1">
							<Label className="text-[11px]" htmlFor="cfg-retry-coeff">
								Backoff ×
							</Label>
							<Input
								id="cfg-retry-coeff"
								min={1}
								onChange={(e: ChangeEvent<HTMLInputElement>) =>
									setRetryField(
										"backoff_coefficient",
										Number(e.target.value) || 1
									)
								}
								step={0.1}
								type="number"
								value={String(numRetry("backoff_coefficient", 2))}
							/>
						</div>
						<div className="flex flex-col gap-1">
							<Label className="text-[11px]" htmlFor="cfg-retry-maxint">
								Max backoff (ms)
							</Label>
							<Input
								id="cfg-retry-maxint"
								min={0}
								onChange={(e: ChangeEvent<HTMLInputElement>) =>
									setRetryField("max_interval_ms", Number(e.target.value) || 0)
								}
								type="number"
								value={String(numRetry("max_interval_ms", 60_000))}
							/>
						</div>
					</div>
					<div className="flex flex-col gap-1">
						<Label className="text-[11px]" htmlFor="cfg-retry-jitter">
							Jitter (0–1)
						</Label>
						<Input
							id="cfg-retry-jitter"
							max={1}
							min={0}
							onChange={(e: ChangeEvent<HTMLInputElement>) =>
								setRetryField("jitter_fraction", Number(e.target.value) || 0)
							}
							step={0.05}
							type="number"
							value={String(numRetry("jitter_fraction", 0))}
						/>
					</div>
					<div className="flex flex-col gap-1">
						<Label className="text-[11px]" htmlFor="cfg-retry-nonretry">
							Non-retryable errors
						</Label>
						<Input
							id="cfg-retry-nonretry"
							onChange={(e: ChangeEvent<HTMLInputElement>) =>
								setRetryField(
									"non_retryable_errors",
									e.target.value
										.split(",")
										.map((s) => s.trim())
										.filter(Boolean)
								)
							}
							placeholder="comma,separated,substrings"
							value={(
								(retry?.non_retryable_errors as string[] | undefined) ?? []
							).join(", ")}
						/>
						<p className="text-[11px] text-muted-foreground">
							Error substrings that fail immediately without retrying.
						</p>
					</div>
				</div>
			) : null}
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-timeout">Timeout (ms)</Label>
				<Input
					id="cfg-timeout"
					min={0}
					onChange={(e: ChangeEvent<HTMLInputElement>) =>
						setExtra(
							"timeout_ms",
							e.target.value ? Number(e.target.value) : undefined
						)
					}
					placeholder="(unbounded)"
					type="number"
					value={timeoutMs == null ? "" : String(timeoutMs)}
				/>
				<p className="text-[11px] text-muted-foreground">
					Per-attempt wall-clock limit. A timeout retries when a policy is set.
				</p>
			</div>
		</div>
	);
}

function NodeConfigPanel({
	value,
	onChange,
	onDelete,
	agents,
	variables,
	workflows,
}: NodeConfigPanelProps) {
	const update = useCallback(
		(key: string, val: unknown) => {
			onChange({ ...value, extra: { ...value.extra, [key]: val } });
		},
		[value, onChange]
	);

	const renderFields = () => {
		switch (value.coreType) {
			case "input":
			case "output":
				return (
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cfg-key">Key</Label>
						<Input
							id="cfg-key"
							onChange={(e: ChangeEvent<HTMLInputElement>) =>
								update("key", e.target.value || null)
							}
							placeholder="(uses node id)"
							value={(value.extra.key as string | null) ?? ""}
						/>
					</div>
				);
			case "prompt":
				return (
					<>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="cfg-prompt">Prompt template</Label>
							<TemplateField
								id="cfg-prompt"
								onChange={(next) => update("prompt", next)}
								value={(value.extra.prompt as string) ?? ""}
								variables={variables}
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="cfg-agent">Agent</Label>
							<AgentPicker
								agents={agents}
								id="cfg-agent"
								onChange={(agentId) => update("agent_id", agentId)}
								value={(value.extra.agent_id as string | null) ?? null}
							/>
						</div>
					</>
				);
			case "condition":
				return (
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cfg-expr">Expression</Label>
						<Input
							id="cfg-expr"
							onChange={(e: ChangeEvent<HTMLInputElement>) =>
								update("expr", e.target.value)
							}
							placeholder='input != ""'
							value={(value.extra.expr as string) ?? ""}
						/>
						<p className="text-[11px] text-muted-foreground">
							{
								"input == · != · contains · starts_with · ends_with · empty · nonempty, and numeric < > <= >="
							}
						</p>
					</div>
				);
			case "transform":
				return (
					<>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="cfg-op">Operation</Label>
							<Select
								items={[
									"uppercase",
									"lowercase",
									"trim",
									"json_parse",
									"template",
									"identity",
								].map((op) => ({ value: op, label: op }))}
								onValueChange={(v) => update("op", v)}
								value={(value.extra.op as string) ?? "uppercase"}
							>
								<SelectTrigger id="cfg-op">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{[
										"uppercase",
										"lowercase",
										"trim",
										"json_parse",
										"template",
										"identity",
									].map((op) => (
										<SelectItem key={op} value={op}>
											{op}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						{value.extra.op === "template" ? (
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="cfg-tmpl">Template</Label>
								<TemplateField
									className="h-16 font-mono text-xs"
									id="cfg-tmpl"
									onChange={(next) => update("template", next || null)}
									value={(value.extra.template as string | null) ?? ""}
									variables={variables}
								/>
							</div>
						) : null}
					</>
				);
			case "set_state":
				return (
					<>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="cfg-state-key">State key</Label>
							<Input
								id="cfg-state-key"
								onChange={(e: ChangeEvent<HTMLInputElement>) =>
									update("key", e.target.value)
								}
								placeholder="my_var"
								value={(value.extra.key as string) ?? ""}
							/>
							<p className="text-[11px] text-muted-foreground">
								Read downstream as {"{{state."}
								{(value.extra.key as string) || "my_var"}
								{"}}"}
							</p>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="cfg-state-value">Value template</Label>
							<TemplateField
								id="cfg-state-value"
								onChange={(next) => update("value", next)}
								value={(value.extra.value as string) ?? ""}
								variables={variables}
							/>
						</div>
					</>
				);
			case "tool":
				return <ToolFields update={update} value={value} />;
			case "recipe":
				return <RecipeFields update={update} value={value} />;
			case "ghost_action":
				return <GhostActionFields update={update} value={value} />;
			case "webhook":
				return (
					<>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="cfg-wh-url">URL</Label>
							<Input
								id="cfg-wh-url"
								onChange={(e: ChangeEvent<HTMLInputElement>) =>
									update("url", e.target.value)
								}
								value={(value.extra.url as string) ?? ""}
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="cfg-wh-method">Method</Label>
							<Select
								items={["POST", "PUT", "PATCH", "GET"].map((m) => ({
									value: m,
									label: m,
								}))}
								onValueChange={(v) => update("method", v)}
								value={(value.extra.method as string) ?? "POST"}
							>
								<SelectTrigger id="cfg-wh-method">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{["POST", "PUT", "PATCH", "GET"].map((m) => (
										<SelectItem key={m} value={m}>
											{m}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</>
				);
			case "delay":
				return (
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cfg-ms">Duration (ms)</Label>
						<Input
							id="cfg-ms"
							min={0}
							onChange={(e: ChangeEvent<HTMLInputElement>) =>
								update("ms", Number(e.target.value) || 0)
							}
							type="number"
							value={String((value.extra.ms as number) ?? 1000)}
						/>
					</div>
				);
			case "sub_workflow":
				return (
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cfg-wfid">Workflow</Label>
						<WorkflowPicker
							id="cfg-wfid"
							onChange={(wfId) => update("workflow_id", wfId)}
							value={(value.extra.workflow_id as string) ?? ""}
							workflows={workflows}
						/>
						<p className="text-[11px] text-muted-foreground">
							Runs the selected workflow and forwards its output.
						</p>
					</div>
				);
			default:
				// The remaining kinds live in a second switch so neither function
				// trips the cognitive-complexity ceiling (one big switch would).
				return renderAdvancedFields();
		}
	};

	// Second half of the per-kind field switch: orchestration / runnable nodes.
	const renderAdvancedFields = () => {
		switch (value.coreType) {
			case "agent_delegate":
				return (
					<DelegateRows
						agents={agents}
						onChange={(delegates) => update("delegates", delegates)}
						value={
							Array.isArray(value.extra.delegates)
								? (value.extra.delegates as DelegateRow[])
								: []
						}
					/>
				);
			case "note":
				return (
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cfg-note">Note</Label>
						<Textarea
							className="h-24 text-xs"
							id="cfg-note"
							onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
								update("text", e.target.value)
							}
							placeholder="Documentation only — does not affect the run."
							value={(value.extra.text as string) ?? ""}
						/>
					</div>
				);
			case "while":
				return (
					<WhileFields
						update={update}
						value={value}
						variables={variables}
						workflows={workflows}
					/>
				);
			case "guardrails":
				return (
					<div className="flex flex-col gap-1.5">
						<Label>Checks</Label>
						<ToggleGroup
							onValueChange={(v: string[]) => update("checks", v)}
							value={
								Array.isArray(value.extra.checks)
									? (value.extra.checks as string[])
									: []
							}
							variant="outline"
						>
							{GUARDRAIL_OPTIONS.map((opt) => (
								<ToggleGroupItem key={opt.value} value={opt.value}>
									{opt.label}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
						<p className="text-[11px] text-muted-foreground">
							Routed through the Gateway firewall; a trip fails the run.
							Moderation is not yet enforced.
						</p>
					</div>
				);
			case "awakeable":
				return <AwakeableFields update={update} value={value} />;
			case "agent":
				return (
					<AgentNodeFields
						agents={agents}
						update={update}
						value={value}
						variables={variables}
					/>
				);
			case "skill":
				return (
					<SkillFields
						agents={agents}
						update={update}
						value={value}
						variables={variables}
					/>
				);
			case "mcp":
				return <McpFields update={update} value={value} />;
			case "plugin":
				return <PluginFields update={update} value={value} />;
			case "notify_user":
				return (
					<NotifyUserFields
						update={update}
						value={value}
						variables={variables}
					/>
				);
			case "channel_send":
				return (
					<ChannelSendFields
						update={update}
						value={value}
						variables={variables}
					/>
				);
			default:
				return null;
		}
	};

	return (
		<div className="flex max-h-[70vh] w-56 flex-col gap-3 overflow-y-auto rounded-xl bg-popover/95 p-3 shadow-xl ring-1 ring-white/10 backdrop-blur">
			<div className="flex items-center justify-between">
				<span className="font-semibold text-sm">Node config</span>
				<Button
					aria-label="Delete node"
					onClick={onDelete}
					size="sm"
					variant="ghost"
				>
					<HugeiconsIcon
						className="size-3.5 text-destructive"
						icon={Delete01Icon}
					/>
				</Button>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-label">Node id</Label>
				<Input
					id="cfg-label"
					onChange={(e: ChangeEvent<HTMLInputElement>) =>
						onChange({ ...value, label: e.target.value })
					}
					value={value.label}
				/>
			</div>
			{renderFields()}
			{RELIABILITY_KINDS.has(value.coreType) ? (
				<ReliabilityFields onChange={onChange} value={value} />
			) : null}
		</div>
	);
}

// --- Palette (add node) ---------------------------------------------------

// Node kinds grouped by purpose, mirroring the way the OpenAI Agent Builder
// organises its insert-node list: a searchable, persistent left rail rather
// than a transient popover.
const PALETTE_GROUPS: { label: string; kinds: CoreNodeType[] }[] = [
	{
		label: "Core",
		kinds: ["input", "prompt", "agent", "agent_delegate", "note"],
	},
	{
		label: "Runnables",
		kinds: ["skill", "mcp", "plugin"],
	},
	{ label: "Tool", kinds: ["tool", "recipe", "ghost_action", "guardrails"] },
	{
		label: "Logic",
		kinds: ["condition", "while", "awakeable"],
	},
	{
		label: "Data",
		kinds: ["transform", "set_state", "sub_workflow", "delay", "webhook"],
	},
	{ label: "Output", kinds: ["output", "notify_user", "channel_send"] },
];

interface PaletteProps {
	onAdd: (kind: CoreNodeType) => void;
	onClose: () => void;
}

function PaletteRow({
	kind,
	onAdd,
}: {
	kind: CoreNodeType;
	onAdd: (kind: CoreNodeType) => void;
}) {
	const meta = NODE_META[kind];
	return (
		<button
			className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
			onClick={() => onAdd(kind)}
			type="button"
		>
			<span
				aria-hidden
				className={`flex size-5 shrink-0 items-center justify-center rounded-md ${meta.color} text-white`}
			>
				{meta.icon}
			</span>
			<span className="min-w-0 flex-1 truncate">{meta.label}</span>
			<HugeiconsIcon
				className="size-3 shrink-0 text-muted-foreground/40"
				icon={Add01Icon}
			/>
		</button>
	);
}

function Palette({ onAdd, onClose }: PaletteProps) {
	const [query, setQuery] = useState("");
	const q = query.trim().toLowerCase();
	const groups = PALETTE_GROUPS.map((group) => ({
		label: group.label,
		kinds: group.kinds.filter(
			(k) => !q || NODE_META[k].label.toLowerCase().includes(q)
		),
	})).filter((group) => group.kinds.length > 0);

	return (
		<div className="flex max-h-[calc(100vh-13rem)] w-52 flex-col gap-2 rounded-xl bg-popover/95 p-2 shadow-xl ring-1 ring-white/10 backdrop-blur">
			<div className="flex items-center justify-between pl-1">
				<span className="font-medium text-muted-foreground text-xs">
					Add node
				</span>
				<Button
					aria-label="Hide palette"
					className="size-6"
					onClick={onClose}
					size="icon"
					variant="ghost"
				>
					<HugeiconsIcon className="size-3.5" icon={Cancel01Icon} />
				</Button>
			</div>
			<Input
				className="h-7 text-xs"
				onChange={(e: ChangeEvent<HTMLInputElement>) =>
					setQuery(e.target.value)
				}
				placeholder="Search nodes"
				value={query}
			/>
			<div className="flex flex-col gap-2 overflow-y-auto">
				{groups.length === 0 ? (
					<p className="px-1 py-2 text-muted-foreground text-xs">No matches</p>
				) : (
					groups.map((group) => (
						<div className="flex flex-col gap-0.5" key={group.label}>
							<span className="px-1 text-[10px] text-muted-foreground/50 uppercase tracking-wide">
								{group.label}
							</span>
							{group.kinds.map((kind) => (
								<PaletteRow key={kind} kind={kind} onAdd={onAdd} />
							))}
						</div>
					))
				)}
			</div>
		</div>
	);
}

// --- Run inputs dialog (inline panel) ------------------------------------

interface RunPanelProps {
	inputKeys: string[];
	onClose: () => void;
	onRun: (inputs: Record<string, string>) => void;
	result: WorkflowRun | null;
	runError: string | null;
	running: boolean;
}

function RunPanel({
	inputKeys,
	running,
	result,
	runError,
	onRun,
	onClose,
}: RunPanelProps) {
	const [inputs, setInputs] = useState<Record<string, string>>(() =>
		Object.fromEntries(inputKeys.map((k) => [k, ""]))
	);

	return (
		<div className="flex w-64 flex-col gap-3 rounded-xl bg-popover/95 p-3 shadow-xl ring-1 ring-white/10 backdrop-blur">
			<div className="flex items-center justify-between">
				<span className="font-semibold text-sm">Run workflow</span>
				<Button onClick={onClose} size="sm" variant="ghost">
					×
				</Button>
			</div>
			{inputKeys.length === 0 ? (
				<p className="text-muted-foreground text-xs">
					No inputs — run immediately.
				</p>
			) : (
				inputKeys.map((key) => (
					<div className="flex flex-col gap-1" key={key}>
						<Label htmlFor={`run-${key}`}>{key}</Label>
						<Textarea
							className="h-14 text-xs"
							id={`run-${key}`}
							onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
								setInputs((p) => ({ ...p, [key]: e.target.value }))
							}
							value={inputs[key] ?? ""}
						/>
					</div>
				))
			)}
			{runError ? (
				<p className="text-destructive text-xs" role="alert">
					{runError}
				</p>
			) : null}
			{result ? (
				<div className="flex flex-col gap-1 rounded-lg p-2 text-xs ring-1 ring-white/10">
					<div className="flex items-center justify-between">
						<span className="font-medium">Result</span>
						<Badge variant={statusBadgeVariant(result.status)}>
							{result.status}
						</Badge>
					</div>
					{result.error ? (
						<p className="text-destructive">{result.error}</p>
					) : null}
					{Object.entries(result.output).map(([k, v]) => (
						<div className="flex gap-2" key={k}>
							<span className="font-mono text-muted-foreground">{k}</span>
							<span className="break-all font-mono">{v}</span>
						</div>
					))}
				</div>
			) : null}
			<Button
				className="w-full"
				disabled={running}
				onClick={() => onRun(inputs)}
				size="sm"
			>
				{running ? (
					<Spinner className="size-3" />
				) : (
					<HugeiconsIcon className="size-3" icon={PlayIcon} />
				)}
				Run
			</Button>
		</div>
	);
}

// --- Main WorkflowCanvas component ----------------------------------------

export interface WorkflowCanvasProps {
	/** All saved workflows, used to populate the Sub-workflow / While-loop-body
	 *  pickers. The current workflow is filtered out internally so it can't pick
	 *  itself (Core rejects a self-referential loop body at run time). */
	allWorkflows?: WorkflowOption[];
	/** Called when the user clicks Record (opens the record-to-workflow flow). */
	onRecord?: () => void;
	/** Called when the user clicks Run. */
	onRun: (inputs: Record<string, string>) => Promise<WorkflowRun>;
	/** Called with the Core-serializable definition object when user saves;
	 *  resolves to the persisted workflow (Core mints the id for new ones). */
	onSave: (definition: Record<string, unknown>) => Promise<Workflow>;
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
	onRun,
	onRecord,
	runNodes,
	reloadSignal,
	allWorkflows,
}: WorkflowCanvasProps) {
	// Agents available on the active node, for the Agent / Agent-Delegate pickers.
	// Reuses the shared `useAgents` hook (no new client). Mapped to the minimal
	// {id,name} the pickers need.
	const { agents: agentSummaries } = useAgents();
	const agentOptions = useMemo<AgentOption[]>(
		() => agentSummaries.map((a) => ({ id: a.id, name: a.name })),
		[agentSummaries]
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
	const [nodes, setNodes] = useState<Node[]>([]);
	const [edges, setEdges] = useState<Edge[]>([]);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
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
			loadedIdRef.current = workflow.id;
		} else {
			setNodes([]);
			setEdges([]);
			setTrigger({ type: "manual" });
			setExtraTriggers([]);
			loadedIdRef.current = null;
		}
		setSelectedNodeId(null);
		setRunResult(null);
		setRunError(null);
	}, [workflow, reloadSignal]);

	// Overlay run status onto nodes
	const nodesWithStatus = useMemo<Node[]>(() => {
		if (!runNodes) {
			return nodes;
		}
		return nodes.map((n) => ({
			...n,
			data: {
				...n.data,
				runStatus: runNodes[n.id]?.status ?? null,
			} as CanvasNodeData,
		}));
	}, [nodes, runNodes]);

	// Prepend the pinned, UI-only trigger entry node. It is driven by `trigger`
	// state (not `nodes`), is non-draggable/non-deletable, and is selected via our
	// own `selectedNodeId` so clicking it opens TriggerConfig in the side panel.
	const displayNodes = useMemo<Node[]>(() => {
		const triggerNode: Node = {
			id: TRIGGER_NODE_ID,
			type: "triggerNode",
			position: TRIGGER_NODE_POSITION,
			draggable: false,
			deletable: false,
			selected: selectedNodeId === TRIGGER_NODE_ID,
			data: { label: "Trigger", trigger } as TriggerNodeData,
		};
		return [triggerNode, ...nodesWithStatus];
	}, [trigger, nodesWithStatus, selectedNodeId]);

	const onNodesChange = useCallback((changes: NodeChange[]) => {
		setNodes((ns) => applyNodeChanges(changes, ns));
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
					type: "smoothstep",
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
		const newNode: Node = {
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
			} as CanvasNodeData,
		};
		setNodes((ns) => [...ns, newNode]);
		setSelectedNodeId(id);
	}, []);

	// Update node data from the config panel
	const handleNodeConfigChange = useCallback(
		(nodeId: string, cfg: NodeConfigValue) => {
			setNodes((ns) =>
				ns.map((n) =>
					n.id === nodeId
						? {
								...n,
								id: cfg.label === n.id ? n.id : cfg.label,
								data: {
									...n.data,
									coreType: cfg.coreType,
									label: cfg.label,
									extra: cfg.extra,
								} as CanvasNodeData,
							}
						: n
				)
			);
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
		setSaveError(null);
		setSaving(true);
		try {
			// Emit the panel-edited trigger plus any further triggers Core declared
			// (which the panel doesn't edit) so an unrelated save doesn't drop them.
			const def = canvasToDefinition(name, description, nodes, edges, [
				trigger,
				...extraTriggers,
			]) as Record<string, unknown>;
			if (workflow) {
				def.id = workflow.id;
			}
			const saved = await onSave(def);
			// Persist node positions under the (possibly newly-minted) id and mark it
			// as the loaded workflow so the parent's re-selection doesn't reset the
			// canvas.
			savePositions(saved.id, nodes);
			loadedIdRef.current = saved.id;
		} catch (e) {
			setSaveError(e instanceof Error ? e.message : "Save failed");
		} finally {
			setSaving(false);
		}
	}, [
		name,
		description,
		nodes,
		edges,
		trigger,
		extraTriggers,
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
				canvasToDefinition(name, description, nodes, edges, [
					trigger,
					...extraTriggers,
				]) as Record<string, unknown>
			),
		[name, description, nodes, edges, trigger, extraTriggers]
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
				// Persist the on-screen canvas first so the snapshot captures the
				// current (possibly unsaved) state, not the last-saved file.
				const def = canvasToDefinition(name, description, nodes, edges, [
					trigger,
					...extraTriggers,
				]) as Record<string, unknown>;
				def.id = wfId;
				await onSave(def);
				await createWorkflowVersion(target, wfId, label);
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
		loadedIdRef.current = restored.id;
		savePositions(restored.id, n);
		restoredWorkflowRef.current = null;
	}, []);

	// Derive input keys for run panel
	const inputKeys = useMemo(
		() =>
			nodes
				.filter((n) => (n.data as CanvasNodeData).coreType === "input")
				.map((n) => {
					const extra = (n.data as CanvasNodeData).extra as Record<
						string,
						unknown
					>;
					return typeof extra.key === "string" && extra.key ? extra.key : n.id;
				}),
		[nodes]
	);

	const handleRun = useCallback(
		async (inputs: Record<string, string>) => {
			setRunning(true);
			setRunError(null);
			setRunResult(null);
			try {
				const result = await onRun(inputs);
				setRunResult(result);
				if (result.status === "failed") {
					sileo.error({ title: result.error ?? "Workflow run failed" });
				} else {
					sileo.success({ title: "Workflow run completed" });
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
			const d = n.data as CanvasNodeData;
			if (d.coreType !== "set_state") {
				continue;
			}
			const extra = d.extra as Record<string, unknown>;
			const key = typeof extra.key === "string" ? extra.key.trim() : "";
			if (key) {
				stateKeys.add(key);
			}
		}
		for (const key of stateKeys) {
			tokens.push({ token: `{{state.${key}}}`, label: "run state" });
		}
		tokens.push({ token: "{{trigger.}}", label: "trigger field (add path)" });
		return tokens;
	}, [nodes]);

	const selectedNode = selectedNodeId
		? nodes.find((n) => n.id === selectedNodeId)
		: null;
	const selectedNodeData = selectedNode
		? (selectedNode.data as CanvasNodeData)
		: null;

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
						className="workflow-controls"
						orientation="horizontal"
						position="bottom-center"
						showInteractive={false}
					/>
					<Background gap={20} size={1} />

					{/* Floating title — name + description, borderless */}
					<Panel position="top-left">
						<div className="flex w-56 flex-col rounded-xl bg-popover/80 px-3 py-1.5 ring-1 ring-white/10 backdrop-blur">
							<Input
								aria-label="Workflow name"
								className="h-6 border-0 bg-transparent p-0 font-semibold text-sm shadow-none focus-visible:ring-0"
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
						</div>
					</Panel>

					{/* Floating actions — Add / Run / Save */}
					<Panel position="top-right">
						<div className="flex items-center gap-1 rounded-full bg-popover/90 p-1 shadow-lg ring-1 ring-white/10 backdrop-blur">
							{saveError ? (
								<span className="px-2 text-destructive text-xs" role="alert">
									{saveError}
								</span>
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
							<NodeConfigPanel
								agents={agentOptions}
								onChange={(v) => handleNodeConfigChange(selectedNodeId, v)}
								onDelete={() => handleDeleteNode(selectedNodeId)}
								value={{
									coreType: selectedNodeData.coreType,
									label: selectedNodeData.label,
									extra:
										(selectedNodeData.extra as Record<string, unknown>) ?? {},
								}}
								variables={variableTokens}
								workflows={pickableWorkflows}
							/>
						</Panel>
					) : null}

					{/* Run panel */}
					{showRun ? (
						<Panel position="bottom-right">
							<RunPanel
								inputKeys={inputKeys}
								onClose={() => setShowRun(false)}
								onRun={handleRun}
								result={runResult}
								runError={runError}
								running={running}
							/>
						</Panel>
					) : null}
				</ReactFlow>
			</div>
		</div>
	);
}
