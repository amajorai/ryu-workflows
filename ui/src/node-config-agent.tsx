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

import { Add01Icon, CodeIcon, Delete01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Input,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Textarea,
} from "@ryu/blocks/companion/controls";
import {
	ModelAgentPicker,
	type RyuPickerSelection,
} from "@ryu/blocks/composer/runtime-picker";
import { useQuery } from "@ryu/ui/hooks/use-query.ts";
import { type ChangeEvent, useCallback, useContext, useRef } from "react";
import { listSkills } from "./bridge.ts";
import { useActiveNode, useApps, useMcp } from "./hooks.ts";

export type {
	AgentOption,
	NodeConfigValue,
	VariableToken,
	WorkflowOption,
} from "./node-config-model.ts";

import {
	type AgentOption,
	type NodeConfigValue,
	RuntimeCatalogContext,
	type VariableToken,
	type WorkflowOption,
} from "./node-config-model.ts";

// Sentinel for "no workflow picked" in a Select (Base UI needs the empty choice
// present in `items`); maps back to an empty string on change.
const NO_WORKFLOW_VALUE = "__none__";

/** Shared workflow-id dropdown used by the Sub-workflow node and the While
 *  loop-body picker. Falls back to a free-text input when no workflows are known
 *  yet (e.g. an unsaved canvas with an empty list), and always preserves an
 *  already-saved id even if it is not in the offered list. */
