import { useMemo } from "react";
import type { VariableToken } from "./node-config.tsx";
import { LOOP_VARIABLE_TOKENS } from "./node-config-control.tsx";
import { parseNodeText } from "./schemas.ts";
import type { CanvasWorkflowNode } from "./workflow-serialization.ts";

/** Variable tokens offered by the per-field "Insert variable" menu. */
export function useVariableTokens(
	nodes: CanvasWorkflowNode[],
	selectedNodeId: string | null
): VariableToken[] {
	// Variable tokens offered by the per-field "Insert variable" menu: the live
	// input, every node id as an upstream-output ref, any state keys declared by
	// SetState nodes, and a trigger-field hint. No autocomplete engine — just a
	// menu sourced from the current graph.
	return useMemo<VariableToken[]>(() => {
		const tokens: VariableToken[] = [
			{ token: "{{input}}", label: "incoming value" },
		];
		for (const n of nodes) {
			tokens.push({ token: `{{nodes.${n.id}}}`, label: "node output" });
		}
		const stateKeys = new Set<string>();
		for (const n of nodes) {
			const d = n.data;
			if (d.coreType !== "set_state") {
				continue;
			}
			const extra = d.extra ?? {};
			const key = parseNodeText(extra.key)?.trim() ?? "";
			if (key) {
				stateKeys.add(key);
			}
		}
		for (const key of stateKeys) {
			tokens.push({ token: `{{state.${key}}}`, label: "run state" });
		}
		tokens.push({ token: "{{trigger.}}", label: "trigger field (add path)" });
		const selected = nodes.find((n) => n.id === selectedNodeId);
		if (selected?.data.extra?.repeat != null) {
			tokens.push(...LOOP_VARIABLE_TOKENS);
		}
		return tokens;
	}, [nodes, selectedNodeId]);
}
