import {
	type NodeFieldUpdateValue,
	parseNodeNumber,
	parseNodeRecord,
	parseNodeText,
	type WorkflowJsonRecord,
} from "./schemas.ts";
// apps/desktop/src/components/workflows/WorkflowCanvas.tsx
//
// React Flow canvas for the WorkflowsPage. Each NodeKind variant from Core
// (apps/core/src/workflow/mod.rs, serde tag="type", rename_all="snake_case")
// maps to a distinct node colour and icon in the palette. Serialization note:
// Core flattens NodeKind onto WorkflowNode via #[serde(flatten)], so the wire
// shape is {id, type, ...kindFields}. React Flow node position is UI-only and
// is persisted to localStorage keyed by workflow id; on reload the graph
// topology is reconstructed from Core and positions are restored from
// localStorage (or auto-laid-out when absent).
//
// Spike result: @xyflow/react v12 (React 19 compatible) renders correctly in
// Tauri's webview via the Vite bundle. No issues with Tailwind v4 or the ESM
// build. @xyflow/react/dist/base.css is imported in index.css for minimal
// required styles; Tailwind classes override visual styling. AI SDK Elements
// does not expose a workflow/DAG canvas primitive; React Flow is the correct
// choice for this surface.

import {
	Button,
	Input,
	Label,
	ToggleGroup,
	ToggleGroupItem,
} from "@ryu/blocks/companion/controls";
import { useLiteralMessages } from "@ryu/i18n/react";
import type { ChangeEvent } from "react";

export type {
	AgentOption,
	NodeConfigValue,
	VariableToken,
	WorkflowOption,
} from "./node-config-model.ts";

import { TemplateField, WorkflowPicker } from "./node-config-agent.tsx";
import type {
	NodeConfigValue,
	VariableToken,
	WorkflowOption,
} from "./node-config-model.ts";

const MAX_WHILE_ITERATIONS = 100;

/** Config fields for a While node. Two real modes, switched by whether a loop
 *  body workflow is set:
 *   - **Loop** (body set): re-runs the body workflow while the condition holds
 *     against the carried value, up to a (capped) iteration limit.
 *   - **Gate** (no body): a one-shot Condition-style branch — takes the `true`
 *     edge when the condition holds, evaluated at most once.
 *  Core supports both (apps/core/src/workflow/executor.rs); this exposes the
 *  loop body + iteration cap the canvas previously hid. */
export function WhileFields({
	value,
	update,
	variables,
	workflows,
}: {
	update: (key: string, val: NodeFieldUpdateValue) => void;
	value: NodeConfigValue;
	variables: VariableToken[];
	workflows: WorkflowOption[];
}) {
	// Loop vs gate is distinguished by the *presence* of body_workflow_id, not its
	// value: a present-but-empty string ("") means "loop mode selected, body not
	// picked yet" so the picker stays visible. Gate mode is the field being absent
	// (null), which Core reads as `None` → the one-shot branch gate.
	const bodyRaw = parseNodeText(value.extra.body_workflow_id);
	const isLoop = bodyRaw != null;
	const bodyId = bodyRaw ?? "";
	const maxIter = parseNodeNumber(value.extra.max_iterations);
	const tl = useLiteralMessages();
	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label
					className="text-muted-foreground text-xs"
					htmlFor="cfg-while-mode"
				>
					Mode
				</Label>
				<ToggleGroup
					id="cfg-while-mode"
					onValueChange={(values: string[]) => {
						const value = values.at(-1);
						// Switching to gate clears the body; switching to loop seeds an
						// empty body so the picker shows (the user then selects one).
						if (value === "gate") {
							update("body_workflow_id", null);
						} else if (value === "loop" && !isLoop) {
							update("body_workflow_id", "");
						}
					}}
					value={[isLoop ? "loop" : "gate"]}
					variant="outline"
				>
					<ToggleGroupItem value="gate">One-shot gate</ToggleGroupItem>
					<ToggleGroupItem value="loop">Loop</ToggleGroupItem>
				</ToggleGroup>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-while-expr">
					{isLoop ? "Repeat while" : "Condition"}
				</Label>
				<TemplateField
					className="h-16 font-mono text-xs"
					id="cfg-while-expr"
					onChange={(next) => update("expr", next)}
					value={parseNodeText(value.extra.expr) ?? ""}
					variables={variables}
				/>
				<p className="text-muted-foreground text-xs">
					{isLoop
						? "Evaluated against the carried value each pass (the input keyword is the carry, e.g. input < 10). Supports == != contains starts_with ends_with empty nonempty, and numeric < > <= >=."
						: "Takes the true branch when the condition holds; evaluated once. Supports == != contains starts_with ends_with empty nonempty, and numeric < > <= >=."}
				</p>
			</div>
			{isLoop ? (
				<>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cfg-while-body">Loop body workflow</Label>
						<WorkflowPicker
							id="cfg-while-body"
							onChange={(wfId) => update("body_workflow_id", wfId || "")}
							value={bodyId}
							workflows={workflows}
						/>
						<p className="text-muted-foreground text-xs">
							Each pass runs this workflow; its output becomes the next pass's
							input. Save the workflow first so it can be picked.
						</p>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cfg-while-max">Max iterations</Label>
						<Input
							id="cfg-while-max"
							max={MAX_WHILE_ITERATIONS}
							min={1}
							onChange={(e: ChangeEvent<HTMLInputElement>) => {
								const n = Number(e.target.value);
								update(
									"max_iterations",
									e.target.value && n > 0 ? n : undefined
								);
							}}
							placeholder={tl("default {MAX_WHILE_ITERATIONS}", {
								MAX_WHILE_ITERATIONS,
							})}
							type="number"
							value={maxIter == null ? "" : String(maxIter)}
						/>
						<p className="text-muted-foreground text-xs">
							{tl(
								"Safety cap on passes (max {MAX_WHILE_ITERATIONS}). The loop also exits as soon as the condition is false.",
								{ MAX_WHILE_ITERATIONS }
							)}
						</p>
					</div>
				</>
			) : null}
		</>
	);
}

