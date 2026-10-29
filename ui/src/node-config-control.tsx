import {
	type NodeFieldUpdateValue,
	parseNodeNumber,
	parseNodeRecord,
	parseNodeStrings,
	parseNodeText,
	patchNodeConfiguration,
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
	Switch,
	ToggleGroup,
	ToggleGroupItem,
} from "@ryu/blocks/companion/controls";
import { type ChangeEvent, useCallback } from "react";

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
							placeholder={`default ${MAX_WHILE_ITERATIONS}`}
							type="number"
							value={maxIter == null ? "" : String(maxIter)}
						/>
						<p className="text-muted-foreground text-xs">
							Safety cap on passes (max {MAX_WHILE_ITERATIONS}). The loop also
							exits as soon as the condition is false.
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

// Default Temporal-style retry policy applied when a node first opts into
// retries. Mirrors the Core `RetryPolicy` defaults (apps/core/src/workflow/mod.rs)
// except `max_attempts`, which jumps to 3 here since toggling retries on with a
// budget of 1 would be a no-op.
const DEFAULT_RETRY_POLICY = {
	max_attempts: 3,
	initial_interval_ms: 100,
	backoff_coefficient: 2,
	max_interval_ms: 60_000,
	jitter_fraction: 0,
	non_retryable_errors: [],
};

// Node kinds where a retry policy / timeout is meaningful (they make external
// calls or can fail/hang). Pure or trivial nodes (input/output/note/condition/
// transform/set_state) and the suspend gate (awakeable, never retried) are
// omitted so the panel stays honest.
export const RELIABILITY_KINDS = new Set<string>([
	"prompt",
	"tool",
	"webhook",
	"agent_delegate",
	"script",
	"ghost_action",
	"recipe",
	"sub_workflow",
	"for_each",
	"parallel",
	"guardrails",
	"delay",
	"while",
	"agent",
	"skill",
	"mcp",
	"plugin",
	"code",
]);

interface ReliabilityFieldsProps {
	onChange: (next: NodeConfigValue) => void;
	value: NodeConfigValue;
}

