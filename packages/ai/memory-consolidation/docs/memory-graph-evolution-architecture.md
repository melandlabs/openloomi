# Memory Graph Evolution: Dynamic Clusters, Reinforcement, and Forgetting

Execution plan: [memory-graph-evolution-execution-plan.md](./memory-graph-evolution-execution-plan.md)

## Problem

OpenLoomi's long-term memory should not remain a bag of isolated records plus
semantic similarity search. That model is useful as an initial retrieval layer,
but it does not explain how memory becomes more stable, more concise, or more
trustworthy over time.

The main gaps are:

- Duplicate memories cannot naturally merge. Similar traces may be retrieved
  together, but the system has no durable structure that says they support the
  same belief, preference, fact, or working pattern.
- New evidence cannot strengthen or weaken older memories. A new trace may be
  similar to an old trace, but similarity alone does not update confidence,
  relation weight, cluster status, or competition between alternatives.
- Forgetting based only on time and per-record value is too coarse. A single old
  record can be noisy, but an old cluster with repeated activation may still be
  important. Likewise, a recent record may be noise if it never connects to
  anything else.
- Retrieval can return fragment noise. Similarity search can surface several
  near-duplicate raw records, weak one-off traces, or conflicting records without
  enough graph context to choose stable memory over evidence fragments.
- Summary and deprecation are currently sedimentation actions, not a complete
  graph mechanism. A summary can supersede source records, and soft-deprecation
  can hide raw evidence by default, but the system still needs an explicit model
  for how clusters form, stabilize, decay, compete, and remain auditable.

The desired evolution is a dynamic memory graph: new memories interact with old
memories, update relations, reshape clusters, and feed forgetting,
consolidation, retrieval, and audit flows.

## Design Goals

- Represent memory records as a dynamic graph rather than isolated fragments.
- Let new memory influence old memory by reinforcing, weakening, contradicting,
  elaborating, or superseding existing graph structures.
- Give memory clusters an explicit lifecycle so the system can distinguish
  forming, active, stable, decaying, superseded, and audit-only memory.
- Treat forgetting as a graph operation, not simple deletion. Forgetting should
  hide, decay, archive, or supersede evidence according to graph state and audit
  constraints.
- Use graph signals during retrieval, including cluster stability, edge weight,
  conflict status, summary coverage, recency, and source evidence quality.
- Preserve audit trails from summaries and artifacts back to source records,
  relation evidence, and the graph operations that changed visibility.
- Keep graph state scoped to the owning user, workspace, or tenant. Cross-scope
  edges should be opt-in product behavior, not a default graph operation.

## Non-goals

- Do not rewrite storage as part of the first architecture step.
- Do not build UI.
- Do not require real-time LLM calls for every memory write.
- Do not implement a complete scheduler in one step.
- Do not delete the raw audit chain.
- Do not bind all relation judgment to one embedding strategy. Embeddings,
  rules, metadata, explicit user feedback, and optional model judgments should
  all be possible sources of graph evidence.

## Core Concepts

### Memory Node

A `Memory Node` is a graph-addressable memory unit. It may represent:

- `raw`: source traces such as messages, observations, or interaction fragments.
- `summary`: stable cluster sedimentation used for compact long-term recall.
- `artifact`: a durable memory product, report, plan, preference profile, or
  externalized knowledge object.

Nodes should keep identity, timestamps, source type, visibility state, and
provenance. A node does not need to know every cluster it belongs to; cluster
membership can be derived or stored by the graph layer.

Graph identity must include the owning scope, such as user, workspace, or
tenant. A graph operation should not connect nodes across scopes unless a caller
explicitly opts into a product feature that permits shared memory.

### Memory Edge

A `Memory Edge` records a relationship between nodes. The architecture should
allow at least these relation kinds:

