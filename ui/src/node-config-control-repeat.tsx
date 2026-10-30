import {
	Input,
	Label,
	Switch,
	ToggleGroup,
	ToggleGroupItem,
} from "@ryu/blocks/companion/controls";
import { useLiteralMessages } from "@ryu/i18n/react";
import { type ChangeEvent, useCallback } from "react";
import type { ReliabilityFieldsProps } from "./node-config-control-reliability.tsx";
import {
	type NodeFieldUpdateValue,
	parseNodeNumber,
	parseNodeRecord,
	parseNodeText,
	patchNodeConfiguration,
} from "./schemas.ts";

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
	const tl = useLiteralMessages();
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
								placeholder={tl("default {MAX_REPEAT_ITERATIONS}", {
									MAX_REPEAT_ITERATIONS,
								})}
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
