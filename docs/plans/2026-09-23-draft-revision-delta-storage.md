# 草稿 Revision 增量存储实施计划

日期：2026-09-23。状态：已实施。

本文记录实施步骤，不修改当前产品合同。现有 Revision 保留策略见
[Control API 技术参考](../control/contracts/control-api.md)；实施完成后，应以更新后的合同和代码为准。

## 1. 问题与目标

当前每次成功提交 Draft change，Server 都会编码、计算 digest，并向 `revisions.content` 写入完整 Flow Revision。
即使只修改一个节点字段，写入量也随整个 Flow 的大小增长。最近 50 条 Draft Run 的保留规则限制长期保存的版本，
但不能消除编辑时的全量写入。

目标是让普通草稿修改主要写入变化的内容，同时保持以下对外语义：

- 每个可读取的 Revision 都还原为提交时确定的完整、不可变快照，`revisionId`、digest 和 Control API 响应不变。
- Draft change 的 CAS、幂等重放和原子提交不变；修改后的 Draft head 在服务重启后可恢复。
- 已接受的 Run、待处理 Publish operation 和 Publication 使用固定内容，不依赖后来可能被清理的编辑链。
- 当前 Draft、发布版本、未结束 Run 及每个 Flow 最近 50 条 Draft Run 的内容保留规则不变。

本次先解决数据库正文写入放大。提交时仍从完整结果计算规范编码和 digest，因此不承诺编码、diff 或 hashing 的 CPU 成本已经与 Flow 大小无关；不能用压缩全量 JSON 代替增量存储。

## 2. 存储模型

保留 `revisions(revision_id, digest, content)` 作为完整快照表。新增 `revision_deltas`：

| 字段               | 含义                                   |
| ------------------ | -------------------------------------- |
| `revision_id`      | 增量 Revision 身份，主键               |
| `base_revision_id` | 构造增量时所用的父 Revision            |
| `patch`            | 从父版本的规范 JSON 到本版本的内容差异 |
| `depth`            | 距离最近完整快照的增量层数             |

一个 Revision 的正文在任一时刻只能由完整快照或增量表达。`flow_revisions` 继续拥有 Flow 归属、父版本、digest、model version、change identity 和请求 digest；正文的两种物理形式不是两份独立事实。增量使用现有 Effect `JsonPatch` 的确定性 `add`、`remove`、`replace` 子集；数组按索引生成差异，并由同一模块应用。不得在读取时重新执行 `DraftOperation`，因为后续编辑语义升级不能改变历史内容。

从基础快照还原后，必须核对规范编码的 digest 与 `flow_revisions.digest` 一致；缺失基础版本、非法 patch 或 digest 不符必须显式失败，不能退回当前 Draft 或静默生成空图。同一 Revision ID 再次写入不同 digest 时仍返回既有身份冲突。

增量链最多 32 层。提交第 33 层时直接保存完整快照；若 patch 的序列化字节数不小于完整快照，也直接保存完整快照。这是存储和读取成本的固定规则，不新增运行时配置。`repairDraft` 从不可读或损坏内容恢复时直接保存完整快照，不让新版本依赖损坏的基础版本。

## 3. 实施步骤

### 3.1 数据库迁移和 Revision owner

1. 在 `apps/server/migrations/0029_*.sql` 新增增量表和还原、清理所需索引，并在 `apps/server/node/storage/migrate.ts` 注册。已存在的完整 Revision 不回填、不改写；不得修改已经发布的 `0028_revision_retention.sql`。
2. 在 `apps/server/node/storage/revision-store.ts` 集中实现完整写入、增量写入、按 ID 还原和物化。物化在同一 Revision ID 下写入完全相同的规范正文与 digest，并原子移除对应增量；重复物化应无副作用。
3. 使用当前 Effect `JsonPatch` 生成和应用增量；入库前检查还原内容，读取时校验持久化 patch 结构与 digest。增加 round-trip 测试，覆盖字段新增、删除、`null`、嵌套对象、数组、CodeModule source 和恶意路径。

### 3.2 草稿读写

