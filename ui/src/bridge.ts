// The client layer the ported canvas/trigger/record components call. It mirrors
// the desktop `lib/api/{workflows,recipes,skills}.ts` surface 1:1 — SAME function
// names, SAME (target-first) signatures, SAME return types — but every call goes
// over the `window.ryu` bridge instead of a direct `fetch`. The `target` argument
// is IGNORED (the host holds the node token; the sandboxed frame never sees it),
// kept only so the copied component call-sites need no edits. Return shapes match
// the desktop clients verbatim because the host closures reuse those very clients.

import type { RyuBridge } from "./ryu.d.ts";

/** A node target the shell passes around. In the sandbox it is inert (the host
 *  owns the token); kept so the ported call-sites type-check unchanged. */
export interface ApiTarget {
	token: string | null;
	url: string;
}

function ryu(): RyuBridge {
	const b = typeof window === "undefined" ? undefined : window.ryu;
	if (!b) {
		throw new Error(
			"The workflows capability is not available for this app (grants workflows:crud/runstate/catalogs)."
		);
	}
	return b;
}

// ── Workflow definition + run types (mirror lib/api/workflows.ts) ────────────

export interface WorkflowNode {
	id: string;
	type: string;
	[key: string]: unknown;
}

export interface WorkflowEdge {
	branch?: string | null;
	from: string;
	to: string;
}

export type WorkflowTrigger =
	| { type: "manual" }
	| {
			type: "schedule";
			cron?: string | null;
			every?: string | null;
			require_approval?: boolean;
	  }
	| { type: "webhook"; secret?: string | null }
	| {
			type: "composio";
			toolkit: string;
			trigger_slug: string;
			connected_account_id?: string | null;
	  };

export interface Workflow {
	createdAt?: string | null;
	description?: string | null;
	edges: WorkflowEdge[];
	id: string;
	name: string;
	nodes: WorkflowNode[];
	triggers: WorkflowTrigger[];
	updatedAt?: string | null;
}

export type NodeStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed"
	| "skipped";

export type RunStatus = "running" | "completed" | "failed" | "awaiting_input";

export interface NodeRunState {
	error?: string | null;
	output?: string | null;
	status: NodeStatus;
}

export interface WorkflowRun {
	awaitingNode?: string | null;
	createdAt: string;
	error?: string | null;
	input: Record<string, string>;
	nodes: Record<string, NodeRunState>;
	output: Record<string, string>;
	runId: string;
	status: RunStatus;
	updatedAt: string;
	workflowId: string;
}

export interface WorkflowVersionMeta {
	createdAt: number;
	id: string;
	label: string | null;
	name: string;
	workflowId: string;
}

export type WorkflowTemplateCategory =
	| "research"
	| "orchestration"
	| "quality"
	| "automation";

export interface WorkflowTemplateMeta {
	category: WorkflowTemplateCategory;
	description: string;
	icon: string | null;
	id: string;
	name: string;
	nodeCount: number;
	pattern: string;
	sourceUrl: string | null;
	tags: string[];
}

export interface WorkflowTemplateDetail extends WorkflowTemplateMeta {
	edges: WorkflowEdge[];
	nodes: WorkflowNode[];
}

// ── Workflow CRUD / run (workflows:crud + workflows:runstate) ────────────────

export function fetchWorkflows(_t?: ApiTarget): Promise<Workflow[]> {
	return ryu().workflows.list() as Promise<Workflow[]>;
}

export function fetchWorkflow(_t: ApiTarget, id: string): Promise<Workflow> {
	return ryu().workflows.get({ id }) as Promise<Workflow>;
}

export function createWorkflow(
	_t: ApiTarget,
	definition: unknown
): Promise<Workflow> {
	return ryu().workflows.save(
		definition as Record<string, unknown>
	) as Promise<Workflow>;
}

export function deleteWorkflow(_t: ApiTarget, id: string): Promise<void> {
	return ryu().workflows.delete({ id });
}

export function runWorkflow(
	_t: ApiTarget,
	id: string,
	input: Record<string, string>
): Promise<WorkflowRun> {
	return ryu().workflows.run({ id, input }) as Promise<WorkflowRun>;
}

export function getWorkflowRun(
	_t: ApiTarget,
	runId: string
): Promise<WorkflowRun> {
	return ryu().workflows.runGet({ runId }) as Promise<WorkflowRun>;
}

