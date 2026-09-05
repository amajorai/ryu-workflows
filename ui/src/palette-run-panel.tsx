import { Add01Icon, Cancel01Icon, PlayIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Badge,
	Button,
	Checkbox,
	Input,
	Label,
	Spinner,
	Textarea,
} from "@ryu/blocks/companion/controls";
import { type ChangeEvent, useState } from "react";
import type { WorkflowRun } from "./bridge.ts";
import {
	type CoreNodeType,
	NODE_META,
	statusBadgeVariant,
} from "./workflow-model.tsx";

const PALETTE_GROUPS: { label: string; kinds: CoreNodeType[] }[] = [
	{
		label: "Core",
		kinds: ["input", "prompt", "agent", "agent_delegate", "note"],
	},
	{
		label: "Runnables",
		kinds: ["skill", "mcp", "plugin"],
	},
	{ label: "Tool", kinds: ["tool", "recipe", "ghost_action", "guardrails"] },
	{
		label: "Logic",
		kinds: ["condition", "while", "awakeable"],
	},
	{
		label: "Data",
		kinds: ["transform", "set_state", "sub_workflow", "delay", "webhook"],
	},
	{ label: "Output", kinds: ["output", "notify_user", "channel_send"] },
];

interface PaletteProps {
	onAdd: (kind: CoreNodeType) => void;
	onClose: () => void;
}

function PaletteRow({
	kind,
	onAdd,
}: {
	kind: CoreNodeType;
	onAdd: (kind: CoreNodeType) => void;
}) {
	const meta = NODE_META[kind];
	return (
		<Button
			className="h-auto w-full justify-start rounded-lg px-2 py-1.5 text-left text-xs"
			onClick={() => onAdd(kind)}
			type="button"
			variant="ghost"
		>
			<span
				aria-hidden
				className={`flex size-5 shrink-0 items-center justify-center rounded-md ${meta.color} text-white`}
			>
				{meta.icon}
			</span>
			<span className="min-w-0 flex-1 truncate">{meta.label}</span>
			<HugeiconsIcon
				className="size-3 shrink-0 text-muted-foreground/40"
				icon={Add01Icon}
			/>
		</Button>
	);
}

export function Palette({ onAdd, onClose }: PaletteProps) {
	const [query, setQuery] = useState("");
	const q = query.trim().toLowerCase();
	const groups = PALETTE_GROUPS.map((group) => ({
		label: group.label,
		kinds: group.kinds.filter(
			(k) => !q || NODE_META[k].label.toLowerCase().includes(q)
		),
	})).filter((group) => group.kinds.length > 0);

	return (
		<div className="flex max-h-[calc(100vh-13rem)] w-52 flex-col gap-2 rounded-xl bg-popover/95 p-2 shadow-xl ring-1 ring-white/10 backdrop-blur">
			<div className="flex items-center justify-between pl-1">
				<span className="font-medium text-muted-foreground text-xs">
					Add node
				</span>
				<Button
					aria-label="Hide palette"
					className="size-6"
					onClick={onClose}
					size="icon"
					variant="ghost"
				>
					<HugeiconsIcon className="size-3.5" icon={Cancel01Icon} />
				</Button>
			</div>
			<Input
				className="h-7 text-xs"
				onChange={(e: ChangeEvent<HTMLInputElement>) =>
					setQuery(e.target.value)
				}
				placeholder="Search nodes"
				value={query}
			/>
			<div className="flex flex-col gap-2 overflow-y-auto">
				{groups.length === 0 ? (
					<p className="px-1 py-2 text-muted-foreground text-xs">No matches</p>
				) : (
					groups.map((group) => (
						<div className="flex flex-col gap-0.5" key={group.label}>
							<span className="px-1 text-[10px] text-muted-foreground/50 uppercase tracking-wide">
								{group.label}
							</span>
							{group.kinds.map((kind) => (
								<PaletteRow key={kind} kind={kind} onAdd={onAdd} />
							))}
						</div>
					))
				)}
			</div>
		</div>
	);
}

// --- Run inputs dialog (inline panel) ------------------------------------

interface RunPanelProps {
	inputKeys: string[];
	onClose: () => void;
	onRun: (inputs: Record<string, string>, dryRun: boolean) => void;
	result: WorkflowRun | null;
	runError: string | null;
	running: boolean;
}

export function RunPanel({
	inputKeys,
	running,
	result,
	runError,
	onRun,
	onClose,
}: RunPanelProps) {
	const [inputs, setInputs] = useState<Record<string, string>>(() =>
		Object.fromEntries(inputKeys.map((k) => [k, ""]))
	);
	const [dryRun, setDryRun] = useState(false);

	return (
		<div className="flex w-64 flex-col gap-3 rounded-xl bg-popover/95 p-3 shadow-xl ring-1 ring-white/10 backdrop-blur">
			<div className="flex items-center justify-between">
				<span className="font-medium text-sm">Run workflow</span>
				<Button onClick={onClose} size="sm" variant="ghost">
					×
				</Button>
			</div>
			{inputKeys.length === 0 ? (
				<p className="text-muted-foreground text-xs">
					No inputs — run immediately.
				</p>
			) : (
				inputKeys.map((key) => (
					<div className="flex flex-col gap-1" key={key}>
						<Label htmlFor={`run-${key}`}>{key}</Label>
						<Textarea
							className="h-14 text-xs"
							id={`run-${key}`}
							onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
								setInputs((p) => ({ ...p, [key]: e.target.value }))
							}
							value={inputs[key] ?? ""}
						/>
					</div>
				))
			)}
			<div className="rounded-lg border border-border/70 bg-background/40 px-2 py-2">
				<Label className="flex cursor-pointer items-center gap-2 text-xs">
					<Checkbox
						checked={dryRun}
						id="workflow-dry-run"
						onCheckedChange={(checked) => setDryRun(checked === true)}
					/>
					<span className="font-medium">Dry run</span>
				</Label>
				<p className="mt-1 pl-6 text-[11px] text-muted-foreground">
					Read-only preview. Writes, messages, and other effects are skipped.
				</p>
			</div>
			{runError ? (
				<p className="text-destructive text-xs" role="alert">
					{runError}
				</p>
			) : null}
			{result ? (
				<div className="flex flex-col gap-1 rounded-lg p-2 text-xs ring-1 ring-white/10">
					{result.dryRun ? (
						<p className="font-medium text-info">
							Read-only dry run — no changes made
						</p>
					) : null}
					<div className="flex items-center justify-between">
						<span className="font-medium">Result</span>
						<Badge variant={statusBadgeVariant(result.status)}>
							{result.status}
						</Badge>
					</div>
					{result.error ? (
						<p className="text-destructive">{result.error}</p>
					) : null}
					{Object.entries(result.output).map(([k, v]) => (
						<div className="flex gap-2" key={k}>
							<span className="font-mono text-muted-foreground">{k}</span>
							<span className="break-all font-mono">{v}</span>
						</div>
					))}
				</div>
			) : null}
			<Button
				className="w-full"
				disabled={running}
				onClick={() => onRun(inputs, dryRun)}
				size="sm"
			>
				{running ? (
					<Spinner className="size-3" />
				) : (
					<HugeiconsIcon className="size-3" icon={PlayIcon} />
				)}
				{dryRun ? "Preview" : "Run"}
			</Button>
		</div>
	);
}

// --- Main WorkflowCanvas component ----------------------------------------
