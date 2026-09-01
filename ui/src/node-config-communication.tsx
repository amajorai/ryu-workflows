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
	Checkbox,
	Input,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Spinner,
	Textarea,
	ToggleGroup,
	ToggleGroupItem,
} from "@ryu/blocks/companion/controls";
import { type ChangeEvent, useState } from "react";
import { fetchNotifyTargetUsers, type NotifyTargetUser } from "./bridge.ts";
import { useRecipes } from "./hooks.ts";
import { useQuery } from "./query.ts";

export type {
	AgentOption,
	NodeConfigValue,
	VariableToken,
	WorkflowOption,
} from "./node-config-model.ts";

import { TemplateField } from "./node-config-agent.tsx";
import type { NodeConfigValue, VariableToken } from "./node-config-model.ts";

const NOTIFY_TARGET_OPTIONS: { value: string; label: string }[] = [
	{ value: "org", label: "Org" },
	{ value: "team", label: "Team" },
	{ value: "members", label: "People" },
];

// The ack policies a NotifyUser node can require, mirroring Core's `AckMode`
// (serde tag `mode`). "none" is fire-and-forget; the rest suspend the run as a
// HITL gate until the policy is satisfied. `quorum` carries `n`; `percentage`
// carries `percent`.
const NOTIFY_ACK_OPTIONS: { value: string; label: string }[] = [
	{ value: "none", label: "None (fire-and-forget)" },
	{ value: "first", label: "First ack resumes" },
	{ value: "all", label: "All must ack" },
	{ value: "quorum", label: "At least this many" },
	{ value: "percentage", label: "At least this percentage" },
];

const DEFAULT_QUORUM_N = 2;
const DEFAULT_PERCENTAGE = 50;

/** Config fields for a NotifyUser node: pick the audience (org/team/members), the
 *  template-aware title + body, the ack policy, and an optional ack timeout. The
 *  discriminated `target` and `ack_mode` objects are rebuilt wholesale on a kind/
 *  mode switch so a stale `team_id`/`user_ids`/`n`/`percent` never leaks into the serialized
 *  shape Core deserializes. */
