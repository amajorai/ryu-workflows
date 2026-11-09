import { describe, expect, test } from "bun:test";
import {
	formatMessage,
	type MessageValuesInput,
	messageIdForLiteral,
} from "@ryu/i18n/core";
import { ghostActionSummary } from "./WorkflowCanvas-nodes.tsx";

// The RTL catalogs mirror each arrow (→ becomes ←); that only reaches the node
// when the arrow sits inside the catalog message.
const ARABIC = new Map([
	[messageIdForLiteral("{action} → {detail}"), "{action} ← {detail}"],
]);

function arabic(source: string, values?: MessageValuesInput): string {
	return formatMessage(
		ARABIC.get(messageIdForLiteral(source)) ?? source,
		values,
		"ar"
	);
}

function english(source: string, values?: MessageValuesInput): string {
	return formatMessage(source, values, "en");
}

/** FIRST STRONG ISOLATE … POP DIRECTIONAL ISOLATE around a value. */
function isolated(value: string): string {
	return `\u2068${value}\u2069`;
}

describe("ghostActionSummary", () => {
	test("mirrors the action-to-detail arrow under Arabic", () => {
		const extra = { action: "click", target: { query: "إرسال" } };
		expect(ghostActionSummary(extra, arabic)).toBe(
			`${isolated("click")} ← ${isolated("إرسال")}`
		);
		expect(ghostActionSummary(extra, english)).toBe(
			`${isolated("click")} → ${isolated("إرسال")}`
		);
	});

	test("isolates two Latin values so the arrow follows the paragraph", () => {
		// Unisolated, "click ← Compose" would form one left-to-right run under
		// dir="rtl", and the mirrored arrow would point back at the action.
		const extra = { action: "click", target: { query: "Compose" } };
		expect(ghostActionSummary(extra, arabic)).toBe(
			`${isolated("click")} ← ${isolated("Compose")}`
		);
	});

	test("shows the bare action when the step has no detail", () => {
		expect(ghostActionSummary({ action: "scroll" }, arabic)).toBe("scroll");
	});
});
