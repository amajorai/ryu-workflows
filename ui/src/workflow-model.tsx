import {
	ArrowDown01Icon,
	ArrowRight01Icon,
	BotIcon,
	CircleIcon,
	Clock01Icon,
	CodeIcon,
	Database01Icon,
	GitBranchIcon,
	Note01Icon,
	Notification01Icon,
	PauseIcon,
	PlugSocketIcon,
	PuzzleIcon,
	RecordIcon,
	RepeatIcon,
	RoboticIcon,
	Shield01Icon,
	SparklesIcon,
	WebhookIcon,
	WorkflowSquare01Icon,
	ZapIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import type { NodeStatus } from "./bridge.ts";

// --- Node kind metadata ---------------------------------------------------

/** Every NodeKind variant Core supports, serialised as snake_case. */
export type CoreNodeType =
	| "input"
	| "output"
	| "prompt"
	| "condition"
	| "transform"
	| "set_state"
	| "tool"
	| "webhook"
	| "delay"
	| "sub_workflow"
	| "agent_delegate"
	| "note"
	| "while"
	| "guardrails"
	| "recipe"
	| "ghost_action"
	| "awakeable"
	| "agent"
	| "skill"
	| "mcp"
	| "plugin"
	| "notify_user"
	| "channel_send";

export interface NodeMeta {
	color: string;
	/** Default extra fields when adding a new node of this kind. */
	defaults: Record<string, unknown>;
	icon: ReactNode;
	label: string;
}

export const NODE_META: Record<CoreNodeType, NodeMeta> = {
	input: {
		label: "Input",
		color: "bg-info",
		icon: <HugeiconsIcon className="size-3" icon={ArrowRight01Icon} />,
		defaults: { key: null },
	},
	output: {
		label: "Output",
		color: "bg-success",
		icon: <HugeiconsIcon className="size-3" icon={ArrowDown01Icon} />,
		defaults: { key: null },
	},
	prompt: {
		// Labelled "Agent": the underlying NodeKind wire shape stays `prompt` so
		// existing saved workflows continue to load. When an agent is picked the node
		// routes to the real configured agent; otherwise it falls back to the default
		// LLM via the gateway.
		label: "Agent",
		color: "bg-purple-500",
		icon: <HugeiconsIcon className="size-3" icon={BotIcon} />,
		defaults: { prompt: "Summarise: {{input}}", agent_id: null },
	},
	condition: {
		label: "Condition",
		color: "bg-warning",
		icon: <HugeiconsIcon className="size-3" icon={GitBranchIcon} />,
		defaults: { expr: 'input != ""' },
	},
	transform: {
		label: "Transform",
		color: "bg-orange-500",
		icon: <HugeiconsIcon className="size-3" icon={CodeIcon} />,
		defaults: { op: "uppercase", template: null },
	},
	set_state: {
		label: "Set State",
		color: "bg-cyan-500",
		icon: <HugeiconsIcon className="size-3" icon={Database01Icon} />,
		defaults: { key: "", value: "{{input}}" },
	},
	tool: {
		label: "Tool",
		color: "bg-teal-500",
		icon: <HugeiconsIcon className="size-3" icon={ZapIcon} />,
		defaults: { name: "ghost", args: {} },
	},
	webhook: {
		label: "Webhook",
		color: "bg-pink-500",
		icon: <HugeiconsIcon className="size-3" icon={WebhookIcon} />,
		defaults: { url: "https://example.com/hook", method: "POST" },
	},
	delay: {
		label: "Delay",
		color: "bg-slate-500",
		icon: <HugeiconsIcon className="size-3" icon={Clock01Icon} />,
		defaults: { ms: 1000 },
	},
	sub_workflow: {
		label: "Sub-workflow",
		color: "bg-indigo-500",
		icon: <HugeiconsIcon className="size-3" icon={WorkflowSquare01Icon} />,
		defaults: { workflow_id: "" },
	},
	agent_delegate: {
		label: "Agent Delegate",
		color: "bg-destructive",
		icon: <HugeiconsIcon className="size-3" icon={CircleIcon} />,
		defaults: { delegates: [], caps: null },
	},
	note: {
		label: "Note",
		color: "bg-warning",
		icon: <HugeiconsIcon className="size-3" icon={Note01Icon} />,
		defaults: { text: "" },
	},
	while: {
		label: "While",
		color: "bg-warning",
		icon: <HugeiconsIcon className="size-3" icon={RepeatIcon} />,
		defaults: { expr: 'input != ""' },
	},
	guardrails: {
		label: "Guardrails",
		color: "bg-destructive",
		icon: <HugeiconsIcon className="size-3" icon={Shield01Icon} />,
		defaults: { checks: ["pii"] },
	},
	recipe: {
		// Replays a recorded ghost desktop-automation recipe (ghost-os parity).
		// Params are templates resolved against the run context before replay.
		label: "Recipe",
		color: "bg-success",
		icon: <HugeiconsIcon className="size-3" icon={RecordIcon} />,
		defaults: { recipe: "", params: {} },
	},
	ghost_action: {
		// A single recorded desktop action (one click/type/scroll). Produced by the
		// in-canvas record flow so a recording shows up as a visible step-per-node
		// chain; runs through the matching ghost action tool.
		label: "Action",
		color: "bg-success",
		icon: <HugeiconsIcon className="size-3" icon={ZapIcon} />,
		defaults: { action: "click", target: {}, params: {} },
	},
	awakeable: {
		// Human-in-the-loop pause/resume gate. Core suspends the run here until the
		// resume endpoint is called; the canvas must round-trip the variant so an
		// open+save never corrupts an Awakeable node into a no-op transform.
		label: "Pause for review",
		color: "bg-fuchsia-600",
		icon: <HugeiconsIcon className="size-3" icon={PauseIcon} />,
		defaults: { prompt: null },
	},
	agent: {
		// Runs a single configured agent on a task (agent runner). Unlike the
		// Prompt node you pick an agent and give it a task rather than authoring a
		// raw LLM prompt; unlike Agent Delegate it is one in-context step.
		label: "Agent",
		color: "bg-violet-600",
		icon: <HugeiconsIcon className="size-3" icon={RoboticIcon} />,
		defaults: { agent_id: "", task: "{{input}}" },
	},
	skill: {
		// Applies an installed Agent Skill: its instruction body + the task run
		// through the chosen agent (or the default gateway LLM when none is set).
		label: "Skill",
		color: "bg-amber-500",
		icon: <HugeiconsIcon className="size-3" icon={SparklesIcon} />,
		defaults: { skill: "", agent_id: null, task: "{{input}}" },
	},
	mcp: {
		// Explicit server + tool form of a Tool node; joined into `<server>.<tool>`
		// for the MCP registry so authors pick each part separately.
		label: "MCP",
		color: "bg-teal-600",
		icon: <HugeiconsIcon className="size-3" icon={PlugSocketIcon} />,
		defaults: { server: "", tool: "", args: {} },
	},
	plugin: {
		// Invokes a Runnable an installed plugin bundles (tool/agent/skill/workflow);
		// dispatched to that kind's execution path by the Core executor.
		label: "Plugin",
		color: "bg-indigo-600",
		icon: <HugeiconsIcon className="size-3" icon={PuzzleIcon} />,
		defaults: { plugin_id: "", runnable_id: "", args: {} },
	},
	notify_user: {
		// Writes an app-inbox notification to the target audience (org/team/members).
		// With ack_mode "none" it is fire-and-forget; any other mode makes it a HITL
		// gate that suspends the run until the ack policy (first/all/quorum) is met.
		label: "Notify user",
		color: "bg-sky-500",
		icon: <HugeiconsIcon className="size-3" icon={Notification01Icon} />,
		defaults: {
			target: { kind: "org" },
			title: "",
			body: "",
			ack_mode: { mode: "none" },
		},
	},
	channel_send: {
		// Sends a message OUT to an external chat channel (Telegram/Slack/Discord/
		// webhook), addressed by recipient. Distinct from notify_user, which pings
		// org members through the in-app inbox.
		label: "Send to channel",
		color: "bg-emerald-600",
		icon: <HugeiconsIcon className="size-3" icon={WebhookIcon} />,
		defaults: {
			platform: "telegram",
			recipient: "",
			text: "",
		},
	},
};

// Neutral fallback for a node whose `type` is not (yet) in NODE_META — e.g. a
// future Core variant this desktop build doesn't know. Rendered as "Unknown" and
// its original `type` is carried through verbatim on save so it round-trips
// losslessly instead of being silently rewritten.
export const UNKNOWN_NODE_META: NodeMeta = {
	label: "Unknown",
	color: "bg-zinc-500",
	icon: <HugeiconsIcon className="size-3" icon={CircleIcon} />,
	defaults: {},
};

// --- Per-run node status colours ------------------------------------------

export const STATUS_RING: Record<NodeStatus, string> = {
	pending: "ring-muted",
	running: "ring-warning animate-pulse",
	completed: "ring-success",
	failed: "ring-destructive",
	skipped: "ring-slate-400",
};

/** Badge variant for a workflow node/run status. */
export function statusBadgeVariant(
	status: string
): "default" | "destructive" | "secondary" {
	if (status === "completed") {
		return "default";
	}
	if (status === "failed") {
		return "destructive";
	}
	return "secondary";
}

/** Outer ring class for a canvas node based on selection + run status. */
export function nodeRingClass(selected: boolean, ring: string): string {
	if (selected) {
		return "ring-2 ring-primary";
	}
	if (ring) {
		return `ring-2 ${ring}`;
	}
	return "ring-white/10";
}

export interface CanvasNodeData extends Record<string, unknown> {
	coreType: CoreNodeType;
	isSelected?: boolean;
	label: string;
	runStatus?: NodeStatus | null;
}