export function NotifyUserFields({
	value,
	update,
	variables,
}: {
	update: (key: string, val: unknown) => void;
	value: NodeConfigValue;
	variables: VariableToken[];
}) {
	const target = (value.extra.target as Record<string, unknown>) ?? {
		kind: "org",
	};
	const kind = (target.kind as string) ?? "org";
	const teamId = (target.team_id as string) ?? "";
	const userIds = Array.isArray(target.user_ids)
		? (target.user_ids as string[])
		: [];
	const ackMode = (value.extra.ack_mode as Record<string, unknown>) ?? {
		mode: "none",
	};
	const mode = (ackMode.mode as string) ?? "none";
	const quorumN =
		typeof ackMode.n === "number" ? (ackMode.n as number) : DEFAULT_QUORUM_N;
	const percentage =
		typeof ackMode.percent === "number"
			? Math.min(100, Math.max(1, Math.round(ackMode.percent)))
			: DEFAULT_PERCENTAGE;
	const ackTimeout = value.extra.ack_timeout_ms as number | null | undefined;
	const [memberSearch, setMemberSearch] = useState("");
	const {
		data: directory,
		error: directoryError,
		isPending: directoryPending,
	} = useQuery<NotifyTargetUser[]>({
		queryKey: ["notify-target-users", kind],
		queryFn: () =>
			kind === "members" ? fetchNotifyTargetUsers() : Promise.resolve([]),
	});
	const selectedIds = new Set(userIds);
	const knownDirectory = directory ?? [];
	const savedUnknownUsers: NotifyTargetUser[] = userIds
		.filter((userId) => !knownDirectory.some((user) => user.id === userId))
		.map((userId) => ({
			email: null,
			id: userId,
			image: null,
			name: userId,
			role: null,
		}));
	const memberOptions = [...knownDirectory, ...savedUnknownUsers];
	const normalizedSearch = memberSearch.trim().toLowerCase();
	const visibleMemberOptions = memberOptions.filter((user) => {
		if (!normalizedSearch) {
			return true;
		}
		return [user.name, user.email ?? "", user.id].some((field) =>
			field.toLowerCase().includes(normalizedSearch)
		);
	});

	const setKind = (nextKind: string) => {
		if (nextKind === "team") {
			update("target", { kind: "team", team_id: teamId });
		} else if (nextKind === "members") {
			update("target", { kind: "members", user_ids: userIds });
		} else {
			update("target", { kind: "org" });
		}
	};

	const setMode = (nextMode: string) => {
		if (nextMode === "quorum") {
			update("ack_mode", { mode: "quorum", n: quorumN });
		} else if (nextMode === "percentage") {
			update("ack_mode", { mode: "percentage", percent: percentage });
		} else {
			update("ack_mode", { mode: nextMode });
		}
	};

	const setMemberSelected = (userId: string, checked: boolean) => {
		const nextUserIds = checked
			? [...new Set([...userIds, userId])]
			: userIds.filter((id) => id !== userId);
		update("target", { kind: "members", user_ids: nextUserIds });
	};

	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-notify-target">Notify</Label>
				<ToggleGroup
					id="cfg-notify-target"
					onValueChange={(values: string[]) => {
						const value = values.at(-1);
						if (value) {
							setKind(value);
						}
					}}
					value={kind ? [kind] : []}
					variant="outline"
				>
					{NOTIFY_TARGET_OPTIONS.map((opt) => (
						<ToggleGroupItem key={opt.value} value={opt.value}>
							{opt.label}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</div>
			{kind === "team" ? (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="cfg-notify-team">Team id</Label>
					<Input
						autoComplete="off"
						id="cfg-notify-team"
						name="notify-team-id"
						onChange={(e: ChangeEvent<HTMLInputElement>) =>
							update("target", { kind: "team", team_id: e.target.value })
						}
						placeholder="team_..."
						value={teamId}
					/>
				</div>
			) : null}
			{kind === "members" ? (
				<fieldset className="flex min-w-0 flex-col gap-1.5">
					<legend className="font-medium text-sm">People</legend>
					<div className="flex items-center justify-between gap-2">
						<p className="text-[11px] text-muted-foreground">
							Choose who can approve this step.
						</p>
						<span className="shrink-0 font-medium text-[11px] tabular-nums">
							{selectedIds.size} selected
						</span>
					</div>
					<Input
						aria-label="Search organization people"
						autoComplete="off"
						id="cfg-notify-members-search"
						name="notify-members-search"
						onChange={(e: ChangeEvent<HTMLInputElement>) =>
							setMemberSearch(e.target.value)
						}
						placeholder="Search people…"
						value={memberSearch}
					/>
					<div className="flex items-center justify-end gap-1">
						<Button
							disabled={knownDirectory.length === 0}
							onClick={() =>
								update("target", {
									kind: "members",
									user_ids: knownDirectory.map((user) => user.id),
								})
							}
							size="sm"
							variant="ghost"
						>
							Select all
						</Button>
						<Button
							disabled={selectedIds.size === 0}
							onClick={() =>
								update("target", { kind: "members", user_ids: [] })
							}
							size="sm"
							variant="ghost"
						>
							Clear
						</Button>
					</div>
					<div
						aria-label="Organization people"
						className="flex max-h-44 flex-col gap-0.5 overflow-y-auto rounded-lg border border-border/70 bg-background/40 p-1"
						role="group"
					>
						{directoryPending ? (
							<div className="flex items-center gap-2 px-2 py-3 text-[11px] text-muted-foreground">
								<Spinner className="size-3" />
								Loading organization people…
							</div>
						) : visibleMemberOptions.length > 0 ? (
							visibleMemberOptions.map((user) => (
								<Label
									className="min-w-0 cursor-pointer rounded-md px-1.5 py-1.5 hover:bg-muted/70"
									key={user.id}
								>
									<Checkbox
										checked={selectedIds.has(user.id)}
										id={`cfg-notify-member-${user.id}`}
										onCheckedChange={(checked) =>
											setMemberSelected(user.id, checked)
										}
									/>
									<span
										aria-hidden="true"
										className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-[10px] text-primary"
									>
										{user.name.slice(0, 1).toUpperCase()}
									</span>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-xs">{user.name}</span>
										<span className="block truncate text-[10px] text-muted-foreground">
											{user.email ?? user.id}
										</span>
									</span>
								</Label>
							))
						) : (
							<p className="px-2 py-3 text-[11px] text-muted-foreground">
								{directoryError
									? "Organization people are unavailable on this node."
									: memberSearch
										? "No people match this search."
										: "No organization people are available to select."}
							</p>
						)}
					</div>
					<p
						aria-live="polite"
						className={
							selectedIds.size === 0
								? "text-[11px] text-warning"
								: "text-[11px] text-muted-foreground"
						}
					>
						{selectedIds.size === 0
							? "Select at least one person."
							: "Only selected people can approve this gate."}
					</p>
				</fieldset>
			) : null}
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-notify-title">Title</Label>
				<TemplateField
					className="h-10 text-xs"
					id="cfg-notify-title"
					onChange={(next) => update("title", next)}
					value={(value.extra.title as string) ?? ""}
					variables={variables}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-notify-body">Body</Label>
				<TemplateField
					id="cfg-notify-body"
					onChange={(next) => update("body", next)}
					value={(value.extra.body as string) ?? ""}
					variables={variables}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-notify-ack">Acknowledgement</Label>
				<Select onValueChange={setMode} value={mode}>
					<SelectTrigger id="cfg-notify-ack">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{NOTIFY_ACK_OPTIONS.map((opt) => (
							<SelectItem key={opt.value} value={opt.value}>
								{opt.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p className="text-[11px] text-muted-foreground">
					{mode === "none"
						? "Fire-and-forget — the run continues immediately."
						: mode === "percentage"
							? "Suspends the run until the approval percentage is met."
							: "Suspends the run (HITL gate) until the ack policy is met."}
				</p>
			</div>
			{mode === "quorum" ? (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="cfg-notify-quorum">Required acks (n)</Label>
					<Input
						autoComplete="off"
						id="cfg-notify-quorum"
						min={1}
						name="notify-quorum-count"
						onChange={(e: ChangeEvent<HTMLInputElement>) => {
							const parsed = Number.parseInt(e.target.value, 10);
							const n = Number.isNaN(parsed) || parsed < 1 ? 1 : parsed;
							update("ack_mode", { mode: "quorum", n });
						}}
						type="number"
						value={String(quorumN)}
					/>
				</div>
			) : null}
			{mode === "percentage" ? (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="cfg-notify-percentage">Required approval (%)</Label>
					<div className="relative">
						<Input
							aria-describedby="cfg-notify-percentage-help"
							autoComplete="off"
							className="pr-8"
							id="cfg-notify-percentage"
							max={100}
							min={1}
							name="notify-quorum-percentage"
							onChange={(e: ChangeEvent<HTMLInputElement>) => {
								const parsed = Number.parseInt(e.target.value, 10);
								const percent = Number.isNaN(parsed)
									? 1
									: Math.min(100, Math.max(1, parsed));
								update("ack_mode", { mode: "percentage", percent });
							}}
							type="number"
							value={String(percentage)}
						/>
						<span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground text-xs">
							%
						</span>
					</div>
					<p
						className="text-[11px] text-muted-foreground"
						id="cfg-notify-percentage-help"
					>
						Rounded up; 50% of 3 people requires 2 approvals.
					</p>
				</div>
			) : null}
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-notify-timeout">Ack timeout (ms, optional)</Label>
				<Input
					autoComplete="off"
					id="cfg-notify-timeout"
					min={0}
					name="notify-ack-timeout"
					onChange={(e: ChangeEvent<HTMLInputElement>) =>
						update(
							"ack_timeout_ms",
							e.target.value ? Number(e.target.value) : undefined
						)
					}
					placeholder="No timeout…"
					type="number"
					value={ackTimeout == null ? "" : String(ackTimeout)}
				/>
				<p className="text-[11px] text-muted-foreground">
					Reserved — inert in v1, but stored for forward compatibility.
				</p>
			</div>
		</>
	);
}

const CHANNEL_PLATFORM_OPTIONS = [
	{ value: "telegram", label: "Telegram" },
	{ value: "slack", label: "Slack" },
	{ value: "discord", label: "Discord" },
	{ value: "webhook", label: "Webhook" },
];

/** Config fields for a ChannelSend node: pick the channel transport, address a
 *  recipient, and template the message. Telegram takes a bot token + chat id;
 *  Slack/Discord/webhook take an incoming-webhook URL (the URL encodes the
 *  destination, so `recipient` is hidden for those). */
export function ChannelSendFields({
	value,
	update,
	variables,
}: {
	update: (key: string, val: unknown) => void;
	value: NodeConfigValue;
	variables: VariableToken[];
}) {
	const platform = (value.extra.platform as string) ?? "telegram";
	const isTelegram = platform === "telegram";

	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-channel-platform">Channel</Label>
				<Select
					items={CHANNEL_PLATFORM_OPTIONS}
					onValueChange={(v: string) => update("platform", v)}
					value={platform}
				>
					<SelectTrigger id="cfg-channel-platform">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{CHANNEL_PLATFORM_OPTIONS.map((opt) => (
							<SelectItem key={opt.value} value={opt.value}>
								{opt.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{isTelegram ? (
				<>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cfg-channel-token">Bot token</Label>
						<Input
							id="cfg-channel-token"
							onChange={(e: ChangeEvent<HTMLInputElement>) =>
								update("bot_token", e.target.value)
							}
							placeholder="123456:ABC-DEF..."
							type="password"
							value={(value.extra.bot_token as string) ?? ""}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cfg-channel-recipient">
							Send to (chat id / @username)
						</Label>
						<TemplateField
							className="h-10 text-xs"
							id="cfg-channel-recipient"
							onChange={(next) => update("recipient", next)}
							value={(value.extra.recipient as string) ?? ""}
							variables={variables}
						/>
					</div>
				</>
			) : (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="cfg-channel-webhook">Webhook URL</Label>
					<Input
						id="cfg-channel-webhook"
						onChange={(e: ChangeEvent<HTMLInputElement>) =>
							update("webhook_url", e.target.value)
						}
						placeholder="https://hooks.slack.com/..."
						value={(value.extra.webhook_url as string) ?? ""}
					/>
					<p className="text-[11px] text-muted-foreground">
						The incoming-webhook URL encodes the destination channel.
					</p>
				</div>
			)}
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-channel-text">Message</Label>
				<TemplateField
					id="cfg-channel-text"
					onChange={(next) => update("text", next)}
					value={(value.extra.text as string) ?? ""}
					variables={variables}
				/>
			</div>
		</>
	);
}

/** Config fields for a Recipe node: pick a recorded ghost recipe and map its
 *  params. Param values are templates resolved against the run context before
 *  replay (so `{{input}}`/`{{nodes.*}}` flow into a recorded action). */
export function RecipeFields({
	value,
	update,
}: {
	update: (key: string, val: unknown) => void;
	value: NodeConfigValue;
}) {
	const { recipes } = useRecipes();
	const current = (value.extra.recipe as string) ?? "";
	const names = recipes.map((r) => r.name);
	const items = [
		{ value: "", label: "Select a recipe…" },
		...names.map((n) => ({ value: n, label: n })),
		// Preserve a saved name even if the recipe isn't in this node's list yet
		// (e.g. a remote node, or recipes still loading).
		...(current && !names.includes(current)
			? [{ value: current, label: current }]
			: []),
	];
	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-recipe">Recipe</Label>
				{recipes.length > 0 ? (
					<Select
						items={items}
						onValueChange={(v) => update("recipe", v)}
						value={current}
					>
						<SelectTrigger id="cfg-recipe">
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
				) : (
					<Input
						id="cfg-recipe"
						onChange={(e: ChangeEvent<HTMLInputElement>) =>
							update("recipe", e.target.value)
						}
						placeholder="recipe name"
						value={current}
					/>
				)}
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-recipe-params">Parameters (JSON)</Label>
				<Textarea
					className="h-16 font-mono text-xs"
					id="cfg-recipe-params"
					onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
						try {
							update("params", JSON.parse(e.target.value));
						} catch {
							// allow partial edit
						}
					}}
					placeholder={'{ "recipient": "{{input}}" }'}
					value={JSON.stringify(value.extra.params ?? {}, null, 2)}
				/>
				<p className="text-[11px] text-muted-foreground">
					String values may use{" "}
					<code className="text-[10px]">{"{{input}}"}</code> and other
					variables.
				</p>
			</div>
		</>
	);
}

/** The action verbs a GhostAction node can run, mirroring the Core executor's
 *  `ghost_action_call` dispatch. */
const GHOST_ACTION_OPTIONS: { value: string; label: string }[] = [
	{ value: "click", label: "Click" },
	{ value: "double_click", label: "Double-click" },
	{ value: "type", label: "Type" },
	{ value: "press", label: "Press key" },
	{ value: "hotkey", label: "Hotkey" },
	{ value: "scroll", label: "Scroll" },
	{ value: "focus", label: "Focus app" },
	{ value: "hover", label: "Hover" },
	{ value: "drag", label: "Drag" },
	{ value: "window", label: "Window" },
	{ value: "wait", label: "Wait" },
];

/** Element-targeted actions show a target-query field. */
const GHOST_TARGETED = new Set([
	"click",
	"double_click",
	"type",
	"hover",
	"drag",
]);

/** The single parameter field each action exposes (if any). */
const GHOST_PARAM_FIELD: Record<
	string,
	{ key: string; label: string; placeholder: string }
> = {
	type: { key: "text", label: "Text to type", placeholder: "{{input}}" },
	press: { key: "key", label: "Key", placeholder: "return" },
	hotkey: { key: "keys", label: "Keys", placeholder: "ctrl+c" },
	scroll: { key: "direction", label: "Direction", placeholder: "down" },
	wait: { key: "seconds", label: "Seconds", placeholder: "1" },
};

/** Config fields for a GhostAction node: the recorded action verb, its target
 *  element, app, and the per-action parameter. String values are templates
 *  resolved against the run context before the ghost call. */
export function GhostActionFields({
	value,
	update,
}: {
	update: (key: string, val: unknown) => void;
	value: NodeConfigValue;
}) {
	const action = (value.extra.action as string) ?? "click";
	const target = (value.extra.target as Record<string, unknown>) ?? {};
	const params = (value.extra.params as Record<string, unknown>) ?? {};
	const query = (target.query as string) ?? "";
	const app = (target.app as string) ?? "";
	const paramField = GHOST_PARAM_FIELD[action];
	const setTarget = (key: string, val: string) =>
		update("target", { ...target, [key]: val });
	const setParam = (key: string, val: string) =>
		update("params", { ...params, [key]: val });

	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-ga-action">Action</Label>
				<Select
					items={GHOST_ACTION_OPTIONS}
					onValueChange={(v) => update("action", v)}
					value={action}
				>
					<SelectTrigger id="cfg-ga-action">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{GHOST_ACTION_OPTIONS.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{GHOST_TARGETED.has(action) && (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="cfg-ga-query">Target element</Label>
					<Input
						id="cfg-ga-query"
						onChange={(e: ChangeEvent<HTMLInputElement>) =>
							setTarget("query", e.target.value)
						}
						placeholder="button or field name"
						value={query}
					/>
				</div>
			)}
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-ga-app">App</Label>
				<Input
					id="cfg-ga-app"
					onChange={(e: ChangeEvent<HTMLInputElement>) =>
						setTarget("app", e.target.value)
					}
					placeholder="e.g. Gmail (optional)"
					value={app}
				/>
			</div>
			{paramField && (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="cfg-ga-param">{paramField.label}</Label>
					<Input
						id="cfg-ga-param"
						onChange={(e: ChangeEvent<HTMLInputElement>) =>
							setParam(paramField.key, e.target.value)
						}
						placeholder={paramField.placeholder}
						value={(params[paramField.key] as string) ?? ""}
					/>
					<p className="text-[11px] text-muted-foreground">
						String values may use{" "}
						<code className="text-[10px]">{"{{input}}"}</code> and other
						variables.
					</p>
				</div>
			)}
		</>
	);
}

/** Engine hard ceiling on While-loop iterations (mirrors Core's
 *  `MAX_WHILE_ITERATIONS`). A node's `max_iterations` is clamped to this. */
