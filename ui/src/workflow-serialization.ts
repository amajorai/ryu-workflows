import { type Edge, MarkerType, type Node } from "@xyflow/react";
import type { Workflow, WorkflowTrigger } from "./bridge.ts";
import {
	parseNodeText,
	type WorkflowDefinition,
	workflowPositionsSchema,
} from "./schemas.ts";
import type { CanvasNodeData } from "./workflow-model.tsx";

const POSITIONS_KEY_PREFIX = "ryu:workflow:positions:";

export function normalizedWorkflowJson(obj: WorkflowDefinition): string {
	return JSON.stringify(
		{
			name: obj.name ?? "",
			description: obj.description ?? "",
			triggers: obj.triggers ?? [],
			max_concurrency: obj.max_concurrency ?? null,
			nodes: obj.nodes ?? [],
			edges: obj.edges ?? [],
		},
		null,
		2
	);
}

function loadPositions(
	workflowId: string
): Record<string, { x: number; y: number }> {
	try {
		const raw = localStorage.getItem(`${POSITIONS_KEY_PREFIX}${workflowId}`);
		return raw ? workflowPositionsSchema.parse(JSON.parse(raw)) : {};
	} catch {
		return {};
	}
}

/** Persist only the UI coordinates; a sandboxed companion may not have storage. */
export function savePositions(workflowId: string, nodes: Node[]): void {
	const positions: Record<string, { x: number; y: number }> = {};
	for (const node of nodes) {
		positions[node.id] = node.position;
	}
	try {
		localStorage.setItem(
			`${POSITIONS_KEY_PREFIX}${workflowId}`,
			JSON.stringify(positions)
		);
	} catch {
		// Position persistence is a best-effort nicety in a null-origin frame.
	}
}

interface AutoPositionResult {
	x: number;
	y: number;
}

function autoPosition(index: number): AutoPositionResult {
	const column = index % 4;
	const row = Math.floor(index / 4);
	return { x: column * 220, y: row * 100 };
}

export type CanvasWorkflowNode = Node<CanvasNodeData>;

/** Convert React Flow state back to Core's user-editable workflow definition. */
export function canvasToDefinition(
	name: string,
	description: string,
	rfNodes: CanvasWorkflowNode[],
	rfEdges: Edge[],
	triggers: WorkflowTrigger[],
	maxConcurrency: number | null = null
): WorkflowDefinition {
	const definition: WorkflowDefinition = {
		id: "",
		name,
		description: description || undefined,
		nodes: rfNodes.map((node) => {
			const data = node.data;
			const extra = data.extra ?? {};
			return { ...extra, id: node.id, type: data.coreType };
		}),
		edges: rfEdges.map((edge) => ({
			from: edge.source,
			to: edge.target,
			branch: parseNodeText(edge.label) ?? undefined,
		})),
		triggers: triggers.filter((trigger) => trigger.type !== "manual"),
	};
	// Core's per-run node concurrency; absent keeps Core's default.
	if (maxConcurrency !== null) {
		definition.max_concurrency = maxConcurrency;
	}
	return definition;
}

interface WorkflowToCanvasResult {
	edges: Edge[];
	nodes: CanvasWorkflowNode[];
}

/** Convert a Core workflow into React Flow state without coercing unknown nodes. */
export function workflowToCanvas(workflow: Workflow): WorkflowToCanvasResult {
	const positions = loadPositions(workflow.id);
	const nodes: CanvasWorkflowNode[] = workflow.nodes.map((coreNode, index) => {
		const coreType = coreNode.type;
		const position = positions[coreNode.id] ?? autoPosition(index);
		const { type: _type, id: _id, ...extra } = coreNode;
		return {
			id: coreNode.id,
			type: "canvasNode",
			position,
			data: { coreType, label: coreNode.id, extra },
		};
	});
	const edges: Edge[] = workflow.edges.map((edge, index) => ({
		id: `e-${edge.from}-${edge.to}-${index}`,
		source: edge.from,
		target: edge.to,
		label: edge.branch ?? undefined,
		markerEnd: { type: MarkerType.ArrowClosed },
		type: "straight",
	}));
	return { nodes, edges };
}
