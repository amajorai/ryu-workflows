<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./icon-dark.png" />
    <img src="./icon-light.png" alt="Workflows" width="144" />
  </picture>
</p>

<div align="center">

# Workflows

</div>

Petgraph DAG automation with triggers, durable execution, and a natural-language workflow builder.

> **The public home of `ryu-workflows`.** Source, builds, and releases live here —
> binaries for every platform are attached to each release.
>
> This tree is generated from the Ryu monorepo, so commits pushed here
> directly are replaced on the next sync. **Pull requests are welcome** —
> open them here and they are ported into the monorepo, then flow back out.
> Ryu as a whole: https://github.com/amajorai/ryu

## Install

**App:** [Install](ryu://apps/@ryu/workflows) (opens the Ryu desktop app and asks you to confirm)

**CLI:**

```bash
ryu apps add @ryu/workflows
```

## Source & build

This is the **source of record** for the app UI. It imports Ryu's private
`@ryu/ui` design system, so it does **not** build standalone outside the
monorepo — it **builds inside the amajorai/ryu monorepo workspace**.
The **shipped bundle below is the built artifact**: a prebuilt single-file
companion bundle is included at [`dist/workflows.ui.html`](./dist/workflows.ui.html) —
the runnable UI Ryu loads for this app.

## License

Apache-2.0 — see [LICENSE](./LICENSE).

## Parts

- **`ui/` — companion (`@ryu/workflows-app`).** A sandboxed full-page Companion
  (Path B, `ui_format: "html"`), a React Flow (`@xyflow/react`) DAG canvas (node
  editing across all kinds, CRUD, versions, run + run-state, triggers, templates,
  ghost record→replay) built to one self-contained `dist/index.html` via
  `vite-plugin-singlefile`. No backend crate of its own — it drives Core's
  `/workflows*` + `/api/workflows/catalog*` + `/api/recipes/*` orchestration over
  the `window.ryu` bridge.

The `notify_user` node supports human-in-the-loop approval gates. The companion
can select multiple people from the scoped organization directory and require the
first approval, everyone, a fixed count, or a percentage before the DAG continues.
Core verifies managed-node recipients and records each member's acknowledgement
durably; percentage thresholds round up.

The Run panel also supports a read-only **Dry run**. It evaluates pure nodes and
read-only MCP tools in memory, skips effectful nodes with reasons, creates no run
history, and does not deliver notifications or other side effects.

## Manifest (`manifest.json`)

- **id** `@ryu/workflows` · one `companion` runnable (`Workflows`, icon
  `workflow-circle-06`).
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
