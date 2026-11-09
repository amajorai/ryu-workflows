import type { Node } from "@xyflow/react";
import { useMemo } from "react";
import type { NodeRunState, WorkflowTrigger } from "./bridge.ts";
import {
	TRIGGER_NODE_ID,
	TRIGGER_NODE_POSITION,
} from "./WorkflowCanvas-nodes.tsx";
import type { CanvasWorkflowNode } from "./workflow-serialization.ts";

/** The canvas nodes with run status overlaid and the pinned trigger node
 *  prepended. */
export function useDisplayNodes(
	nodes: CanvasWorkflowNode[],
	runNodes: Record<string, NodeRunState> | undefined,
	trigger: WorkflowTrigger,
	selectedNodeId: string | null
): Node[] {
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
	return useMemo<Node[]>(() => {
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
}
