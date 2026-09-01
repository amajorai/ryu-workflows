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
import type { CoreNodeType } from "./workflow-model.tsx";

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
	update: (key: string, val: unknown) => void;
	value: NodeConfigValue;
	variables: VariableToken[];
	workflows: WorkflowOption[];
}) {
	// Loop vs gate is distinguished by the *presence* of body_workflow_id, not its
	// value: a present-but-empty string ("") means "loop mode selected, body not
	// picked yet" so the picker stays visible. Gate mode is the field being absent
	// (null), which Core reads as `None` → the one-shot branch gate.
	const bodyRaw = value.extra.body_workflow_id;
	const isLoop = typeof bodyRaw === "string";
	const bodyId = isLoop ? (bodyRaw as string) : "";
	const maxIter = value.extra.max_iterations as number | null | undefined;
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
					value={(value.extra.expr as string) ?? ""}
					variables={variables}
				/>
				<p className="text-[11px] text-muted-foreground">
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
						<p className="text-[11px] text-muted-foreground">
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
						<p className="text-[11px] text-muted-foreground">
							Safety cap on passes (max {MAX_WHILE_ITERATIONS}). The loop also
							exits as soon as the condition is false.
						</p>
					</div>
				</>
			) : null}
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
	non_retryable_errors: [] as string[],
};

// Node kinds where a retry policy / timeout is meaningful (they make external
// calls or can fail/hang). Pure or trivial nodes (input/output/note/condition/
// transform/set_state) and the suspend gate (awakeable, never retried) are
// omitted so the panel stays honest.
export const RELIABILITY_KINDS = new Set<CoreNodeType>([
	"prompt",
	"tool",
	"webhook",
	"agent_delegate",
	"ghost_action",
	"recipe",
	"sub_workflow",
	"guardrails",
	"delay",
	"while",
	"agent",
	"skill",
	"mcp",
	"plugin",
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
		(key: string, val: unknown) => {
			onChange({ ...value, extra: { ...value.extra, [key]: val } });
		},
		[value, onChange]
	);
	const retry = value.extra.retry as Record<string, unknown> | undefined;
	const retryEnabled = retry != null;
	const setRetryField = useCallback(
		(key: string, val: unknown) => {
			setExtra("retry", {
				...DEFAULT_RETRY_POLICY,
				...(retry ?? {}),
				[key]: val,
			});
		},
		[retry, setExtra]
	);
	const numRetry = (key: string, fallback: number) =>
		(retry?.[key] as number | undefined) ?? fallback;
	const timeoutMs = value.extra.timeout_ms as number | null | undefined;

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
							<Label className="text-[11px]" htmlFor="cfg-retry-max">
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
							<Label className="text-[11px]" htmlFor="cfg-retry-init">
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
							<Label className="text-[11px]" htmlFor="cfg-retry-coeff">
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
							<Label className="text-[11px]" htmlFor="cfg-retry-maxint">
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
						<Label className="text-[11px]" htmlFor="cfg-retry-jitter">
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
						<Label className="text-[11px]" htmlFor="cfg-retry-nonretry">
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
							value={(
								(retry?.non_retryable_errors as string[] | undefined) ?? []
							).join(", ")}
						/>
						<p className="text-[11px] text-muted-foreground">
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
				<p className="text-[11px] text-muted-foreground">
					Per-attempt wall-clock limit. A timeout retries when a policy is set.
				</p>
			</div>
		</div>
	);
}