- `supports`: two nodes reinforce the same memory pattern.
- `contradicts`: two nodes conflict or compete.
- `elaborates`: one node adds detail to another without replacing it.
- `supersedes`: one node is the preferred canonical representation of another.
- `co-occurs`: nodes were observed or activated together.
- `same-topic`: nodes are semantically adjacent but not yet judged as support or
  conflict.

Edges should carry weight, confidence, evidence count, last activation time,
reason codes, and source evidence. Some edges are strong enough to shape
clusters; others remain weak observations.

Current relation-graph helpers already use a smaller operational vocabulary:
`support`, `compete`, and `related`. The richer relation kinds above should be
treated as architecture-level semantics that can project down into those current
edge classes:

- `supports` maps to `support`.
- `contradicts` maps to `compete`.
- `same-topic`, weak `elaborates`, and uncertain co-activation map to `related`.
- `supersedes` is primarily a consolidation/audit relation and should connect to
  summary or artifact provenance rather than force raw clusters to merge.

This keeps existing helpers useful while leaving room for later interfaces to
represent more nuance.

### Memory Cluster

A `Memory Cluster` is a stable or forming group of memory nodes connected by
supporting evidence. A cluster is not just a search result. It is an evolving
memory structure with its own lifecycle, score, evidence set, relation history,
and possible competition with other clusters.

Clusters should be able to contain raw nodes, summaries, and artifacts. A
summary can become the active representative of a stable cluster while raw
source nodes remain linked for audit.

### Reinforcement

`Reinforcement` happens when new evidence increases confidence in an existing
node, edge, or cluster. Examples:

- a new raw trace supports an existing preference cluster
- a retrieved memory is reused successfully in an answer
- multiple source records co-activate in the same task context
- explicit user feedback confirms a prior memory

Reinforcement should update edge weights, cluster stability, activation counts,
and retrieval priority. It should not automatically overwrite raw evidence.

### Weakening / Decay

`Weakening` happens when evidence becomes stale, unsupported, contradicted, or
unused. `Decay` is time-based weakening, but weakening can also come from new
contradictory evidence or failed retrieval outcomes.

Decay should operate on graph structure:

- isolated raw nodes decay faster than reinforced clusters
- weak edges decay when they are not reactivated
- contradicted clusters can lose active status
- superseded clusters can move toward audit-only visibility

### Consolidation

`Consolidation` turns stable graph structures into compact durable memory:
summaries, artifacts, or canonical cluster representatives. Consolidation should
consume cluster state and source evidence rather than treating records as an
unordered batch.

The consolidation output should preserve provenance: source node ids, relation
evidence, reason codes, quality/confidence signals, and the cluster lifecycle
state that justified sedimentation.

### Soft Forgetting

`Soft Forgetting` hides source raw records from default retrieval after a stable
summary or artifact supersedes them. It does not delete audit evidence.

Soft-forgotten records should keep fields such as deprecation timestamp, reason,
superseding summary or artifact id, and source linkage. Default retrieval should
prefer the active summary/cluster representative; audit retrieval should be able
to include deprecated raw records.

### Audit Trail

The `Audit Trail` is the reversible chain from a summary or artifact back to:

- source raw records
- relation evidence
- graph update operations
- cluster lifecycle decisions
- deprecation or visibility changes

Audit is a first-class requirement. It lets operators answer why a memory exists,
what evidence supports it, what was hidden by default, and how to recover the raw
source chain when needed.

## Architecture Layers

### Graph Layer

Responsibility: express memory nodes, edges, clusters, lifecycle state, and
graph snapshots.

The Graph Layer stores or derives:

- node identity and visibility
- edge kind, weight, confidence, and provenance
- cluster membership and cluster representatives
- competition relationships between clusters
- graph version or operation metadata
- owner scope, so graph reads and writes stay isolated by user, workspace, or
  tenant

It should not decide which model/provider judges relation meaning. It should not
perform final retrieval ranking by itself. It should expose enough graph state
for interaction, lifecycle, consolidation, retrieval, and audit layers.

### Interaction Layer

Responsibility: let new memory interact with existing memory and produce a graph
update plan.

