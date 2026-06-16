# 记忆关系图原型设计

## 目标

当前 `@openloomi/memory-consolidation` 已经具备从 `cluster` 到
`consolidation plan` 的决策能力：

```text
cluster -> score -> competition -> preserve / observe / decay
```

但更上游的问题还没有解决：相似 trace 如何形成 cluster，互斥模式如何形成
competition。这个原型设计把记忆看成一张动态关系图：

```text
trace -> relation graph -> graph clusters -> competition groups -> consolidation plan
```

核心思想是：不要在写入入口判断“这是不是噪声”，也不要立刻给 trace 贴永久标签；
先保留 trace 之间的关系，让支持边、竞争边和激活历史逐步决定哪些结构稳定下来。

## 原型闭环

这个原型把前面讨论过的强化、聚簇、竞争和 consolidation plan 串成一个闭环：

```text
new trace
  -> create / update relation edges
  -> reinforce or decay node and edge weights
  -> form graph clusters from strong support edges
  -> form competition groups from strong compete edges
  -> reuse buildMemoryConsolidationPlan
  -> preserve / observe / decay
```

这里的关键约束是：前半段只负责发现结构，后半段才负责做决策。关系图不会直接决定
“应该记住什么”，它只回答两个问题：

- 哪些 trace 已经形成同一个稳定证据簇？
- 哪些稳定证据簇处在同一个竞争维度里？

这样能避免把图机制做成另一个 upfront classifier，也能继续复用当前 package 里已经存在的
score、competition 和 plan 逻辑。

## 非目标

这个原型不解决完整自动聚类问题：

- 不接入 forgetting engine runtime。
- 不修改 storage schema。
- 不引入 embedding / LLM 依赖。
- 不自动判断两条 trace 是否支持或冲突。
- 不生成长期 summary。

mini 版本只验证：如果已经有一组 trace relation，是否可以从图结构中得到
`clusterKey` 和 `competitionKey`，再复用现有 consolidation plan。

## 核心对象

### Trace Node

`TraceNode` 表示一个原始记忆痕迹。它可以来自消息、观察、用户反馈或任务状态。

```text
id
recordId
timestamp
activationCount
lastActivatedAt
```

节点本身不需要知道自己属于哪个分类。它只需要保留足够的身份和激活信息。

### Relation Edge

`RelationEdge` 表示两个 trace 之间的关系。

```text
fromRecordId
toRecordId
relation: support | compete | related
weight
evidenceCount
activationCount
lastActivatedAt
```

三类边的含义不同：

- `support`：两个 trace 支持同一个记忆模式，可以促成聚簇。
- `compete`：两个 trace 指向互斥或冲突的模式，不应该合并。
- `related`：语义相关但不能确定支持或冲突，只作为观察信号。

mini 版本中，关系边先由测试或调用方显式传入。未来可以由 embedding、LLM 或规则
生成候选边。

### Graph Cluster

`GraphCluster` 由强 `support` 边形成。

```text
clusterId
recordIds
supportEdgeIds
relatedEdgeIds
status: tentative | stable | contested
supportScore
latestTimestamp
```

聚簇不是分类结果，而是图中的稳定社区。孤立节点也可以形成一个 tentative
micro-cluster，但不会因为孤立就被提升为长期记忆。

### Competition Group

`CompetitionGroup` 由 cluster 之间的强 `compete` 边形成。

```text
competitionKey
clusterIds
competeEdgeIds
```

竞争关系不合并 cluster，只说明这些 cluster 在同一个使用场景或记忆维度上互斥。
例如中文回答偏好和英文回答偏好不应该合并，但可以进入同一个竞争组。

## 边权强化与衰减

关系图的关键不是边是否存在，而是边权会变化。

### 强化

当相似 trace 反复出现，或在检索时一起被激活，边权增强：

```text
newWeight = oldWeight + evidenceBoost + activationBoost
```

可以区分两种强化：

- `evidenceBoost`：新的独立 trace 提供重复证据。
- `activationBoost`：已有 trace 在同一上下文中共同被召回或使用。

这样一条安静偏好如果多次出现，会逐步形成强 support 边。

### 衰减

长期没有新证据或再激活的边会衰减：

```text
decayedWeight = weight * timeDecay(lastActivatedAt, now)
```

衰减应该作用在边和节点上，而不只是作用在单条记忆上。这样孤立噪声会自然失去
连接能力，而稳定簇会因为持续再激活保持活性。

## 从关系图形成聚簇

mini 版本可以使用很保守的规则：

1. 只选择 `relation = support` 且 `weight >= supportThreshold` 的边。
2. 用这些边构造无向图。
3. 图中的 connected components 形成 graph clusters。
4. 没有强 support 边的节点形成 tentative micro-cluster。
5. `related` 边不参与合并，只保留为观察信号。

这种规则故意简单。它不是最终聚类算法，但能验证“簇由支持关系形成”这个方向。

## 从竞争边形成竞争组

competition 的形成也保持保守：

1. 先根据 support 边得到 graph clusters。
2. 检查所有 `relation = compete` 且 `weight >= competeThreshold` 的边。
3. 如果一条 compete 边连接了两个不同 cluster，就建立 cluster-level compete edge。
4. 通过 cluster-level compete edge 的 connected components 得到 competition groups。
5. 没有竞争边的 cluster 使用自己的 clusterId 作为 competitionKey。

这样可以表达：

```text
cluster: 中文回答偏好
cluster: 英文回答偏好
competition group: answer-language-like
```

