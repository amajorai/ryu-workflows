// Agent-node config fields that pick from installed catalogs (skills, tools,
// MCP servers, plugins). Split from node-config-agent.tsx, which re-exports them.

import {
	Input,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ryu/blocks/companion/controls";
import { useQuery } from "@ryu/ui/hooks/use-query.ts";
import type { ChangeEvent } from "react";
import { listSkills } from "./bridge.ts";
import { useActiveNode, useApps, useMcp } from "./hooks.ts";
import {
	AgentPicker,
	JsonArgsField,
	TemplateField,
} from "./node-config-agent.tsx";
import type {
	AgentOption,
	NodeConfigValue,
	VariableToken,
} from "./node-config-model.ts";
import { type NodeFieldUpdateValue, parseNodeText } from "./schemas.ts";

/** Config fields for a Skill node: pick an installed skill, optionally an agent
 *  to run it under, and the task. The skill's instruction body is prepended. */
export function SkillFields({
	value,
	update,
	agents,
	variables,
}: {
	agents: AgentOption[];
	update: (key: string, val: NodeFieldUpdateValue) => void;
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
		value: s.id ?? s.name,
		label: s.name || s.id || "",
	}));
	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-skill-id">Skill</Label>
				<CatalogSelect
					id="cfg-skill-id"
					inputPlaceholder="research"
					onChange={(v) => update("skill", v)}
					options={skillOptions}
					placeholder="Select a skill…"
					value={parseNodeText(value.extra.skill) ?? ""}
				/>
				<p className="text-muted-foreground text-xs">
					An installed skill (its SKILL.md stem).
				</p>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-skill-agent">Agent (optional)</Label>
				<AgentPicker
					agents={agents}
					id="cfg-skill-agent"
					onChange={(agentId) => update("agent_id", agentId)}
					value={parseNodeText(value.extra.agent_id) ?? null}
				/>
				<p className="text-muted-foreground text-xs">
					Runs under this agent, or the default LLM when unset.
				</p>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-skill-task">Task</Label>
				<TemplateField
					id="cfg-skill-task"
					onChange={(next) => update("task", next)}
					value={parseNodeText(value.extra.task) ?? ""}
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
		<Select items={items} onValueChange={onChange} value={value}>
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
	update: (key: string, val: NodeFieldUpdateValue) => void;
	value: NodeConfigValue;
}) {
	const { tools } = useMcp();
	const name = parseNodeText(value.extra.name) ?? "";
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
				<p className="text-muted-foreground text-xs">
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
	update: (key: string, val: NodeFieldUpdateValue) => void;
	value: NodeConfigValue;
}) {
	const { servers, tools } = useMcp();
	const server = parseNodeText(value.extra.server) ?? "";
	const tool = parseNodeText(value.extra.tool) ?? "";
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
				<p className="text-muted-foreground text-xs">
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
	onPluginChange,
}: {
	onPluginChange: (pluginId: string) => void;
	update: (key: string, val: NodeFieldUpdateValue) => void;
	value: NodeConfigValue;
}) {
	const { apps } = useApps();
	const pluginId = parseNodeText(value.extra.plugin_id) ?? "";
	const runnableId = parseNodeText(value.extra.runnable_id) ?? "";
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
					onChange={onPluginChange}
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
				<p className="text-muted-foreground text-xs">
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
