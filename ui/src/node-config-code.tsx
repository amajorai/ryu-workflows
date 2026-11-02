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
import {
	CODE_LANGUAGE_OPTIONS,
	CODE_MODE_OPTIONS,
	parseCodeLanguage,
	parseCodeMode,
	switchCodeLanguage,
} from "./code-node-model.ts";
import { JsonArgsField, TemplateField } from "./node-config-agent.tsx";
import type { NodeConfigValue, VariableToken } from "./node-config-model.ts";
import {
	type NodeFieldUpdateValue,
	parseNodeText,
	type WorkflowJsonRecord,
} from "./schemas.ts";

const MODE_HINTS = {
	lean: {
		run: "Runs main with the program input as its one argument; stdout is the output.",
		check: "Fails unless Lean accepts every declaration without sorry.",
	},
	bend: {
		run: "Runs main with the program input as its one argument; stdout is the output.",
		check: 'Fails unless Bend prints "ALL PROOFS CHECK" for every law.',
	},
	baml: {
		run: "Calls the function through the Ryu gateway. Functions use client Ryu.",
		check: "Fails unless baml-cli check accepts the source.",
	},
} as const;

/** Config fields for a Code node: language, run/check mode, the program source
 *  (literal, never template-resolved), then the language's inputs: one program
 *  argument for Lean/Bend, or a function, its arguments and a model for BAML. */
export function CodeFields({
	value,
	update,
	onExtraChange,
	variables,
}: {
	onExtraChange: (extra: WorkflowJsonRecord) => void;
	update: (key: string, val: NodeFieldUpdateValue) => void;
	value: NodeConfigValue;
	variables: VariableToken[];
}) {
	const language = parseCodeLanguage(value.extra.language);
	const mode = parseCodeMode(value.extra.mode);
	const isBaml = language === "baml";

	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-code-language">Language</Label>
				<Select
					items={CODE_LANGUAGE_OPTIONS}
					onValueChange={(next: string) =>
						onExtraChange(
							switchCodeLanguage(value.extra, parseCodeLanguage(next))
						)
					}
					value={language}
				>
					<SelectTrigger id="cfg-code-language">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{CODE_LANGUAGE_OPTIONS.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-code-mode">Mode</Label>
				<Select
					items={CODE_MODE_OPTIONS}
					onValueChange={(next: string) => update("mode", parseCodeMode(next))}
					value={mode}
				>
					<SelectTrigger id="cfg-code-mode">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{CODE_MODE_OPTIONS.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p className="text-muted-foreground text-xs">
					{MODE_HINTS[language][mode]}
				</p>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-code-source">Source</Label>
				<Textarea
					className="h-48 font-mono text-xs"
					id="cfg-code-source"
					onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
						update("source", e.target.value)
					}
					spellCheck={false}
					value={parseNodeText(value.extra.source) ?? ""}
				/>
				<p className="text-muted-foreground text-xs">
					Used as written; variables are not substituted into the source.
				</p>
			</div>
			{mode === "run" && !isBaml ? (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="cfg-code-input">Program input</Label>
					<TemplateField
						className="h-12 font-mono text-xs"
						id="cfg-code-input"
						onChange={(next) => update("input", next || null)}
						placeholder="{{input}}"
						value={parseNodeText(value.extra.input) ?? ""}
						variables={variables}
					/>
				</div>
			) : null}
			{mode === "run" && isBaml ? (
				<>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cfg-code-function">Function</Label>
						<Input
							id="cfg-code-function"
							onChange={(e: ChangeEvent<HTMLInputElement>) =>
								update("function", e.target.value || null)
							}
							placeholder="Summarize"
							value={parseNodeText(value.extra.function) ?? ""}
						/>
					</div>
					<JsonArgsField
						id="cfg-code-args"
						label="Arguments (JSON; string values are templates)"
						onCommit={(parsed) => update("args", parsed)}
						value={value.extra.args ?? undefined}
					/>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cfg-code-model">Model</Label>
						<Input
							id="cfg-code-model"
							onChange={(e: ChangeEvent<HTMLInputElement>) =>
								update("model", e.target.value || null)
							}
							placeholder="(workflow default)"
							value={parseNodeText(value.extra.model) ?? ""}
						/>
					</div>
				</>
			) : null}
		</>
	);
}
