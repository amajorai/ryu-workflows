import {
	addEdge,
	applyEdgeChanges,
	applyNodeChanges,
	type Connection,
	type Edge,
	type EdgeChange,
	MarkerType,
	type Node,
	type NodeChange,
} from "@xyflow/react";
import { type Dispatch, type SetStateAction, useCallback } from "react";
import type { NodeConfigValue } from "./node-config.tsx";
import { canvasNodeDataSchema } from "./schemas.ts";
import { type CoreNodeType, NODE_META } from "./workflow-model.tsx";
import type { CanvasWorkflowNode } from "./workflow-serialization.ts";

let _nodeCounter = 0;

/** Graph-editing callbacks for the workflow canvas (node/edge changes, palette
 *  adds, config-panel edits, and deletes). */
export function useCanvasGraphHandlers(
	setNodes: Dispatch<SetStateAction<CanvasWorkflowNode[]>>,
	setEdges: Dispatch<SetStateAction<Edge[]>>,
	setSelectedNodeId: Dispatch<SetStateAction<string | null>>
) {
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

	return {
		handleAddNode,
		handleDeleteNode,
		handleNodeConfigChange,
		onConnect,
		onEdgesChange,
		onNodeClick,
		onNodesChange,
		onPaneClick,
	};
}
