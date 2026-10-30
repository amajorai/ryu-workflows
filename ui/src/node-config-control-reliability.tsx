import { Input, Label, Switch } from "@ryu/blocks/companion/controls";
import { type ChangeEvent, useCallback } from "react";
import type { NodeConfigValue } from "./node-config-model.ts";
import {
	type NodeFieldUpdateValue,
	parseNodeNumber,
	parseNodeRecord,
	parseNodeStrings,
	patchNodeConfiguration,
} from "./schemas.ts";

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

export interface ReliabilityFieldsProps {
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
