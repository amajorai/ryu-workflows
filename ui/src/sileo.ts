// A tiny toast shim standing in for the shell's `sileo` toast library, which
// depends on shell React context/portals unavailable in the sandbox. Renders a
// self-contained, auto-dismissing toast into a fixed corner container. Same call
// surface the ported components use: `sileo.error({ title })` / `sileo.success({
// title })`.

type ToastKind = "error" | "success";

const CONTAINER_ID = "ryu-toast-container";

function container(): HTMLElement | null {
	if (typeof document === "undefined") {
		return null;
	}
	let el = document.getElementById(CONTAINER_ID);
	if (!el) {
		el = document.createElement("div");
		el.id = CONTAINER_ID;
		el.style.cssText =
			"position:fixed;bottom:16px;right:16px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;pointer-events:none;";
		document.body.appendChild(el);
	}
	return el;
}

function show(kind: ToastKind, title: string) {
	const root = container();
	if (!root) {
		return;
	}
	const toast = document.createElement("div");
	const border = kind === "error" ? "#ef4444" : "#22c55e";
	toast.style.cssText = `pointer-events:auto;max-width:22rem;padding:10px 12px;border-radius:10px;border:1px solid var(--border,#3f3f46);border-left:3px solid ${border};background:var(--popover,#18181b);color:var(--foreground,#fafafa);font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.35);opacity:0;transition:opacity .15s ease;`;
	toast.textContent = title;
	root.appendChild(toast);
	requestAnimationFrame(() => {
		toast.style.opacity = "1";
	});
	setTimeout(() => {
		toast.style.opacity = "0";
		setTimeout(() => toast.remove(), 200);
	}, 3200);
}

export const sileo = {
	error: ({ title }: { title: string }) => show("error", title),
	success: ({ title }: { title: string }) => show("success", title),
};
