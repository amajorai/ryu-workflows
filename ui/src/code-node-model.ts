// Defaults and language switching for Core's `code` node (NodeKind::Code):
// a Lean 4, Bend or BAML program that a step runs or checks. Pure data so the
// canvas, the palette and the tests share one source of truth.

import type { WorkflowJsonRecord } from "./schemas.ts";

export type CodeLanguage = "lean" | "bend" | "baml";
export type CodeMode = "run" | "check";

export const CODE_LANGUAGE_OPTIONS: { value: CodeLanguage; label: string }[] = [
	{ value: "lean", label: "Lean 4" },
	{ value: "bend", label: "Bend" },
	{ value: "baml", label: "BAML" },
];

export const CODE_MODE_OPTIONS: { value: CodeMode; label: string }[] = [
	{ value: "run", label: "Run" },
	{ value: "check", label: "Check" },
];

const LEAN_STARTER = `def main (args : List String) : IO Unit :=
  IO.println s!"Hello from Lean: {args.headD ""}"
`;

const BEND_STARTER = `import Base

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    IO.print("Hello from Bend")
`;

const BAML_STARTER = `class Summary {
  title string
  bullets string[]
}

function Summarize(text: string) -> Summary {
  client Ryu
  prompt #"
    Summarize the text.
    {{ ctx.output_format }}

    {{ text }}
  "#
}
`;

export const CODE_STARTERS: Record<CodeLanguage, string> = {
	lean: LEAN_STARTER,
	bend: BEND_STARTER,
	baml: BAML_STARTER,
};

/** Fields a new node of each language starts with. Lean and Bend take one
 *  program argument; BAML takes a function name and its named arguments. */
export function codeNodeDefaults(language: CodeLanguage): WorkflowJsonRecord {
	if (language === "baml") {
		return {
			language,
			mode: "run",
			source: CODE_STARTERS.baml,
			input: null,
			function: "Summarize",
			args: { text: "{{input}}" },
			model: null,
		};
	}
	return {
		language,
		mode: "run",
		source: CODE_STARTERS[language],
		input: "{{input}}",
		function: null,
		args: null,
		model: null,
	};
}

export function parseCodeLanguage(value: unknown): CodeLanguage {
	return value === "bend" || value === "baml" ? value : "lean";
}

export function parseCodeMode(value: unknown): CodeMode {
	return value === "check" ? "check" : "run";
}

/** Canvas subtitle, e.g. "Lean 4 · check". */
export function codeNodeSummary(extra: WorkflowJsonRecord | undefined): string {
	const language = parseCodeLanguage(extra?.language);
	const label =
		CODE_LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ??
		language;
	return `${label} · ${parseCodeMode(extra?.mode)}`;
}

/** Switch a node's language. An untouched starter (or empty source) is swapped
 *  for the new language's starter; edited source is kept so nothing is lost.
 *  Language-specific fields reset to the new language's defaults. */
export function switchCodeLanguage(
	extra: WorkflowJsonRecord,
	language: CodeLanguage
): WorkflowJsonRecord {
	const source = typeof extra.source === "string" ? extra.source : "";
	const untouched =
		source.trim() === "" ||
		Object.values(CODE_STARTERS).some(
			(starter) => starter.trim() === source.trim()
		);
	const defaults = codeNodeDefaults(language);
	return {
		...extra,
		...defaults,
		mode: parseCodeMode(extra.mode),
		source: untouched ? CODE_STARTERS[language] : source,
	};
}
