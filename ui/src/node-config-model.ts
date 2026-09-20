import type { RyuCatalogSnapshot } from "@ryu/app-host/app-bridge";
import { createContext } from "react";
import type { CoreNodeType } from "./workflow-model.tsx";

export interface AgentOption {
	id: string;
	name: string;
}

export interface WorkflowOption {
	id: string;
	name: string;
}

export interface VariableToken {
	label: string;
	token: string;
}

export interface NodeConfigValue {
	coreType: CoreNodeType;
	extra: Record<string, unknown>;
	label: string;
}

export const RuntimeCatalogContext = createContext<RyuCatalogSnapshot | null>(
	null
);
