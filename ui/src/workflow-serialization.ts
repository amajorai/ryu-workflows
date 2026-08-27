import { type Edge, MarkerType, type Node } from "@xyflow/react";
import type { Workflow, WorkflowTrigger } from "./bridge.ts";
import type { CanvasNodeData, CoreNodeType } from "./workflow-model.tsx";

const POSITIONS_KEY_PREFIX = "ryu:workflow:positions:";

export function normalizedWorkflowJson(obj: Record<string, unknown>): string {
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

function autoPosition(index: number): { x: number; y: number } {
	const column = index % 4;
	const row = Math.floor(index / 4);
	return { x: column * 220, y: row * 100 };
}

/** Convert React Flow state back to Core's user-editable workflow definition. */
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
		id: "",
		name,
		description: description || undefined,
		nodes: rfNodes.map((node) => {
			const data = node.data as CanvasNodeData;
			const extra = (data.extra ?? {}) as Record<string, unknown>;
			return { id: node.id, type: data.coreType, ...extra };
		}),
		edges: rfEdges.map((edge) => ({
			from: edge.source,
			to: edge.target,
			branch: (edge.label as string | undefined) ?? undefined,
		})),
		triggers: triggers.filter((trigger) => trigger.type !== "manual"),
	};
}

/** Convert a Core workflow into React Flow state without coercing unknown nodes. */
export function workflowToCanvas(workflow: Workflow): {
	nodes: Node[];
	edges: Edge[];
} {
	const positions = loadPositions(workflow.id);
	const nodes: Node[] = workflow.nodes.map((coreNode, index) => {
		const coreType = coreNode.type as CoreNodeType;
		const position = positions[coreNode.id] ?? autoPosition(index);
		const {
			type: _type,
			id: _id,
			...extra
		} = coreNode as Record<string, unknown>;
		return {
			id: coreNode.id,
			type: "canvasNode",
			position,
			data: { coreType, label: coreNode.id, extra } as CanvasNodeData,
		};
	});
	const edges: Edge[] = workflow.edges.map((edge, index) => ({
		id: `e-${edge.from}-${edge.to}-${index}`,
		source: edge.from,
		target: edge.to,
		label: edge.branch ?? undefined,
		markerEnd: { type: MarkerType.ArrowClosed },
		type: "smoothstep",
	}));
	return { nodes, edges };
}
