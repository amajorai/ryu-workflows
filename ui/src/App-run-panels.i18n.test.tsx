import { afterEach, describe, expect, test } from "bun:test";
import { registerLiteralCatalogLoader } from "@ryu/i18n/core";
import { I18nProvider } from "@ryu/i18n/react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResumePanel } from "./App-run-panels.tsx";
import type { Workflow, WorkflowNode, WorkflowRun } from "./bridge.ts";
import { workflowRunSchema, workflowSchema } from "./schemas.ts";

// A notification gate's summary was spliced from English fragments
// ("everyone in the organization", `at least ${n} people must approve`) with
// a hard-coded "; ", and its member count was a string, so no locale could
// translate or pluralize it.

const MEMBERS =
	"{count, plural, one {# selected person} other {# selected people}}";
const QUORUM =
	"{count, plural, one {at least # person must approve} other {at least # people must approve}}";
const JOIN = "{target}; {policy}";

const CATALOGS: Record<string, Record<string, string>> = {
	ar: {
		[JOIN]: "{target}؛ {policy}",
		"everyone in the organization": "كل من في المؤسسة",
		"everyone must approve": "يجب أن يوافق الجميع",
	},
	de: {
		[JOIN]: "{target}; {policy}",
		[MEMBERS]:
			"{count, plural, one {# ausgewählte Person} other {# ausgewählte Personen}}",
		[QUORUM]:
			"{count, plural, one {mindestens # Person muss zustimmen} other {mindestens # Personen müssen zustimmen}}",
	},
	ja: {
		[JOIN]: "{target}：{policy}",
		[MEMBERS]: "{count, plural, other {選択した#人}}",
		[QUORUM]: "{count, plural, other {#人以上の承認が必要}}",
		"Awaiting approvals": "承認待ち",
		"everyone in the selected team": "選択したチームの全員",
		"any 1 person must approve": "誰か1人の承認が必要",
	},
};

function gate(target: unknown, ackMode: unknown): WorkflowNode {
	return {
		ack_mode: ackMode,
		id: "gate",
		target,
		type: "notify_user",
	} as WorkflowNode;
}

function render(locale: string, node: WorkflowNode): string {
	registerLiteralCatalogLoader((requested) =>
		requested.startsWith(locale) ? (CATALOGS[locale] ?? {}) : {}
	);
	const workflow: Workflow = workflowSchema.parse({
		edges: [],
		id: "wf",
		name: "Approvals",
		nodes: [node],
		trigger: { type: "manual" },
	});
	const run: WorkflowRun = workflowRunSchema.parse({
		awaitingNode: "gate",
		createdAt: "2026-11-08T00:00:00.000Z",
		dryRun: false,
		input: {},
		nodes: {},
		output: {},
		runId: "run-1",
		status: "awaiting_input",
		updatedAt: "2026-11-08T00:00:00.000Z",
		workflowId: "wf",
	});
	return renderToStaticMarkup(
		<I18nProvider
			autoLocalizeDom={false}
			initialLocale={locale}
			initialPackId={null}
		>
			<ResumePanel
				onResume={() => Promise.resolve()}
				run={run}
				workflow={workflow}
			/>
		</I18nProvider>
	);
}

afterEach(() => registerLiteralCatalogLoader(null));

const THREE_MEMBERS = { kind: "members", user_ids: ["a", "b", "c"] };

describe("notification gate summary", () => {
	test("pluralizes the member count and quorum in English", () => {
		expect(
			render("en", gate(THREE_MEMBERS, { mode: "quorum", n: 2 }))
		).toContain("3 selected people; at least 2 people must approve");
		expect(
			render(
				"en",
				gate({ kind: "members", user_ids: ["a"] }, { mode: "quorum", n: 1 })
			)
		).toContain("1 selected person; at least 1 person must approve");
	});

	test("translates every fragment and the joiner in Japanese", () => {
		const team = render("ja", gate({ kind: "team" }, { mode: "first" }));
		expect(team).toContain("承認待ち");
		expect(team).toContain("選択したチームの全員：誰か1人の承認が必要");
		expect(
			render("ja", gate(THREE_MEMBERS, { mode: "quorum", n: 2 }))
		).toContain("選択した3人：2人以上の承認が必要");
	});

	test("translates the summary in Arabic and German", () => {
		expect(render("ar", gate({ kind: "org" }, { mode: "all" }))).toContain(
			"كل من في المؤسسة؛ يجب أن يوافق الجميع"
		);
		expect(
			render("de", gate(THREE_MEMBERS, { mode: "quorum", n: 2 }))
		).toContain(
			"3 ausgewählte Personen; mindestens 2 Personen müssen zustimmen"
		);
	});
});
