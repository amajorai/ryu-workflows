// Hand-rolled, dependency-free replacements for the `@ryu/ui` controls the ported
// canvas/trigger/record components import. The sandbox cannot import the shell's
// Radix/Base-UI component trees, so each control here reimplements the SAME prop
// API the components use (see the desktop originals) with plain semantic HTML +
// the SAME Tailwind classNames — so visual parity comes from the compiled
// utilities, not a re-style. This mirrors the whiteboard/monitors/finetune apps'
// "zero @ryu/ui" rule, but preserves the shell component surface so the ~4k lines
// of ported markup need no rewrite beyond the import path.

import {
	type ButtonHTMLAttributes,
	Children,
	cloneElement,
	createContext,
	type InputHTMLAttributes,
	isValidElement,
	type LabelHTMLAttributes,
	type ReactElement,
	type ReactNode,
	type Ref,
	type TextareaHTMLAttributes,
	useContext,
	useId,
	useState,
} from "react";

function cx(...parts: (string | false | null | undefined)[]): string {
	return parts.filter(Boolean).join(" ");
}

// ── Badge ─────────────────────────────────────────────────────────────────────

type BadgeVariant =
	| "default"
	| "secondary"
	| "destructive"
	| "outline"
	| "success"
	| "warning"
	| "info";

const BADGE_VARIANT: Record<string, string> = {
	default: "bg-primary text-primary-foreground",
	secondary: "bg-secondary text-secondary-foreground",
	destructive: "bg-destructive text-white",
	outline: "border border-border text-foreground",
	success: "bg-success text-success-foreground",
	warning: "bg-warning text-warning-foreground",
	info: "bg-info text-info-foreground",
};

export function Badge({
	className,
	variant = "default",
	children,
	...rest
}: {
	className?: string;
	variant?: BadgeVariant | string;
	children?: ReactNode;
} & React.HTMLAttributes<HTMLSpanElement>) {
	return (
		<span
			className={cx(
				"inline-flex w-fit items-center justify-center gap-1 rounded-md px-2 py-0.5 font-medium text-xs",
				BADGE_VARIANT[variant] ?? BADGE_VARIANT.default,
				className
			)}
			{...rest}
		>
			{children}
		</span>
	);
}

// ── Button ──────────────────────────────────────────────────────────────────

type ButtonVariant =
	| "default"
	| "ghost"
	| "outline"
	| "destructive"
	| "secondary";

const BUTTON_VARIANT: Record<string, string> = {
	default: "bg-primary text-primary-foreground hover:bg-primary/90",
	ghost: "hover:bg-accent hover:text-accent-foreground",
	outline: "border border-border bg-transparent hover:bg-accent",
	destructive: "bg-destructive text-white hover:bg-destructive/90",
	secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
};

const BUTTON_SIZE: Record<string, string> = {
	default: "h-9 px-4 py-2",
	sm: "h-8 gap-1.5 px-3",
	icon: "size-9",
};

