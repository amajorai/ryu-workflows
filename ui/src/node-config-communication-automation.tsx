import {
	Input,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Textarea,
} from "@ryu/blocks/companion/controls";
import type { ChangeEvent } from "react";
import { useRecipes } from "./hooks.ts";
import type { NodeConfigValue } from "./node-config-model.ts";
import {
	type NodeFieldUpdateValue,
	parseNodeRecord,
	parseNodeText,
} from "./schemas.ts";

/** Config fields for a Recipe node: pick a recorded ghost recipe and map its
 *  params. Param values are templates resolved against the run context before
 *  replay (so `{{input}}`/`{{nodes.*}}` flow into a recorded action). */
export function RecipeFields({
	value,
	update,
}: {
	update: (key: string, val: NodeFieldUpdateValue) => void;
	value: NodeConfigValue;
}) {
	const { recipes } = useRecipes();
	const current = parseNodeText(value.extra.recipe) ?? "";
	const names = recipes.map((r) => r.name);
	const items = [
		{ value: "", label: "Select a recipe…" },
		...names.map((n) => ({ value: n, label: n })),
		// Preserve a saved name even if the recipe isn't in this node's list yet
		// (e.g. a remote node, or recipes still loading).
		...(current && !names.includes(current)
			? [{ value: current, label: current }]
			: []),
	];
	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-recipe">Recipe</Label>
				{recipes.length > 0 ? (
					<Select
						items={items}
						onValueChange={(v) => update("recipe", v)}
						value={current}
					>
						<SelectTrigger id="cfg-recipe">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{items.map((item) => (
								<SelectItem key={item.value} value={item.value}>
									{item.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : (
					<Input
						id="cfg-recipe"
						onChange={(e: ChangeEvent<HTMLInputElement>) =>
							update("recipe", e.target.value)
						}
						placeholder="recipe name"
						value={current}
					/>
				)}
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-recipe-params">Parameters (JSON)</Label>
				<Textarea
					className="h-16 font-mono text-xs"
					id="cfg-recipe-params"
					onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
						try {
							update("params", JSON.parse(e.target.value));
						} catch {
							// allow partial edit
						}
					}}
					placeholder={'{ "recipient": "{{input}}" }'}
					value={JSON.stringify(value.extra.params ?? {}, null, 2)}
				/>
				<p className="text-muted-foreground text-xs">
					String values may use <code className="text-xs">{"{{input}}"}</code>{" "}
					and other variables.
				</p>
			</div>
		</>
	);
}

/** The action verbs a GhostAction node can run, mirroring the Core executor's
 *  `ghost_action_call` dispatch. */
const GHOST_ACTION_OPTIONS: { value: string; label: string }[] = [
	{ value: "click", label: "Click" },
	{ value: "double_click", label: "Double-click" },
	{ value: "type", label: "Type" },
	{ value: "press", label: "Press key" },
	{ value: "hotkey", label: "Hotkey" },
	{ value: "scroll", label: "Scroll" },
	{ value: "focus", label: "Focus app" },
	{ value: "hover", label: "Hover" },
	{ value: "drag", label: "Drag" },
	{ value: "window", label: "Window" },
	{ value: "wait", label: "Wait" },
];

/** Element-targeted actions show a target-query field. */
const GHOST_TARGETED = new Set([
	"click",
	"double_click",
	"type",
	"hover",
	"drag",
]);

/** The single parameter field each action exposes (if any). */
const GHOST_PARAM_FIELD = new Map<
	string,
	{ key: string; label: string; placeholder: string }
>(
	Object.entries({
		type: { key: "text", label: "Text to type", placeholder: "{{input}}" },
		press: { key: "key", label: "Key", placeholder: "return" },
		hotkey: { key: "keys", label: "Keys", placeholder: "ctrl+c" },
		scroll: { key: "direction", label: "Direction", placeholder: "down" },
		wait: { key: "seconds", label: "Seconds", placeholder: "1" },
	})
);

/** Config fields for a GhostAction node: the recorded action verb, its target
 *  element, app, and the per-action parameter. String values are templates
 *  resolved against the run context before the ghost call. */
export function GhostActionFields({
	value,
	update,
}: {
	update: (key: string, val: NodeFieldUpdateValue) => void;
	value: NodeConfigValue;
}) {
	const action = parseNodeText(value.extra.action) ?? "click";
	const target = parseNodeRecord(value.extra.target) ?? {};
	const params = parseNodeRecord(value.extra.params) ?? {};
	const query = parseNodeText(target.query) ?? "";
	const app = parseNodeText(target.app) ?? "";
	const paramField = GHOST_PARAM_FIELD.get(action);
	const setTarget = (key: string, val: string) =>
		update("target", { ...target, [key]: val });
	const setParam = (key: string, val: string) =>
		update("params", { ...params, [key]: val });

	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-ga-action">Action</Label>
				<Select
					items={GHOST_ACTION_OPTIONS}
					onValueChange={(v) => update("action", v)}
					value={action}
				>
					<SelectTrigger id="cfg-ga-action">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{GHOST_ACTION_OPTIONS.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{GHOST_TARGETED.has(action) && (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="cfg-ga-query">Target element</Label>
					<Input
						id="cfg-ga-query"
						onChange={(e: ChangeEvent<HTMLInputElement>) =>
							setTarget("query", e.target.value)
						}
						placeholder="button or field name"
						value={query}
					/>
				</div>
			)}
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-ga-app">App</Label>
				<Input
					id="cfg-ga-app"
					onChange={(e: ChangeEvent<HTMLInputElement>) =>
						setTarget("app", e.target.value)
					}
					placeholder="e.g. Gmail (optional)"
					value={app}
				/>
			</div>
			{paramField && (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="cfg-ga-param">{paramField.label}</Label>
					<Input
						id="cfg-ga-param"
						onChange={(e: ChangeEvent<HTMLInputElement>) =>
							setParam(paramField.key, e.target.value)
						}
						placeholder={paramField.placeholder}
						value={parseNodeText(params[paramField.key]) ?? ""}
					/>
					<p className="text-muted-foreground text-xs">
						String values may use <code className="text-xs">{"{{input}}"}</code>{" "}
						and other variables.
					</p>
				</div>
			)}
		</>
	);
}