const MAX_FANOUT_CONCURRENCY = 16;

/** Shared "how many at once" input for the fan-out nodes. */
function FanoutConcurrencyField({
	id,
	update,
	value,
}: {
	id: string;
	update: (key: string, val: NodeFieldUpdateValue) => void;
	value: NodeConfigValue;
}) {
	const current = parseNodeNumber(value.extra.max_concurrency);
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>Run at once</Label>
			<Input
				id={id}
				max={MAX_FANOUT_CONCURRENCY}
				min={1}
				onChange={(e: ChangeEvent<HTMLInputElement>) => {
					const n = Number(e.target.value);
					update(
						"max_concurrency",
						e.target.value && n > 0
							? Math.min(n, MAX_FANOUT_CONCURRENCY)
							: undefined
					);
				}}
				placeholder="default 4"
				type="number"
				value={current == null ? "" : String(current)}
			/>
		</div>
	);
}

/** Config fields for a For each node: the body workflow, the array to map
 *  over, and how many items run at once. */
export function ForEachFields({
	value,
	update,
	variables,
	workflows,
}: {
	update: (key: string, val: NodeFieldUpdateValue) => void;
	value: NodeConfigValue;
	variables: VariableToken[];
	workflows: WorkflowOption[];
}) {
	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-each-body">Workflow per item</Label>
				<WorkflowPicker
					id="cfg-each-body"
					onChange={(wfId) => update("body_workflow_id", wfId || "")}
					value={parseNodeText(value.extra.body_workflow_id) ?? ""}
					workflows={workflows}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-each-items">Items</Label>
				<TemplateField
					className="h-12 font-mono text-xs"
					id="cfg-each-items"
					onChange={(next) => update("items", next || undefined)}
					value={parseNodeText(value.extra.items) ?? "{{input}}"}
					variables={variables}
				/>
				<p className="text-muted-foreground text-xs">
					Must resolve to a JSON array. Each item runs the workflow with input
					set to the item; the results come back as an array in the same order.
				</p>
			</div>
			<FanoutConcurrencyField
				id="cfg-each-concurrency"
				update={update}
				value={value}
			/>
		</>
	);
}

interface ParallelBranchRow {
	id: string;
	input?: string;
	workflow_id: string;
}

function parseBranchRows(raw: NodeFieldUpdateValue): ParallelBranchRow[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const rows: ParallelBranchRow[] = [];
	for (const entry of raw) {
		const record = parseNodeRecord(entry);
		if (!record) {
			continue;
		}
		const row: ParallelBranchRow = {
			id: parseNodeText(record.id) ?? "",
			workflow_id: parseNodeText(record.workflow_id) ?? "",
		};
		const input = parseNodeText(record.input);
		if (input) {
			row.input = input;
		}
		rows.push(row);
	}
	return rows;
}

/** Config fields for a Parallel node: one row per branch (id + workflow). */
export function ParallelFields({
	value,
	update,
	workflows,
}: {
	update: (key: string, val: NodeFieldUpdateValue) => void;
	value: NodeConfigValue;
	workflows: WorkflowOption[];
}) {
	const rows = parseBranchRows(value.extra.branches);
	const write = (next: ParallelBranchRow[]) =>
		update(
			"branches",
			next.map((row) => {
				const branch: WorkflowJsonRecord = {
					id: row.id,
					workflow_id: row.workflow_id,
				};
				if (row.input) {
					branch.input = row.input;
				}
				return branch;
			})
		);
	return (
		<>
			<div className="flex flex-col gap-2">
				<Label>Branches</Label>
				{rows.map((row, index) => (
					<div
						className="flex flex-col gap-1 rounded-lg p-1.5 ring-1 ring-border"
						key={`branch-${index.toString()}`}
					>
						<Input
							aria-label="Branch id"
							onChange={(e: ChangeEvent<HTMLInputElement>) =>
								write(
									rows.map((r, i) =>
										i === index
											? { ...r, id: e.target.value.replace(/[^\w-]/g, "") }
											: r
									)
								)
							}
							placeholder="branch_id"
							value={row.id}
						/>
						<WorkflowPicker
							id={`cfg-par-wf-${index.toString()}`}
							onChange={(wfId) =>
								write(
									rows.map((r, i) =>
										i === index ? { ...r, workflow_id: wfId || "" } : r
									)
								)
							}
							value={row.workflow_id}
							workflows={workflows}
						/>
						<Button
							onClick={() => write(rows.filter((_, i) => i !== index))}
							size="sm"
							type="button"
							variant="ghost"
						>
							Remove
						</Button>
					</div>
				))}
				<Button
					onClick={() =>
						write([
							...rows,
							{ id: `branch_${(rows.length + 1).toString()}`, workflow_id: "" },
						])
					}
					size="sm"
					type="button"
					variant="outline"
				>
					Add branch
				</Button>
				<p className="text-muted-foreground text-xs">
					Every branch receives the node input. The output is a JSON object
					keyed by branch id.
				</p>
			</div>
			<FanoutConcurrencyField
				id="cfg-par-concurrency"
				update={update}
				value={value}
			/>
		</>
	);
}

export {
	RELIABILITY_KINDS,
	ReliabilityFields,
	type ReliabilityFieldsProps,
} from "./node-config-control-reliability.tsx";
export {
	LOOP_VARIABLE_TOKENS,
	REPEAT_KINDS,
	RepeatFields,
} from "./node-config-control-repeat.tsx";
