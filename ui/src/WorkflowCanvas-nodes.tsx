import { ZapIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@ryu/blocks/companion/controls";
import { Handle, type NodeTypes, Position } from "@xyflow/react";
import type { WorkflowTrigger } from "./bridge.ts";
import { codeNodeSummary } from "./code-node-model.ts";
import {
	parseNodeRecord,
	parseNodeText,
	type WorkflowJsonRecord,
} from "./schemas.ts";
import {
	type CanvasNodeData,
	nodeMeta,
	nodeRingClass,
	STATUS_RING,
	statusBadgeVariant,
} from "./workflow-model.tsx";

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
export const TRIGGER_NODE_ID = "__trigger__";
export const TRIGGER_NODE_POSITION = { x: 0, y: -110 } as const;

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

export const NODE_TYPES: NodeTypes = {
	canvasNode: CanvasNode,
	triggerNode: TriggerNode,
};

// Stable references for React Flow props. React Flow subscribes to its internal
// store via useSyncExternalStore and re-derives from these; passing fresh object
// literals every render can churn the snapshot ("getSnapshot should be cached")
// and spin into an update loop. Hoisting them keeps the identity stable.
export const PRO_OPTIONS = { hideAttribution: true } as const;
export const FIT_VIEW_OPTIONS = { maxZoom: 1, padding: 0.25 } as const;
