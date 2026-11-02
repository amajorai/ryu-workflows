import {
	ghostRecipeSummariesSchema,
	ghostRecordingStateSchema,
	ghostRecordingStopSchema,
} from "@ryu/app-host/rpc";

export type {
	LearnedEvent,
	Recipe,
	RecipeLocator,
	RecipeStep,
	RecipeSummary,
} from "@ryuhq/core-client/recipes";

import { z } from "zod";

/** Node configurations and recipe extensions are JSON wire data, including
 * fields belonging to future Core node kinds that this canvas must preserve. */
export const workflowJsonValueSchema = z.json();
export const workflowJsonRecordSchema = z.record(
	z.string(),
	workflowJsonValueSchema
);
export type WorkflowJsonValue = z.infer<typeof workflowJsonValueSchema>;
export type WorkflowJsonRecord = z.infer<typeof workflowJsonRecordSchema>;
const optionalText = z.string().nullable().optional();
export const workflowNodeSchema = z
	.object({ id: z.string(), type: z.string() })
	.catchall(workflowJsonValueSchema);
export const workflowEdgeSchema = z.object({
	branch: optionalText,
	from: z.string(),
	to: z.string(),
});
export const workflowTriggerSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("manual") }),
	z.object({
		type: z.literal("schedule"),
		cron: optionalText,
		every: optionalText,
		require_approval: z.boolean().optional(),
	}),
	z.object({ type: z.literal("webhook"), secret: optionalText }),
	z.object({
		type: z.literal("composio"),
		toolkit: z.string(),
		trigger_slug: z.string(),
		connected_account_id: optionalText,
	}),
	z.object({ type: z.literal("event"), event: z.string() }),
]);
export const workflowDefinitionSchema = z
	.object({
		id: z.string().optional(),
		name: z.string(),
		description: optionalText,
		nodes: z.array(workflowNodeSchema),
		edges: z.array(workflowEdgeSchema).default([]),
		triggers: z.array(workflowTriggerSchema).default([]),
	})
	.catchall(workflowJsonValueSchema.optional());
export const workflowSchema = workflowDefinitionSchema.extend({
	id: z.string(),
	createdAt: optionalText,
	updatedAt: optionalText,
});
export const nodeStatusSchema = z.enum([
	"pending",
	"running",
	"completed",
	"failed",
	"skipped",
]);
export const runStatusSchema = z.enum([
	"running",
	"completed",
	"failed",
	"awaiting_input",
	"waiting",
]);
export const nodeRunStateSchema = z.object({
	error: optionalText,
	output: optionalText,
	status: nodeStatusSchema,
});
export const workflowRunSchema = z.object({
	awaitingNode: optionalText,
	createdAt: z.string(),
	dryRun: z.boolean(),
	error: optionalText,
	input: z.record(z.string(), z.string()),
	nodes: z.record(z.string(), nodeRunStateSchema),
	output: z.record(z.string(), z.string()),
	resumeAt: optionalText,
	runId: z.string(),
	status: runStatusSchema,
	updatedAt: z.string(),
	waitReason: optionalText,
	workflowId: z.string(),
});
export const workflowVersionMetaSchema = z.object({
	createdAt: z.number(),
	id: z.string(),
	label: z.string().nullable(),
	name: z.string(),
	workflowId: z.string(),
});
export const workflowTemplateCategorySchema = z.enum([
	"research",
	"orchestration",
	"quality",
	"automation",
]);
export const workflowTemplateMetaSchema = z.object({
	category: workflowTemplateCategorySchema,
	description: z.string(),
	icon: z.string().nullable(),
	id: z.string(),
	name: z.string(),
	nodeCount: z.number(),
	pattern: z.string(),
	sourceUrl: z.string().nullable(),
	tags: z.array(z.string()),
});
export const workflowTemplateDetailSchema = workflowTemplateMetaSchema.extend({
	nodes: z.array(workflowNodeSchema),
	edges: z.array(workflowEdgeSchema).default([]),
});
export const mcpServerSchema = z
	.object({ description: optionalText, id: z.string(), name: z.string() })
	.catchall(workflowJsonValueSchema.optional());
export const mcpToolSchema = mcpServerSchema.extend({ server: optionalText });
export const mcpCatalogSchema = z.object({
	servers: z.array(mcpServerSchema),
	tools: z.array(mcpToolSchema),
});
export const appInfoSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		runnables: z
			.array(z.object({ id: z.string(), name: z.string(), kind: z.string() }))
			.optional(),
	})
	.catchall(workflowJsonValueSchema.optional());
export const scheduledJobSchema = z
	.object({
		id: z.string(),
		lastOutcome: optionalText,
		lastRunAt: optionalText,
	})
	.catchall(workflowJsonValueSchema.optional());
export const installedSkillSchema = z
	.object({
		description: optionalText,
		id: z.string().optional(),
		name: z.string(),
	})
	.catchall(workflowJsonValueSchema.optional());
export const notifyTargetUserSchema = z.object({
	email: z.string().nullable(),
	id: z.string(),
	image: z.string().nullable(),
	name: z.string(),
	role: z.string().nullable(),
});
export const hookEventInfoSchema = z.object({
	description: z.string().optional(),
	id: z.string(),
	payload_example: workflowJsonRecordSchema.optional(),
	plugin: z.string().optional(),
	title: z.string(),
});
export const composioStatusSchema = z
	.object({
		configured: z.boolean(),
		executionOwner: z.literal("connect").optional(),
	})
	.catchall(workflowJsonValueSchema.optional());
