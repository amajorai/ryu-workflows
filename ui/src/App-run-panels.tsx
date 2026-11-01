import { Button, Input } from "@ryu/blocks/companion/controls";
import { type LiteralMessage, useLiteralMessages } from "@ryu/i18n/react";
import { useState } from "react";
import type { Workflow, WorkflowNode, WorkflowRun } from "./bridge.ts";
import {
	parseNodeNumber,
	parseNodeRecord,
	parseNodeStrings,
	parseNodeText,
} from "./schemas.ts";

function notificationGateSummary(
	node: WorkflowNode | undefined,
	tl: LiteralMessage
): string {
	if (!node) {
		return "the selected people";
	}
	const target = parseNodeRecord(node.target);
	const targetKind = parseNodeText(target?.kind) ?? "org";
	const targetSummary =
		targetKind === "members"
			? tl("{count} selected people", {
					count: String(parseNodeStrings(target?.user_ids)?.length ?? 0),
				})
			: targetKind === "team"
				? "everyone in the selected team"
				: "everyone in the organization";
	const ackMode = parseNodeRecord(node.ack_mode);
	const mode = parseNodeText(ackMode?.mode) ?? "first";
	const policy =
		mode === "all"
			? "everyone must approve"
			: mode === "quorum"
				? `at least ${parseNodeNumber(ackMode?.n) ?? 1} people must approve`
				: mode === "percentage"
					? `at least ${parseNodeNumber(ackMode?.percent) ?? 50}% must approve`
					: "any 1 person must approve";
	return `${targetSummary}; ${policy}`;
}

/** A run parked on a provider rate, usage, or session limit. Core wakes it on
 * its own when the limit resets, so there is nothing to do here but explain. */
export function LimitWaitPanel({ resumeAt }: { resumeAt?: string | null }) {
	const tl = useLiteralMessages();
	const when = resumeAt ? new Date(resumeAt) : null;
	const label =
		when && !Number.isNaN(when.getTime())
			? `at ${when.toLocaleString()}`
			: "when the limit resets";
	return (
		<div className="bg-warning/10 px-4 py-3" role="status">
			<p className="font-medium text-sm text-status-warning">
				Paused by a provider limit
			</p>
			<p className="mt-1 text-muted-foreground text-xs">
				{tl(
					"This run reached a rate, usage, or session limit. It continues from where it stopped {label}.",
					{ label }
				)}
			</p>
		</div>
	);
}

/** Human-in-the-loop resume bar shown when a run suspends at an Awakeable gate.
 *  Notification gates are read-only here: their member acknowledgement policy
 *  can only be satisfied by an authorized recipient's inbox Ack action. */
export function ResumePanel({
	run,
	workflow,
	onResume,
}: {
	run: WorkflowRun;
	workflow: Workflow;
	onResume: (payload: string) => Promise<void>;
}) {
	const tl = useLiteralMessages();
	const [payload, setPayload] = useState("");
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	const gateNode = workflow.nodes.find((n) => n.id === run.awaitingNode);
	const prompt =
		parseNodeText(gateNode?.prompt) ??
		"This workflow is paused and needs your input to continue.";
	const isNotificationGate = gateNode?.type === "notify_user";

	const handle = async () => {
		setBusy(true);
		setErr(null);
		try {
			await onResume(payload);
			setPayload("");
		} catch (e) {
			setErr(e instanceof Error ? e.message : "Resume failed");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="bg-warning/10 px-4 py-3">
			<p className="mb-2 font-medium text-sm text-status-warning">
				{isNotificationGate
					? "Awaiting approvals"
					: tl("Awaiting input: {prompt}", { prompt })}
			</p>
			{isNotificationGate ? (
				<div className="max-w-xl rounded-lg border border-warning/25 bg-background/40 px-3 py-2">
					<p className="font-medium text-sm">
						{notificationGateSummary(gateNode, tl)}
					</p>
					<p className="mt-1 text-muted-foreground text-xs">
						Each selected person can approve from their Ryu inbox. The workflow
						continues automatically when the rule is met.
					</p>
				</div>
			) : (
				<div className="flex items-center gap-2">
					<Input
						aria-label="Workflow response"
						className="max-w-md"
						name="workflow-response"
						onChange={(e) => setPayload(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !busy) {
								handle();
							}
						}}
						placeholder="Type your response…"
						value={payload}
					/>
					<Button disabled={busy} onClick={() => handle()} size="sm">
						{busy ? "Resuming…" : "Resume"}
					</Button>
				</div>
			)}
			{err ? (
				<p aria-live="polite" className="mt-1 text-status-destructive text-xs">
					{err}
				</p>
			) : null}
		</div>
	);
}
