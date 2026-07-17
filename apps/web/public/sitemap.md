# ieva — sitemap

An LLM-oriented semantic index of the documentation.

## Start here

### Introduction — /#/introduction
- Type: Conceptual
- Summary: What ieva is (a browser-native, filesystem-first agent framework) and the three things a browser runtime enables that a server can't: agents shared by link, live hot-reload against a folder, time-travel over the checkpoint store.
- Topics: path-derived identity, the smallest agent, eve lineage.

### Getting started — /#/getting-started
- Type: Integration
- Summary: The one-call bootstrapAgent() pipeline (OPFS ingest → discover → esbuild compile → run) and the React hook.
- Prerequisites: a browser with OPFS.
- Topics: OpfsFileSystem, EsbuildLoader, IdbStore, createModelRegistry, useIevaAgent.

## Authoring

### agent.ts — /#/agent-config
- Type: Reference
- Summary: Model and runtime config; fields; dynamic model resolution. Optional file that defaults to anthropic/claude-sonnet-5.
- Topics: model ids, compaction, limits, defineDynamic.

### Tools — /#/tools
- Type: Integration
- Summary: One file = one tool; filename = tool name; inputSchema (Zod / Standard / JSON Schema); approval gates; overriding and disabling built-ins.
- Topics: defineTool, ctx.getSandbox, approval, disableTool.

### Skills — /#/skills
- Type: Conceptual
- Summary: Markdown playbooks loaded on demand via progressive disclosure; description fallback chain; packaged skills.
- Topics: load_skill, SKILL.md, ctx.getSkill.

### Subagents — /#/subagents
- Type: Conceptual
- Summary: Specialist child agents; required description; isolation (inherits nothing); name-collision build error.

### Hooks — /#/hooks
- Type: Integration
- Summary: Observe-only lifecycle subscribers; cannot block or modify; wildcard handler; throwing hook → turn.failed.

### State — /#/state
- Type: Integration
- Summary: defineState — durable session-scoped state; module-scope declaration; shared runtime instance across the host/compiled-module boundary.

## Browser runtime

### Ingesting a directory — /#/ingest
- Type: Integration
- Summary: Four adapters (picker/live, drag-drop, zip, URL) into one OPFS VFS; the synchronous path index over async OPFS that keeps globbing working.

### Sandbox — /#/sandbox
- Type: Conceptual
- Summary: just-bash pure-JS shell over OPFS; coreutils in JS; a fidelity boundary not a security boundary; no python/sqlite/git in the browser.

### Durability — /#/durability
- Type: Conceptual
- Summary: session → turn → step checkpoints in IndexedDB; the redeploy-safety invariant (no model/tool config in the snapshot) that also makes hot reload safe; interrupted steps re-run.

### Models — /#/models
- Type: Integration
- Summary: anthropic/<model> BYOK direct-browser and webllm/<model> local WebGPU, behind a memoizing registry.

## Reference

### Project layout — /#/project-layout
- Type: Reference
- Summary: The conventional directory and the rules the compiler enforces (naming, required slots, collisions). Discovery never executes authored code.

### Packages — /#/packages
- Type: Reference
- Summary: ieva, @ieva/fs, @ieva/compiler, @ieva/store-idb, @ieva/model, @ieva/kit, @ieva/react.