export function Button({
	className,
	variant = "default",
	size = "default",
	children,
	...rest
}: {
	variant?: ButtonVariant | string;
	size?: "default" | "sm" | "icon" | string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
	return (
		<button
			className={cx(
				"inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
				BUTTON_VARIANT[variant] ?? BUTTON_VARIANT.default,
				BUTTON_SIZE[size] ?? BUTTON_SIZE.default,
				className
			)}
			type={rest.type ?? "button"}
			{...rest}
		>
			{children}
		</button>
	);
}

// ── Input / Textarea / Label ──────────────────────────────────────────────────

export function Input({
	className,
	...rest
}: InputHTMLAttributes<HTMLInputElement>) {
	return (
		<input
			className={cx(
				"flex h-9 w-full min-w-0 rounded-md border border-border bg-input/30 px-3 py-1 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50",
				className
			)}
			{...rest}
		/>
	);
}

export function Textarea({
	className,
	...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
	ref?: Ref<HTMLTextAreaElement>;
}) {
	return (
		<textarea
			className={cx(
				"flex min-h-16 w-full rounded-md border border-border bg-input/30 px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50",
				className
			)}
			{...rest}
		/>
	);
}

export function Label({
	className,
	children,
	...rest
}: LabelHTMLAttributes<HTMLLabelElement>) {
	return (
		<label
			className={cx(
				"flex select-none items-center gap-2 font-medium text-sm",
				className
			)}
			{...rest}
		>
			{children}
		</label>
	);
}

// ── Spinner ───────────────────────────────────────────────────────────────────

export function Spinner({ className }: { className?: string }) {
	return (
		<span
			aria-label="Loading"
			className={cx(
				"inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent",
				className
			)}
			role="status"
		/>
	);
}

// ── Switch ────────────────────────────────────────────────────────────────────

export function Switch({
	checked = false,
	onCheckedChange,
	disabled,
	className,
	id,
}: {
	checked?: boolean;
	onCheckedChange?: (checked: boolean) => void;
	disabled?: boolean;
	className?: string;
	id?: string;
}) {
	return (
		<button
			aria-checked={checked}
			className={cx(
				"inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent p-0.5 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
				checked ? "bg-primary" : "bg-input",
				className
			)}
			disabled={disabled}
			id={id}
			onClick={() => onCheckedChange?.(!checked)}
			role="switch"
			type="button"
		>
			<span
				className={cx(
					"pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform",
					checked ? "translate-x-4" : "translate-x-0"
				)}
			/>
		</button>
	);
}

// ── Select (native <select>, options from `items` or SelectItem children) ─────

interface SelectItemShape {
	label: ReactNode;
	value: string;
}

/** Recursively collect SelectItem descendants → {value,label}. Used when the
 *  caller drives options via <SelectItem> children instead of the `items` prop. */
function collectSelectItems(children: ReactNode, out: SelectItemShape[]): void {
	Children.forEach(children, (child) => {
		if (!isValidElement(child)) {
			return;
		}
		const el = child as ReactElement<{ value?: string; children?: ReactNode }>;
		if ((el.type as { __ryuSelectItem?: boolean })?.__ryuSelectItem) {
			out.push({
				value: String(el.props.value ?? ""),
				label: el.props.children,
			});
			return;
		}
		if (el.props?.children) {
			collectSelectItems(el.props.children, out);
		}
	});
}

export function Select({
	value,
	onValueChange,
	items,
	children,
	className,
	id,
	disabled,
}: {
	value?: string;
	onValueChange?: (value: string) => void;
	items?: SelectItemShape[];
	children?: ReactNode;
	className?: string;
	id?: string;
	disabled?: boolean;
}) {
	let options: SelectItemShape[] = items ?? [];
	if (!items) {
		const collected: SelectItemShape[] = [];
		collectSelectItems(children, collected);
		options = collected;
	}
	// De-dup by value (canvas often passes BOTH items and mirror SelectItem kids).
	const seen = new Set<string>();
	const unique = options.filter((o) => {
		if (seen.has(o.value)) {
			return false;
		}
		seen.add(o.value);
		return true;
	});
	// A trigger className is threaded down via <SelectTrigger className>; pull the
	// first descendant trigger's className so the native select keeps its sizing.
	const triggerClass = findTriggerClass(children);
	return (
		<select
			className={cx(
				"flex w-full cursor-pointer items-center rounded-md border border-border bg-input/30 px-2 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50",
				triggerClass,
				className
			)}
			disabled={disabled}
			id={id}
			onChange={(e) => onValueChange?.(e.target.value)}
			value={value ?? ""}
		>
			{unique.map((o) => (
				<option key={o.value} value={o.value}>
					{typeof o.label === "string" || typeof o.label === "number"
						? o.label
						: o.value}
				</option>
			))}
		</select>
	);
}

function findTriggerClass(children: ReactNode): string | undefined {
	let found: string | undefined;
	Children.forEach(children, (child) => {
		if (found || !isValidElement(child)) {
			return;
		}
		const el = child as ReactElement<{
			className?: string;
			children?: ReactNode;
		}>;
		if ((el.type as { __ryuSelectTrigger?: boolean })?.__ryuSelectTrigger) {
			found = el.props.className;
			return;
		}
		if (el.props?.children) {
			const nested = findTriggerClass(el.props.children);
			if (nested) {
				found = nested;
			}
		}
	});
	return found;
}

// Structural markers — inert wrappers; the native <select> above reads them.
export function SelectTrigger(_: {
	className?: string;
	id?: string;
	children?: ReactNode;
}) {
	return null;
}
(SelectTrigger as { __ryuSelectTrigger?: boolean }).__ryuSelectTrigger = true;

export function SelectContent({ children }: { children?: ReactNode }) {
	return <>{children}</>;
}

export function SelectValue(_: { placeholder?: string }) {
	return null;
}

export function SelectItem(_: { value: string; children?: ReactNode }) {
	return null;
}
(SelectItem as { __ryuSelectItem?: boolean }).__ryuSelectItem = true;

export function SelectSeparator() {
	return null;
}

// ── ToggleGroup (single OR multiple, inferred from the value type) ────────────

interface ToggleGroupCtx {
	multiple: boolean;
	onToggle: (value: string) => void;
	selected: Set<string>;
}

const ToggleGroupContext = createContext<ToggleGroupCtx | null>(null);

export function ToggleGroup({
	value,
	onValueChange,
	children,
	className,
	id,
}: {
	value?: string | string[];
	onValueChange?: (value: string & string[]) => void;
	variant?: string;
	children?: ReactNode;
	className?: string;
	id?: string;
}) {
	const multiple = Array.isArray(value);
	const selected = new Set<string>(
		multiple ? (value as string[]) : value ? [value as string] : []
	);
	const onToggle = (v: string) => {
		if (multiple) {
			const next = new Set(selected);
			if (next.has(v)) {
				next.delete(v);
			} else {
				next.add(v);
			}
			(onValueChange as unknown as (x: string[]) => void)?.([...next]);
		} else {
			(onValueChange as unknown as (x: string) => void)?.(
				selected.has(v) ? "" : v
			);
		}
	};
	return (
		<ToggleGroupContext.Provider value={{ multiple, onToggle, selected }}>
			<div
				className={cx(
					"inline-flex flex-wrap items-center gap-1 rounded-md",
					className
				)}
				id={id}
			>
				{children}
			</div>
		</ToggleGroupContext.Provider>
	);
}

export function ToggleGroupItem({
	value,
	children,
	className,
}: {
	value: string;
	children?: ReactNode;
	className?: string;
}) {
	const ctx = useContext(ToggleGroupContext);
	const active = ctx?.selected.has(value) ?? false;
	return (
		<button
			aria-pressed={active}
			className={cx(
				"inline-flex h-8 cursor-pointer items-center justify-center rounded-md border px-2.5 font-medium text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
				active
					? "border-border bg-accent text-accent-foreground"
					: "border-border bg-transparent hover:bg-accent/50",
				className
			)}
			onClick={() => ctx?.onToggle(value)}
			type="button"
		>
			{children}
		</button>
	);
}

// ── DropdownMenu (stateful popover; `render` element becomes the trigger) ─────

interface DropdownCtx {
	close: () => void;
	open: boolean;
	setOpen: (open: boolean) => void;
}

const DropdownContext = createContext<DropdownCtx | null>(null);

export function DropdownMenu({ children }: { children?: ReactNode }) {
	const [open, setOpen] = useState(false);
	return (
		<DropdownContext.Provider
			value={{ open, setOpen, close: () => setOpen(false) }}
		>
			<span className="relative inline-flex">{children}</span>
		</DropdownContext.Provider>
	);
}

export function DropdownMenuTrigger({
	render,
	children,
	className,
}: {
	/** A React element (e.g. a <Button/>) whose look the trigger adopts (Base-UI
	 *  pattern). When absent a plain button is used. `children` is the label. */
	render?: ReactElement;
	children?: ReactNode;
	className?: string;
}) {
	const ctx = useContext(DropdownContext);
	const onClick = () => ctx?.setOpen(!ctx.open);
	if (render && isValidElement(render)) {
		return cloneElement(
			render as ReactElement<{ onClick?: () => void; children?: ReactNode }>,
			{ onClick },
			children
		);
	}
	return (
		<button className={className} onClick={onClick} type="button">
			{children}
		</button>
	);
}

export function DropdownMenuContent({
	children,
	className,
	align = "start",
}: {
	children?: ReactNode;
	className?: string;
	align?: "start" | "end" | "center";
}) {
	const ctx = useContext(DropdownContext);
	if (!ctx?.open) {
		return null;
	}
	return (
		<>
			<button
				aria-hidden
				className="fixed inset-0 z-40 cursor-default"
				onClick={ctx.close}
				tabIndex={-1}
				type="button"
			/>
			<div
				className={cx(
					"absolute top-full z-50 mt-1 min-w-40 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-md",
					align === "end" ? "right-0" : "left-0",
					className
				)}
			>
				{children}
			</div>
		</>
	);
}

export function DropdownMenuItem({
	children,
	onClick,
	className,
}: {
	children?: ReactNode;
	onClick?: () => void;
	className?: string;
}) {
	const ctx = useContext(DropdownContext);
	return (
		<button
			className={cx(
				"flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring",
				className
			)}
			onClick={() => {
				onClick?.();
				ctx?.close();
			}}
			type="button"
		>
			{children}
		</button>
	);
}

// ── Dialog (modal overlay; `open`/`onOpenChange`) ─────────────────────────────

export function Dialog({
	open,
	onOpenChange,
	children,
}: {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	children?: ReactNode;
}) {
	if (!open) {
		return null;
	}
	return (
		<div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
			<button
				aria-hidden
				className="absolute inset-0 cursor-default bg-black/50"
				onClick={() => onOpenChange?.(false)}
				tabIndex={-1}
				type="button"
			/>
			{children}
		</div>
	);
}

export function DialogContent({
	children,
	className,
}: {
	children?: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cx(
				"relative z-10 w-full max-w-lg rounded-xl border border-border bg-background p-5 shadow-xl",
				className
			)}
		>
			{children}
		</div>
	);
}

export function DialogHeader({ children }: { children?: ReactNode }) {
	return <div className="mb-3 flex flex-col gap-1.5">{children}</div>;
}

export function DialogTitle({
	children,
	className,
}: {
	children?: ReactNode;
	className?: string;
}) {
	return (
		<h2 className={cx("font-semibold text-lg leading-none", className)}>
			{children}
		</h2>
	);
}

export function DialogDescription({ children }: { children?: ReactNode }) {
	return <p className="text-muted-foreground text-sm">{children}</p>;
}

// A stable id helper some ported call-sites reference indirectly.
export function useControlId(prefix: string): string {
	const id = useId();
	return `${prefix}-${id}`;
}
