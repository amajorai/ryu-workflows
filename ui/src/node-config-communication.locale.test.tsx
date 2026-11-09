import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

// The closed Acknowledgement trigger must show the translated policy label. A
// bare <SelectValue /> without `items` printed the raw mode ("first") in
// every locale.

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register();
}
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { I18nProvider } = await import("@ryu/i18n/react");
const { NotifyUserFields } = await import("./node-config-communication.tsx");

const mounted: { root: Root; container: HTMLDivElement }[] = [];

afterEach(async () => {
	for (const { root, container } of mounted.splice(0)) {
		await act(async () => {
			root.unmount();
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		container.remove();
	}
});

function shippedCatalog(locale: string): Record<string, string> {
	const path = fileURLToPath(
		new URL(`../../../../packages/i18n/locales/${locale}.json`, import.meta.url)
	);
	return JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
}

async function ackTriggerText(locale: string): Promise<string> {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	mounted.push({ root, container });
	await act(async () => {
		root.render(
			<I18nProvider
				autoLocalizeDom={false}
				initialLocale={locale}
				initialPackId={null}
				manageDocument={false}
				overlays={{ [locale]: shippedCatalog(locale) }}
			>
				<NotifyUserFields
					update={() => undefined}
					value={{
						coreType: "NotifyUser",
						extra: { ack_mode: { mode: "first" }, target: { kind: "org" } },
						label: "Notify",
					}}
					variables={[]}
				/>
			</I18nProvider>
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	const trigger = container.querySelector("#cfg-notify-ack");
	if (!trigger) {
		throw new Error("the acknowledgement trigger did not render");
	}
	return trigger.textContent ?? "";
}

test("the acknowledgement trigger shows the German policy label", async () => {
	const expected = shippedCatalog("de")["First ack resumes"];
	expect(expected).toBeTruthy();
	const text = await ackTriggerText("de");
	expect(text).toContain(expected ?? "");
	expect(text).not.toContain("first");
});

test("the acknowledgement trigger shows the English policy label", async () => {
	expect(await ackTriggerText("en")).toContain("First ack resumes");
});
