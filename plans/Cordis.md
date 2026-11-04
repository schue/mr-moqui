# Cordis Runtime Refactor

Status: draft, not checked in. Explores refactoring the framework onto a
[Cordis](https://github.com/dshbox/cordis-rs)-like structure: a typed runtime for
plugin-oriented Rust applications (`Context`, `Plugin` → `prepare`/`Input`/
`PreparedPlugin` → `spawn` → `FiberHandle`, typed `Service` with realms, typed
routed `Event`, apply-generation resource ownership, no runtime-wide shutdown).

## The core mismatch to decide first

Cordis is a typed, async, compile-time plugin runtime. Moqui's plugin surface is
dynamic, XML-driven, and disk-loaded:

| Moqui today | Cordis equivalent | Fit |
|---|---|---|
| `ExecutionContextFactory` (god object: conf, resource, cache, entity, sessions, pools, executor, native registry) | `Context` + a set of Fibers publishing `Service`s | Good — the main win |
| Subsystem crates (`moqui-entity`, `moqui-mail`, `moqui-report`…) registering via `moqui_core::extension` inventory | `Plugin::prepare`/`apply` | Good — direct mapping |
| Components (`mr-mantle`, `mr-boss`…) loaded from `runtime/component` at boot, mostly XML + JS | Plugins | Poor — they are data, not Rust; dynamic loading is not possible on stable Rust anyway |
| Services: XML-defined, `BTreeMap<String, Value>` parameters, `NativeService` closures | Typed `Service` with `Args`/`Output` | Poor — the point of Moqui is stringly-typed, data-defined services |
| EECA, observers, cluster notify | Typed routed `Event` | Partial — EECA rules are data-driven; only the internal Rust plumbing could be typed |

The realistic target: **Cordis as the internal runtime skeleton for the
framework's subsystems, with Moqui's dynamic service/entity/screen surface
wrapped in a small number of dynamic services** — not a 1:1 mapping where every
Moqui service becomes a typed Cordis service.

## What would be needed

### 1. A `moqui-runtime` crate owning a `cordis::Context`

- `moqui-core` currently has no tokio; Cordis is async-first. Introduce a tokio
  runtime at the boundary (the host already has one) and make `apply()` async.
  Blocking subsystems (the database clients are deliberately blocking, SMTP is
  blocking) need `spawn_blocking` or sync bridges inside their fibers.
- Boot stays strictly ordered (conf → resource → entity → service → screen →
  webapp). Cordis has no boot ordering beyond service dependencies, so express
  the order with `InjectSpec` required-service declarations and accept that a
  "Pending" fiber means "dependency not published yet" — a semantic change from
  today's fail-fast boot.

### 2. Typed facade services replacing factory fields

One typed service per facade: `EntityService`, `ResourceService`,
`CacheService`, `ServiceCall` (the dynamic dispatcher: `Args = (name,
Parameters)`), `ScreenService`, `SchedulerService`, `SessionService`,
`L10nService`, `ToolRegistry`, `SearchService`, `TelemetryService`. Then:

- `ExecutionContextFactory` becomes a thin boot orchestrator that spawns the
  fibers; `ExecutionContext` (per-request) is built by pulling services from the
  `Context` instead of holding factory fields.
- The `extensions: HashMap<TypeId, Arc<dyn Any>>` hack and the `EntityHooks`
  hook table (Phase 3 of [Crate-Split](Crate-Split.md)) become ordinary service
  dependencies — this is where Cordis pays for itself.

### 3. Convert each subsystem crate from `extension` inventory to a `Plugin`

- `prepare()` takes typed config parsed from `MoquiConf.xml` (replacing
  `BootOptions`/conf-text passing).
- `apply()` publishes its services and registers listeners;
  `ToolFactory::destroy`/`post_facade_destroy` and the `before_shutdown`/
  `after_boot` hooks disappear, replaced by apply-generation ownership —
  listeners, tasks, timers, and service publications are cleaned up when the
  fiber is disposed. That removes a whole class of "who tears this down" code
  (mail's IDLE workers, the collab Yjs sessions, the scheduler, the devkit file
  watcher).
- Component crates keep the `inventory` link (via `target/moqui-app`) but their
  `register` becomes "publish into a per-component service realm" — realms give
  the isolation boundary Moqui does not currently have (two components defining
  the same tool name collide today).

### 4. Events (optional)

Typed `Event`s for internal Rust plumbing: resource changes (the
`ResourceChange`/change-log feed), cluster notify messages, scheduler ticks,
devkit reload signals. EECA stays data-driven; it emits events into the runtime
instead of calling observers directly.

### 5. Shutdown rework

Cordis has no runtime-wide shutdown; fibers are disposed explicitly.
`ExecutionContextFactory::shutdown` becomes an ordered dispose of the fiber
handles (reverse dependency order), with the `shutting_down` flag logic moved
into the scheduler fiber's dispose.

### 6. Test/tooling impact

- The spec runner, `moqui check`/`lsp` (model-only boots), and the browser
  (wasm, `Executor::Inline`) all construct factories directly. Each needs a
  "boot a Context with a subset of plugins" story; the Inline executor maps to
  a single-threaded tokio runtime — new code.
- `moq build` and the generated `moqui-app` crate are untouched — components
  still link statically.

## Gains and costs

Gains:

- Deterministic per-subsystem cleanup.
- Typed dependency ordering instead of boot-sequence convention.
- A clean seam for subsystems to appear/disappear (embedded Postgres fails →
  dependent fibers go Pending instead of boot aborting).
- Per-component isolation via realms.
- A uniform lifecycle vocabulary.

Costs:

- **Cordis is pre-freeze.** v3 is a deliberately breaking line (`0.11` facade /
  `0.6` core, `#[non_exhaustive]` vocabularies, documented promise changes).
  Betting the framework's spine on it means tracking a moving contract.
- **The type safety mostly does not reach Moqui's surface.** Services, entities,
  screens, and EECA stay dynamic; they are wrapped in a handful of dynamic
  services. The typed benefit is internal plumbing only.
- **The convergence machinery would be barely used.** Moqui components are
  static at boot; plugins do not appear and disappear. We buy the
  lifecycle/cleanup model, not the plugin-dynamics model.
- **Async boundary work** across a codebase deliberately kept blocking below
  the host.
- **Much of the structural value is already spent.** The Crate-Split plan (done
  through Phase 6) already gives per-subsystem crates, registration seams, and
  parallel builds. Cordis is a lifecycle refactor on top of a layout we already
  have — it is not about crate organization.

## Suggested path

1. **Pilot, low risk.** Add `cordis-core`, create `moqui-runtime`, move only the
   tool registry and the `extension` hooks (mail IDLE workers, report
   `after_boot`) into plugins. Prove the dispose/cleanup semantics against the
   existing test suite.
2. **Facades as services.** Publish the entity/resource/service/screen/scheduler
   facades; `ExecutionContext` pulls from the `Context`. The big one — it
   touches every `ec.*` construction path, not call sites.
3. **Subsystem crates as plugins.** Retire `moqui_core::extension` and
   `EntityHooks`.
4. **Optional.** Typed events for notify/cluster/resource-change; per-component
   realms.
5. **Do not plan** on `cordis-loader` for dynamic components — stable Rust
   dynamic libraries make that a dead end for now, and Moqui's XML components
   do not need it.

## Assessment

A 1–2 quarter refactor for a real but bounded gain (cleanup determinism plus
dependency typing). Main risks: Cordis's pre-freeze churn and the async
boundary. If the goal is only a cleaner plugin lifecycle for the subsystem
crates, a lighter version — keep the factory, replace `extension`/hooks with an
explicit typed service table we own — captures most of the benefit without
taking on a third-party runtime contract.
