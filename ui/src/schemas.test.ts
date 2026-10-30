import { describe, expect, test } from "bun:test";
import {
	ghostRecordingStopSchema,
	parseDelegateRows,
	patchNodeConfiguration,
	type RecordingStopResult,
	workflowDefinitionSchema,
	workflowRunSchema,
} from "./schemas.ts";
import {
	canvasToDefinition,
	workflowToCanvas,
} from "./workflow-serialization.ts";

describe("workflow boundary compatibility", () => {
	test("future node kinds retain their configuration through canvas editing", () => {
		const workflow = {
			id: "future-workflow",
			name: "Future Core workflow",
			nodes: [
				{
					id: "future",
					type: "future_core_kind",
					nested: { selected: ["one", 2, true, null] },
				},
			],
			edges: [],
			triggers: [],
		};
		const canvas = workflowToCanvas(workflow);
		expect(
			canvasToDefinition(workflow.name, "", canvas.nodes, canvas.edges, [])
				.nodes
		).toEqual(workflow.nodes);
	});
	test("legacy delegates keep presets and default an omitted agent to the host model", () => {
		expect(
			parseDelegateRows([
				{
					id: "delegate",
					task: "Review",
					preset: "code_read",
					future_setting: { enabled: true },
				},
			])
		).toEqual([
			{
				id: "delegate",
				task: "Review",
				agent_id: null,
				preset: "code_read",
				future_setting: { enabled: true },
			},
		]);
	});

	test("legacy definitions without edge and trigger arrays remain editable", () => {
		expect(
			workflowDefinitionSchema.parse({ name: "Legacy", nodes: [] })
		).toEqual({ name: "Legacy", nodes: [], edges: [], triggers: [] });
	});
	test("clearing optional configuration removes its wire key and preserves unrelated fields", () => {
		expect(
			patchNodeConfiguration(
				{ timeout_ms: 42, future_setting: { enabled: true } },
				"timeout_ms",
				undefined
			)
		).toEqual({ future_setting: { enabled: true } });
	});
	test("legacy recording replies can omit event counters and captured events", () => {
		const reply: RecordingStopResult = {
			recording: false,
			started_at: "now",
			task: "Legacy task",
		};
		expect(ghostRecordingStopSchema.parse(reply)).toEqual(reply);
	});
	test("malformed run states are rejected before reaching the run panel", () => {
		expect(
			workflowRunSchema.safeParse({
				createdAt: "now",
				updatedAt: "now",
				dryRun: false,
				runId: "run",
				workflowId: "workflow",
				input: {},
				output: {},
				nodes: { agent: { status: "completed", output: 42 } },
				status: "completed",
			}).success
		).toBe(false);
	});
});