The Interaction Layer takes new memory nodes plus candidate existing nodes or
clusters. It proposes:

- new edges
- edge reinforcement
- edge weakening
- cluster joins or splits
- conflict/competition observations
- reason codes and evidence links

It should support multiple signal sources: metadata rules, explicit relation
keys, embeddings, co-activation, user feedback, and optional model judgment. It
should output a plan before persistence so callers can dry-run, audit, or gate
graph changes.

### Cluster Lifecycle Layer

Responsibility: manage cluster state transitions.

Suggested lifecycle states:

- `forming`: early evidence exists but is not stable.
- `active`: the cluster is useful in retrieval and still evolving.
- `stable`: evidence is strong enough for consolidation.
- `decaying`: evidence or activation is weakening.
- `superseded`: another summary, artifact, or cluster is the preferred
  representative.
- `audit-only`: hidden from default retrieval but retained for traceability.

The lifecycle layer consumes graph state and policy. It should not generate
summary text, mutate storage directly, or decide UI presentation.

### Forgetting / Consolidation Layer

Responsibility: convert stable or decaying cluster state into memory operations.

Operations can include:

- generate summary candidates from stable clusters
- persist summaries or artifacts
- soft-deprecate source raw records
- archive source details when policy allows
- mark weak clusters as decaying or audit-only
- preserve contested clusters without premature summarization

This layer is where current summary plus soft-deprecation behavior belongs. It
should consume cluster lifecycle decisions and produce auditable actions.

### Retrieval Layer

Responsibility: use graph signals during recall.

Retrieval should start with semantic, keyword, recency, or metadata candidates,
then use graph state to:

- expand from a raw hit to its active cluster representative
- suppress deprecated source records by default
- prefer stable summaries when they cover noisy raw traces
- include conflicting clusters when contradiction matters
- rank by relation strength, activation, lifecycle state, and evidence quality
- support audit mode via `includeDeprecated` and provenance expansion

Graph-aware retrieval should not replace all semantic search. It should make
semantic candidates more contextual and less fragmentary.

### Observability Layer

Responsibility: report how the graph changed and why.

Reports should include:

- graph diffs
- created/updated edges
- reinforcement and decay events
- cluster lifecycle transitions
- consolidation outputs
- source soft-deprecation outcomes
- retrieval changes compared with baseline search
- audit chain completeness

The observability layer makes the system operable before fully automatic graph
behavior is enabled.

## Data Flows

### Ingest-time Flow

```text
new memory
  -> normalize node
  -> retrieve candidate existing nodes/clusters
  -> infer relation candidates
  -> build graph update plan
  -> reinforce / weaken / create edges
  -> update cluster membership and lifecycle signals
  -> emit GraphEvolutionReport
```

The ingest path should be incremental. It does not need to summarize
immediately. Its job is to make the new memory interact with existing memory so
future consolidation and retrieval have graph context.

### Batch Consolidation Flow

```text
stable cluster
  -> consolidation planner
  -> summary or artifact draft
  -> persist summary/artifact
  -> soft-deprecate source raw records
  -> update cluster representative
  -> emit consolidation and deprecation diagnostics
```

This is the sedimentation path. The summary is not a replacement for the graph;
it is the active compact representation of a stable cluster. Source raw records
remain audit-linked and can be retrieved with audit options.

### Retrieval Flow

```text
query
  -> semantic / keyword / metadata candidates
  -> graph expansion
  -> lifecycle and visibility filtering
  -> graph-aware ranking
  -> active summaries and selected raw records
```

Default retrieval should hide deprecated raw source records when an active
summary covers them. When the query needs evidence or conflict, retrieval can
expand to source records, related clusters, or competing clusters.

### Audit Flow

```text
summary or artifact
  -> source record ids
  -> relation evidence
  -> graph operations
  -> lifecycle decisions
  -> deprecation / visibility history
```

