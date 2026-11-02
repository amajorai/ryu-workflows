import { expect, test } from "bun:test";
import { RyuAppShell } from "@ryu/blocks/companion/app-ui";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectWorkflowBindings } from "./ConnectWorkflowBindings.tsx";

test("Connect binding panel exposes a safe loading state in the Companion shell", () => {
	const html = renderToStaticMarkup(
		<RyuAppShell surface="editor">
			<ConnectWorkflowBindings workflowId="workflow-a" />
		</RyuAppShell>
	);
	expect(html).toContain("Connect triggers");
	expect(html).toContain("Loading bindings");
	expect(html).toContain("Connect trigger ID");
	expect(html).not.toContain("Authorization");
	expect(html).not.toContain("RYU_CONNECT");
});
