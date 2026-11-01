import { useLiteralMessages } from "@ryu/i18n/react";
import type { Edge } from "@xyflow/react";
import {
	type Dispatch,
	type MutableRefObject,
	type SetStateAction,
	useMemo,
} from "react";
import {
	type ApiTarget,
	createWorkflowVersion,
	getWorkflowVersionDefinition,
	listWorkflowVersions,
	restoreWorkflowVersion,
	type Workflow,
	type WorkflowTrigger,
} from "./bridge.ts";
import type { WorkflowDefinition } from "./schemas.ts";
import type { VersionSource } from "./VersionHistory.tsx";
import type { CanvasWorkflowNode } from "./workflow-serialization.ts";
import {
	canvasToDefinition,
	normalizedWorkflowJson,
	savePositions,
} from "./workflow-serialization.ts";

export interface WorkflowVersionSourceOptions {
	activeNode: ApiTarget;
	baseUpdatedAtRef: MutableRefObject<string | null>;
	currentNodesRef: MutableRefObject<CanvasWorkflowNode[]>;
	description: string;
	edges: Edge[];
	extraTriggers: WorkflowTrigger[];
	maxConcurrency: number | null;
	name: string;
	nodes: CanvasWorkflowNode[];
	onSave: (definition: WorkflowDefinition) => Promise<Workflow>;
	restoredWorkflowRef: MutableRefObject<Workflow | null>;
	saveInFlightRef: MutableRefObject<boolean>;
	setSaveError: Dispatch<SetStateAction<string | null>>;
	setSaving: Dispatch<SetStateAction<boolean>>;
	trigger: WorkflowTrigger;
	workflow: Workflow | null;
}

/** Server-backed version source (snapshot / diff / restore) for the canvas. */
export function useWorkflowVersionSource({
	activeNode,
	baseUpdatedAtRef,
	currentNodesRef,
	description,
	edges,
	extraTriggers,
	maxConcurrency,
	name,
	nodes,
	onSave,
	restoredWorkflowRef,
	saveInFlightRef,
	setSaveError,
	setSaving,
	trigger,
	workflow,
}: WorkflowVersionSourceOptions): VersionSource {
	const tl = useLiteralMessages();
	return useMemo<VersionSource>(() => {
		const target = { token: activeNode.token ?? null, url: activeNode.url };
		const wfId = workflow?.id ?? "";
		return {
			list: () =>
				listWorkflowVersions(target, wfId).then((vs) =>
					vs.map((v) => ({
						createdAt: v.createdAt,
						id: v.id,
						label: v.label,
						title: v.name,
					}))
				),
			getValue: (versionId) =>
				getWorkflowVersionDefinition(target, wfId, versionId).then((obj) =>
					normalizedWorkflowJson(obj)
				),
			snapshot: async (label) => {
				if (saveInFlightRef.current) {
					throw new Error(
						"Wait for the current save to finish before saving a version"
					);
				}
				saveInFlightRef.current = true;
				setSaving(true);
				try {
					// Persist the on-screen canvas first so the snapshot captures the
					// current (possibly unsaved) state, not the last-saved file.
					const def = canvasToDefinition(
						name,
						description,
						nodes,
						edges,
						[trigger, ...extraTriggers],
						maxConcurrency
					);
					def.id = wfId;
					def.updated_at = baseUpdatedAtRef.current;
					let saved: Workflow;
					try {
						saved = await onSave(def);
						setSaveError(null);
					} catch (error) {
						setSaveError(
							error instanceof Error ? error.message : "Save failed"
						);
						throw error;
					}
					savePositions(saved.id, currentNodesRef.current);
					baseUpdatedAtRef.current = saved.updatedAt ?? null;
					try {
						await createWorkflowVersion(
							target,
							saved.id,
							label,
							saved.updatedAt ?? undefined
						);
					} catch (error) {
						setSaveError(
							tl("Workflow saved, but the version was not saved: {message}", {
								message:
									error instanceof Error ? error.message : "Version failed",
							})
						);
						throw error;
					}
				} finally {
					saveInFlightRef.current = false;
					setSaving(false);
				}
			},
			restore: async (versionId) => {
				restoredWorkflowRef.current = await restoreWorkflowVersion(
					target,
					wfId,
					versionId
				);
			},
		};
	}, [
		activeNode.token,
		activeNode.url,
		workflow?.id,
		name,
		description,
		nodes,
		edges,
		trigger,
		extraTriggers,
		maxConcurrency,
		onSave,
		tl,
	]);
}
