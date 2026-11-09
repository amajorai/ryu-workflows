import { describe, expect, test } from "bun:test";
import {
	CODE_STARTERS,
	codeNodeDefaults,
	codeNodeSummary,
	parseCodeLanguage,
	parseCodeMode,
	switchCodeLanguage,
} from "./code-node-model.ts";
import type { WorkflowJsonValue } from "./schemas.ts";
import {
	canvasToDefinition,
	workflowToCanvas,
} from "./workflow-serialization.ts";

describe("code node model", () => {
	test("Lean and Bend take a program input; BAML takes a function and args", () => {
		expect(codeNodeDefaults("lean")).toMatchObject({
			language: "lean",
			mode: "run",
			input: "{{input}}",
			function: null,
			args: null,
		});
		expect(codeNodeDefaults("baml")).toMatchObject({
			language: "baml",
			input: null,
			function: "Summarize",
			args: { text: "{{input}}" },
		});
		expect(CODE_STARTERS.baml).toContain("client Ryu");
	});

	test("unknown wire values fall back to the safe defaults", () => {
		expect(parseCodeLanguage("python")).toBe("lean");
		expect(parseCodeLanguage("bend")).toBe("bend");
		expect(parseCodeMode("prove")).toBe("run");
		expect(parseCodeMode("check")).toBe("check");
	});

	test("switching language swaps an untouched starter but keeps edited source", () => {
		const fresh = switchCodeLanguage(codeNodeDefaults("lean"), "baml");
		expect(fresh.source).toBe(CODE_STARTERS.baml);
		expect(fresh.function).toBe("Summarize");

		const edited = {
			...codeNodeDefaults("lean"),
			mode: "check",
			source: "theorem t : 1 + 1 = 2 := by decide",
		};
		const switched = switchCodeLanguage(edited, "bend");
		expect(switched.source).toBe("theorem t : 1 + 1 = 2 := by decide");
		expect(switched.language).toBe("bend");
		expect(switched.mode).toBe("check");
		expect(switched.input).toBe("{{input}}");
	});

	test("the canvas subtitle names the language and mode", () => {
		expect(codeNodeSummary({ language: "baml", mode: "check" })).toBe(
			"BAML · check"
		);
		expect(codeNodeSummary({})).toBe("Lean 4 · run");
	});

	test("a code node round-trips through canvas editing", () => {
		const nodes: {
			id: string;
			type: string;
			[key: string]: WorkflowJsonValue;
		}[] = [
			{
				id: "prove",
				type: "code",
				language: "bend",
				mode: "check",
				source: CODE_STARTERS.bend,
			},
			{
				id: "extract",
				type: "code",
				language: "baml",
				mode: "run",
				source: CODE_STARTERS.baml,
				function: "Summarize",
				args: { text: "{{nodes.prove}}" },
				model: "gpt-4o-mini",
			},
		];
		const workflow = {
			id: "code-workflow",
			name: "Code",
			nodes,
			edges: [{ from: "prove", to: "extract", branch: null }],
			triggers: [],
		};
		const canvas = workflowToCanvas(workflow);
		expect(
			canvasToDefinition(workflow.name, "", canvas.nodes, canvas.edges, [])
				.nodes
		).toEqual(workflow.nodes);
	});
});
