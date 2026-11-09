import { describe, expect, test } from "bun:test";
import type { Edge } from "@xyflow/react";
import { canvasToDefinition } from "./WorkflowCanvas.tsx";
import type { CanvasWorkflowNode } from "./workflow-serialization.ts";
import { workflowToCanvas } from "./workflow-serialization.ts";

describe("workflow canvas serialization", () => {
	test("round-trips node extras, edge branches, and drops bare manual triggers", () => {
		const nodes: CanvasWorkflowNode[] = [
			{
				id: "prompt-1",
				position: { x: 0, y: 0 },
				data: {
					coreType: "prompt",
					label: "prompt-1",
					extra: { prompt: "Say hi" },
				},
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

	test("round-trips a percentage NotifyUser approval rule", () => {
		const definition = canvasToDefinition(
			"Review",
			"",
			[
				{
					id: "notify",
					position: { x: 0, y: 0 },
					data: {
						coreType: "notify_user",
						label: "approval",
						extra: {
							target: { kind: "members", user_ids: ["u1", "u2", "u3"] },
							ack_mode: { mode: "percentage", percent: 50 },
						},
					},
				},
			],
			[],
			[{ type: "manual" }]
		);

		expect(definition.nodes[0]).toMatchObject({
			target: { kind: "members", user_ids: ["u1", "u2", "u3"] },
			ack_mode: { mode: "percentage", percent: 50 },
		});
	});

	test("renders workflow connections as direct straight edges", () => {
		const { edges } = workflowToCanvas({
			edges: [{ from: "input", to: "output" }],
			id: "demo",
			name: "Demo",
			nodes: [
				{ id: "input", type: "input" },
				{ id: "output", type: "output" },
			],
			triggers: [{ type: "manual" }],
		});

		expect(edges[0]).toMatchObject({
			source: "input",
			target: "output",
			type: "straight",
		});
	});
});