Audit mode should prove why a summary exists and why raw records are hidden by
default. It should recover source evidence without turning audit records back
into normal retrieval noise.

## Interface Boundary

These names are conceptual boundaries, not final helper names. Each boundary
should stay small enough to test independently and broad enough to guide future
implementation.

### MemoryGraphStore

Input:

- node writes and reads
- edge writes and reads
- cluster snapshots or cluster update operations
- graph operation metadata
- owner scope for every graph read and write

Output:

- graph snapshot for candidate records or clusters
- persisted graph update result
- audit provenance for nodes, edges, and clusters

Not responsible for:

- judging relation meaning
- deciding lifecycle policy
- generating summaries
- final retrieval ranking

Consumed by:

- GraphInteractionEngine
- ClusterLifecyclePolicy
- MemoryConsolidationPlanner
- GraphAwareRetriever
- Observability Layer

### GraphInteractionEngine

Input:

- new memory nodes
- candidate existing nodes/clusters
- signal sources such as embeddings, metadata, relation keys, co-activation, or
  optional model judgments

Output:

- graph update plan
- relation candidates and judgments
- reinforcement or weakening events
- evidence and reason codes

Not responsible for:

- storage schema migration
- final persistence without caller approval
- summary generation
- default retrieval behavior

Consumed by:

- ingest-time memory pipeline
- batch graph maintenance
- GraphEvolutionReport

### ClusterLifecyclePolicy

Input:

- graph snapshot
- cluster scores
- edge weights
- activation history
- conflict and supersession signals
- policy thresholds

Output:

- lifecycle transitions
- cluster representative suggestions
- consolidation eligibility
- decay or audit-only recommendations

Not responsible for:

- creating raw relation evidence
- writing summaries
- deleting raw records
- ranking query results directly

Consumed by:

- MemoryConsolidationPlanner
- GraphAwareRetriever
- Observability Layer

### MemoryConsolidationPlanner

Input:

- stable or decaying cluster state
- source node ids and evidence
- lifecycle recommendations
- summarization or artifact constraints

Output:

- summary/artifact candidates
- source soft-deprecation plan
- archive recommendations
- diagnostics for preserve / observe / decay decisions

Not responsible for:

- judging every relation from scratch
- direct UI presentation
- mandatory online writes
- removing audit evidence

Consumed by:

- forgetting/consolidation runtime
- summary/artifact generation boundary
- audit tooling

### GraphAwareRetriever

Input:

- query
- semantic/keyword candidate hits
- graph snapshot
- visibility mode such as default retrieval or audit retrieval

Output:

- ranked memory hits
- graph expansion explanation
- active summaries/raw records
- optional audit source chains

Not responsible for:

- mutating graph state by default
- deciding cluster lifecycle
- generating summaries
- replacing the underlying semantic index

Consumed by:

- agent context assembly
- memory search APIs
- evaluation and retrieval dry-runs

### GraphEvolutionReport

Input:

- graph update plan
- persisted graph update result
- lifecycle transitions
- consolidation/deprecation outcomes
- retrieval diff data

Output:

- human-readable and machine-readable graph diff
- reinforcement and weakening summary
- cluster lifecycle summary
- audit chain completeness
- warnings and no-op diagnostics

Not responsible for:

- deciding policy
- mutating storage
- ranking memories
- summarizing source content

Consumed by:

- tests and evals
- operators
- future UI surfaces
- rollout gates

## Phased Implementation Plan

### Phase 1: Architecture + Conceptual Contracts

Define the graph architecture, terms, lifecycle states, and interface boundaries.
Keep this phase documentation-first. Any contracts should be conceptual or
dry-run only. The success criterion is shared understanding of where graph,
interaction, lifecycle, consolidation, retrieval, and observability concerns
belong.

### Phase 2: Ingest-time Graph Interaction

Add an opt-in path where new memory retrieves candidate existing memory and
produces a graph update plan. Start with explicit metadata/relation keys and
simple similarity candidates. Persist only behind a controlled boundary, with
reports showing proposed edges, reinforcement, weakening, and cluster impact.

