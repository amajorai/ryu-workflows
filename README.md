# ryu-workflows

Workflows for Ryu — petgraph DAG automation with triggers, durable execution, and a natural-language workflow builder.

> **The public home of `ryu-workflows`.** Source, builds, and releases live here —
> binaries for every platform are attached to each release.
>
> This tree is generated from the Ryu monorepo, so commits pushed here
> directly are replaced on the next sync. **Pull requests are welcome** —
> open them here and they are ported into the monorepo, then flow back out.
> Ryu as a whole: https://github.com/amajorai/ryu

## Source & build

This is the **source of record** for the app UI. It imports Ryu's private
`@ryu/ui` design system, so it does **not** build standalone outside the
monorepo — it **builds inside the amajorai/ryu monorepo workspace**.
The **shipped bundle below is the built artifact**: a prebuilt single-file
companion bundle is included at [`dist/workflows.ui.html`](./dist/workflows.ui.html) —
the runnable UI Ryu loads for this app.

## License

Apache-2.0 — see [LICENSE](./LICENSE).

---

# com.ryu.workflows — Workflows

petgraph DAG automation: build multi-node workflows with triggers
(schedule/webhook/Composio), durable execution, and a natural-language workflow
builder. The companion is the React Flow canvas over Core's in-crate workflow
engine.

## Parts

- **`ui/` — companion (`@ryu/workflows-app`).** A sandboxed full-page Companion
  (Path B, `ui_format: "html"`), a React Flow (`@xyflow/react`) DAG canvas — node
  editing across all kinds, CRUD, versions, run + run-state, triggers, templates,
  ghost record→replay — built to one self-contained `dist/index.html` via
  `vite-plugin-singlefile`. No backend crate of its own — it drives Core's
  `/workflows*` + `/api/workflows/catalog*` + `/api/recipes/*` orchestration over
  the `window.ryu` bridge.

## Manifest (`manifest.json`)

- **id** `com.ryu.workflows` · one `companion` runnable (`Workflows`, icon
  `workflow-square-01`).
- **Grants:** `workflows:crud` (author/edit/delete), `workflows:runstate`
  (run + observe run state), `workflows:catalogs` (node/template catalogs),
  `ghost:record` (ghost record→replay folded into `NodeKind::GhostAction`).
- No sidecar: the DAG engine, durable execution (in-process `FallbackEngine`), and
  triggers all live in Core's workflow module.

## Surface

Registers as the **Workflows** companion in the desktop app store / launcher.

## Swap seam

The canvas binds to the `workflows:*` bridge capabilities, not to the engine
directly. Node kinds and trigger backends are extensible enums routed through one
engine; the durable engine is itself swappable behind Core's workflow module.
