# Moqui on DSH

Status 2026-11-05: draft, no code. How Moqui and [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(`dsh`) meet: Moqui as the system of record behind a harness, DSH as the agent surface in front of it, and the client
work (time, token use, invoices) the join makes possible. The runtime question is settled in [Cordis](Cordis.md): no
Cordis crate in Moqui, no shared runtime. What replaces it is here. Read with
[LLM-A2A-Assist](LLM-A2A-Assist.md) (the runtime and the protocol work, built) and the guides
[docs/ai/MCP.md](../docs/ai/MCP.md), [docs/ai/A2A.md](../docs/ai/A2A.md),
[docs/ai/Gateway.md](../docs/ai/Gateway.md).

## 0. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | "On DSH" means Moqui as the system of record behind a DSH harness, over MCP and A2A. It never means a Cordis port, Moqui compiled to TypeScript, or shared Rust crates. | DSH vendors Cordis for JavaScript (`vendor/`, `docs/cordis-primer.md`); `cordis-rs` is a sibling implementation of the same paradigm, so nothing crosses but ideas ([Cordis §2](Cordis.md)). |
| D2 | Moqui is the authority: identity, permissions, approvals, the books. DSH is the requester. | Moqui's write approvals are server-issued, single-use, owner-only and bound to a hash of the arguments (13.11). A harness's sandbox or approval policy is a local preference and must never be able to satisfy a Moqui write. |
| D3 | DSH keeps the agent loop, the session log, the plugin ecosystem and its desktop and web surfaces. Moqui does not rebuild them, and DSH does not model Moqui's entities. | One owner per concern; both sides already have their half. |
| D4 | What crosses is content-free: ids, counts, statuses, amounts. Prompts, files and screen content cross only inside the user's own request, as they already do through the `screen` tool. | A ledger that holds client content is a liability and a dispute magnet; counts and documents are enough to bill. |
| D5 | Tools are exposed per caller: the user's own authority ∩ the agent definition's role group ∩ its tool policy (13.11/4.3), never a per-install allowlist. | The alternative, one shared token with broad rights, is what makes "MCP for business apps" unsafe. |
| D6 | The flag-bearing use case is client work: time and token use rolled up to a customer and invoiced. Every other depth is justified by that one or by a user who asks. | Agency practice is the segment that has both the need and a budget; the cost-dashboard plugins already cover the rest. |
| D7 | Tax, e-invoicing mandates, collections and GL are not hand-rolled. They come from Moqui's invoice path or from the accounting provider (Stripe, QuickBooks, Xero). | Hand-rolling these is how billing projects die; Moqui already has them. |

## 1. What "on DSH" means, in three depths

Table 1. Three depths, each useful alone, each next one needing the one before.

| Depth | Moqui is | Reached by | Built? |
|---|---|---|---|
| 1. Tools | a tool server | MCP `POST /mcp` (13.11) and the MCP/A2A clients (13.12) | yes, config only |
| 2. Screens | the application the agent works | the `screen` tool over the server-side screen session (13.3) | yes |
| 3. The record | the books, the audit and the customer | sessions, usage, invoices posted to Moqui entities | no (this plan) |

Not this:

- **Moqui inside DSH.** The `wasm32-unknown-emscripten` build (`crates/moqui-browser/Cargo.toml:3`) is a browser worker
  with SQLite over a service worker's database; it is not a harness plugin and has no place to put a database either.
- **Cordis in Moqui.** Rejected in [Cordis](Cordis.md) on four verified blockers, chiefly
  `Plugin::apply` returning `impl Future + Send` (`cordis-core` 0.6.1 `plugin.rs:158`) against an
  `ExecutionContext` that is `Rc`/`RefCell` (`crates/moqui-core/src/context/factory.rs:1020-1043`), and Cordis's own
  multi-threaded completion runtime (`effect.rs:488-498`) against the `moqui-browser` host and the
  "do not add async to core" rule (`docs/dev/Practices-Rust.md`, §8).
- **A fork of DSH.** Contributions go upstream as plugins on the `dsh-plugin` topic, not as a maintained fork.

## 2. The surfaces, as verified

Table 2. What each side speaks today.

| Surface | Moqui | DSH |
|---|---|---|
| MCP server | yes, protocol 2026-07-28, Streamable HTTP at `POST /mcp` (13.11) | none (client only) |
| MCP client | yes, `mcp__<server>__<tool>` (13.12) | yes, `dsh-mcp-client`, stdio and streamable-http |
| A2A server / client | yes, 1.0 (13.10 / 13.12) | none |
| ACP (editor ↔ agent) | none | yes, `acp` profile |
| JSON-RPC SDK | none | yes, `dsh --profile sdk` (TS and Python) |
| OpenAI-compatible gateway | yes, `/llm/v1` (13.13) | none |
| Screen surface | yes, `screen` over the tui render model | no; its tools are fs, shell and browser |
| Identity and authority | users, api keys, login keys, app passwords, role groups, tool policies | peers, accounts, local credentials |
| Durable record | entities, cluster, audit, invoices, GL | JSONL session log, sqlite/json storage |

Two details make depth 1 cheap, and both were checked in the code:

- Moqui's MCP tool names are already sanitized to `[A-Za-z0-9_.-]`, at most 128 characters
  (`crates/moqui-llm/src/mcp/tools.rs:221`), which is the name shape a DeepSeek function-call contract accepts.
- DSH's MCP client selects protocol 2026-07-28 when the server offers it, and takes `headers` per server
  (`dsh-mcp-client/README.md`), so the Moqui side is a URL and a Bearer token.

The one unknown that decides the direction is the write path: Moqui's approvals are MCP multi-round-trip requests with
a URL elicitation (`docs/ai/MCP.md`), and whether `dsh-mcp-client` completes that round trip and surfaces the link is
unverified. That is Phase 0.

## 3. Depth 1: Moqui's tools in DSH

On the Moqui side, the configuration is the one 13.11 already documents: `<mcp server-enabled="true">`, an
`AgentDefinition` that serves `mcp` with `exposeMcp="Y"`, `AgentToolExposure` rows for the services to expose, the
`McpServerUse` and `AgentUse` permissions, and `max-direct-tools` with `find_tools`/`describe_tools`/`run_tool` as the
overflow (13.4).

On the DSH side, one entry in a profile or a `cordis.patch.yml`:

```yaml
- id: mcp-moqui
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: moqui
    transport: streamable-http
    url: https://moqui.example/mcp
    headers:
      Authorization: !!js '`Bearer ${process.env.MOQUI_TOKEN}`'
    expandTemplates: true
    startupTimeoutMs: 15000
```

What that buys, without further work: the model sees Moqui's read tools (`screen`, `search`, `data`, `skill`) plus the
exposed services, each as the signed-in user with that user's permissions, behind the read fence, under the tarpit, and
with every write turned into an approval owned by a human in Moqui.

Three limits to plan around rather than discover:

- **Prompt budget.** `max-direct-tools` is 40 and DSH has no tool search of its own. A real Mantle install has far more
  services worth exposing. Keep the direct set small and legible (the batch below), and let `find_tools`/`run_tool`
  cover the tail; measure the schema bytes in the Phase 0 gate, since DSH's prefix caching makes a stable tool list
  worth more than a complete one.
- **Approval arithmetic.** A write pauses for up to `approval-wait` seconds and the client's retry runs it once. A
  harness that drops the call in between leaves the run `AuthRequired` until its owner acts; that is visible in
  System › LLM › Approvals, not lost. Say so in the guide.
- **Error text is prompt text.** `-31401`, `-31403`, a refused exposure, an expired `requestState` and a tarpit refusal
  all reach the model as text and teach it what to do next. They need a pass for a coding-model audience
  (`docs/ai/MCP.md`, "The transport").

## 4. Depth 2: the screens

The differentiator is not that Moqui has tools; it is that a client's real application, with the caller's own
permissions, is reachable as text and can be driven to the edge of a save and no further. DSH's own tools stop at the
filesystem, the shell and a browser; they cannot open "the invoice for Acme, March" and hand the save to a human who
is already signed in.

That is `screen` over the tui render model in a server-side session (13.3): the agent navigates, filters, fills, and a
press of a saving button is held as an approval with current and proposed values, Edit in screen, and Reject with
feedback (13.4). The DSH session becomes the transcript; the work happens in Moqui.

What to measure: tokens per screen render, and the failure text when a permission or a validation refuses. Both decide
whether a small model can work screens at all; the evaluation harness (`moqui test <component> --agents`) already
measures that with recordings and no live model.

## 5. Depth 3: the record, and the reason to do any of this

### 5.1 What each side already has

- DSH's `dsh-token-meter` folds the durable log into `uncachedInputTokens`, `outputTokens`, `cacheReadTokens` and
  `cacheWriteTokens`, and models a retry as its own billed attempt ("`llm/retry-started` ends that replacement scope").
  Its docs say to reach for a real tokenizer "when a deployment needs exact billing-grade counts". `sessionStats` and
  `sessionTelemetry` are display-grade and lossy; neither is a billing source.
- DSH's plugin ecosystem has ~140 cost and usage plugins. They stop at "what did this session cost".
- Moqui has the business half for human time, built and spec'd: `WorkEffort` (project) with `WorkEffortParty` roles,
  `TimeEntry`/`Timesheet`, effective-dated `RateAmount` by project, person and work type
  (`mantle.work.TimeServices.find#RateAmount`), `WorkEffortBilling`, `WorkEffortInvoice`, unbilled work to the cent
  (`mantle.work.ProjectServices.get#UnbilledSummary`), an invoice from approved time only
  (`mantle.account.InvoiceServices.create#ProjectInvoiceItems`), the time behind each line
  (`get#InvoiceTimeDetail`), plus `Invoice`, `InvoiceItem`, `Payment`, `PaymentApplication`,
  `InvoiceAgingSummary` and the GL. The reference flow is
  `runtime/component/mr-mantle/test/WorkProjectBilling.spec.js`; the entities are in
  `runtime/component/mr-mantle/entity/{WorkEffort,AccountingAccount}Entities.xml`.

So the missing piece is neither the meter nor the invoice. It is the join, and the discipline that lets the invoice
defend itself.

### 5.2 Four layers, which must not merge

Most billing plugins merge these, which is why none of them can invoice.

| Layer | What it is | Invariant | DSH | Moqui |
|---|---|---|---|---|
| Meter | facts: tokens, wall time, tool time, compute, remote calls | append-only, idempotent by `(sessionId, seq, kind)` | the durable session log | `UsageRecord` (new) |
| Rate | policy: price per model and bucket, hourly by role, markup, fixed fee | effective-dated, snapshotted at close | new plugin | `RateAmount`, `ProductPrice`, `AgreementTerm` |
| Allocate and close | who owes it: customer, project, period, approved time | one WIP bucket per `(project, period)`, close idempotent | new plugin | `WorkEffortBilling`, `get#UnbilledSummary` |
| Books | invoice, credit note, payment, aging, GL | issued documents immutable, corrections are new documents | new provider | `Invoice`, `Payment`, `GlAccount` |

### 5.3 The DSH side

A `dsh-billing` bundle of plugins, in DSH's own seam shape (a Service Definition, providers, consumers):

- `ctx.billing.meter`: `UsageRecord`s folded from `session/event` (`assistant/attempt`, `request/header`,
  `tool/call`→`tool/result`, `turn/end`). Kinds: `llm.tokens` (the four buckets), `llm.calls`, `tool.ms`, `compute.ms`,
  `storage.bytes`. Counts and route only; no prompt, no file, no argument. A durable outbox, so a harness that is
  offline or whose Moqui is down meters locally and posts later.
- `ctx.billing.rates`: model price table `(provider, model, bucket, currency, effectiveFrom)` and rate cards per
  customer and project (hourly by role, fixed fee per task, token markup). Prices are provider-published; store the
  version used.
- `ctx.billing.targets`: `(identity, working directory, agent)` → customer and project, overridable per session.
  Unassigned usage goes to a personal bucket, never silently to a client.
- `ctx.billing.time`: a manual timer, plus proposed entries derived from session wall time (idle-capped, per project
  per day) that a human confirms through the `interaction` package. Proposed → approved → invoiced → void, the same
  state machine as Moqui's time entries.
- `ctx.billing.close`: a `jobs`/`schedule` job that rates approved time and assigned usage against the snapshot,
  computes unbilled, and produces a **draft** invoice. Issuing needs human approval through the `tools/pre-execute`
  waterfall; the agent may draft, never issue, never move money.
- `ctx.billing.ledger`: providers behind one interface: `ledger-sqlite` (default, a small double-entry ledger),
  `ledger-moqui` (the full books), `ledger-stripe` (metered billing), `ledger-export` (CSV/IIF, QuickBooks, Xero).
- `tool-billing`: model-facing tools `billing_status`, `billing_time_log`, `billing_invoice_draft`, `billing_report`,
  so the agent answers "what is Acme at this month" and logs "1.5 h debugging the deploy" under the same approval
  rules as any write.

### 5.4 The Moqui side

- A `UsageRecord` entity (facts, keyed by `sourceSessionId` + `seq`, content-free) and rate resolution for the token
  buckets, so usage lands in the same unbilled calculation as time: `get#UnbilledSummary` gains usage, and
  `create#ProjectInvoiceItems` gains line kinds `time`, `usage`, `fixed`. Whether the buckets are modelled as
  `Measurement`/`MeasurementType` rows or as their own entity is an implementation choice; the invoice path is shared.
- Intake over MCP: `billing_usage_submit` (idempotent batch) and `billing_time_log` (a write, so approved), or the
  same two as REST services. Identity is the caller's: a harness posts as a user, and the user's projects are the ones
  it may post to.
- `WorkEffortGitCommit`, `WorkEffortRecord` and the screen sessions already carry the evidence that an invoice line can
  cite. That citation — "here is the invoice, here is the work it paid for" — is what none of the 140 usage plugins can
  produce, and it is Moqui's side of the join.

### 5.5 What is billable, honestly

Three policies per project, in the rate card: **bundled** (tokens and agent time are internal cost; the invoice is hours
or a fixed fee, the margin is internal), **pass-through** (provider cost plus a markup percentage as one "AI usage"
line per period), or **unit** (per run, per task, per 1k tokens). Always produce two views: the invoice view and the
margin view, because an agency that discovers the agent cost more than the hour it billed stops using it.

### 5.6 Invariants that make it accounting

Money in integer minor units with an explicit currency, rounded at the line, the unrounded value kept beside it.
Rates effective-dated, with the version and the FX rate snapshotted at close. Draft invoices mutable, issued invoices
immutable; corrections are a credit note and a new invoice. Gapless numbering per series from a transactional counter.
A period lock, with reopening audited. Every line carrying references to the usage records and time entries behind it.
No deletes anywhere: void with a reason and an audit row.

## 6. What Moqui must add, ranked

1. **Nothing** for depth 1 beyond a client-work exposure seed and a guide: `docs/ai/DSH.md` (a user guide, not this
   plan) covering the config row, the token, the permissions, the approval round trip and the limits.
2. A client-work bundle of exposures and policies: a read-only Party/Project/Time/Invoice set a non-admin client can
   use, so the first thing a DSH user sees is their own work, not 200 Mantle services.
3. `UsageRecord`, rate resolution, usage in `get#UnbilledSummary`, usage lines in `create#ProjectInvoiceItems`, and the
   intake services (§5.4). This is mr-mantle and `moqui.work`/`moqui.llm` work, beside
   `WorkProjectBilling.spec.js`.
4. The session and run mirror: a content-free projection of a DSH session (turns, steps, tools, models, counts, status)
   into the runs Moqui already stores for its own agent (13.9's rows), so one place answers "what did the agent do for
   this client".
5. Later, only on user pull: A2A from Moqui's agent to a DSH agent, the `/llm/v1` gateway as DSH's model endpoint with
   central keys and quotas, and a client portal on Moqui screens.

## 7. What DSH must add (upstream, not Moqui's work)

- An MCP server plugin (`ctx.tools` → MCP) or an A2A server plugin. DSH has neither; until one exists the arrow only
  points at Moqui, and a Moqui agent cannot delegate to a DSH one.
- A durable usage and session export provider (`session-persistence`, `storage`), or Moqui's intake reading DSH's
  JSONL and sqlite stores directly. The second is worse: it puts DSH's file format in Moqui.
- Tool search, if a business app's tool surface is to be reachable without a curated exposure list.

These are contributions to another project: propose them, do not fork it. DSH is a developer preview and says
"THERE WILL BE COMPATIBILITY-BREAKING CHANGES"; a plugin against its documented seams survives that, a Moqui-side
coupling to its internal files does not.

## 8. Guardrails

- **Authority.** DSH = requester, Moqui = authority (D2). No token, policy or plugin on the DSH side may issue, approve
  or skip a Moqui write.
- **Versions.** Couple at MCP 2026-07-28 and A2A 1.0, both versioned documents, never at a runtime. Isolate DSH's
  session-event vocabulary behind the meter, because it will move.
- **Content.** Counts and documents cross; content does not (D4). If a future step needs content, it is a different
  decision with a consent and retention story.
- **Degradation.** With Moqui down, DSH keeps working and the meter queues. At most as many unbilled usage records as
  the outbox holds, named in the log, and the failure tolerance rule applies: name it and go on.
- **Identity.** Login keys and app passwords over TLS or loopback only, as `docs/ai/MCP.md` enforces; no OAuth server
  before a user needs one.
- **No measurement, no claim.** Each phase records what it measured, in the Performance plan's manner:
  `plans/Performance.md` sets 500 ms cold start, and nothing here may quietly add to it.

## 9. Phases and gates

No phase starts before the previous gate, and each gate is a measurement, not a demo.

| Phase | What | Gate |
|---|---|---|
| 0 | Spike, no code (two days): enable `/mcp` on a dev node with two exposures, point a DSH profile's `mcp-client` at it, run one read and one write with its approval. | The approval link is surfaced in the DSH transcript, the retry runs the write once, and the record states: tool-schema bytes in the prompt, per-call latency including the approval wait, tokens per screen render, and the failure behaviours (401, 403, expired `requestState`, Moqui restart mid-approval). If DSH's client cannot complete the MRTR round trip, stop and switch to §7's MCP-server plugin as the primary path. |
| 1 | Client-work exposure seed and policy; `docs/ai/DSH.md`; the tool list kept small and stable. | A non-admin user sees only their permitted tools; a write is refused without its owner's approval; the guide's commands reproduce the setup from an empty install. |
| 2 | `screen` in a DSH session for two real screens, with saves approved and Edit in screen. | The human saves from the card, the model reads a refused save as teachable text, and tokens per screen are within the prefix budget the gate in Phase 0 fixed. |
| 3 | The session and run mirror; `UsageRecord` intake in Moqui from a DSH harness, idempotent by `(sessionId, seq)`. | A month of usage replays exactly: no duplicates after a restart, an offline period or a re-post; totals equal DSH's own meter per model and bucket. |
| 4 | Billing v1: time proposals and approvals, rate cards, unbilled including usage, margin view. | Unbilled equals the manual calculation to the cent for a real week, beside `WorkProjectBilling.spec.js`. |
| 5 | Billing v2: close, draft invoice, human issue, payment recorded, export; `ledger-sqlite` or Moqui's own invoice path. | One real invoice issued and paid; the invariant suite green (line sums, source references, gapless numbers, period lock, void and reissue). |
| 6 | Later: client portal, dunning, tax and e-invoicing through the accounting provider, A2A from Moqui's agent to a DSH one, the gateway as DSH's model endpoint. | A client logs in and sees the work behind the invoice. |

If billing is picked up on its own, §5 and Phases 3 to 5 move to `plans/Billing.md` and this plan keeps the decisions
and the link; the entity and service names are already there to move.

## 10. Open questions

1. **Does `dsh-mcp-client` complete a 2026-07-28 MRTR with a URL elicitation?** Decisive for depth 1's write path.
2. Do a business app's screens read well as text to the models DSH users run, at the token cost measured? The
   evaluation harness can answer it with recordings.
3. Is 40 direct tools plus `find_tools` enough for a harness with no tool search, or does DSH need its own search
   before a business app's surface is usable?
4. Where do sessions live: sqlite for one person, Moqui for an agency, or one mode with the ledger swapped? Two modes
   double the test surface; one mode hides the choice.
5. Which invoice lines must be exact? Provider usage per attempt is exact; an envelope estimate is heuristic. The
   recommendation here is to bill time and fixed fees and keep usage as cost and margin, so no invoice depends on a
   heuristic.
6. Multi-currency and tax: the rate card's currency, the invoice's, and who owns the tax calculation (Moqui's
   `TaxAuthorityRate` or the accounting provider).
7. Distribution: a DSH bundle in the marketplace, a Moqui component, or both. Who installs what, and who supports it.

## 11. Non-goals

- Any Cordis crate in Moqui, a shared runtime, or a port of DSH packages ([Cordis](Cordis.md)).
- Moqui compiled to wasm inside a harness.
- Hand-rolled tax, e-invoicing mandates, dunning or GL in v1 and v2.
- An OAuth 2.1 authorization server, the A2A and MCP clients' OAuth path, and content-bearing session mirroring,
  before a user needs them.
- A maintained fork of DSH, and any Moqui code that reads DSH's session files as a format.
