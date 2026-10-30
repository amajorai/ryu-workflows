import {
	type NodeFieldUpdateValue,
	parseDelegateRows,
	parseNodeNumber,
	parseNodeStrings,
	parseNodeText,
	patchNodeConfiguration,
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

import { Delete01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Button,
	Input,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Textarea,
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

import {
	AgentNodeFields,
	AgentPicker,
	AwakeableFields,
	DelegateRows,
	GUARDRAIL_OPTIONS,
	McpFields,
	type NodeConfigPanelProps,
	PluginFields,
	SkillFields,
	TemplateField,
	ToolFields,
	WorkflowPicker,
} from "./node-config-agent.tsx";
import { CodeFields } from "./node-config-code.tsx";
import {
	ChannelSendFields,
	GhostActionFields,
	NotifyUserFields,
	RecipeFields,
} from "./node-config-communication.tsx";
import {
	ForEachFields,
	ParallelFields,
	RELIABILITY_KINDS,
	REPEAT_KINDS,
	ReliabilityFields,
	RepeatFields,
	WhileFields,
} from "./node-config-control.tsx";

export function NodeConfigPanel({
	value,
	onChange,
	onDelete,
	agents,
	variables,
	workflows,
}: NodeConfigPanelProps) {
	const update = useCallback(
		(key: string, val: NodeFieldUpdateValue) => {
			onChange({
				...value,
				extra: patchNodeConfiguration(value.extra, key, val),
			});
		},
		[value, onChange]
	);

	const renderFields = () => {
		switch (value.coreType) {
			case "input":
			case "output":
				return (
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cfg-key">Key</Label>
						<Input
							id="cfg-key"
							onChange={(e: ChangeEvent<HTMLInputElement>) =>
								update("key", e.target.value || null)
							}
							placeholder="(uses node id)"
							value={parseNodeText(value.extra.key) ?? ""}
						/>
					</div>
				);
			case "prompt":
				return (
					<>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="cfg-prompt">Prompt template</Label>
							<TemplateField
								id="cfg-prompt"
								onChange={(next) => update("prompt", next)}
								value={parseNodeText(value.extra.prompt) ?? ""}
								variables={variables}
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="cfg-agent">Agent</Label>
							<AgentPicker
								agents={agents}
								id="cfg-agent"
								onChange={(agentId) => update("agent_id", agentId)}
								value={parseNodeText(value.extra.agent_id) ?? null}
							/>
						</div>
					</>
				);
			case "condition":
				return (
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cfg-expr">Expression</Label>
						<Input
							id="cfg-expr"
							onChange={(e: ChangeEvent<HTMLInputElement>) =>
								update("expr", e.target.value)
							}
							placeholder='input != ""'
							value={parseNodeText(value.extra.expr) ?? ""}
						/>
						<p className="text-muted-foreground text-xs">
							{
								"input == · != · contains · starts_with · ends_with · empty · nonempty, and numeric < > <= >="
							}
						</p>
					</div>
				);
			case "transform":
				return (
					<>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="cfg-op">Operation</Label>
							<Select
								items={[
									"uppercase",
									"lowercase",
									"trim",
									"json_parse",
									"template",
									"identity",
								].map((op) => ({ value: op, label: op }))}
								onValueChange={(v) => update("op", v)}
								value={parseNodeText(value.extra.op) ?? "uppercase"}
							>
								<SelectTrigger id="cfg-op">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{[
										"uppercase",
										"lowercase",
										"trim",
										"json_parse",
										"template",
										"identity",
									].map((op) => (
										<SelectItem key={op} value={op}>
											{op}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						{value.extra.op === "template" ? (
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="cfg-tmpl">Template</Label>
								<TemplateField
									className="h-16 font-mono text-xs"
									id="cfg-tmpl"
									onChange={(next) => update("template", next || null)}
									value={parseNodeText(value.extra.template) ?? ""}
									variables={variables}
								/>
							</div>
						) : null}
					</>
				);
			case "set_state":
				return (
					<>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="cfg-state-key">State key</Label>
							<Input
								id="cfg-state-key"
								onChange={(e: ChangeEvent<HTMLInputElement>) =>
									update("key", e.target.value)
								}
								placeholder="my_var"
								value={parseNodeText(value.extra.key) ?? ""}
							/>
							<p className="text-muted-foreground text-xs">
								Read downstream as {"{{state."}
								{parseNodeText(value.extra.key) || "my_var"}
								{"}}"}
							</p>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="cfg-state-value">Value template</Label>
							<TemplateField
								id="cfg-state-value"
								onChange={(next) => update("value", next)}
								value={parseNodeText(value.extra.value) ?? ""}
								variables={variables}
							/>
						</div>
					</>
				);
			case "tool":
				return <ToolFields update={update} value={value} />;
			case "recipe":
				return <RecipeFields update={update} value={value} />;
			case "ghost_action":
				return <GhostActionFields update={update} value={value} />;
			case "webhook":
				return (
					<>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="cfg-wh-url">URL</Label>
							<Input
								id="cfg-wh-url"
								onChange={(e: ChangeEvent<HTMLInputElement>) =>
									update("url", e.target.value)
								}
								value={parseNodeText(value.extra.url) ?? ""}
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="cfg-wh-method">Method</Label>
							<Select
								items={["POST", "PUT", "PATCH", "GET"].map((m) => ({
									value: m,
									label: m,
								}))}
								onValueChange={(v) => update("method", v)}
								value={parseNodeText(value.extra.method) ?? "POST"}
							>
								<SelectTrigger id="cfg-wh-method">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{["POST", "PUT", "PATCH", "GET"].map((m) => (
										<SelectItem key={m} value={m}>
											{m}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</>
				);
			case "delay":
				return (
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cfg-ms">Duration (ms)</Label>
						<Input
							id="cfg-ms"
							min={0}
							onChange={(e: ChangeEvent<HTMLInputElement>) =>
								update("ms", Number(e.target.value) || 0)
							}
							type="number"
							value={String(parseNodeNumber(value.extra.ms) ?? 1000)}
						/>
					</div>
				);
			case "sub_workflow":
				return (
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cfg-wfid">Workflow</Label>
						<WorkflowPicker
							id="cfg-wfid"
							onChange={(wfId) => update("workflow_id", wfId)}
							value={parseNodeText(value.extra.workflow_id) ?? ""}
							workflows={workflows}
						/>
						<p className="text-muted-foreground text-xs">
							Runs the selected workflow and forwards its output.
						</p>
					</div>
				);
			default:
				// The remaining kinds live in a second switch so neither function
				// trips the cognitive-complexity ceiling (one big switch would).
				return renderAdvancedFields();
		}
	};

	// Second half of the per-kind field switch: orchestration / runnable nodes.
	const renderAdvancedFields = () => {
		switch (value.coreType) {
			case "agent_delegate":
				return (
					<DelegateRows
						agents={agents}
						onChange={(delegates) => update("delegates", delegates)}
						value={
							Array.isArray(value.extra.delegates)
								? parseDelegateRows(value.extra.delegates)
								: []
						}
					/>
				);
			case "script":
				return (
					<>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="cfg-script">Script</Label>
							<Textarea
								className="h-48 font-mono text-xs"
								id="cfg-script"
								onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
									update("code", e.target.value)
								}
								spellCheck={false}
								value={parseNodeText(value.extra.code) ?? ""}
							/>
							<p className="text-muted-foreground text-xs">
								JavaScript with agent(), parallel(), pipeline(), phase(), and
								args (the node input). Return the node output.
							</p>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="cfg-script-agent">Agent</Label>
							<AgentPicker
								agents={agents}
								id="cfg-script-agent"
								onChange={(agentId) => update("agent_id", agentId)}
								value={parseNodeText(value.extra.agent_id) ?? null}
							/>
						</div>
					</>
				);
			case "note":
				return (
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cfg-note">Note</Label>
						<Textarea
							className="h-24 text-xs"
							id="cfg-note"
							onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
								update("text", e.target.value)
							}
							placeholder="Documentation only — does not affect the run."
							value={parseNodeText(value.extra.text) ?? ""}
						/>
					</div>
				);
			case "for_each":
				return (
					<ForEachFields
						update={update}
						value={value}
						variables={variables}
						workflows={workflows}
					/>
				);
			case "parallel":
				return (
					<ParallelFields update={update} value={value} workflows={workflows} />
				);
			case "while":
				return (
					<WhileFields
						update={update}
						value={value}
						variables={variables}
						workflows={workflows}
					/>
				);
			case "guardrails":
				return (
					<div className="flex flex-col gap-1.5">
						<Label>Checks</Label>
						<ToggleGroup
							onValueChange={(v: string[]) => update("checks", v)}
							value={
								Array.isArray(value.extra.checks)
									? (parseNodeStrings(value.extra.checks) ?? [])
									: []
							}
							variant="outline"
						>
							{GUARDRAIL_OPTIONS.map((opt) => (
								<ToggleGroupItem key={opt.value} value={opt.value}>
									{opt.label}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
						<p className="text-muted-foreground text-xs">
							Routed through the Gateway firewall; a trip fails the run.
							Moderation is not yet enforced.
						</p>
					</div>
				);
			case "awakeable":
				return <AwakeableFields update={update} value={value} />;
			case "agent":
				return (
					<AgentNodeFields
						agents={agents}
						update={update}
						value={value}
						variables={variables}
					/>
				);
			case "skill":
				return (
					<SkillFields
						agents={agents}
						update={update}
						value={value}
						variables={variables}
					/>
				);
			case "mcp":
				return <McpFields update={update} value={value} />;
			case "plugin":
				return (
					<PluginFields
						onPluginChange={(pluginId) => {
							if (pluginId === value.extra.plugin_id) {
								return;
							}
							// Runnable IDs are scoped to their plugin. Don't leave a stale
							// runnable selected after the user chooses a different plugin.
							onChange({
								...value,
								extra: {
									...value.extra,
									plugin_id: pluginId,
									runnable_id: "",
								},
							});
						}}
						update={update}
						value={value}
					/>
				);
			case "notify_user":
				return (
					<NotifyUserFields
						update={update}
						value={value}
						variables={variables}
					/>
				);
			case "channel_send":
				return (
					<ChannelSendFields
						update={update}
						value={value}
						variables={variables}
					/>
				);
			case "code":
				return (
					<CodeFields
						onExtraChange={(extra) => onChange({ ...value, extra })}
						update={update}
						value={value}
						variables={variables}
					/>
				);
			default:
				return null;
		}
	};

	return (
		<div className="flex max-h-[70vh] w-56 flex-col gap-3 overflow-y-auto rounded-xl bg-popover/95 p-3 shadow-xl ring-1 ring-border backdrop-blur">
			<div className="flex items-center justify-between">
				<span className="font-medium text-sm">Node config</span>
				<Button
					aria-label="Delete node"
					onClick={onDelete}
					size="sm"
					variant="ghost"
				>
					<HugeiconsIcon
						className="size-3.5 text-status-destructive"
						icon={Delete01Icon}
					/>
				</Button>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-label">Node id</Label>
				<Input
					id="cfg-label"
					onChange={(e: ChangeEvent<HTMLInputElement>) =>
						onChange({ ...value, label: e.target.value })
					}
					value={value.label}
				/>
			</div>
			{renderFields()}
			{REPEAT_KINDS.has(value.coreType) ? (
				<RepeatFields onChange={onChange} value={value} />
			) : null}
			{RELIABILITY_KINDS.has(value.coreType) ? (
				<ReliabilityFields onChange={onChange} value={value} />
			) : null}
		</div>
	);
}

// --- Palette (add node) ---------------------------------------------------
