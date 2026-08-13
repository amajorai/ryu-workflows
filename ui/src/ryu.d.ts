// The `window.ryu` bridge surface this app consumes. The host installs it inline
// (Path B bootstrap) BEFORE this module runs; every method is a capability-gated
// RPC over a MessagePort — no tokens, no direct network (the frame's CSP is
// `connect-src 'none'`). Calls made before the host port arrives are queued and
// flushed on connect. This app needs the `workflows` surface (grants
// `workflows:crud`/`runstate`/`catalogs`) + the `ghost` surface (grant
// `ghost:record`); Core owns the `/workflows*` + `/api/workflows/catalog*` +
// `/api/recipes/*` orchestration behind them.
//
// Method return shapes mirror the desktop client the host reuses verbatim (the
// host closures call `fetchWorkflows`/`runWorkflow`/… and forward the result),
// so `bridge.ts` re-declares the concrete types and casts these `unknown`s.

export interface RyuWorkflows {
	agents(): Promise<unknown>;
	apps(): Promise<unknown>;
	composio(args: {
		kind: "status" | "toolkits" | "triggers" | "connections";
		toolkit?: string;
	}): Promise<unknown>;
	delete(args: { id: string }): Promise<void>;
	get(args: { id: string }): Promise<unknown>;
	/** Every app event an enabled app declares it emits — the `event` trigger's picker. */
	hookEvents(): Promise<unknown>;
	list(): Promise<unknown>;
	mcp(): Promise<unknown>;
	resume(args: { runId: string; payload: string }): Promise<unknown>;
	run(args: { id: string; input?: Record<string, string> }): Promise<unknown>;
	runGet(args: { runId: string }): Promise<unknown>;
	save(args: Record<string, unknown>): Promise<unknown>;
	schedules(): Promise<unknown>;
	skills(): Promise<unknown>;
	templateGet(args: { id: string }): Promise<unknown>;
	templateInstall(args: { templateId: string }): Promise<string>;
	templatesList(): Promise<unknown>;
	versionCreate(args: { id: string; label?: string }): Promise<void>;
	versionGet(args: { id: string; versionId: string }): Promise<unknown>;
	versionRestore(args: { id: string; versionId: string }): Promise<unknown>;
	versionsList(args: { id: string }): Promise<unknown>;
	webhook(args: { id: string }): Promise<{ url: string }>;
}

export interface RyuGhost {
	recipes(): Promise<unknown>;
	recordStart(args: { task: string }): Promise<unknown>;
	recordStatus(): Promise<unknown>;
	recordStop(): Promise<unknown>;
}

export interface RyuBridge {
	context: { spaceId?: string; docId?: string; workflowId?: string } | null;
	ghost: RyuGhost;
	workflows: RyuWorkflows;
}

declare global {
	interface Window {
		ryu?: RyuBridge;
	}
}
