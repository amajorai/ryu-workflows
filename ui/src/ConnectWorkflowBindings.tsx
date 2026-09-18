import { Button, Input, Label } from "@ryu/blocks/companion/controls";
import { useI18n } from "@ryu/i18n/react";
import { useQuery } from "@ryu/ui/hooks/use-query.ts";
import type { TriggerSubscription } from "@ryuhq/core-client/composio-triggers";
import { useRef, useState } from "react";
import type { RyuBridge } from "./ryu.d.ts";

type ConnectWorkflowHost = RyuBridge["workflows"] & {
	connectBindings: NonNullable<RyuBridge["workflows"]["connectBindings"]>;
	bindConnectTrigger: NonNullable<RyuBridge["workflows"]["bindConnectTrigger"]>;
	removeConnectBinding: NonNullable<
		RyuBridge["workflows"]["removeConnectBinding"]
	>;
};

function host(): ConnectWorkflowHost {
	const bridge = (window as unknown as { ryu?: RyuBridge }).ryu;
	if (
		typeof bridge?.workflows?.connectBindings !== "function" ||
		typeof bridge.workflows.bindConnectTrigger !== "function" ||
		typeof bridge.workflows.removeConnectBinding !== "function"
	) {
		throw new Error("Connect workflow bindings are unavailable in this host");
	}
	return bridge.workflows as ConnectWorkflowHost;
}

export function ConnectWorkflowBindings({
	workflowId,
}: {
	workflowId: string;
}) {
	const { t } = useI18n();
	const [triggerId, setTriggerId] = useState("");
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const pending = useRef(false);
	const query = useQuery<TriggerSubscription[]>({
		queryKey: ["workflow-connect-bindings", workflowId],
		queryFn: async () => {
			const result = await host().connectBindings({ id: workflowId });
			if (!Array.isArray(result)) {
				throw new Error("Invalid workflow bindings response");
			}
			return result as TriggerSubscription[];
		},
	});
	async function change(bindingId?: string) {
		if (pending.current) {
			return;
		}
		pending.current = true;
		setBusy(true);
		setFailed(false);
		try {
			if (bindingId) {
				await host().removeConnectBinding({ id: workflowId, bindingId });
			} else {
				await host().bindConnectTrigger({
					id: workflowId,
					connectTriggerId: triggerId.trim(),
				});
				setTriggerId("");
			}
			await query.refetch();
		} catch {
			setFailed(true);
		} finally {
			pending.current = false;
			setBusy(false);
		}
	}
	const valid =
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			triggerId.trim()
		);
	return (
		<section
			aria-label={t("workflows.connect.title", {}, "Connect triggers")}
			className="flex flex-col gap-3"
		>
			<p className="text-muted-foreground text-xs">
				{t(
					"workflows.connect.help",
					{},
					"Bind an existing Connect trigger to this saved workflow. Bindings survive workflow edits and are managed separately from its definition."
				)}
			</p>
			{query.isLoading && (
				<p role="status">
					{t("workflows.connect.loading", {}, "Loading bindings…")}
				</p>
			)}
			{(query.isError || failed) && (
				<p className="text-status-destructive text-xs" role="alert">
					{t(
						"workflows.connect.error",
						{},
						"Connect bindings are unavailable or the change could not be confirmed. Refresh to check the current state before retrying."
					)}
				</p>
			)}
			<Button
				disabled={busy || query.isFetching}
				onClick={() => void query.refetch()}
				size="sm"
				variant="outline"
			>
				{t("workflows.connect.refresh", {}, "Refresh bindings")}
			</Button>
			{!(query.isLoading || query.isError) && query.data?.length === 0 && (
				<p className="text-muted-foreground text-xs">
					{t(
						"workflows.connect.empty",
						{},
						"No Connect triggers are bound to this workflow."
					)}
				</p>
			)}
			<ul className="flex flex-col gap-2">
				{query.data?.map((binding) => (
					<li
						className="flex flex-wrap items-center justify-between gap-2"
						key={binding.id}
					>
						<span className="break-all font-mono text-xs" translate="no">
							{binding.triggerSlug}
						</span>
						<Button
							disabled={busy || query.isError || query.isFetching}
							onClick={() => void change(binding.id)}
							size="sm"
							variant="outline"
						>
							{t("workflows.connect.remove", {}, "Remove binding")}
						</Button>
					</li>
				))}
			</ul>
			<Label htmlFor="connect-workflow-trigger">
				{t("workflows.connect.id", {}, "Connect trigger ID")}
			</Label>
			<Input
				autoComplete="off"
				disabled={busy || query.isLoading || query.isError}
				id="connect-workflow-trigger"
				onChange={(event) => setTriggerId(event.target.value)}
				value={triggerId}
			/>
			<Button
				disabled={
					!valid || busy || query.isLoading || query.isError || query.isFetching
				}
				onClick={() => void change()}
				size="sm"
			>
				{t("workflows.connect.bind", {}, "Bind trigger")}
			</Button>
		</section>
	);
}
