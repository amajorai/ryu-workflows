import type { RyuCatalogSnapshot } from "@ryu/app-host/app-bridge";
import { createContext } from "react";
import type { WorkflowJsonRecord } from "./schemas.ts";

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
	coreType: string;
	extra: WorkflowJsonRecord;
	label: string;
}

export const RuntimeCatalogContext = createContext<RyuCatalogSnapshot | null>(
	null
);
