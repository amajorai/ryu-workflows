// The client layer the ported canvas/trigger/record components call. It mirrors
// the desktop `lib/api/{workflows,recipes,skills}.ts` surface 1:1 — SAME function
// names, SAME (target-first) signatures, SAME return types — but every call goes
// over the `window.ryu` bridge instead of a direct `fetch`. The `target` argument
// is IGNORED (the host holds the node token; the sandboxed frame never sees it),
// kept only so the copied component call-sites need no edits. Return shapes match
// the desktop clients verbatim because the host closures reuse those very clients.

import type { RyuCatalogSnapshot } from "@ryu/app-host/app-bridge";
import { z } from "zod";
import type {
	AppInfo,
	ComposioStatus,
	ComposioToolkit,
	ComposioTrigger,
	HookEventInfo,
	InstalledSkill,
	LearnedEvent,
	McpServer,
	McpTool,
	NotifyTargetUser,
	Recipe,
	RecipeLocator,
	RecipeStep,
	RecipeSummary,
	RecordingState,
	RecordingStopResult,
	ScheduledJob,
	Workflow,
	WorkflowDefinition,
	WorkflowRun,
	WorkflowTemplateDetail,
	WorkflowTemplateMeta,
	WorkflowVersionMeta,
} from "./schemas.ts";
import {
	appInfoSchema,
	composioStatusSchema,
	composioToolkitSchema,
	composioTriggerSchema,
	ghostRecipeSummariesSchema,
	ghostRecordingStateSchema,
	ghostRecordingStopSchema,
	hookEventInfoSchema,
	installedSkillSchema,
	mcpCatalogSchema,
	notifyTargetUserSchema,
	scheduledJobSchema,
	workflowDefinitionSchema,
	workflowRunSchema,
	workflowSchema,
	workflowTemplateDetailSchema,
	workflowTemplateMetaSchema,
	workflowVersionMetaSchema,
} from "./schemas.ts";

export type {
	AppInfo,
	ComposioStatus,
	ComposioToolkit,
	ComposioTrigger,
	HookEventInfo,
	InstalledSkill,
	LearnedEvent,
	McpServer,
	McpTool,
	NodeRunState,
	NodeStatus,
	NotifyTargetUser,
	Recipe,
	RecipeLocator,
	RecipeStep,
	RecipeSummary,
	RecordingState,
	RecordingStopResult,
	RunStatus,
	ScheduledJob,
	Workflow,
	WorkflowDefinition,
	WorkflowEdge,
	WorkflowNode,
	WorkflowRun,
	WorkflowTemplateCategory,
	WorkflowTemplateDetail,
	WorkflowTemplateMeta,
	WorkflowTrigger,
	WorkflowVersionMeta,
} from "./schemas.ts";

import type { RyuBridge } from "./ryu.d.ts";

/** A node target the shell passes around. In the sandbox it is inert (the host
 *  owns the token); kept so the ported call-sites type-check unchanged. */
export interface ApiTarget {
	token: string | null;
	url: string;
}

function ryu(): RyuBridge {
	const b = globalThis.window?.ryu;
	if (!b) {
		throw new Error(
			"The workflows capability is not available for this app (grants workflows:crud/runstate/catalogs)."
		);
	}
	return b;
}

// ── Workflow definition + run types (mirror lib/api/workflows.ts) ────────────

// ── Workflow CRUD / run (workflows:crud + workflows:runstate) ────────────────

export function fetchWorkflows(_t?: ApiTarget): Promise<Workflow[]> {
	return ryu()
		.workflows.list()
		.then((reply) => workflowSchema.array().parse(reply));
}

export function fetchWorkflow(_t: ApiTarget, id: string): Promise<Workflow> {
	return ryu()
		.workflows.get({ id })
		.then((reply) => workflowSchema.parse(reply));
}

export function createWorkflow(
	_t: ApiTarget,
	definition: WorkflowDefinition
): Promise<Workflow> {
	return ryu()
		.workflows.save(workflowDefinitionSchema.parse(definition))
		.then((reply) => workflowSchema.parse(reply));
}

export function deleteWorkflow(_t: ApiTarget, id: string): Promise<void> {
	return ryu().workflows.delete({ id });
}

export function runWorkflow(
	_t: ApiTarget,
	id: string,
	input: Record<string, string>,
	options: { dryRun?: boolean } = {}
): Promise<WorkflowRun> {
	return ryu()
		.workflows.run({
			id,
			input,
			dryRun: options.dryRun,
		})
		.then((reply) => workflowRunSchema.parse(reply));
}

export function getWorkflowRun(
	_t: ApiTarget,
	runId: string
): Promise<WorkflowRun> {
	return ryu()
		.workflows.runGet({ runId })
		.then((reply) => workflowRunSchema.parse(reply));
}

export function resumeWorkflow(
	_t: ApiTarget,
	runId: string,
	payload: string
): Promise<WorkflowRun> {
	return ryu()
		.workflows.resume({ runId, payload })
		.then((reply) => workflowRunSchema.parse(reply));
}

// ── Versions (workflows:crud) ────────────────────────────────────────────────

export function listWorkflowVersions(
	_t: ApiTarget,
	id: string
): Promise<WorkflowVersionMeta[]> {
	return ryu()
		.workflows.versionsList({ id })
		.then((reply) => workflowVersionMetaSchema.array().parse(reply));
}

export function getWorkflowVersionDefinition(
	_t: ApiTarget,
	id: string,
	versionId: string
): Promise<WorkflowDefinition> {
	return ryu()
		.workflows.versionGet({ id, versionId })
		.then((reply) => workflowDefinitionSchema.parse(reply));
}