export function resumeWorkflow(
	_t: ApiTarget,
	runId: string,
	payload: string
): Promise<WorkflowRun> {
	return ryu().workflows.resume({ runId, payload }) as Promise<WorkflowRun>;
}

// ── Versions (workflows:crud) ────────────────────────────────────────────────

export function listWorkflowVersions(
	_t: ApiTarget,
	id: string
): Promise<WorkflowVersionMeta[]> {
	return ryu().workflows.versionsList({ id }) as Promise<WorkflowVersionMeta[]>;
}

export function getWorkflowVersionDefinition(
	_t: ApiTarget,
	id: string,
	versionId: string
): Promise<Record<string, unknown>> {
	return ryu().workflows.versionGet({ id, versionId }) as Promise<
		Record<string, unknown>
	>;
}

export async function createWorkflowVersion(
	_t: ApiTarget,
	id: string,
	label?: string
): Promise<void> {
	await ryu().workflows.versionCreate(label ? { id, label } : { id });
}

export function restoreWorkflowVersion(
	_t: ApiTarget,
	id: string,
	versionId: string
): Promise<Workflow> {
	return ryu().workflows.versionRestore({ id, versionId }) as Promise<Workflow>;
}

// ── Template catalog (workflows:crud) ────────────────────────────────────────

export function fetchWorkflowTemplates(
	_t?: ApiTarget
): Promise<WorkflowTemplateMeta[]> {
	return ryu().workflows.templatesList() as Promise<WorkflowTemplateMeta[]>;
}

export function fetchWorkflowTemplate(
	_t: ApiTarget,
	id: string
): Promise<WorkflowTemplateDetail> {
	return ryu().workflows.templateGet({ id }) as Promise<WorkflowTemplateDetail>;
}

export function installWorkflowTemplate(
	_t: ApiTarget,
	templateId: string
): Promise<string> {
	return ryu().workflows.templateInstall({ templateId });
}

export function fetchWorkflowWebhookUrl(
	_t: ApiTarget,
	id: string
): Promise<{ url: string }> {
	return ryu().workflows.webhook({ id });
}

// ── Node-config catalog reads (workflows:catalogs) ───────────────────────────

export interface AgentSummary {
	engine?: string | null;
	id: string;
	model?: string | null;
	name: string;
	[key: string]: unknown;
}

export interface McpServer {
	description?: string | null;
	id: string;
	name: string;
	[key: string]: unknown;
}

export interface McpTool {
	description?: string | null;
	id: string;
	name: string;
	server?: string | null;
	[key: string]: unknown;
}

export interface AppInfo {
	id: string;
	name: string;
	runnables?: { id: string; name: string; kind: string }[];
	[key: string]: unknown;
}

export interface ScheduledJob {
	id: string;
	lastOutcome?: string | null;
	lastRunAt?: string | null;
	[key: string]: unknown;
}

export interface InstalledSkill {
	description?: string | null;
	id?: string;
	name: string;
	[key: string]: unknown;
}

export function fetchAgents(_t?: ApiTarget): Promise<AgentSummary[]> {
	return ryu().workflows.agents() as Promise<AgentSummary[]>;
}

export function fetchApps(_t?: ApiTarget): Promise<AppInfo[]> {
	return ryu().workflows.apps() as Promise<AppInfo[]>;
}

export function fetchMcp(
	_t?: ApiTarget
): Promise<{ servers: McpServer[]; tools: McpTool[] }> {
	return ryu().workflows.mcp() as Promise<{
		servers: McpServer[];
		tools: McpTool[];
	}>;
}

export function fetchJobs(_t?: ApiTarget): Promise<ScheduledJob[]> {
	return ryu().workflows.schedules() as Promise<ScheduledJob[]>;
}

export function listSkills(_t?: ApiTarget): Promise<InstalledSkill[]> {
	return ryu().workflows.skills() as Promise<InstalledSkill[]>;
}

// ── Composio catalog (workflows:catalogs) ────────────────────────────────────

export interface ComposioStatus {
	configured: boolean;
	[key: string]: unknown;
}

export interface ComposioToolkit {
	name: string;
	slug: string;
	[key: string]: unknown;
}

export interface ComposioTrigger {
	displayName: string;
	name: string;
	[key: string]: unknown;
}

