import { afterEach, describe, expect, it } from "bun:test";
import {
	draftRecipeFromEvents,
	fetchNotifyTargetUsers,
	fetchWorkflows,
	type LearnedEvent,
	listRecipes,
	runWorkflow,
} from "./bridge.ts";
import type { RyuWorkflows } from "./ryu.d.ts";

function event(overrides: Partial<LearnedEvent> = {}): LearnedEvent {
	return {
		event_type: "click",
		ts_ms: 0,
		...overrides,
	};
}

afterEach(() => {
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		writable: true,
		value: undefined,
	});
});

// ── ryu() capability guard ───────────────────────────────────────────────────

describe("bridge guard", () => {
	it("throws a clear error when window.ryu is absent", () => {
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			writable: true,
			value: {},
		});
		expect(() => fetchWorkflows()).toThrow(
			/workflows capability is not available/
		);
	});

	it("reads the scoped organization roster through the host bridge", async () => {
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			writable: true,
			value: {
				ryu: {
					workflows: {
						notifyTargets: () =>
							Promise.resolve([
								{
									email: "ada@example.test",
									id: "user-ada",
									image: null,
									name: "Ada Lovelace",
									role: "member",
								},
							]),
					},
				},
			},
		});

		expect(await fetchNotifyTargetUsers()).toEqual([
			{
				email: "ada@example.test",
				id: "user-ada",
				image: null,
				name: "Ada Lovelace",
				role: "member",
			},
		]);
	});

	it("forwards the dry-run flag through the host bridge", async () => {
		const received: Parameters<RyuWorkflows["run"]>[0][] = [];
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			writable: true,
			value: {
				ryu: {
					workflows: {
						run: (args: Parameters<RyuWorkflows["run"]>[0]) => {
							received.push(args);
							return Promise.resolve({
								dryRun: true,
								runId: "run-1",
								workflowId: "wf-1",
								createdAt: "now",
								updatedAt: "now",
								status: "completed",
								input: {},
								output: {},
								nodes: {},
							});
						},
					},
				},
			},
		});

		await runWorkflow(
			{ url: "", token: null },
			"wf-1",
			{ text: "hello" },
			{ dryRun: true }
		);
		expect(received[0]).toEqual({
			id: "wf-1",
			input: { text: "hello" },
			dryRun: true,
		});
	});
});

// ── draftRecipeFromEvents (pure) ─────────────────────────────────────────────

describe("draftRecipeFromEvents", () => {
	it("assigns sequential 1-based step ids", () => {
		const recipe = draftRecipeFromEvents("do stuff", [
			event(),
			event({ event_type: "press", key: "Enter" }),
		]);
		expect(recipe.steps.map((s) => s.id)).toEqual([1, 2]);
	});

	it("maps a type event to a type action carrying the text", () => {
		const [step] = draftRecipeFromEvents("t", [
			event({ event_type: "type", key: "hello", element_name: "Search" }),
		]).steps;
		expect(step).toMatchObject({
			action: "type",
			params: { text: "hello" },
		});
		expect(step?.target).toMatchObject({ query: "Search" });
	});

	it("defaults a type event's text to empty when key is missing", () => {
		const [step] = draftRecipeFromEvents("t", [
			event({ event_type: "type" }),
		]).steps;
		expect(step?.params).toEqual({ text: "" });
	});

	it("maps press, hotkey, and scroll events with their key params", () => {
		const steps = draftRecipeFromEvents("t", [
			event({ event_type: "press", key: "Tab" }),
			event({ event_type: "hotkey", key: "cmd+c" }),
			event({ event_type: "scroll", key: "up" }),
		]).steps;
		expect(steps[0]).toMatchObject({ action: "press", params: { key: "Tab" } });
		expect(steps[1]).toMatchObject({
			action: "hotkey",
			params: { keys: "cmd+c" },
		});
		expect(steps[2]).toMatchObject({
			action: "scroll",
			params: { direction: "up" },
		});
	});

	it("defaults a scroll direction to down when key is missing", () => {
		const [step] = draftRecipeFromEvents("t", [
			event({ event_type: "scroll" }),
		]).steps;
		expect(step?.params).toEqual({ direction: "down" });
	});

	it("maps an app_switch event to a focus action with the app name", () => {
		const [step] = draftRecipeFromEvents("t", [
			event({ event_type: "app_switch", app_name: "Safari" }),
		]).steps;
		expect(step).toMatchObject({ action: "focus", params: { app: "Safari" } });
	});

	it("treats an unknown event type as a click", () => {
		const [step] = draftRecipeFromEvents("t", [
			event({ event_type: "mystery", element_name: "OK" }),
		]).steps;
		expect(step?.action).toBe("click");
		expect(step?.note).toBe("OK");
	});

	it("omits the target when no locator fields are present", () => {
		const [step] = draftRecipeFromEvents("t", [
			event({ event_type: "click" }),
		]).steps;
		expect(step?.target).toBeNull();
	});

	it("builds a locator from any of name/role/id/app", () => {
		const [step] = draftRecipeFromEvents("t", [
			event({
				event_type: "click",
				element_role: "button",
				element_id: "submit",
				app_name: "Mail",
			}),
		]).steps;
		expect(step?.target).toEqual({
			query: null,
			role: "button",
			identifier: "submit",
			app: "Mail",
		});
	});

	it("slugifies the task into the recipe name and picks the first app", () => {
		const recipe = draftRecipeFromEvents("Send  the Report!", [
			event({ event_type: "click" }),
			event({ event_type: "app_switch", app_name: "Numbers" }),
		]);
		expect(recipe.name).toBe("send-the-report");
		expect(recipe.app).toBe("Numbers");
		expect(recipe.schema_version).toBe(2);
		expect(recipe.on_failure).toBe("abort");
	});

	it("falls back to a placeholder name and description for an empty task", () => {
		const recipe = draftRecipeFromEvents("", []);
		expect(recipe.name).toBe("recorded-recipe");
		expect(recipe.description).toBe("Recorded workflow");
		expect(recipe.app).toBeNull();
		expect(recipe.steps).toEqual([]);
	});

	it("slugifies a task with only punctuation to the placeholder name", () => {
		expect(draftRecipeFromEvents("!!!", []).name).toBe("recorded-recipe");
	});
});

// ── Recipe list via the cross-app bridge ──────────────────────────────────────

describe("listRecipes", () => {
	const recipe = {
		app: null,
		description: "d",
		name: "send-report",
		params: [],
		step_count: 2,
	};

	function install(bridge: Record<string, unknown>) {
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			writable: true,
			value: { ryu: bridge },
		});
	}

	it("reads the Recipes app's list route through app.request", async () => {
		const requests: unknown[] = [];
		install({
			app: {
				request: (args: unknown) => {
					requests.push(args);
					return Promise.resolve({ recipes: [recipe] });
				},
			},
			ghost: { recipes: () => Promise.reject(new Error("legacy verb used")) },
		});
		expect(await listRecipes()).toEqual([recipe]);
		expect(requests).toEqual([
			{ app: "@ryu/recipes", method: "GET", path: "/" },
		]);
	});

	it("falls back to the legacy ghost.recipes verb when app.request fails", async () => {
		install({
			app: { request: () => Promise.reject(new Error("denied")) },
			ghost: { recipes: () => Promise.resolve([recipe]) },
		});
		expect(await listRecipes()).toEqual([recipe]);
	});
});