export async function createWorkflowVersion(
	_t: ApiTarget,
	id: string,
	label?: string,
	expectedRevision?: string
): Promise<void> {
	const args: Parameters<RyuBridge["workflows"]["versionCreate"]>[0] = { id };
	if (label) {
		args.label = label;
	}
	if (expectedRevision !== undefined) {
		args.expectedRevision = expectedRevision;
	}
	await ryu().workflows.versionCreate(args);
}

export function restoreWorkflowVersion(
	_t: ApiTarget,
	id: string,
	versionId: string
): Promise<Workflow> {
	return ryu()
		.workflows.versionRestore({ id, versionId })
		.then((reply) => workflowSchema.parse(reply));
}

// ── Template catalog (workflows:crud) ────────────────────────────────────────

export function fetchWorkflowTemplates(
	_t?: ApiTarget
): Promise<WorkflowTemplateMeta[]> {
	return ryu()
		.workflows.templatesList()
		.then((reply) => workflowTemplateMetaSchema.array().parse(reply));
}

export function fetchWorkflowTemplate(
	_t: ApiTarget,
	id: string
): Promise<WorkflowTemplateDetail> {
	return ryu()
		.workflows.templateGet({ id })
		.then((reply) => workflowTemplateDetailSchema.parse(reply));
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

/** Read the shared Ryu provider/agent catalog used by the node pickers. */
export function fetchRuntimeCatalog(): Promise<RyuCatalogSnapshot> {
	return ryu().catalog.snapshot();
}

export function fetchApps(_t?: ApiTarget): Promise<AppInfo[]> {
	return ryu()
		.workflows.apps()
		.then((reply) => appInfoSchema.array().parse(reply));
}

export function fetchMcp(
	_t?: ApiTarget
): Promise<{ servers: McpServer[]; tools: McpTool[] }> {
	return ryu()
		.workflows.mcp()
		.then((reply) => mcpCatalogSchema.parse(reply));
}

export function fetchJobs(_t?: ApiTarget): Promise<ScheduledJob[]> {
	return ryu()
		.workflows.schedules()
		.then((reply) => scheduledJobSchema.array().parse(reply));
}

/** Read the verified organization roster used by NotifyUser's multi-person picker. */
export function fetchNotifyTargetUsers(): Promise<NotifyTargetUser[]> {
	return ryu()
		.workflows.notifyTargets()
		.then((reply) => notifyTargetUserSchema.array().parse(reply));
}

export function listSkills(_t?: ApiTarget): Promise<InstalledSkill[]> {
	return ryu()
		.workflows.skills()
		.then((reply) => installedSkillSchema.array().parse(reply));
}

/** One app event an enabled app declares it emits — the catalog behind the `event`
 *  trigger's picker. */

export function fetchHookEvents(_t?: ApiTarget): Promise<HookEventInfo[]> {
	return ryu()
		.workflows.hookEvents()
		.then((reply) => hookEventInfoSchema.array().parse(reply));
}

// ── Composio catalog (workflows:catalogs) ────────────────────────────────────

export function fetchComposioStatus(_t?: ApiTarget): Promise<ComposioStatus> {
	return ryu()
		.workflows.composio({
			kind: "status",
		})
		.then((reply) => composioStatusSchema.parse(reply));
}

export function fetchComposioToolkits(
	_t?: ApiTarget
): Promise<ComposioToolkit[]> {
	return ryu()
		.workflows.composio({ kind: "toolkits" })
		.then((reply) => composioToolkitSchema.array().parse(reply));
}

export function fetchComposioTriggers(
	_t: ApiTarget,
	toolkit: string
): Promise<ComposioTrigger[]> {
	return ryu()
		.workflows.composio({ kind: "triggers", toolkit })
		.then((reply) => composioTriggerSchema.array().parse(reply));
}

// ── Ghost recipes ───────────────────────────────────────────────────────────

/** The Recipes app, whose sidecar serves the recipe list. */
const RECIPES_APP_ID = "@ryu/recipes";

/** The Recipes list route's reply (`GET /` on the Recipes mount). */
const recipesListReplySchema = z.object({
	recipes: ghostRecipeSummariesSchema.optional(),
});

/** The recipe list, read from the Recipes app's own route through the generic
 *  cross-app bridge (`app.request`, grant `app:http:@ryu/recipes`). A host that
 *  predates the cross-app bridge (or refuses it) falls back to the legacy
 *  `ghost.recipes` verb (grant `ghost:record`). */
export async function listRecipes(_t?: ApiTarget): Promise<RecipeSummary[]> {
	const bridge = ryu();
	if (bridge.app) {
		try {
			const reply = await bridge.app.request({
				app: RECIPES_APP_ID,
				method: "GET",
				path: "/",
			});
			return recipesListReplySchema.parse(reply).recipes ?? [];
		} catch {
			// An older host or a denied grant: use the legacy verb below.
		}
	}
	return ghostRecipeSummariesSchema.parse(await bridge.ghost.recipes());
}

export function startRecording(
	_t: ApiTarget,
	task: string
): Promise<RecordingState> {
	return ryu()
		.ghost.recordStart({ task })
		.then((reply) => ghostRecordingStateSchema.parse(reply));
}

export function getRecordingStatus(_t?: ApiTarget): Promise<RecordingState> {
	return ryu()
		.ghost.recordStatus()
		.then((reply) => ghostRecordingStateSchema.parse(reply));
}

export function stopRecording(_t?: ApiTarget): Promise<RecordingStopResult> {
	return ryu()
		.ghost.recordStop()
		.then((reply) => ghostRecordingStopSchema.parse(reply));
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