1. 将 `FlowStore.draft()`、`FlowStore.revision()` 和 `commitRevision()` 接到 Revision owner。提交事务内完成旧 head 比较、正文保存、`flow_revisions` 元数据和 Draft head 更新；失败时整体回滚。
2. `ControlService.changeDraft()`、`removeConnectionUsage()` 和 `repairDraft()` 继续计算提交后的完整规范内容和 digest。幂等重放先读元数据，不要求被清理的旧正文仍存在。
3. `GET draft`、`GET revision`、Draft sync、check 和 validation 均通过同一还原入口取得内容；已清理的 Revision 仍按现有合同返回 404。损坏正文的修复入口继续使用其既有错误语义。

### 3.3 Run、发布与直接 SQL 消费者

1. Draft Run 的准入事务先物化目标 Revision，再提交 Run；发布准入事务先物化目标 Revision，再提交 Publish operation。物化和准入必须一起提交或回滚；准入失败不得留下完整快照、新 Run 或发布操作。
2. `RunStore.claim()`、Publication 后续推进、Trigger、Poll 和 Integration 当前直接读取 `revisions.content`。逐处核对它们只接触已经物化的 Run 或发布版本；不符合这一前提的查询改用 Revision owner。其他调用 `RevisionStore.ensure()` 的写入路径维持完整快照语义。
3. Rollback 继续引用已有的完整发布版本，不重新根据编辑增量计算历史内容。Run 等待、恢复和重试使用准入时固定的正文。

### 3.4 清理与 Flow 删除

1. 扩展 `FlowStore.pruneDraftRevisions()`：完整快照和增量共同遵守现有保留条件。当前 Draft 还原链中的基础快照和增量不能被清理，即使中间 Revision 没有 Run；链长由 32 层检查点规则限制。
2. 当新的检查点或 Run/发布物化使旧链不再被保护时，Maintenance 分批删除不再需要的正文，同时保留 Draft change 幂等元数据。先判断引用关系，再在事务中删除，避免清理和准入交错破坏可读版本。
3. Flow 物理删除和孤儿 Revision 收集同时覆盖增量表；删除仍被 Run 或 Publication 引用的完整正文前沿用现有生命周期门槛。Maintenance 日志分别报告清理的完整正文和增量数量。

### 3.5 文档与交付

更新 `docs/architecture.md` 和 `docs/control/contracts/control-api.md`：完整 Revision 是逻辑读取合同，物理正文可以是完整快照或增量；保留与 404 语义不变。实现只落在 Server 存储和应用准入边界，不新增 Control API 字段、Workbench 状态或 rollout flag。

## 4. 验收

- 从旧版数据库升级后，既有 Revision、Run 和 Publication 内容逐字节保持可读；新旧存储形式可以同时存在。
- 连续修改同一 Flow、重启服务、读取任一仍保留的 Revision，所得规范内容和 digest 与提交时一致；32 层边界前后均成立。
- 并发 Draft change、相同/冲突 `changeId` 重放、事务失败、损坏 patch 和缺失基础版本均按既有错误或明确的存储错误处理，不产生半提交状态。
- Draft Run、Publish、Rollback、Trigger 执行和 Wait 恢复在后续编辑与清理后仍使用当时固定的内容。
- 最近 50 条 Draft Run 的正文、当前 Draft、Publication、待处理发布和未结束 Run 仍可读取；过期正文返回 404，幂等重放仍返回原 Revision 元数据。
- 用确定性的大 Flow 连续提交小字段修改，对比改造前后的实际正文写入字节数，并记录检查点、Run/发布物化造成的完整写入。普通小修改不能再每次写入与整个 Flow 等大的正文；不以不稳定的墙钟耗时作为唯一验收依据。
- `packages/open-flow` 执行 `bun run test`，`apps/server` 执行 `bun run test`，仓库根目录执行 `bun run check`；检查完整 diff 和 `git diff --check`。

## 5. 实施顺序

先完成增量格式和数据库往返验证，再接入草稿提交与读取；随后接入 Run/发布物化，最后启用增量清理。启用清理前，必须通过重启、并发和物化测试证明所有受保护的 Revision 可读。只有完成第 4 节全部验收后，才将当前分支视为可合并。
