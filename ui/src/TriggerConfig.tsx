// apps/desktop/src/components/workflows/TriggerConfig.tsx
//
// Trigger configuration for a workflow, rendered inside the canvas's right-side
// config panel when the pinned "Trigger" entry node is selected — the same panel
// pattern every other node uses. This replaces the old standalone TriggerPanel
// strip that sat above the canvas: the trigger is now part of the graph, not a
// bar bolted on top. The trigger round-trips as part of the workflow definition
// (Core reconciles it into scheduler jobs / Composio subscriptions on save).
// Schedule status is read from the heartbeat jobs by matching the deterministic
// `wf-sched-<workflowId>-*` ids Core mints.

import {
	Copy01Icon,
	Tick01Icon,
	ViewIcon,
	ViewOffSlashIcon,
	WebhookIcon,
	ZapIcon,
} from "@hugeicons/core-free-icons";
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
} from "@ryu/blocks/companion/controls";
import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import type { ScheduledJob, WorkflowTrigger } from "./bridge.ts";
import { fetchWorkflowWebhookUrl } from "./bridge.ts";
import {
	useComposioStatus,
	useComposioToolkits,
	useComposioTriggers,
	useHookEvents,
} from "./hooks.ts";

/** Trigger type values mirror Core's `WorkflowTrigger` tag (snake_case). */
type TriggerType = WorkflowTrigger["type"];

const TRIGGER_LABEL: Record<TriggerType, string> = {
	manual: "Manual",
	schedule: "Schedule",
	webhook: "Webhook",
	composio: "Composio event",
	event: "App event",
};

const TRIGGER_OPTIONS: { value: TriggerType; label: string }[] = (
	["manual", "schedule", "webhook", "composio", "event"] as TriggerType[]
).map((value) => ({ value, label: TRIGGER_LABEL[value] }));

/** Interval presets offered for a schedule trigger's `every` field. */
const INTERVAL_PRESETS = ["5m", "15m", "1h", "6h", "1d"];

/** Default trigger config when switching the type. */
function defaultTrigger(type: TriggerType): WorkflowTrigger {
	switch (type) {
		case "schedule":
			return { type: "schedule", cron: null, every: "1h" };
		case "webhook":
			return { type: "webhook", secret: null };
		case "composio":
			return {
				type: "composio",
				toolkit: "",
				trigger_slug: "",
				connected_account_id: null,
			};
		case "event":
			// Empty until the user picks one. Saving with no event selected leaves a
			// trigger that matches nothing, which is inert rather than harmful — and
			// far better than defaulting to some arbitrary app's event.
			return { type: "event", event: "" };
		default:
			return { type: "manual" };
	}
}

interface TriggerConfigProps {
	/** Base URL of the active node, for the webhook status surface. */
	nodeUrl: string;
	/** Report a changed trigger up to the canvas. */
	onChange: (trigger: WorkflowTrigger) => void;
	/** Heartbeat jobs from the active node, used to surface schedule status. */
	scheduleJobs: ScheduledJob[];
	/** The single trigger this workflow declares (first of the list). */
	trigger: WorkflowTrigger;
	/** This workflow's id (empty for an unsaved workflow). */
	workflowId: string;
}

/** A small inline status line for a schedule trigger: last run + outcome. */
function ScheduleStatus({
	workflowId,
	jobs,
}: {
	workflowId: string;
	jobs: ScheduledJob[];
}) {
	const job = useMemo(() => {
		if (!workflowId) {
			return null;
		}
		const prefix = `wf-sched-${workflowId}-`;
		return jobs.find((j) => j.id.startsWith(prefix)) ?? null;
	}, [workflowId, jobs]);

	if (!job) {
		return (
			<span className="text-[11px] text-muted-foreground">
				Saves a scheduled job on save.
			</span>
		);
	}
	if (!job.lastRunAt) {
		return (
			<span className="text-[11px] text-muted-foreground">
				Scheduled — not run yet.
			</span>
		);
	}
	const when = new Date(job.lastRunAt).toLocaleString();
	return (
		<span className="text-[11px] text-muted-foreground">
			Last run {when}
			{job.lastOutcome ? ` — ${job.lastOutcome}` : ""}
		</span>
	);
}

