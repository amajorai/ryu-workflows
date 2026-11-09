// The `window.ryu` bridge surface this app consumes. The host installs it inline
// (Path B bootstrap) BEFORE this module runs; every method is a capability-gated
// RPC over a MessagePort — no tokens, no direct network (the frame's CSP is
// `connect-src 'none'`). Calls made before the host port arrives are queued and
// flushed on connect. This app needs the `workflows` surface (grants
// `workflows:crud`/`runstate`/`catalogs` + `core:list_agents`) + the `ghost` surface (grant
// `ghost:record`); Core owns the `/workflows*` + `/api/workflows/catalog*` +
// `/api/recipes/*` orchestration behind them.
//
// Method return shapes mirror the desktop client the host reuses verbatim (the
// host closures call `fetchWorkflows`/`runWorkflow`/… and forward the result),
// so `bridge.ts` validates replies with the concrete schema owners.

import type {
	RyuCatalogModels,
	RyuCatalogSnapshot,
} from "@ryu/app-host/app-bridge";
import type { RyuCompanionWindowApi } from "@ryu/app-host/realtime";

import type {
	AppInfo,
	HookEventInfo,
	InstalledSkill,
	McpCatalog,
	NotifyTargetUser,
	RecipeSummary,
	RecordingState,
	RecordingStopResult,
	ScheduledJob,
	TriggerSubscription,
	Workflow,
	WorkflowDefinition,
	WorkflowJsonValue,
	WorkflowRun,
	WorkflowTemplateDetail,
	WorkflowTemplateMeta,
	WorkflowVersionMeta,
} from "./schemas.ts";

export interface RyuWorkflows {
	apps(): Promise<AppInfo[]>;
	bindConnectTrigger?(args: {
		id: string;
		connectTriggerId: string;
	}): Promise<TriggerSubscription>;
	composio(args: {
		kind: "status" | "toolkits" | "triggers" | "connections";
		toolkit?: string;
	}): Promise<WorkflowJsonValue>;
	connectBindings?(args: { id: string }): Promise<TriggerSubscription[]>;
	delete(args: { id: string }): Promise<void>;
	get(args: { id: string }): Promise<Workflow>;
	/** Every app event an enabled app declares it emits — the `event` trigger's picker. */
	hookEvents(): Promise<HookEventInfo[]>;
	list(): Promise<Workflow[]>;
	mcp(): Promise<McpCatalog>;
	notifyTargets(): Promise<NotifyTargetUser[]>;
	removeConnectBinding?(args: { id: string; bindingId: string }): Promise<void>;
	resume(args: { runId: string; payload: string }): Promise<WorkflowRun>;
	run(args: {
		dryRun?: boolean;
		id: string;
		input?: Record<string, string>;
	}): Promise<WorkflowRun>;
	runGet(args: { runId: string }): Promise<WorkflowRun>;
	save(args: WorkflowDefinition): Promise<Workflow>;
	schedules(): Promise<ScheduledJob[]>;
	skills(): Promise<InstalledSkill[]>;
	templateGet(args: { id: string }): Promise<WorkflowTemplateDetail>;
	templateInstall(args: { templateId: string }): Promise<string>;
	templatesList(): Promise<WorkflowTemplateMeta[]>;
	versionCreate(args: {
		id: string;
		label?: string;
		expectedRevision?: string;
	}): Promise<void>;
	versionGet(args: {
		id: string;
		versionId: string;
	}): Promise<WorkflowDefinition>;
	versionRestore(args: { id: string; versionId: string }): Promise<Workflow>;
	versionsList(args: { id: string }): Promise<WorkflowVersionMeta[]>;
	webhook(args: { id: string }): Promise<{ url: string }>;
}

export interface RyuGhost {
	recipes(): Promise<RecipeSummary[]>;
	recordStart(args: { task: string }): Promise<RecordingState>;
	recordStatus(): Promise<RecordingState>;
	recordStop(): Promise<RecordingStopResult>;
}

/** The generic app-route bridge (`app.request`, Host API 1.18). `app` targets
 *  another app's sidecar and needs the reviewed `app:http:<app>` grant. */
export interface RyuAppRequest {
	request(args: {
		app?: string;
		body?: WorkflowJsonValue;
		method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
		path: string;
	}): Promise<unknown>;
}

export interface RyuBridge extends RyuCompanionWindowApi {
	app?: RyuAppRequest;
	catalog: {
		models(input: { providerId: string }): Promise<RyuCatalogModels>;
		snapshot(): Promise<RyuCatalogSnapshot>;
	};
	context: { spaceId?: string; docId?: string; workflowId?: string } | null;
	ghost: RyuGhost;
	workflows: RyuWorkflows;
}

declare module "@ryu/app-host/realtime" {
	interface RyuCompanionWindowApi {
		app?: RyuBridge["app"];
		catalog: RyuBridge["catalog"];
		context: RyuBridge["context"];
		ghost: RyuBridge["ghost"];
		workflows: RyuBridge["workflows"];
	}
}
