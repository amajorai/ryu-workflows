import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@ryu/blocks/companion/controls";
import type { Dispatch, SetStateAction } from "react";

/** Confirmation before discarding unsaved edits and reloading the latest save. */
export function WorkflowReloadDialog({
	onReloadLatest,
	reloadConfirmationOpen,
	reloadError,
	reloading,
	setReloadConfirmationOpen,
	setReloadError,
	setReloading,
}: {
	onReloadLatest?: () => Promise<void>;
	reloadConfirmationOpen: boolean;
	reloadError: string | null;
	reloading: boolean;
	setReloadConfirmationOpen: Dispatch<SetStateAction<boolean>>;
	setReloadError: Dispatch<SetStateAction<string | null>>;
	setReloading: Dispatch<SetStateAction<boolean>>;
}) {
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!reloading) {
					setReloadConfirmationOpen(open);
				}
			}}
			open={reloadConfirmationOpen}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Discard edits and reload?</DialogTitle>
					<DialogDescription>
						Reloading replaces your unsaved graph and trigger edits with the
						latest saved workflow. Your current edits will be lost.
					</DialogDescription>
				</DialogHeader>
				{reloadError ? (
					<p className="text-sm text-status-destructive" role="alert">
						{reloadError}
					</p>
				) : null}
				<div className="flex justify-end gap-2">
					<Button
						disabled={reloading}
						onClick={() => setReloadConfirmationOpen(false)}
						variant="outline"
					>
						Keep editing
					</Button>
					<Button
						disabled={reloading}
						onClick={async () => {
							setReloadError(null);
							setReloading(true);
							try {
								await onReloadLatest?.();
								setReloadConfirmationOpen(false);
							} catch (error) {
								setReloadError(
									error instanceof Error ? error.message : "Reload failed"
								);
							} finally {
								setReloading(false);
							}
						}}
					>
						{reloading ? "Reloading…" : "Discard edits and reload"}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