### Phase 3: Cluster Lifecycle State

Introduce lifecycle state for clusters. Compute forming, active, stable,
decaying, superseded, and audit-only transitions from graph signals. Keep the
policy separate from storage and summarization. Add dry-run lifecycle reports
before changing default runtime behavior.

### Phase 4: Graph-aware Forgetting / Consolidation

Make forgetting and consolidation consume cluster lifecycle state. Stable
clusters produce summaries or artifacts; source raw records are soft-deprecated
after successful persistence; weak or unsupported structures decay; contested
clusters are preserved for observation rather than prematurely summarized.

### Phase 5: Graph-aware Retrieval

Use graph state to improve retrieval. Start with dry-run comparison reports:
baseline semantic candidates versus graph-expanded and graph-ranked results.
Then enable controlled retrieval paths where active summaries represent stable
clusters and deprecated raw source records are hidden by default but available
for audit.

### Phase 6: Evaluation and Observability

Build evaluation scenarios and reports for:

- duplicate memory reduction
- stable preference recall
- conflict handling
- source evidence traceability
- noise suppression
- graph-aware retrieval quality
- audit chain completeness

Observability should make every graph operation explainable before broad runtime
enablement.

## Relationship to Existing Work

- Relation graph and relation discovery already form the foundation of the Graph
  Layer and Interaction Layer. Existing relation candidates, relation judgment,
  graph assignment, competition groups, and lifecycle signals can be treated as
  early graph mechanics.
- Current `support`, `compete`, and `related` relation edges are the operational
  projection of the broader relation taxonomy proposed here. Future interfaces
  can add richer relation kinds without invalidating the current graph pipeline.
- The current forgetting engine is an early Forgetting / Consolidation Layer. It
  scans eligible memory, groups records, generates summaries, transitions tiers,
  and provides a place for graph-aware cluster decisions to be consumed later.
- Summary plus soft-deprecation is the sedimentation action after cluster
  stabilization. It should eventually be driven by stable cluster lifecycle
  state rather than only by record age or batch grouping.
- `includeDeprecated` and audit retrieval are the foundation of the Audit Trail.
  Default retrieval can hide superseded raw records, while audit retrieval can
  recover the source chain behind a summary or artifact.
- Existing semantic retrieval dry-runs and retrieval comparison reports can
  become the evaluation harness for graph-aware retrieval before changing
  default ranking.

## Acceptance Criteria

This architecture is sufficient when it can answer the following questions:

- How does new memory affect old memory?

  New memory becomes a node, retrieves candidate neighbors, produces relation
  updates, reinforces or weakens edges, and can update cluster membership and
  lifecycle state.

- How do memory clusters form, stabilize, and decay?

  Clusters form from supporting edges, become active through evidence and
  activation, stabilize when policy thresholds are met, decay when unsupported or
  contradicted, and move to superseded or audit-only states when a summary or
  artifact becomes the active representative.

- Why is forgetting a graph operation?

  Forgetting must consider whether a record is isolated noise, part of a stable
  cluster, contradicted by a stronger cluster, superseded by a summary, or still
  needed for audit. Those are graph states, not simple per-record age checks.

- Where do summary and deprecation sit in the architecture?

  They are consolidation outputs after cluster stabilization. A summary or
  artifact becomes the compact active representative; source raw records are
  soft-deprecated by default but remain linked for audit.

- How does retrieval use graph signals instead of only similarity?

  Retrieval starts from semantic or keyword candidates, then expands and ranks by
  cluster membership, edge strength, lifecycle state, contradiction,
  supersession, activation, and visibility mode.

- Which boundaries should future interface design use?

  Future interfaces should center on `MemoryGraphStore`,
  `GraphInteractionEngine`, `ClusterLifecyclePolicy`,
  `MemoryConsolidationPlanner`, `GraphAwareRetriever`, and
  `GraphEvolutionReport`.
