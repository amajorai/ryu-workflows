import { afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";
import type { AppInfo, InstalledSkill, McpTool } from "./bridge.ts";
import type { NodeConfigValue } from "./node-config-model.ts";
import { nodeConfigValueSchema, type WorkflowDefinition } from "./schemas.ts";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register();
}
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { createWorkflow } = await import("./bridge.ts");
const { NodeConfigPanel } = await import("./node-config.tsx");
const { canvasToDefinition } = await import("./workflow-serialization.ts");

interface CatalogFixture {
	apps?: AppInfo[];
	mcp?: McpTool[];
	skills?: InstalledSkill[];
}

interface BridgeCalls {
	apps: number;
	mcp: number;
	saved: WorkflowDefinition[];
	skills: number;
}

interface MountedPanel {
	container: HTMLDivElement;
	root: Root;
}

const mountedPanels: MountedPanel[] = [];

function installBridge(catalogs: CatalogFixture): BridgeCalls {
	const calls: BridgeCalls = { apps: 0, mcp: 0, saved: [], skills: 0 };
	Reflect.set(window, "ryu", {
		workflows: {
			apps: async () => {
				calls.apps += 1;
				return catalogs.apps ?? [];
			},
			mcp: async () => {
				calls.mcp += 1;
				return { servers: [], tools: catalogs.mcp ?? [] };
			},
			schedules: async () => [],
			save: async (definition: WorkflowDefinition) => {
				calls.saved.push(definition);
				return {
					edges: [],
					id: "workflow-saved",
					name: "Catalog workflow",
					nodes: [],
					triggers: [],
				};
			},
			skills: async () => {
				calls.skills += 1;
				return catalogs.skills ?? [];
			},
		},
	});
	return calls;
}

function ConfigSurface({ initialValue }: { initialValue: NodeConfigValue }) {
	const [value, setValue] = useState(initialValue);
	return (
		<>
			<NodeConfigPanel
				agents={[]}
				onChange={setValue}
				onDelete={() => undefined}
				value={value}
				variables={[]}
				workflows={[]}
			/>
			<output data-testid="node-value">{JSON.stringify(value)}</output>
		</>
	);
}

