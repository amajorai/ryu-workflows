import {
	Add01Icon,
	PlayIcon,
	RecordIcon,
	SaveIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, Input, Spinner } from "@ryu/blocks/companion/controls";
import { Panel } from "@xyflow/react";
import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import type { Workflow } from "./bridge.ts";
import { VersionHistory, type VersionSource } from "./VersionHistory.tsx";

/** Floating title — name + description, borderless. */
export function WorkflowTitlePanel({
	description,
	maxConcurrency,
	name,
	setDescription,
	setMaxConcurrency,
	setName,
}: {
	description: string;
	maxConcurrency: number | null;
	name: string;
	setDescription: Dispatch<SetStateAction<string>>;
	setMaxConcurrency: Dispatch<SetStateAction<number | null>>;
	setName: Dispatch<SetStateAction<string>>;
}) {
	return (
		<Panel position="top-left">
			<div className="flex w-56 flex-col rounded-xl bg-popover/80 px-3 py-1.5 ring-1 ring-border backdrop-blur">
				<Input
					aria-label="Workflow name"
					className="h-6 border-0 bg-transparent p-0 font-medium text-sm shadow-none focus-visible:ring-0"
					onChange={(e: ChangeEvent<HTMLInputElement>) =>
						setName(e.target.value)
					}
					value={name}
				/>
				<Input
					aria-label="Description"
					className="h-5 border-0 bg-transparent p-0 text-muted-foreground text-xs shadow-none focus-visible:ring-0"
					onChange={(e: ChangeEvent<HTMLInputElement>) =>
						setDescription(e.target.value)
					}
					placeholder="Add a description"
					value={description}
				/>
				<Input
					aria-label="Steps that run at once"
					className="h-5 border-0 bg-transparent p-0 text-muted-foreground text-xs shadow-none focus-visible:ring-0"
					max={16}
					min={1}
					onChange={(e: ChangeEvent<HTMLInputElement>) => {
						const next = Number.parseInt(e.target.value, 10);
						setMaxConcurrency(
							Number.isFinite(next) ? Math.min(Math.max(next, 1), 16) : null
						);
					}}
					placeholder="Parallel steps: 4"
					title="How many independent steps run at the same time (1 to 16)"
					type="number"
					value={maxConcurrency === null ? "" : String(maxConcurrency)}
				/>
			</div>
		</Panel>
	);
}

/** Floating actions — Add / Run / Save. */
export function WorkflowActionsPanel({
	currentDefString,
	handleSave,
	handleVersionRestored,
	onRecord,
	onReloadLatest,
	reloading,
	saveError,
	saving,
	setReloadConfirmationOpen,
	setReloadError,
	setShowRun,
	togglePalette,
	versionSource,
	workflow,
}: {
	currentDefString: string;
	handleSave: () => Promise<void>;
	handleVersionRestored: () => void;
	onRecord?: () => void;
	onReloadLatest?: () => Promise<void>;
	reloading: boolean;
	saveError: string | null;
	saving: boolean;
	setReloadConfirmationOpen: Dispatch<SetStateAction<boolean>>;
	setReloadError: Dispatch<SetStateAction<string | null>>;
	setShowRun: Dispatch<SetStateAction<boolean>>;
	togglePalette: () => void;
	versionSource: VersionSource;
	workflow: Workflow | null;
}) {
	return (
		<Panel position="top-right">
			<div className="flex items-center gap-1 rounded-full bg-popover/90 p-1 shadow-lg ring-1 ring-border backdrop-blur">
				{saveError ? (
					<span className="px-2 text-status-destructive text-xs" role="alert">
						{saveError}
					</span>
				) : null}
				{saveError && workflow && onReloadLatest ? (
					<Button
						disabled={saving || reloading}
						onClick={() => {
							setReloadError(null);
							setReloadConfirmationOpen(true);
						}}
						size="sm"
						variant="outline"
					>
						Reload latest workflow
					</Button>
				) : null}
				<Button
					className="rounded-full"
					onClick={togglePalette}
					size="sm"
					variant="ghost"
				>
					<HugeiconsIcon className="size-3.5" icon={Add01Icon} />
					Add
				</Button>
				{onRecord ? (
					<Button
						className="rounded-full"
						onClick={onRecord}
						size="sm"
						variant="ghost"
					>
						<HugeiconsIcon className="size-3.5" icon={RecordIcon} />
						Record
					</Button>
				) : null}
				{workflow ? (
					<Button
						className="rounded-full"
						onClick={() => setShowRun((p) => !p)}
						size="sm"
						variant="ghost"
					>
						<HugeiconsIcon className="size-3.5" icon={PlayIcon} />
						Run
					</Button>
				) : null}
				{workflow ? (
					<VersionHistory
						currentValue={currentDefString}
						onRestored={handleVersionRestored}
						source={versionSource}
					/>
				) : null}
				<Button
					className="rounded-full"
					disabled={saving}
					onClick={handleSave}
					size="sm"
				>
					{saving ? (
						<Spinner className="size-3.5" />
					) : (
						<HugeiconsIcon className="size-3.5" icon={SaveIcon} />
					)}
					Save
				</Button>
			</div>
		</Panel>
	);
}
