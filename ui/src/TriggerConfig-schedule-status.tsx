import { useLiteralMessages } from "@ryu/i18n/react";
import { formatDateTime } from "@ryu/ui/lib/timezone.ts";
import { useMemo } from "react";
import type { ScheduledJob } from "./bridge.ts";

/** A small inline status line for a schedule trigger: last run + outcome. */
export function ScheduleStatus({
	workflowId,
	jobs,
}: {
	workflowId: string;
	jobs: ScheduledJob[];
}) {
	const tl = useLiteralMessages();
	const job = useMemo(() => {
		if (!workflowId) {
			return null;
		}
		const prefix = `wf-sched-${workflowId}-`;
		return jobs.find((j) => j.id.startsWith(prefix)) ?? null;
	}, [workflowId, jobs]);

	if (!job) {
		return (
			<span className="text-muted-foreground text-xs">
				Saves a scheduled job on save.
			</span>
		);
	}
	if (!job.lastRunAt) {
		return (
			<span className="text-muted-foreground text-xs">
				Scheduled — not run yet.
			</span>
		);
	}
	const when = formatDateTime(job.lastRunAt);
	return (
		<span className="text-muted-foreground text-xs">
			{job.lastOutcome
				? tl("Last run {when} — {outcome}", {
						when,
						outcome: job.lastOutcome,
					})
				: tl("Last run {when}", { when })}
		</span>
	);
}