async function settle(): Promise<void> {
	await Promise.resolve();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function mountPanel(
	initialValue: NodeConfigValue
): Promise<HTMLDivElement> {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	mountedPanels.push({ container, root });
	await act(async () => {
		root.render(<ConfigSurface initialValue={initialValue} />);
		await settle();
	});
	return container;
}

function currentValue(container: HTMLElement): NodeConfigValue {
	const state = container.querySelector(
		"[data-testid='node-value']"
	)?.textContent;
	if (!state) {
		throw new Error("The rendered node config value was not available.");
	}
	return nodeConfigValueSchema.parse(JSON.parse(state));
}

function namedButton(
	container: HTMLElement,
	selector: string
): HTMLButtonElement {
	const button = container.querySelector<HTMLButtonElement>(selector);
	if (!button) {
		throw new Error(`Could not find button: ${selector}`);
	}
	return button;
}

async function selectCatalogItem(
	container: HTMLElement,
	controlId: string,
	itemLabel: string
): Promise<void> {
	await act(async () => {
		namedButton(container, `#${controlId}`).click();
		await settle();
	});
	const item = [
		...document.querySelectorAll<HTMLElement>('[role="option"]'),
	].find((option) => option.textContent?.trim() === itemLabel);
	if (!item) {
		throw new Error(`Could not find catalog option: ${itemLabel}`);
	}
	await act(async () => {
		item.click();
		await settle();
	});
}

async function fillInput(
	container: HTMLElement,
	selector: string,
	value: string
): Promise<void> {
	const input = container.querySelector<HTMLInputElement>(selector);
	if (!input) {
		throw new Error(`Could not find input: ${selector}`);
	}
	await act(async () => {
		const setter = Object.getOwnPropertyDescriptor(
			Object.getPrototypeOf(input),
			"value"
		)?.set;
		setter?.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await settle();
	});
}

function definitionFor(
	value: NodeConfigValue
): ReturnType<typeof canvasToDefinition> {
	const definition = canvasToDefinition(
		"Catalog workflow",
		"",
		[
			{
				id: value.label,
				position: { x: 0, y: 0 },
				data: {
					coreType: value.coreType,
					extra: value.extra,
					label: value.label,
				},
			},
		],
		[],
		[{ type: "manual" }]
	);
	return definition;
}

async function saveValue(value: NodeConfigValue): Promise<void> {
	await act(async () => {
		await createWorkflow({ token: null, url: "" }, definitionFor(value));
		await settle();
	});
}

afterEach(async () => {
	for (const { container, root } of mountedPanels.splice(0)) {
		await act(async () => root.unmount());
		container.remove();
	}
	Reflect.set(window, "ryu", undefined);
});

test("skill catalog selection emits the skill ID in the saved Core node", async () => {
	const calls = installBridge({
		skills: [{ id: "incident-investigator", name: "Incident Investigator" }],
	});
	const container = await mountPanel({
		coreType: "skill",
		extra: { skill: "", task: "{{input}}" },
		label: "skill_1",
	});

	await selectCatalogItem(container, "cfg-skill-id", "Incident Investigator");
	const value = currentValue(container);
	expect(value.extra).toEqual({
		skill: "incident-investigator",
		task: "{{input}}",
	});
	expect(calls.skills).toBeGreaterThan(0);
	await saveValue(value);
	expect(calls.saved).toEqual([
		{
			description: undefined,
			edges: [],
			id: "",
			name: "Catalog workflow",
			nodes: [
				{
					id: "skill_1",
					skill: "incident-investigator",
					task: "{{input}}",
					type: "skill",
				},
			],
			triggers: [],
		},
	]);
});

test("tool catalog selection saves its fully-qualified MCP ID and keeps arguments", async () => {
	const calls = installBridge({
		mcp: [
			{
				id: "browser.list_tabs",
				name: "list_tabs",
				server: "browser",
			},
		],
	});
	const container = await mountPanel({
		coreType: "tool",
		extra: { args: { limit: 5 }, name: "" },
		label: "tool_1",
	});

	await selectCatalogItem(container, "cfg-tool-name", "browser · list_tabs");
	const value = currentValue(container);
	expect(value.extra).toEqual({
		args: { limit: 5 },
		name: "browser.list_tabs",
	});
	expect(calls.mcp).toBeGreaterThan(0);
	const definition = definitionFor(value);
	expect(definition.nodes).toEqual([
		{
			args: { limit: 5 },
			id: "tool_1",
			name: "browser.list_tabs",
			type: "tool",
		},
	]);
	await saveValue(value);
	expect(calls.saved).toEqual([definition]);
});

test("plugin catalog selection saves its runnable and clears a runnable from the previous plugin", async () => {
	const calls = installBridge({
		apps: [
			{
				id: "@ryu/quality-kit",
				name: "Quality Kit",
				runnables: [
					{ id: "audit-workflow", kind: "workflow", name: "Audit changes" },
				],
			},
			{
				id: "@ryu/calendar-kit",
				name: "Calendar Kit",
				runnables: [{ id: "sync-events", kind: "tool", name: "Sync events" }],
			},
		],
	});
	const container = await mountPanel({
		coreType: "plugin",
		extra: {
			args: {},
			plugin_id: "@ryu/quality-kit",
			runnable_id: "audit-workflow",
		},
		label: "plugin_1",
	});

	await selectCatalogItem(container, "cfg-plugin-id", "Calendar Kit");
	const runnable = namedButton(container, "#cfg-plugin-runnable");
	expect(runnable.textContent).toContain("Select a runnable…");
	await selectCatalogItem(
		container,
		"cfg-plugin-runnable",
		"Sync events (tool)"
	);
	const value = currentValue(container);
	expect(value.extra).toEqual({
		args: {},
		plugin_id: "@ryu/calendar-kit",
		runnable_id: "sync-events",
	});
	expect(calls.apps).toBeGreaterThan(0);
	const definition = definitionFor(value);
	expect(definition.nodes).toEqual([
		{
			args: {},
			id: "plugin_1",
			plugin_id: "@ryu/calendar-kit",
			runnable_id: "sync-events",
			type: "plugin",
		},
	]);
	await saveValue(value);
	expect(calls.saved).toEqual([definition]);
});

test("node ID edit is controlled and serializes as the Core node ID", async () => {
	const calls = installBridge({});
	const container = await mountPanel({
		coreType: "note",
		extra: { text: "Preserve this note." },
		label: "note_1",
	});

	await fillInput(container, "#cfg-label", "review_gate");
	const value = currentValue(container);
	expect(value.label).toBe("review_gate");
	const definition = definitionFor(value);
	expect(definition.nodes).toEqual([
		{ id: "review_gate", text: "Preserve this note.", type: "note" },
	]);
	await saveValue(value);
	expect(calls.saved).toEqual([definition]);
});