// A shared "Reliability" section (retry policy + per-attempt timeout) rendered
// below a node's kind-specific fields. Writes `retry` and `timeout_ms` straight
// into `extra`, which the canvas serialises verbatim onto the WorkflowNode.
export function ReliabilityFields({ value, onChange }: ReliabilityFieldsProps) {
	const setExtra = useCallback(
		(key: string, val: NodeFieldUpdateValue) => {
			onChange({
				...value,
				extra: patchNodeConfiguration(value.extra, key, val),
			});
		},
		[value, onChange]
	);
	const retry = parseNodeRecord(value.extra.retry);
	const retryEnabled = retry != null;
	const setRetryField = useCallback(
		(key: string, val: NodeFieldUpdateValue) => {
			setExtra("retry", {
				...DEFAULT_RETRY_POLICY,
				...retry,
				[key]: val,
			});
		},
		[retry, setExtra]
	);
	const numRetry = (key: string, fallback: number) =>
		parseNodeNumber(retry?.[key]) ?? fallback;
	const timeoutMs = parseNodeNumber(value.extra.timeout_ms);

	return (
		<div className="flex flex-col gap-2 border-white/10 border-t pt-3">
			<div className="flex items-center justify-between">
				<Label
					className="text-muted-foreground text-xs"
					htmlFor="cfg-retry-toggle"
				>
					Retry on failure
				</Label>
				<Switch
					checked={retryEnabled}
					id="cfg-retry-toggle"
					onCheckedChange={(on) =>
						setExtra("retry", on ? { ...DEFAULT_RETRY_POLICY } : undefined)
					}
				/>
			</div>
			{retryEnabled ? (
				<div className="flex flex-col gap-2 rounded-lg bg-black/10 p-2">
					<div className="grid grid-cols-2 gap-2">
						<div className="flex flex-col gap-1">
							<Label className="text-xs" htmlFor="cfg-retry-max">
								Max attempts
							</Label>
							<Input
								id="cfg-retry-max"
								min={1}
								onChange={(e: ChangeEvent<HTMLInputElement>) =>
									setRetryField("max_attempts", Number(e.target.value) || 1)
								}
								type="number"
								value={String(numRetry("max_attempts", 3))}
							/>
						</div>
						<div className="flex flex-col gap-1">
							<Label className="text-xs" htmlFor="cfg-retry-init">
								Initial backoff (ms)
							</Label>
							<Input
								id="cfg-retry-init"
								min={0}
								onChange={(e: ChangeEvent<HTMLInputElement>) =>
									setRetryField(
										"initial_interval_ms",
										Number(e.target.value) || 0
									)
								}
								type="number"
								value={String(numRetry("initial_interval_ms", 100))}
							/>
						</div>
						<div className="flex flex-col gap-1">
							<Label className="text-xs" htmlFor="cfg-retry-coeff">
								Backoff ×
							</Label>
							<Input
								id="cfg-retry-coeff"
								min={1}
								onChange={(e: ChangeEvent<HTMLInputElement>) =>
									setRetryField(
										"backoff_coefficient",
										Number(e.target.value) || 1
									)
								}
								step={0.1}
								type="number"
								value={String(numRetry("backoff_coefficient", 2))}
							/>
						</div>
						<div className="flex flex-col gap-1">
							<Label className="text-xs" htmlFor="cfg-retry-maxint">
								Max backoff (ms)
							</Label>
							<Input
								id="cfg-retry-maxint"
								min={0}
								onChange={(e: ChangeEvent<HTMLInputElement>) =>
									setRetryField("max_interval_ms", Number(e.target.value) || 0)
								}
								type="number"
								value={String(numRetry("max_interval_ms", 60_000))}
							/>
						</div>
					</div>
					<div className="flex flex-col gap-1">
						<Label className="text-xs" htmlFor="cfg-retry-jitter">
							Jitter (0–1)
						</Label>
						<Input
							id="cfg-retry-jitter"
							max={1}
							min={0}
							onChange={(e: ChangeEvent<HTMLInputElement>) =>
								setRetryField("jitter_fraction", Number(e.target.value) || 0)
							}
							step={0.05}
							type="number"
							value={String(numRetry("jitter_fraction", 0))}
						/>
					</div>
					<div className="flex flex-col gap-1">
						<Label className="text-xs" htmlFor="cfg-retry-nonretry">
							Non-retryable errors
						</Label>
						<Input
							id="cfg-retry-nonretry"
							onChange={(e: ChangeEvent<HTMLInputElement>) =>
								setRetryField(
									"non_retryable_errors",
									e.target.value
										.split(",")
										.map((s) => s.trim())
										.filter(Boolean)
								)
							}
							placeholder="comma,separated,substrings"
							value={(parseNodeStrings(retry?.non_retryable_errors) ?? []).join(
								", "
							)}
						/>
						<p className="text-muted-foreground text-xs">
							Error substrings that fail immediately without retrying.
						</p>
					</div>
				</div>
			) : null}
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-timeout">Timeout (ms)</Label>
				<Input
					id="cfg-timeout"
					min={0}
					onChange={(e: ChangeEvent<HTMLInputElement>) =>
						setExtra(
							"timeout_ms",
							e.target.value ? Number(e.target.value) : undefined
						)
					}
					placeholder="(unbounded)"
					type="number"
					value={timeoutMs == null ? "" : String(timeoutMs)}
				/>
				<p className="text-muted-foreground text-xs">
					Per-attempt wall-clock limit. A timeout retries when a policy is set.
				</p>
			</div>
		</div>
	);
}

const MAX_REPEAT_ITERATIONS = 100;

// Node kinds that may carry a `repeat` policy. Core rejects it on gates that
// suspend for a human (awakeable, acknowledged notify_user), on branchers
// (condition), and on while (already a loop); input/output/note gain nothing
// from it. Mirrors `validate_repeat` in apps/core/src/workflow/mod.rs.
export const REPEAT_KINDS = new Set<string>([
	"prompt",
	"agent",
	"skill",
	"tool",
	"mcp",
	"plugin",
	"webhook",
	"transform",
	"sub_workflow",
	"agent_delegate",
	"recipe",
	"ghost_action",
	"channel_send",
	"code",
]);

// Template tokens Core exposes inside a repeating step.
export const LOOP_VARIABLE_TOKENS = [
	{ token: "{{loop.iteration}}", label: "repeat iteration (1-based)" },
	{ token: "{{loop.previous}}", label: "previous iteration output" },
	{ token: "{{loop.original}}", label: "step's original input" },
];