export function WorkflowPicker({
	workflows,
	value,
	onChange,
	id,
	placeholder,
}: {
	workflows: WorkflowOption[];
	value: string;
	onChange: (workflowId: string) => void;
	id: string;
	placeholder?: string;
}) {
	if (workflows.length === 0) {
		return (
			<Input
				id={id}
				onChange={(e: ChangeEvent<HTMLInputElement>) =>
					onChange(e.target.value)
				}
				placeholder={placeholder ?? "wf_..."}
				value={value}
			/>
		);
	}
	const known = workflows.some((w) => w.id === value);
	const items = [
		{ value: NO_WORKFLOW_VALUE, label: "Select a workflow…" },
		...workflows.map((w) => ({ value: w.id, label: w.name || w.id })),
		// Keep a saved id selectable even if it is not in this node's list (e.g. a
		// workflow deleted since, or still loading).
		...(value && !known ? [{ value, label: value }] : []),
	];
	return (
		<Select
			items={items}
			onValueChange={(v) => onChange(v === NO_WORKFLOW_VALUE ? "" : v)}
			value={value || NO_WORKFLOW_VALUE}
		>
			<SelectTrigger id={id}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{items.map((item) => (
					<SelectItem key={item.value} value={item.value}>
						{item.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

// Sentinel option value for "no agent picked" (routes to the default LLM). Base
// UI Select needs the unset choice present in `items`; we map it back to null.
const DEFAULT_AGENT_VALUE = "__default_llm__";

// Guardrail checks offered by the Guardrails node. The names map to Gateway
// firewall categories server-side (jailbreak → prompt-injection patterns).
// `moderation` is offered but not yet enforced by the firewall (documented).
export const GUARDRAIL_OPTIONS: { label: string; value: string }[] = [
	{ value: "pii", label: "PII" },
	{ value: "jailbreak", label: "Jailbreak" },
	{ value: "moderation", label: "Moderation" },
];

/** Agent dropdown shared by the Agent node and each Agent-Delegate row. Empty
 *  selection (the sentinel) serializes back to `null`. */
export function AgentPicker({
	agents,
	value,
	onChange,
	id,
}: {
	agents: AgentOption[];
	value: string | null;
	onChange: (agentId: string | null) => void;
	id: string;
}) {
	const runtimeCatalog = useContext(RuntimeCatalogContext);
	if (runtimeCatalog && runtimeCatalog.agents.length > 0) {
		return (
			<ModelAgentPicker
				ariaLabel="Choose an agent"
				catalog={runtimeCatalog}
				mode="agent"
				onSelectionChange={(selection: RyuPickerSelection) => {
					if (selection.kind === "agent") {
						onChange(selection.agentId);
					}
				}}
				placeholder="Choose an agent"
				value={value ? { agentId: value, kind: "agent" } : undefined}
			/>
		);
	}
	const items = [
		{ value: DEFAULT_AGENT_VALUE, label: "(default LLM)" },
		...agents.map((a) => ({ value: a.id, label: a.name })),
	];
	return (
		<Select
			items={items}
			onValueChange={(v) => onChange(v === DEFAULT_AGENT_VALUE ? null : v)}
			value={value ?? DEFAULT_AGENT_VALUE}
		>
			<SelectTrigger id={id}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{items.map((item) => (
					<SelectItem key={item.value} value={item.value}>
						{item.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/** One delegate in an AgentDelegate node. Mirrors Core's `DelegateSpec`
 *  (apps/core/src/workflow/delegation.rs): `id` + `task` are required, `agent_id`
 *  is optional (null routes to the default LLM), `preset` is omitted so Core's
 *  serde default (`code_read`) applies. */
export interface DelegateRow {
	agent_id: string | null;
	id: string;
	task: string;
}

let _delegateCounter = 0;

/** Editable list of AgentDelegate rows: add/remove, per-row agent picker + task
 *  template. Each row id is auto-generated and stable for its lifetime. */
export function DelegateRows({
	agents,
	value,
	onChange,
}: {
	agents: AgentOption[];
	value: DelegateRow[];
	onChange: (rows: DelegateRow[]) => void;
}) {
	const addRow = () => {
		_delegateCounter += 1;
		onChange([
			...value,
			{ id: `delegate_${_delegateCounter}`, task: "", agent_id: null },
		]);
	};
	const updateRow = (index: number, patch: Partial<DelegateRow>) => {
		onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
	};
	const removeRow = (index: number) => {
		onChange(value.filter((_, i) => i !== index));
	};

	return (
		<div className="flex flex-col gap-2">
			<Label>Delegates</Label>
			{value.length === 0 ? (
				<p className="text-[11px] text-muted-foreground">
					No delegates yet. Add one to fan out a task to a sub-agent.
				</p>
			) : null}
			{value.map((row, index) => (
				<div
					className="flex flex-col gap-1.5 rounded-lg p-2 ring-1 ring-white/10"
					key={row.id}
				>
					<div className="flex items-center justify-between">
						<span className="font-mono text-[10px] text-muted-foreground">
							{row.id}
						</span>
						<Button
							aria-label="Remove delegate"
							className="size-6"
							onClick={() => removeRow(index)}
							size="icon"
							variant="ghost"
						>
							<HugeiconsIcon
								className="size-3 text-destructive"
								icon={Delete01Icon}
							/>
						</Button>
					</div>
					<AgentPicker
						agents={agents}
						id={`delegate-agent-${row.id}`}
						onChange={(agentId) => updateRow(index, { agent_id: agentId })}
						value={row.agent_id}
					/>
					<Textarea
						aria-label="Delegate task"
						className="h-14 font-mono text-xs"
						onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
							updateRow(index, { task: e.target.value })
						}
						placeholder="Task for this delegate…"
						value={row.task}
					/>
				</div>
			))}
			<Button onClick={addRow} size="sm" variant="ghost">
				<HugeiconsIcon className="size-3" icon={Add01Icon} />
				Add delegate
			</Button>
		</div>
	);
}

/** Textarea with an "Insert variable" dropdown. Inserts the chosen `{{token}}`
 *  at the current cursor position (or appends if the field is unfocused), then
 *  reports the new value via `onChange`. Pure UI helper: no autocomplete engine,
 *  just a menu of known tokens collected from the graph. */
export function TemplateField({
	id,
	value,
	onChange,
	variables,
	placeholder,
	className,
}: {
	className?: string;
	id: string;
	onChange: (next: string) => void;
	placeholder?: string;
	value: string;
	variables: VariableToken[];
}) {
	const ref = useRef<HTMLTextAreaElement>(null);

	const insert = useCallback(
		(token: string) => {
			const el = ref.current;
			if (el) {
				const start = el.selectionStart ?? value.length;
				const end = el.selectionEnd ?? value.length;
				const next = value.slice(0, start) + token + value.slice(end);
				onChange(next);
				// Restore focus + place the cursor right after the inserted token.
				requestAnimationFrame(() => {
					el.focus();
					const caret = start + token.length;
					el.setSelectionRange(caret, caret);
				});
				return;
			}
			onChange(value + token);
		},
		[value, onChange]
	);

	return (
		<div className="flex flex-col gap-1">
			<Textarea
				className={className ?? "h-20 font-mono text-xs"}
				id={id}
				onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
					onChange(e.target.value)
				}
				placeholder={placeholder}
				ref={ref}
				value={value}
			/>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							className="h-6 self-start px-2 text-[11px]"
							size="sm"
							type="button"
							variant="ghost"
						/>
					}
				>
					<HugeiconsIcon className="size-3" icon={CodeIcon} />
					Insert variable
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
					{variables.map((v) => (
						<DropdownMenuItem key={v.token} onClick={() => insert(v.token)}>
							<span className="font-mono text-xs">{v.token}</span>
							{v.label && v.label !== v.token ? (
								<span className="ml-2 text-[10px] text-muted-foreground">
									{v.label}
								</span>
							) : null}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

export interface NodeConfigPanelProps {
	agents: AgentOption[];
	onChange: (v: NodeConfigValue) => void;
	onDelete: () => void;
	value: NodeConfigValue;
	/** Variable tokens offered by the "Insert variable" menu on template fields. */
	variables: VariableToken[];
	/** Other saved workflows, offered by the Sub-workflow / While-body pickers
	 *  (the current workflow is excluded by the caller to avoid self-reference). */
	workflows: WorkflowOption[];
}

/** Config fields for an Awakeable (human-in-the-loop pause) node. */
export function AwakeableFields({
	value,
	update,
}: {
	update: (key: string, val: unknown) => void;
	value: NodeConfigValue;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor="cfg-awakeable-prompt">Prompt</Label>
			<Textarea
				className="h-20 text-xs"
				id="cfg-awakeable-prompt"
				onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
					update("prompt", e.target.value || null)
				}
				placeholder="What input is expected before the run resumes?"
				value={(value.extra.prompt as string | null) ?? ""}
			/>
			<p className="text-[11px] text-muted-foreground">
				Pauses the run (human-in-the-loop) until the resume endpoint is called;
				the resume payload becomes this node's output.
			</p>
		</div>
	);
}

/** A JSON args editor shared by the MCP and Plugin nodes. Parses on every edit
 *  and only commits valid JSON, so a partial keystroke never clobbers the value. */
export function JsonArgsField({
	id,
	label,
	value,
	onCommit,
}: {
	id: string;
	label: string;
	onCommit: (parsed: unknown) => void;
	value: unknown;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			<Textarea
				className="h-16 font-mono text-xs"
				id={id}
				onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
					try {
						onCommit(JSON.parse(e.target.value));
					} catch {
						// allow partial edit
					}
				}}
				value={JSON.stringify(value ?? {}, null, 2)}
			/>
		</div>
	);
}

/** Config fields for an Agent node: pick a configured agent and give it a task.
 *  The first-class "run agent X on this task" step (routes through the agent
 *  runner), distinct from a raw-prompt node. */
export function AgentNodeFields({
	value,
	update,
	agents,
	variables,
}: {
	agents: AgentOption[];
	update: (key: string, val: unknown) => void;
	value: NodeConfigValue;
	variables: VariableToken[];
}) {
	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-agent-id">Agent</Label>
				<AgentPicker
					agents={agents}
					id="cfg-agent-id"
					onChange={(agentId) => update("agent_id", agentId ?? "")}
					value={(value.extra.agent_id as string | null) || null}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-agent-task">Task</Label>
				<TemplateField
					id="cfg-agent-task"
					onChange={(next) => update("task", next)}
					value={(value.extra.task as string) ?? ""}
					variables={variables}
				/>
				<p className="text-[11px] text-muted-foreground">
					Runs the agent on this task. Defaults to {"{{input}}"}.
				</p>
			</div>
		</>
	);
}

/** Config fields for a Skill node: pick an installed skill, optionally an agent
 *  to run it under, and the task. The skill's instruction body is prepended. */
export function SkillFields({
	value,
	update,
	agents,
	variables,
}: {
	agents: AgentOption[];
	update: (key: string, val: unknown) => void;
	value: NodeConfigValue;
	variables: VariableToken[];
}) {
	const activeNode = useActiveNode();
	const { data: installedSkills } = useQuery({
		queryKey: ["skills", "installed", activeNode.url, activeNode.token],
		queryFn: () =>
			listSkills({ url: activeNode.url, token: activeNode.token ?? null }),
	});
	const skillOptions = (installedSkills ?? []).map((s) => ({
		value: s.id,
		label: s.name || s.id,
	}));
	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-skill-id">Skill</Label>
				<CatalogSelect
					id="cfg-skill-id"
					inputPlaceholder="research"
					onChange={(v) => update("skill", v)}
					options={skillOptions as { label: string; value: string }[]}
					placeholder="Select a skill…"
					value={(value.extra.skill as string) ?? ""}
				/>
				<p className="text-[11px] text-muted-foreground">
					An installed skill (its SKILL.md stem).
				</p>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-skill-agent">Agent (optional)</Label>
				<AgentPicker
					agents={agents}
					id="cfg-skill-agent"
					onChange={(agentId) => update("agent_id", agentId)}
					value={(value.extra.agent_id as string | null) ?? null}
				/>
				<p className="text-[11px] text-muted-foreground">
					Runs under this agent, or the default LLM when unset.
				</p>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-skill-task">Task</Label>
				<TemplateField
					id="cfg-skill-task"
					onChange={(next) => update("task", next)}
					value={(value.extra.task as string) ?? ""}
					variables={variables}
				/>
			</div>
		</>
	);
}

/** A catalog-backed picker mirroring RecipeFields: a Select over `options` that
 *  always preserves the current value even when it isn't in the list yet (a remote
 *  node, or a catalog still loading), and falls back to a free-text Input when the
 *  catalog is empty so an id can always be entered by hand. */
export function CatalogSelect({
	id,
	value,
	onChange,
	options,
	placeholder,
	inputPlaceholder,
}: {
	id: string;
	inputPlaceholder: string;
	onChange: (value: string) => void;
	options: { value: string; label: string }[];
	placeholder: string;
	value: string;
}) {
	if (options.length === 0) {
		return (
			<Input
				id={id}
				onChange={(e: ChangeEvent<HTMLInputElement>) =>
					onChange(e.target.value)
				}
				placeholder={inputPlaceholder}
				value={value}
			/>
		);
	}
	const items = [
		{ value: "", label: placeholder },
		...options,
		// Preserve a saved id even if it isn't in the fetched list (remote node, or
		// the catalog changed since the workflow was authored).
		...(value && !options.some((o) => o.value === value)
			? [{ value, label: value }]
			: []),
	];
	return (
		<Select onValueChange={onChange} value={value}>
			<SelectTrigger id={id}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{items.map((item) => (
					<SelectItem key={item.value} value={item.value}>
						{item.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/** Config fields for a Tool node: pick a tool from the MCP registry by its
 *  fully-qualified `<server>.<tool>` id (the shape the executor's `run_tool`
 *  expects). Reuses the shared `useMcp` hook; free-text fallback preserves manual
 *  ids on a remote node. */
export function ToolFields({
	value,
	update,
}: {
	update: (key: string, val: unknown) => void;
	value: NodeConfigValue;
}) {
	const { tools } = useMcp();
	const name = (value.extra.name as string) ?? "";
	const toolOptions = tools.map((t) => ({
		value: t.id,
		label: `${t.server} · ${t.name}`,
	}));
	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-tool-name">Tool</Label>
				<CatalogSelect
					id="cfg-tool-name"
					inputPlaceholder="ghost.snapshot"
					onChange={(v) => update("name", v)}
					options={toolOptions}
					placeholder="Select a tool…"
					value={name}
				/>
				<p className="text-[11px] text-muted-foreground">
					The fully-qualified {"<server>.<tool>"} id on the MCP registry.
				</p>
			</div>
			<JsonArgsField
				id="cfg-tool-args"
				label="Args (JSON)"
				onCommit={(parsed) => update("args", parsed)}
				value={value.extra.args}
			/>
		</>
	);
}

/** Config fields for an MCP node: pick a registered server, then one of its
 *  tools (joined as `<server>.<tool>` by Core). Reuses the shared `useMcp` hook;
 *  each picker falls back to free text when the catalog is empty. */
export function McpFields({
	value,
	update,
}: {
	update: (key: string, val: unknown) => void;
	value: NodeConfigValue;
}) {
	const { servers, tools } = useMcp();
	const server = (value.extra.server as string) ?? "";
	const tool = (value.extra.tool as string) ?? "";
	const serverOptions = servers.map((s) => ({ value: s.name, label: s.name }));
	const toolOptions = tools
		.filter((t) => t.server === server)
		.map((t) => ({ value: t.name, label: t.name }));
	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-mcp-server">Server</Label>
				<CatalogSelect
					id="cfg-mcp-server"
					inputPlaceholder="spider"
					onChange={(v) => update("server", v)}
					options={serverOptions}
					placeholder="Select a server…"
					value={server}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-mcp-tool">Tool</Label>
				<CatalogSelect
					id="cfg-mcp-tool"
					inputPlaceholder="crawl"
					onChange={(v) => update("tool", v)}
					options={toolOptions}
					placeholder={server ? "Select a tool…" : "Pick a server first"}
					value={tool}
				/>
				<p className="text-[11px] text-muted-foreground">
					Called as {"<server>.<tool>"} on the MCP registry.
				</p>
			</div>
			<JsonArgsField
				id="cfg-mcp-args"
				label="Args (JSON)"
				onCommit={(parsed) => update("args", parsed)}
				value={value.extra.args}
			/>
		</>
	);
}

/** Config fields for a Plugin node: pick an installed plugin + one of the
 *  runnables it bundles (tool/agent/skill/workflow). Reuses the shared `useApps`
 *  hook; the runnable list comes from the selected plugin's own `runnables`. */
export function PluginFields({
	value,
	update,
}: {
	update: (key: string, val: unknown) => void;
	value: NodeConfigValue;
}) {
	const { apps } = useApps();
	const pluginId = (value.extra.plugin_id as string) ?? "";
	const runnableId = (value.extra.runnable_id as string) ?? "";
	const pluginOptions = apps.map((a) => ({
		value: a.id,
		label: a.name || a.id,
	}));
	const selectedApp = apps.find((a) => a.id === pluginId);
	const runnableOptions = (selectedApp?.runnables ?? []).map((r) => ({
		value: r.id,
		label: r.name ? `${r.name} (${r.kind})` : r.id,
	}));
	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-plugin-id">Plugin</Label>
				<CatalogSelect
					id="cfg-plugin-id"
					inputPlaceholder="com.example.my-app"
					onChange={(v) => update("plugin_id", v)}
					options={pluginOptions}
					placeholder="Select a plugin…"
					value={pluginId}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-plugin-runnable">Runnable</Label>
				<CatalogSelect
					id="cfg-plugin-runnable"
					inputPlaceholder="my-tool"
					onChange={(v) => update("runnable_id", v)}
					options={runnableOptions}
					placeholder={pluginId ? "Select a runnable…" : "Pick a plugin first"}
					value={runnableId}
				/>
				<p className="text-[11px] text-muted-foreground">
					A runnable the plugin bundles (tool/agent/skill/workflow).
				</p>
			</div>
			<JsonArgsField
				id="cfg-plugin-args"
				label="Args (JSON)"
				onCommit={(parsed) => update("args", parsed)}
				value={value.extra.args}
			/>
		</>
	);
}

// The audiences a NotifyUser workflow node can target. This is the workflow
// `NotifyTargetSpec` contract (org, team, or explicit members), not the transport
// `NotifyTarget` enum used by monitor and node-level delivery channels.