export function fetchComposioStatus(_t?: ApiTarget): Promise<ComposioStatus> {
	return ryu().workflows.composio({
		kind: "status",
	}) as Promise<ComposioStatus>;
}

export function fetchComposioToolkits(
	_t?: ApiTarget
): Promise<ComposioToolkit[]> {
	return ryu().workflows.composio({ kind: "toolkits" }) as Promise<
		ComposioToolkit[]
	>;
}

export function fetchComposioTriggers(
	_t: ApiTarget,
	toolkit: string
): Promise<ComposioTrigger[]> {
	return ryu().workflows.composio({ kind: "triggers", toolkit }) as Promise<
		ComposioTrigger[]
	>;
}

// ── Ghost recipes (ghost:record) ─────────────────────────────────────────────

export interface RecipeSummary {
	app: string | null;
	description: string;
	name: string;
	params: string[];
	step_count: number;
}

export interface RecipeLocator {
	app?: string | null;
	dom_class?: string | null;
	dom_id?: string | null;
	identifier?: string | null;
	query?: string | null;
	role?: string | null;
}

export interface RecipeStep {
	action: string;
	id: number;
	note?: string | null;
	on_failure?: string | null;
	params?: Record<string, string> | null;
	target?: RecipeLocator | null;
}

export interface Recipe {
	app?: string | null;
	description: string;
	name: string;
	on_failure?: string | null;
	params?: Record<string, unknown> | null;
	preconditions?: unknown;
	schema_version: number;
	steps: RecipeStep[];
}

export interface RecordingState {
	recording: boolean;
	started_at?: string;
	status?: unknown;
	task?: string;
}

export interface LearnedEvent {
	app_name?: string | null;
	element_id?: string | null;
	element_name?: string | null;
	element_role?: string | null;
	event_type: string;
	key?: string | null;
	ts_ms: number;
	x?: number | null;
	y?: number | null;
}

export interface RecordingStopResult {
	draft?: Recipe;
	event_count: number;
	events: LearnedEvent[];
	recording: false;
	started_at: string;
	suggestion?: string;
	task: string;
}

export function listRecipes(_t?: ApiTarget): Promise<RecipeSummary[]> {
	return ryu().ghost.recipes() as Promise<RecipeSummary[]>;
}

export function startRecording(
	_t: ApiTarget,
	task: string
): Promise<RecordingState> {
	return ryu().ghost.recordStart({ task }) as Promise<RecordingState>;
}

export function getRecordingStatus(_t?: ApiTarget): Promise<RecordingState> {
	return ryu().ghost.recordStatus() as Promise<RecordingState>;
}

export function stopRecording(_t?: ApiTarget): Promise<RecordingStopResult> {
	return ryu().ghost.recordStop() as Promise<RecordingStopResult>;
}

/** Slugify a task description into a safe recipe name. */
function slugify(task: string): string {
	const slug = task
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "");
	return slug || "recorded-recipe";
}

/** Build an editable recipe draft from a captured action sequence (offline
 *  fallback for older Core builds that don't return a `draft`). Copied verbatim
 *  from the desktop `lib/api/recipes.ts`. */
export function draftRecipeFromEvents(
	task: string,
	events: LearnedEvent[]
): Recipe {
	const steps: RecipeStep[] = events.map((e, i): RecipeStep => {
		const id = i + 1;
		const target: RecipeLocator | null =
			e.element_name || e.element_role || e.element_id || e.app_name
				? {
						query: e.element_name ?? null,
						role: e.element_role ?? null,
						identifier: e.element_id ?? null,
						app: e.app_name ?? null,
					}
				: null;
		switch (e.event_type) {
			case "type":
				return { id, action: "type", target, params: { text: e.key ?? "" } };
			case "press":
				return { id, action: "press", params: { key: e.key ?? "" } };
			case "hotkey":
				return { id, action: "hotkey", params: { keys: e.key ?? "" } };
			case "scroll":
				return { id, action: "scroll", params: { direction: e.key ?? "down" } };
			case "app_switch":
				return { id, action: "focus", params: { app: e.app_name ?? "" } };
			default:
				return {
					id,
					action: "click",
					target,
					note: e.element_name ?? undefined,
				};
		}
	});
	return {
		schema_version: 2,
		name: slugify(task),
		description: task || "Recorded workflow",
		app: events.find((e) => e.app_name)?.app_name ?? null,
		params: {},
		steps,
		on_failure: "abort",
	};
}
