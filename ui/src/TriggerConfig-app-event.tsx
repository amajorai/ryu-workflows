import {
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ryu/blocks/companion/controls";
import { useLiteralMessages } from "@ryu/i18n/react";
import type { WorkflowTrigger } from "./bridge.ts";
import { useHookEvents } from "./hooks.ts";

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
export function AppEventTriggerConfig({
	trigger,
	onChange,
}: {
	trigger: Extract<WorkflowTrigger, { type: "event" }>;
	onChange: (trigger: WorkflowTrigger) => void;
}) {
	const tl = useLiteralMessages();
	const events = useHookEvents(true);
	const list = events.data;

	if (list && list.length === 0) {
		return (
			<span className="text-muted-foreground text-xs">
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
			? [
					{
						value: trigger.event,
						label: tl("{event} (not installed)", { event: trigger.event }),
					},
				]
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
				<span className="text-muted-foreground text-xs">
					{selected.description}
				</span>
			) : null}
			{trigger.event ? (
				<span className="font-mono text-muted-foreground text-xs">
					{trigger.event}
				</span>
			) : (
				<span className="text-muted-foreground text-xs">
					The event payload is passed to the workflow as its run input.
				</span>
			)}
		</div>
	);
}
