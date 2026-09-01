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
	type DelegateRow,
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
import {
	ChannelSendFields,
	GhostActionFields,
	NotifyUserFields,
	RecipeFields,
} from "./node-config-communication.tsx";
import {
	RELIABILITY_KINDS,
	ReliabilityFields,
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
		(key: string, val: unknown) => {
			onChange({ ...value, extra: { ...value.extra, [key]: val } });
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
							value={(value.extra.key as string | null) ?? ""}
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
								value={(value.extra.prompt as string) ?? ""}
								variables={variables}
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="cfg-agent">Agent</Label>
							<AgentPicker
								agents={agents}
								id="cfg-agent"
								onChange={(agentId) => update("agent_id", agentId)}
								value={(value.extra.agent_id as string | null) ?? null}
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
							value={(value.extra.expr as string) ?? ""}
						/>
						<p className="text-[11px] text-muted-foreground">
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
								value={(value.extra.op as string) ?? "uppercase"}
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
									value={(value.extra.template as string | null) ?? ""}
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
								value={(value.extra.key as string) ?? ""}
							/>
							<p className="text-[11px] text-muted-foreground">
								Read downstream as {"{{state."}
								{(value.extra.key as string) || "my_var"}
								{"}}"}
							</p>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="cfg-state-value">Value template</Label>
							<TemplateField
								id="cfg-state-value"
								onChange={(next) => update("value", next)}
								value={(value.extra.value as string) ?? ""}
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
								value={(value.extra.url as string) ?? ""}
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
								value={(value.extra.method as string) ?? "POST"}
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
							value={String((value.extra.ms as number) ?? 1000)}
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
							value={(value.extra.workflow_id as string) ?? ""}
							workflows={workflows}
						/>
						<p className="text-[11px] text-muted-foreground">
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
								? (value.extra.delegates as DelegateRow[])
								: []
						}
					/>
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
							value={(value.extra.text as string) ?? ""}
						/>
					</div>
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
									? (value.extra.checks as string[])
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
						<p className="text-[11px] text-muted-foreground">
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
				return <PluginFields update={update} value={value} />;
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
			default:
				return null;
		}
	};

	return (
		<div className="flex max-h-[70vh] w-56 flex-col gap-3 overflow-y-auto rounded-xl bg-popover/95 p-3 shadow-xl ring-1 ring-white/10 backdrop-blur">
			<div className="flex items-center justify-between">
				<span className="font-semibold text-sm">Node config</span>
				<Button
					aria-label="Delete node"
					onClick={onDelete}
					size="sm"
					variant="ghost"
				>
					<HugeiconsIcon
						className="size-3.5 text-destructive"
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
			{RELIABILITY_KINDS.has(value.coreType) ? (
				<ReliabilityFields onChange={onChange} value={value} />
			) : null}
		</div>
	);
}

// --- Palette (add node) ---------------------------------------------------
