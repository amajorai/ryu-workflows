import { afterEach, describe, expect, it } from "bun:test";
import type { Edge, Node } from "@xyflow/react";
import type { CanvasWorkflowNode } from "./workflow-serialization.ts";
import {
	canvasToDefinition,
	savePositions,
	workflowToCanvas,
} from "./workflow-serialization.ts";

afterEach(() => {
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		writable: true,
		value: undefined,
	});
});

describe("workflow canvas persistence", () => {
	it("round-trips coordinates across a companion relaunch", () => {
		const values = new Map<string, string>();
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			writable: true,
			value: {
				getItem: (key: string) => values.get(key) ?? null,
				setItem: (key: string, value: string) => values.set(key, value),
			},
		});
		const nodes: Node[] = [
			{
				id: "notify",
				position: { x: 41, y: 82 },
				data: {},
			},
		];
		savePositions("workflow-1", nodes);

		const restored = workflowToCanvas({
			id: "workflow-1",
			name: "Notify",
			nodes: [{ id: "notify", type: "notify_user" }],
			edges: [],
			triggers: [],
		});
		expect(restored.nodes[0]?.position).toEqual({ x: 41, y: 82 });
	});

	it("keeps canvas identity authoritative over untrusted extra fields", () => {
		const nodes: CanvasWorkflowNode[] = [
			{
				id: "authoritative-id",
				position: { x: 0, y: 0 },
				data: {
					coreType: "notify_user",
					label: "authoritative-id",
					extra: {
						id: "spoofed-id",
						type: "run_agent",
						message: "Review this run",
					},
				},
			},
		];
		const edges: Edge[] = [
			{ id: "edge-1", source: "authoritative-id", target: "next" },
		];

		expect(
			canvasToDefinition("Approval", "", nodes, edges, [{ type: "manual" }])
		).toMatchObject({
			nodes: [
				{
					id: "authoritative-id",
					type: "notify_user",
					message: "Review this run",
				},
			],
			edges: [{ from: "authoritative-id", to: "next" }],
			triggers: [],
		});
	});

	it("round-trips a step's repeat policy through the canvas", () => {
		const repeat = {
			max_iterations: 5,
			until: 'input contains "DONE"',
			collect: "all",
		};
		const canvas = workflowToCanvas({
			id: "workflow-repeat",
			name: "Refine",
			nodes: [{ id: "refine", type: "prompt", prompt: "{{input}}", repeat }],
			edges: [],
			triggers: [],
		});
		expect(
			canvasToDefinition("Refine", "", canvas.nodes, canvas.edges, []).nodes
		).toEqual([{ id: "refine", type: "prompt", prompt: "{{input}}", repeat }]);
	});

	it("continues with deterministic positions when sandbox storage is denied", () => {
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			writable: true,
			value: {
				getItem: () => {
					throw new Error("storage denied");
				},
				setItem: () => {
					throw new Error("storage denied");
				},
			},
		});
		expect(() =>
			savePositions("workflow-1", [
				{ id: "node-1", position: { x: 9, y: 9 }, data: {} },
			])
		).not.toThrow();
		expect(
			workflowToCanvas({
				id: "workflow-1",
				name: "Fallback",
				nodes: [{ id: "node-1", type: "run_agent" }],
				edges: [],
				triggers: [],
			}).nodes[0]?.position
		).toEqual({ x: 0, y: 0 });
	});
});

describe("fan-out nodes and run concurrency", () => {
	it("round-trips for_each and parallel nodes and the workflow max_concurrency", () => {
		const canvas = workflowToCanvas({
			id: "workflow-fanout",
			name: "Fan-out",
			max_concurrency: 2,
			nodes: [
				{
					id: "each",
					type: "for_each",
					body_workflow_id: "wf_body",
					items: "{{state.urls}}",
					max_concurrency: 3,
				},
				{
					id: "fan",
					type: "parallel",
					branches: [{ id: "a", workflow_id: "wf_a" }],
				},
			],
			edges: [{ from: "each", to: "fan" }],
			triggers: [],
		});
		const definition = canvasToDefinition(
			"Fan-out",
			"",
			canvas.nodes,
			canvas.edges,
			[],
			2
		);
		expect(definition.max_concurrency).toBe(2);
		expect(definition.nodes).toEqual([
			{
				id: "each",
				type: "for_each",
				body_workflow_id: "wf_body",
				items: "{{state.urls}}",
				max_concurrency: 3,
			},
			{
				id: "fan",
				type: "parallel",
				branches: [{ id: "a", workflow_id: "wf_a" }],
			},
		]);
	});

	it("omits max_concurrency when the canvas leaves Core's default", () => {
		const definition = canvasToDefinition("Plain", "", [], [], []);
		expect("max_concurrency" in definition).toBe(false);
	});
});