export const composioToolkitSchema = z
	.object({ name: z.string(), slug: z.string() })
	.catchall(workflowJsonValueSchema);
export const composioTriggerSchema = z
	.object({ displayName: z.string(), name: z.string() })
	.catchall(workflowJsonValueSchema);
export const triggerSubscriptionSchema = z.object({
	agentId: z.string(),
	composioTriggerId: z.string().nullable(),
	connectedAccountId: z.string(),
	createdAt: z.string(),
	id: z.string(),
	targetKind: z.enum(["agent", "workflow"]).optional(),
	toolkit: z.string(),
	triggerSlug: z.string(),
	workflowId: z.string().optional(),
});
export const workflowPositionsSchema = z.record(
	z.string(),
	z.object({ x: z.number(), y: z.number() })
);
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type WorkflowTrigger = z.infer<typeof workflowTriggerSchema>;
export type Workflow = z.infer<typeof workflowSchema>;
export type NodeStatus = z.infer<typeof nodeStatusSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type NodeRunState = z.infer<typeof nodeRunStateSchema>;
export type WorkflowRun = z.infer<typeof workflowRunSchema>;
export type WorkflowVersionMeta = z.infer<typeof workflowVersionMetaSchema>;
export type WorkflowTemplateCategory = z.infer<
	typeof workflowTemplateCategorySchema
>;
export type WorkflowTemplateMeta = z.infer<typeof workflowTemplateMetaSchema>;
export type WorkflowTemplateDetail = z.infer<
	typeof workflowTemplateDetailSchema
>;
export type McpServer = z.infer<typeof mcpServerSchema>;
export type McpTool = z.infer<typeof mcpToolSchema>;
export type AppInfo = z.infer<typeof appInfoSchema>;
export type ScheduledJob = z.infer<typeof scheduledJobSchema>;
export type InstalledSkill = z.infer<typeof installedSkillSchema>;
export type NotifyTargetUser = z.infer<typeof notifyTargetUserSchema>;
export type HookEventInfo = z.infer<typeof hookEventInfoSchema>;
export type ComposioStatus = z.infer<typeof composioStatusSchema>;
export type ComposioToolkit = z.infer<typeof composioToolkitSchema>;
export type ComposioTrigger = z.infer<typeof composioTriggerSchema>;
export type RecordingState = z.infer<typeof ghostRecordingStateSchema>;
export type RecordingStopResult = z.infer<typeof ghostRecordingStopSchema>;
export interface WorkflowDefinition {
	description?: string | null;
	edges: WorkflowEdge[];
	id?: string;
	/** How many independent nodes of one run Core executes at once. */
	max_concurrency?: number | null;
	name: string;
	nodes: WorkflowNode[];
	triggers: WorkflowTrigger[];
	updated_at?: string | null;
}
export type McpCatalog = z.infer<typeof mcpCatalogSchema>;
export type TriggerSubscription = z.infer<typeof triggerSubscriptionSchema>;

export const parseNodeText = z
	.string()
	.nullable()
	.optional()
	.catch(undefined).parse;
export const parseNodeNumber = z
	.number()
	.nullable()
	.optional()
	.catch(undefined).parse;
export const parseNodeStrings = z
	.array(z.string())
	.optional()
	.catch(undefined).parse;
export const parseNodeRecord = workflowJsonRecordSchema
	.nullable()
	.optional()
	.catch(undefined).parse;
export const parseGhostLiveCounters = z
	.object({
		elapsed_secs: z.number().optional().catch(undefined),
		event_count: z.number().optional().catch(undefined),
	})
	.catch({}).parse;
export {
	ghostRecipeSummariesSchema,
	ghostRecordingStateSchema,
	ghostRecordingStopSchema,
};

export const delegateRowsSchema = z.array(
	z
		.object({
			agent_id: z.string().nullable().default(null),
			id: z.string(),
			task: z.string(),
		})
		.catchall(workflowJsonValueSchema)
);
export const parseDelegateRows = delegateRowsSchema.catch([]).parse;
export const nodeConfigValueSchema = z.object({
	coreType: z.string(),
	extra: workflowJsonRecordSchema,
	label: z.string(),
});

export const workflowTriggerTypeSchema = z.enum(
	workflowTriggerSchema.options.map((option) => option.shape.type.value)
);

export type NodeFieldUpdateValue = z.infer<
	ReturnType<typeof workflowJsonValueSchema.optional>
>;
export function patchNodeConfiguration(
	extra: WorkflowJsonRecord,
	key: string,
	value: NodeFieldUpdateValue
): WorkflowJsonRecord {
	const next = { ...extra };
	if (value === undefined) {
		delete next[key];
	} else {
		next[key] = value;
	}
	return next;
}
export const canvasNodeDataSchema = z.object({
	coreType: z.string(),
	label: z.string(),
	extra: workflowJsonRecordSchema.optional(),
	isSelected: z.boolean().optional(),
	runStatus: nodeStatusSchema.nullable().optional(),
});
export type DelegateRow = z.infer<typeof delegateRowsSchema.element>;
