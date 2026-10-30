import { workflowTriggerTypeSchema } from "./schemas.ts";
// apps/desktop/src/components/workflows/TriggerConfig.tsx
//
// Trigger configuration for a workflow, rendered inside the canvas's right-side
// config panel when the pinned "Trigger" entry node is selected — the same panel
// pattern every other node uses. This replaces the old standalone TriggerPanel
// strip that sat above the canvas: the trigger is now part of the graph, not a
// bar bolted on top. The trigger round-trips as part of the workflow definition
// Schedules remain Core-owned; Connect trigger bindings are managed by the
// separate Connect service and survive workflow definition edits.
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
import { type ChangeEvent, useEffect, useState } from "react";
import type { ScheduledJob, WorkflowTrigger } from "./bridge.ts";
import { fetchWorkflowWebhookUrl } from "./bridge.ts";
import { AppEventTriggerConfig } from "./TriggerConfig-app-event.tsx";
import { ComposioTriggerConfig } from "./TriggerConfig-composio.tsx";
import { ScheduleStatus } from "./TriggerConfig-schedule-status.tsx";

/** Trigger type values mirror Core's `WorkflowTrigger` tag (snake_case). */
type TriggerType = WorkflowTrigger["type"];

const TRIGGER_LABEL = {
	manual: "Manual",
	schedule: "Schedule",
	webhook: "Webhook",
	composio: "Composio event",
	event: "App event",
} satisfies Record<TriggerType, string>;

const TRIGGER_OPTIONS: { value: TriggerType; label: string }[] =
	workflowTriggerTypeSchema.options.map((value) => ({
		value,
		label: TRIGGER_LABEL[value],
	}));

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
					<span className="text-muted-foreground text-xs">
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
							<span className="text-muted-foreground text-xs">
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
									<span className="text-muted-foreground text-xs">
										POST here to trigger
									</span>
								</div>
								<span className="break-all font-mono text-muted-foreground text-xs">
									{url}
								</span>
							</div>
						) : (
							<span className="text-muted-foreground text-xs">
								Save the workflow to get its webhook URL.
							</span>
						)}
					</div>
				);
			}
			case "composio":
				return (
					<ComposioTriggerConfig
						onChange={onChange}
						trigger={trigger}
						workflowId={workflowId}
					/>
				);
			case "event":
				return <AppEventTriggerConfig onChange={onChange} trigger={trigger} />;
			default:
				return null;
		}
	};

	return (
		<div className="flex max-h-[70vh] w-56 flex-col gap-3 overflow-y-auto rounded-xl bg-popover/95 p-3 shadow-xl ring-1 ring-border backdrop-blur">
			<div className="flex items-center gap-1.5">
				<HugeiconsIcon
					className="size-4 text-muted-foreground"
					icon={ZapIcon}
				/>
				<span className="font-medium text-sm">Trigger</span>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label className="text-xs" htmlFor="trig-type">
					When this runs
				</Label>
				<Select
					items={TRIGGER_OPTIONS}
					onValueChange={(v) => setType(workflowTriggerTypeSchema.parse(v))}
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