mini 版本不需要理解它们为什么是回答语言偏好，只需要看到两个稳定簇之间存在强竞争。

## 生命周期

关系图中的 cluster 可以有三个图状态：

```text
tentative -> stable -> contested
```

- `tentative`：证据少，只有单点或弱连接。
- `stable`：support 边足够强，形成稳定簇。
- `contested`：存在强 competition group，需要交给 plan 决策。

是否最终进入长期整合，仍然由 `buildMemoryConsolidationPlan` 决定。plan 给出
`preserve` 后，可以派生出第四个生命周期状态：

```text
contested / stable -> consolidated
```

`consolidated` 不由 relation graph 直接判断，它表示某个 graph cluster 已经在 plan 层
被选为长期整合候选。

## 与现有 plan helper 的连接

relation graph 不直接做 `preserve` / `observe` / `decay` 决策。它只生成 resolver：

```text
getClusterKey(record) -> graph cluster id
getCompetitionKey(cluster) -> graph competition key
```

然后复用现有链路：

```text
records
  -> relation graph assignment
  -> buildMemoryEvidenceClusters
  -> buildMemoryConsolidationPlan
```

这样可以让新机制作为现有 package 的前半段，而不是替换已有 scoring 和 plan。

## 示例

原始 trace：

```text
A: 以后技术问题用中文解释
B: 我更喜欢中文回答
C: 代码解释默认中文
D: 这次先用英文
E: 以后默认英文
F: 技术讨论用英文
N: urgent todo blocker random note
```

关系边：

```text
A support B 0.82
B support C 0.78
A support C 0.74
E support F 0.80
A compete E 0.76
B compete E 0.73
C compete F 0.70
D related E 0.45
```

形成的 graph clusters：

```text
cluster-zh: A, B, C
cluster-en: E, F
cluster-temp: D
cluster-noise: N
```

形成的 competition groups：

```text
competition-1: cluster-zh, cluster-en
cluster-temp: no strong competition
cluster-noise: no strong competition
```

再交给 consolidation plan 后，可能得到：

```text
cluster-zh -> preserve
cluster-en -> observe 或 preserve，取决于最近重复证据
cluster-temp -> decay
cluster-noise -> decay
```

如果后续出现更多英文偏好 trace，`cluster-en` 的 evidence 和 recency 会增强，并可能在
competition 中赢过旧的中文偏好簇。

## 信号如何传递

原型里每一层只向下一层传递必要信号：

| 层级               | 输入                                  | 输出                           | 不做什么           |
| ------------------ | ------------------------------------- | ------------------------------ | ------------------ |
| relation graph     | trace nodes + relation edges          | decayed / reinforced edges     | 不判断长期记忆     |
| graph cluster      | strong support edges                  | `clusterId -> recordIds`       | 不生成 summary     |
| competition group  | strong compete edges between clusters | `competitionKey -> clusterIds` | 不合并冲突簇       |
| evidence cluster   | records + `getClusterKey`             | cluster score                  | 不接触 storage     |
| consolidation plan | cluster score + `getCompetitionKey`   | preserve / observe / decay     | 不直接修改 runtime |

因此强化机制的作用不是“强行保存某条 trace”，而是让相关边更容易跨过
`supportThreshold` 或 `competeThreshold`。跨过阈值之后，trace 才会进入更稳定的图结构；
没有跨过阈值的孤立痕迹仍然可以被现有 forgetting policy 自然压缩或归档。

## 最小 API 形状

如果后续进入代码实现，mini 版本可以只暴露一个纯函数：

```text
assignMemoryRelationGraph({
  records,
  nodes,
  relations,
  now,
  thresholds,
}) -> {
  clusters,
  competitionGroups,
  getClusterKey(record),
  getCompetitionKey(cluster),
}
```

`relations` 由调用方显式提供，不在 mini 版本里自动生成。函数内部只做三件事：

1. 对节点和边应用时间衰减。
2. 用强 `support` 边计算 connected components。
3. 用强 `compete` 边计算 cluster-level competition groups。

然后调用方可以把 resolver 交给现有函数：

```text
assignMemoryRelationGraph
  -> buildMemoryEvidenceClusters
  -> buildMemoryConsolidationPlan
```

这个 API 的好处是实现范围很小，但已经能验证最关键的假设：聚簇和竞争关系可以从图结构
自然形成，而不是由写死分类规则提前决定。

## 复杂度边界

relation graph 不能做全量两两比较。mini 版本只处理已传入的 relation edges：

```text
cluster assignment: O(nodes + supportEdges)
competition assignment: O(clusters + competeEdges)
```

未来如果自动生成 relation edges，也应该只做局部 topK 候选：

```text
new trace -> retrieve topK candidate nodes/clusters -> create/update edges
```

不能退化成所有 trace 两两比较。

## 后续实现顺序

建议分三步推进：

1. **关系图原型**
   - 输入 records + explicit relations。
   - 输出 cluster assignment + competition assignment。
   - 复用现有 consolidation plan。

2. **关系候选生成**
   - 用 embedding 或轻量规则召回 topK 候选。
   - 只生成候选边，不直接合并。

3. **模糊关系裁决**
   - 对低置信度候选边做 LLM/规则裁决。
   - 输出 `support` / `compete` / `related` / `uncertain`。
   - `uncertain` 保持 tentative，不做强合并。

这个顺序能把复杂问题延迟到足够需要的时候，同时让当前 package 先形成完整概念闭环。
