import { afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

// The GhostAction fields used the bare words "Type", "Key" and "Keys", which
// the catalog translates in their other senses ("Typ", "Schlüssel"), so the
// German form asked for a "type" and a lock's key.

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register();
}
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { I18nProvider } = await import("@ryu/i18n/react");
const { registerLiteralCatalogLoader } = await import("@ryu/i18n/core");
const { GhostActionFields } = await import(
	"./node-config-communication-automation.tsx"
);

/** Stand-ins for the catalog, with the wrong senses on the bare words. */
const DE: Record<string, string> = {
	"Key combination": "Tastenkombination",
	"Key to press": "Zu drückende Taste",
	Key: "Schlüssel",
	Keys: "Schlüssel",
	Type: "Typ",
	"Type text": "Text eingeben",
};

const mounted: { root: Root; container: HTMLDivElement }[] = [];

afterEach(async () => {
	for (const { root, container } of mounted.splice(0)) {
		await act(async () => {
			root.unmount();
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		container.remove();
	}
	registerLiteralCatalogLoader(null);
});

async function renderAction(action: string): Promise<HTMLDivElement> {
	registerLiteralCatalogLoader((locale) => (locale.startsWith("de") ? DE : {}));
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	mounted.push({ root, container });
	await act(async () => {
		root.render(
			<I18nProvider
				initialLocale="de"
				initialPackId={null}
				manageDocument={false}
			>
				<GhostActionFields
					update={() => undefined}
					value={{
						coreType: "GhostAction",
						extra: { action },
						label: "Ghost action",
					}}
				/>
			</I18nProvider>
		);
	});
	// Let the catalog load and the page localizer pass settle.
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 50));
	});
	return container;
}

function labelText(container: HTMLElement, id: string): string {
	return container.querySelector(`label[for="${id}"]`)?.textContent ?? "";
}

test("the type action reads 'Text eingeben', not 'Typ'", async () => {
	const container = await renderAction("type");
	expect(container.querySelector("#cfg-ga-action")?.textContent).toContain(
		"Text eingeben"
	);
	expect(container.textContent).not.toContain("Typ");
});

test("the key fields name a key to press and a key combination", async () => {
	const press = await renderAction("press");
	expect(labelText(press, "cfg-ga-param")).toBe("Zu drückende Taste");
	expect(press.textContent).not.toContain("Schlüssel");

	const hotkey = await renderAction("hotkey");
	expect(labelText(hotkey, "cfg-ga-param")).toBe("Tastenkombination");
	expect(hotkey.textContent).not.toContain("Schlüssel");
});
