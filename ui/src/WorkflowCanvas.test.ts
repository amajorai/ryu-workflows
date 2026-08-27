import { describe, expect, test } from "bun:test";
import type { Edge, Node } from "@xyflow/react";
import { canvasToDefinition } from "./WorkflowCanvas.tsx";

describe("workflow canvas serialization", () => {
	test("round-trips node extras, edge branches, and drops bare manual triggers", () => {
		const nodes: Node[] = [
			{
				id: "prompt-1",
				position: { x: 0, y: 0 },
				data: { coreType: "prompt", extra: { prompt: "Say hi" } },
			},
		];
		const edges: Edge[] = [
			{ id: "edge-1", source: "prompt-1", target: "output-1", label: "yes" },
		];

		const definition = canvasToDefinition("Demo", "A workflow", nodes, edges, [
			{ type: "manual" },
			{ type: "webhook", secret: "s" },
		]);

		expect(definition.nodes).toEqual([
			{ id: "prompt-1", type: "prompt", prompt: "Say hi" },
		]);
		expect(definition.edges).toEqual([
			{ from: "prompt-1", to: "output-1", branch: "yes" },
		]);
		expect(definition.triggers).toEqual([{ type: "webhook", secret: "s" }]);
	});
});
