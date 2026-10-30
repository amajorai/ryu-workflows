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
import { useI18n } from "@ryu/i18n/react";
import type { ChangeEvent } from "react";
import type { WorkflowTrigger } from "./bridge.ts";
import { ConnectWorkflowBindings } from "./ConnectWorkflowBindings.tsx";
import {
	useComposioStatus,
	useComposioToolkits,
	useComposioTriggers,
} from "./hooks.ts";

/** A `composio`-typed trigger, narrowed for the config sub-component. */
type ComposioTrigger = Extract<WorkflowTrigger, { type: "composio" }>;

/** Composio trigger config: toolkit + trigger-slug pickers driven by the
 *  Composio catalog (the same client the agent editor uses), plus a free-text
 *  connected-account id. Hooks live here (not in the parent's render switch) so
 *  they are called unconditionally at a component top level. */
export function ComposioTriggerConfig({
	trigger,
	onChange,
	workflowId,
}: {
	trigger: ComposioTrigger;
	onChange: (trigger: WorkflowTrigger) => void;
	workflowId: string;
}) {
	const { t } = useI18n();
	const status = useComposioStatus();
	const connectOwned = status.data?.executionOwner === "connect";
	const toolkits = useComposioToolkits(
		!connectOwned && (status.data?.configured ?? false)
	);
	const triggers = useComposioTriggers(
		connectOwned ? null : trigger.toolkit || null
	);
	if (status.isLoading) {
		return (
			<p role="status">
				{t(
					"workflows.connect.statusLoading",
					{},
					"Loading integration status…"
				)}
			</p>
		);
	}
	if (status.isError) {
		return (
			<div role="alert">
				<p>
					{t(
						"workflows.connect.statusError",
						{},
						"Integration status is unavailable."
					)}
				</p>
				<Button
					onClick={() => void status.refetch()}
					size="sm"
					variant="outline"
				>
					{t("workflows.connect.retry", {}, "Retry")}
				</Button>
			</div>
		);
	}
	if (status.data?.executionOwner === "connect") {
		if (!status.data.configured) {
			return (
				<p className="text-status-destructive text-xs" role="alert">
					{t(
						"workflows.connect.unconfigured",
						{},
						"Connect is not configured for this user or node."
					)}
				</p>
			);
		}
		return workflowId ? (
			<ConnectWorkflowBindings key={workflowId} workflowId={workflowId} />
		) : (
			<p className="text-muted-foreground text-xs">
				{t(
					"workflows.connect.saveFirst",
					{},
					"Save the workflow before binding a Connect trigger."
				)}
			</p>
		);
	}

	if (status.data && !status.data.configured) {
		return (
			<span className="text-muted-foreground text-xs">
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