// A "Repeat" section that writes the Core `RepeatPolicy` into `extra.repeat`:
// re-run this one step a set number of times, while/until a condition holds on
// its latest output, or until the output stops changing.
export function RepeatFields({ value, onChange }: ReliabilityFieldsProps) {
	const repeat = parseNodeRecord(value.extra.repeat);
	const setRepeat = useCallback(
		(next: NodeFieldUpdateValue) => {
			onChange({
				...value,
				extra: patchNodeConfiguration(value.extra, "repeat", next),
			});
		},
		[value, onChange]
	);
	const setField = useCallback(
		(key: string, val: NodeFieldUpdateValue) => {
			setRepeat(patchNodeConfiguration(repeat ?? {}, key, val));
		},
		[repeat, setRepeat]
	);
	const maxIterations = parseNodeNumber(repeat?.max_iterations);
	const intervalMs = parseNodeNumber(repeat?.interval_ms);
	const feedOutput = repeat?.feed_output !== false;
	const stopWhenUnchanged = repeat?.stop_when_unchanged === true;
	const collect = parseNodeText(repeat?.collect) === "all" ? "all" : "last";
	const conditionField =
		(key: "until" | "while") => (e: ChangeEvent<HTMLInputElement>) =>
			setField(key, e.target.value.trim() ? e.target.value : undefined);

	return (
		<div className="flex flex-col gap-2 border-white/10 border-t pt-3">
			<div className="flex items-center justify-between">
				<Label
					className="text-muted-foreground text-xs"
					htmlFor="cfg-repeat-toggle"
				>
					Repeat step
				</Label>
				<Switch
					checked={repeat != null}
					id="cfg-repeat-toggle"
					onCheckedChange={(on) =>
						setRepeat(on ? { max_iterations: 3 } : undefined)
					}
				/>
			</div>
			{repeat == null ? null : (
				<div className="flex flex-col gap-2 rounded-lg bg-black/10 p-2">
					<div className="grid grid-cols-2 gap-2">
						<div className="flex flex-col gap-1">
							<Label className="text-xs" htmlFor="cfg-repeat-max">
								Max iterations
							</Label>
							<Input
								id="cfg-repeat-max"
								max={MAX_REPEAT_ITERATIONS}
								min={1}
								onChange={(e: ChangeEvent<HTMLInputElement>) => {
									const n = Number(e.target.value);
									setField(
										"max_iterations",
										e.target.value && n > 0 ? n : undefined
									);
								}}
								placeholder={`default ${MAX_REPEAT_ITERATIONS}`}
								type="number"
								value={maxIterations == null ? "" : String(maxIterations)}
							/>
						</div>
						<div className="flex flex-col gap-1">
							<Label className="text-xs" htmlFor="cfg-repeat-interval">
								Pause between (ms)
							</Label>
							<Input
								id="cfg-repeat-interval"
								min={0}
								onChange={(e: ChangeEvent<HTMLInputElement>) =>
									setField(
										"interval_ms",
										e.target.value ? Number(e.target.value) : undefined
									)
								}
								placeholder="0"
								type="number"
								value={intervalMs == null ? "" : String(intervalMs)}
							/>
						</div>
					</div>
					<div className="flex flex-col gap-1">
						<Label className="text-xs" htmlFor="cfg-repeat-until">
							Stop when
						</Label>
						<Input
							className="font-mono text-xs"
							id="cfg-repeat-until"
							onChange={conditionField("until")}
							placeholder='input contains "DONE"'
							value={parseNodeText(repeat.until) ?? ""}
						/>
					</div>
					<div className="flex flex-col gap-1">
						<Label className="text-xs" htmlFor="cfg-repeat-while">
							Continue while
						</Label>
						<Input
							className="font-mono text-xs"
							id="cfg-repeat-while"
							onChange={conditionField("while")}
							placeholder="input < 10"
							value={parseNodeText(repeat.while) ?? ""}
						/>
						<p className="text-muted-foreground text-xs">
							Checked after each pass against that pass's output (the input
							keyword). Same grammar as a Condition node.
						</p>
					</div>
					<div className="flex items-center justify-between">
						<Label className="text-xs" htmlFor="cfg-repeat-feed">
							Feed output into next pass
						</Label>
						<Switch
							checked={feedOutput}
							id="cfg-repeat-feed"
							onCheckedChange={(on) =>
								setField("feed_output", on ? undefined : false)
							}
						/>
					</div>
					<div className="flex items-center justify-between">
						<Label className="text-xs" htmlFor="cfg-repeat-converge">
							Stop when output stops changing
						</Label>
						<Switch
							checked={stopWhenUnchanged}
							id="cfg-repeat-converge"
							onCheckedChange={(on) =>
								setField("stop_when_unchanged", on ? true : undefined)
							}
						/>
					</div>
					<div className="flex flex-col gap-1">
						<Label className="text-xs" htmlFor="cfg-repeat-collect">
							Step output
						</Label>
						<ToggleGroup
							id="cfg-repeat-collect"
							onValueChange={(values: string[]) => {
								const next = values.at(-1);
								setField("collect", next === "all" ? "all" : undefined);
							}}
							value={[collect]}
							variant="outline"
						>
							<ToggleGroupItem value="last">Last pass</ToggleGroupItem>
							<ToggleGroupItem value="all">All passes (JSON)</ToggleGroupItem>
						</ToggleGroup>
						<p className="text-muted-foreground text-xs">
							Inside the step use {"{{loop.iteration}}"}, {"{{loop.previous}}"},
							and {"{{loop.original}}"}.
						</p>
					</div>
				</div>
			)}
		</div>
	);
}
