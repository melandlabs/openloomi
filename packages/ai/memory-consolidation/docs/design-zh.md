# 记忆簇与竞争机制设计思路

## 背景

当前 forgetting engine 以单条记忆为单位进行价值评分，并结合时间、访问次数、重要性、媒体引用和 pin 状态，决定记忆是否进入后续分层压缩流程。这个设计适合控制记忆规模，也能让短期记忆逐步沉淀为中长期摘要。

如果未来希望进一步提升长期记忆质量，可以在现有 forgetting engine 之外，引入一个轻量的“记忆簇”层。它不替换现有分层、压缩和归档逻辑，而是补充一个基于重复证据和再激活的长期记忆整合视角。

## 核心想法

不要在写入入口强行判断一条信息是否是噪声，而是先让信息留下较弱的记忆痕迹。后续如果相似信息反复出现，或者被多次检索和使用，就合并成记忆簇并逐渐增强；如果只是一次性信息，则因为缺少再激活和重复证据而自然衰减。

也就是说，记忆质量不只来自单条记录的即时评分，还来自一段时间内多条相似痕迹之间的相互支持。

## 概念划分

- Trace：一次原始记忆痕迹，例如一条消息、一次观察或一次交互片段。
- Cluster：多条相似 Trace 形成的记忆模式，用来表达“这个主题或偏好反复出现过”。
- Summary：稳定 Cluster 的长期可读表达，可以作为后续检索和上下文注入的材料。

简化后的关系是：

```text
Trace 是证据
Cluster 是记忆模式
Summary 是稳定记忆的可读表达
```

## 与现有机制的关系

这个方向不是替换当前 forgetting engine，而是作为未来增强层：

- 现有机制继续负责记忆分层、压缩、归档和硬删除策略。
- 记忆簇机制负责从多条痕迹中识别稳定模式。
- 低价值的孤立 Trace 可以继续被现有遗忘策略压缩或归档。
- 稳定 Cluster 可以作为摘要生成、长期记忆保留和冲突处理的额外信号。

## 当前 package 范围

`@openloomi/memory-consolidation` 目前只提供纯函数能力：

- 构建 evidence clusters。
- 从显式 trace relation 中分配 graph clusters 和 competition groups。
- 保留 weak related edges 作为观察信号，而不是直接参与合并。
- 计算 cluster-level score。
- 输出 per-record diagnostics。
- 输出 consolidation plan，将记忆簇信号转成 `preserve`、`observe`、`decay` 建议。
- 支持 eval 场景比较 trace-level signal 和 cluster-level signal。

它不会修改 forgetting decision、storage schema、retrieval behavior 或 summarization behavior。

## 决策层设计

`buildMemoryConsolidationPlan` 是当前 package 内的核心决策层。它不直接删除、
保留或写入长期记忆，而是把 cluster 信号转成可解释的候选计划：

- `preserve`：重复证据足够强，可以作为后续长期整合候选。
- `observe`：证据还不够清晰，或者竞争结果接近，需要继续观察。
- `decay`：孤立证据或被稳定竞争簇压过的一次性证据，不应该被提升为长期记忆。

竞争关系由调用方通过 `getCompetitionKey` 显式提供。例如
`answer-language:zh` 和 `answer-language:en` 可以归入同一个
`answer-language` 竞争组；而一次性噪声可以保持独立分组，自然因为缺少重复证据而衰减。

这种设计的目的不是让系统判断“这是不是噪声”，而是让噪声因为没有重复证据、
没有再激活、没有赢得竞争而无法进入长期整合。

关系图层只负责输出 `tentative`、`stable` 和 `contested` 状态；`consolidated` 是
consolidation plan 产生 `preserve` 建议之后的派生状态，不由关系图直接决定。

## 后续验证方向

后续可以继续通过离线 eval 验证：

- 噪声召回率：一次性噪声是否减少出现在长期检索结果中。
- 稳定偏好召回准确率：多次出现的用户偏好是否更容易被保留。
- 临时指令污染率：一次临时上下文是否会错误变成长期偏好。
- 偏好变化适应速度：用户真实偏好改变后，新记忆多久能稳定胜出。
- 冲突解释能力：系统是否能说明当前结论由哪些证据支持。