/** A `composio`-typed trigger, narrowed for the config sub-component. */
type ComposioTrigger = Extract<WorkflowTrigger, { type: "composio" }>;

/** Composio trigger config: toolkit + trigger-slug pickers driven by the
 *  Composio catalog (the same client the agent editor uses), plus a free-text
 *  connected-account id. Hooks live here (not in the parent's render switch) so
 *  they are called unconditionally at a component top level. */
/** Config for an **app event** trigger: pick one of the events the installed apps
 *  declare they emit.
 *
 *  A picker rather than a text field because the id is fully qualified
 *  (`@ryu/meetings#meeting.ended`) and nothing about it is guessable — typing it
 *  from memory is how you end up with a workflow that silently never runs. The
 *  catalog is every event an ENABLED app declares, so an app that is installed but
 *  off does not offer events that could not fire.
 *
 *  A saved event whose provider was since disabled or uninstalled stays selected and
 *  is shown as such, rather than being silently reset — the subscription is still
 *  valid and starts firing again the moment the app comes back. */
function AppEventTriggerConfig({
	trigger,
	onChange,
}: {
	trigger: Extract<WorkflowTrigger, { type: "event" }>;
	onChange: (trigger: WorkflowTrigger) => void;
}) {
	const events = useHookEvents(true);
	const list = events.data;

	if (list && list.length === 0) {
		return (
			<span className="text-[11px] text-muted-foreground">
				No installed app publishes events yet. Enable an app that emits them
				(Meetings, Monitors, Quests…) and it will appear here.
			</span>
		);
	}

	// A saved-but-now-absent event must remain selectable, or opening the panel
	// would silently drop the workflow's subscription.
	const known = (list ?? []).some((e) => e.id === trigger.event);
	const items = [
		{ value: "", label: "Select an event" },
		...(list ?? []).map((e) => ({
			value: e.id,
			label: e.plugin ? `${e.title} — ${e.plugin}` : e.title,
		})),
		...(trigger.event && !known
			? [{ value: trigger.event, label: `${trigger.event} (not installed)` }]
			: []),
	];
	const selected = (list ?? []).find((e) => e.id === trigger.event);

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-col gap-1.5">
				<Label className="text-xs" htmlFor="trig-event">
					Event
				</Label>
				<Select
					items={items}
					onValueChange={(v) => onChange({ type: "event", event: v ?? "" })}
					value={trigger.event}
				>
					<SelectTrigger className="h-7 text-xs" id="trig-event">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{items.map((i) => (
							<SelectItem key={i.value} value={i.value}>
								{i.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{selected?.description ? (
				<span className="text-[11px] text-muted-foreground">
					{selected.description}
				</span>
			) : null}
			{trigger.event ? (
				<span className="font-mono text-[10px] text-muted-foreground">
					{trigger.event}
				</span>
			) : (
				<span className="text-[11px] text-muted-foreground">
					The event payload is passed to the workflow as its run input.
				</span>
			)}
		</div>
	);
}

function ComposioTriggerConfig({
	trigger,
	onChange,
}: {
	trigger: ComposioTrigger;
	onChange: (trigger: WorkflowTrigger) => void;
}) {
	const status = useComposioStatus();
	const toolkits = useComposioToolkits(status.data?.configured ?? false);
	const triggers = useComposioTriggers(trigger.toolkit || null);

	if (status.data && !status.data.configured) {
		return (
			<span className="text-[11px] text-muted-foreground">
				Add a Composio key in Settings → Integrations to pick a trigger.
			</span>
		);
	}

	const toolkitItems = [
		{ value: "", label: "Select toolkit" },
		...(toolkits.data ?? []).map((t) => ({ value: t.slug, label: t.name })),
	];
	const triggerItems = [
		{ value: "", label: "Select trigger" },
		...(triggers.data ?? []).map((t) => ({
			value: t.name,
			label: t.displayName,
		})),
	];

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-col gap-1.5">
				<Label className="text-xs" htmlFor="trig-toolkit">
					Toolkit
				</Label>
				<Select
					items={toolkitItems}
					onValueChange={(v) =>
						onChange({ ...trigger, toolkit: v ?? "", trigger_slug: "" })
					}
					value={trigger.toolkit}
				>
					<SelectTrigger className="h-7 text-xs" id="trig-toolkit">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{toolkitItems.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label className="text-xs" htmlFor="trig-slug">
					Trigger
				</Label>
				<Select
					items={triggerItems}
					onValueChange={(v) => onChange({ ...trigger, trigger_slug: v ?? "" })}
					value={trigger.trigger_slug}
				>
					<SelectTrigger className="h-7 text-xs" id="trig-slug">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{triggerItems.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label className="text-xs" htmlFor="trig-account">
					Account
				</Label>
				<Input
					className="h-7 text-xs"
					id="trig-account"
					onChange={(e: ChangeEvent<HTMLInputElement>) =>
						onChange({
							...trigger,
							connected_account_id: e.target.value || null,
						})
					}
					placeholder="connected account id"
					value={trigger.connected_account_id ?? ""}
				/>
			</div>
		</div>
	);
}

export function TriggerConfig({
	trigger,
	onChange,
	scheduleJobs,
	workflowId,
	nodeUrl,
}: TriggerConfigProps) {
	// The inbound webhook URL is derived from the NODE's base URL, which the
	// sandboxed frame cannot know (no token, no host) — so it comes from the host
	// over the bridge (`workflows.webhook`), not the shell's `nodeUrl` prop (which
	// is host-less here). Fetched only when a saved workflow declares a webhook.
	const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
	// The signing secret is auto-generated on save when left blank (Core backfills
	// it so the endpoint can fire), so it must be retrievable here to sign with —
	// a reveal toggle + copy affordance turns the masked field into the read-only
	// surface the caller reads the key from.
	const [showSecret, setShowSecret] = useState(false);
	const [copiedSecret, setCopiedSecret] = useState(false);
	useEffect(() => {
		if (trigger.type !== "webhook" || !workflowId) {
			setWebhookUrl(null);
			return;
		}
		let alive = true;
		fetchWorkflowWebhookUrl({ url: nodeUrl, token: null }, workflowId)
			.then((r) => {
				if (alive) {
					setWebhookUrl(r.url);
				}
			})
			.catch(() => {
				if (alive) {
					setWebhookUrl(null);
				}
			});
		return () => {
			alive = false;
		};
	}, [trigger.type, workflowId, nodeUrl]);
	const setType = (type: TriggerType) => {
		if (type === trigger.type) {
			return;
		}
		onChange(defaultTrigger(type));
	};

	const renderConfig = () => {
		switch (trigger.type) {
			case "manual":
				return (
					<span className="text-[11px] text-muted-foreground">
						Runs only when started manually — use the Run button above the
						canvas.
					</span>
				);
			case "schedule":
				return (
					<div className="flex flex-col gap-2">
						<div className="flex flex-col gap-1.5">
							<Label className="text-xs" htmlFor="trig-every">
								Every
							</Label>
							<Select
								items={[
									{ value: "__custom__", label: "Custom cron" },
									...INTERVAL_PRESETS.map((p) => ({ value: p, label: p })),
								]}
								onValueChange={(v) =>
									onChange(
										v === "__custom__"
											? { type: "schedule", cron: "0 9 * * *", every: null }
											: { type: "schedule", cron: null, every: v }
									)
								}
								value={trigger.every ?? "__custom__"}
							>
								<SelectTrigger className="h-7 text-xs" id="trig-every">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="__custom__">Custom cron</SelectItem>
									{INTERVAL_PRESETS.map((p) => (
										<SelectItem key={p} value={p}>
											{p}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						{trigger.every ? null : (
							<div className="flex flex-col gap-1.5">
								<Label className="text-xs" htmlFor="trig-cron">
									Cron
								</Label>
								<Input
									className="h-7 font-mono text-xs"
									id="trig-cron"
									onChange={(e: ChangeEvent<HTMLInputElement>) =>
										onChange({
											type: "schedule",
											cron: e.target.value,
											every: null,
										})
									}
									placeholder="0 9 * * *"
									value={trigger.cron ?? ""}
								/>
							</div>
						)}
						<ScheduleStatus jobs={scheduleJobs} workflowId={workflowId} />
					</div>
				);
			case "webhook": {
				// The per-workflow webhook ingress is live: an external caller (any
				// integration/app/service that can POST — the universal "beyond
				// Composio" path) hits the URL below with an HMAC-SHA256 signature over
				// the raw body, keyed by this secret. Fail-closed: without a secret the
				// trigger never fires (an unauthenticated public trigger is a
				// request-forgery vector), so the secret field is required, not
				// cosmetic. The URL needs the workflow's id, so it only appears once
				// the workflow is saved.
				// Host-provided over the bridge (see the effect above); null until it
				// resolves or when the workflow is unsaved.
				const url = webhookUrl;
				return (
					<div className="flex flex-col gap-2">
						<div className="flex flex-col gap-1.5">
							<Label className="text-xs" htmlFor="trig-secret">
								Signing secret
							</Label>
							<div className="flex items-center gap-1">
								<Input
									className="h-7 flex-1 font-mono text-xs"
									id="trig-secret"
									onChange={(e: ChangeEvent<HTMLInputElement>) =>
										onChange({
											type: "webhook",
											secret: e.target.value || null,
										})
									}
									placeholder="auto-generated on save"
									type={showSecret ? "text" : "password"}
									value={trigger.secret ?? ""}
								/>
								<Button
									aria-label={showSecret ? "Hide secret" : "Reveal secret"}
									onClick={() => setShowSecret((v) => !v)}
									size="icon"
									variant="ghost"
								>
									<HugeiconsIcon
										className="size-4"
										icon={showSecret ? ViewOffSlashIcon : ViewIcon}
									/>
								</Button>
								<Button
									aria-label="Copy secret"
									disabled={!trigger.secret}
									onClick={() => {
										if (!trigger.secret) {
											return;
										}
										navigator.clipboard
											.writeText(trigger.secret)
											.then(() => {
												setCopiedSecret(true);
												setTimeout(() => setCopiedSecret(false), 1500);
											})
											.catch(() => {
												// Clipboard denied — no-op; the revealed field is
												// still selectable as a fallback.
											});
									}}
									size="icon"
									variant="ghost"
								>
									<HugeiconsIcon
										className="size-4"
										icon={copiedSecret ? Tick01Icon : Copy01Icon}
									/>
								</Button>
							</div>
							<span className="text-[11px] text-muted-foreground">
								The caller signs the raw body with HMAC-SHA256 using this
								secret. Left blank, Ryu generates one on save.
							</span>
						</div>
						{url ? (
							<div className="flex flex-col gap-1.5">
								<div className="flex items-center gap-1.5">
									<HugeiconsIcon
										className="size-3.5 text-muted-foreground"
										icon={WebhookIcon}
									/>
									<span className="text-[11px] text-muted-foreground">
										POST here to trigger
									</span>
								</div>
								<span className="break-all font-mono text-[11px] text-muted-foreground">
									{url}
								</span>
							</div>
						) : (
							<span className="text-[11px] text-muted-foreground">
								Save the workflow to get its webhook URL.
							</span>
						)}
					</div>
				);
			}
			case "composio":
				return <ComposioTriggerConfig onChange={onChange} trigger={trigger} />;
			case "event":
				return <AppEventTriggerConfig onChange={onChange} trigger={trigger} />;
			default:
				return null;
		}
	};

	return (
		<div className="flex max-h-[70vh] w-56 flex-col gap-3 overflow-y-auto rounded-xl bg-popover/95 p-3 shadow-xl ring-1 ring-white/10 backdrop-blur">
			<div className="flex items-center gap-1.5">
				<HugeiconsIcon
					className="size-4 text-muted-foreground"
					icon={ZapIcon}
				/>
				<span className="font-semibold text-sm">Trigger</span>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label className="text-xs" htmlFor="trig-type">
					When this runs
				</Label>
				<Select
					items={TRIGGER_OPTIONS}
					onValueChange={(v) => setType(v as TriggerType)}
					value={trigger.type}
				>
					<SelectTrigger className="h-7 text-xs" id="trig-type">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{TRIGGER_OPTIONS.map((opt) => (
							<SelectItem key={opt.value} value={opt.value}>
								{opt.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{renderConfig()}
		</div>
	);
}
