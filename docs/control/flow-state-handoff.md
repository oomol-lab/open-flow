# Flow State 实现交接

交接时间：2026-10-30。当前本仓库实现已完成，验证记录见下文。设计的唯一事实来源是
[Flow State 设计计划](flow-state-plan.md)；本文只补充实现所需的上下文、顺序与已知风险，与计划冲突时以计划为准，
并回写计划。

## Implementation baseline update (2026-10-30)

The npm `next` artifact is now beta.76 at `fd93811d8fdccc98be4511a43106bbc0fb7a6572`.
Its tarball contains Model v12 / Engine v9. Implement Flow State as Model v13 / Engine v10,
preserving the published v9 runtime and digest. The original baseline below is historical.

## 本次实施结果

S1、S2、S3、S5 与架构更新已完成，Cloud S4 未改动。

- 公共层使用 WebCrypto SHA-256 前 16 字节作为带类型标识的哈希；数字与时间水位规则、模式重置与配额错误已写入契约。
- Server 迁移 57、四张 State 表与 Run 写入计数已接入。支持跨 Task/Run 状态、Draft/Live 隔离、整批原子去重、模式切换与 Flow 生命周期清理。
- REST、CLI、MCP 共用部署服务；scope 必填，默认不返回业务值。Workbench 有 Flow 状态面板与节点历史菜单，Live 清空单独确认，80% 用量在界面和节点运行日志提示。
- 七种语言文案与 Lab story 已补齐。跨 Run conformance 从公共 `flow-state` 入口导出，参数验证与 Task 结束取消用例在公共 runtime conformance 中。
- CLI Lab 验收发现原 HTTP/OpenAPI 执行输入过滤会丢弃无绑定的 Run 参数；已在公共执行 owner 修复，并由新 Cron/HTTP 场景覆盖。

验证记录（2026-10-30）：

| 验证                             | 结果                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| 根目录 `bun run check`           | 通过，包含格式、lint、类型和层级检查                                                            |
| 公共包 `bun run test`            | 242 个文件、3,008 项通过                                                                        |
| Server `bun run test`            | 100 个文件、1,287 项通过；随后补充极小配额下的删除边界，存储文件 7 项再次通过                   |
| CLI `bun run test`               | 6 个文件、139 项通过                                                                            |
| 公共包 `test:package`            | 实际 tarball、Browser runtime、独立 CLI consumer 检查通过                                       |
| `lab test flow-state` 与 `--mcp` | 均通过，第二次 Run 无新条目                                                                     |
| 视觉与交互                       | Lab 浅色/深色、节点菜单、历史弹窗、80% 提示和 Live 确认已检查；取消、清空失败反馈有组件行为测试 |

关键回归覆盖：跨 Task/Run 读写、条件插入不覆盖、严格 JSON、Draft/Live 实际运行隔离、满额整批失败与满额重复批次、
水位与模式切换、失败保留写入、Run 共享写入预算、`dedupe.full` 的 `onError`、不可捕获配额错误、物理删除清理、REST/MCP/CLI 显式 scope。

尚未发布或部署。Cloud 后续需完成 D1 存储/迁移、执行协议转发、State capability 宿主、去重执行、
配额与回收、v10 engine digest，并运行公共 conformance 后再升级 Cloud 的客户端。

## 工作区

- Worktree：`/Users/su/oomol-lab/open-flow/.claude/worktrees/flow-state`，分支 `feat/flow-state`，基于
  `fd93811d`（`chore: release open-flow 0.1.0-beta.76`）。所有命令在该目录运行。
- 主 checkout（`/Users/su/oomol-lab/open-flow`）不要改动。它有两个未跟踪文件
  `docs/control/flow-state-plan.md` 与 `docs/control/code-runtime-alignment-plan.md`，已复制到本 worktree；以本
  worktree 中的版本为准。
- 本 worktree 包含 Flow State 实现、测试、文档更新；三个原始计划/交接文档随实现纳入版本管理。
- 提交与推送只在用户要求时进行。提交前在仓库根目录运行 `bun run check` 并通过；提交信息与 PR 描述不加任何 AI
  署名。

## 范围

本次交接覆盖本仓库的 S1、S2、S3、S5 与架构文档更新：

| 阶段 | 内容                                                                          |
| ---- | ----------------------------------------------------------------------------- |
| 文档 | `docs/architecture.md` 第 3 节新增 State Store 边界（计划“架构文档变更”一节） |
| S1   | 公共包：去重节点、`context.state` / `context.dedupe`、类型、conformance       |
| S2   | Server：迁移 57、State Store、Capability 宿主、去重节点执行、Flow 删除清理    |
| S3   | Control API、CLI、MCP 的状态查看与清空                                        |
| S5   | Workbench 去重节点菜单与 Flow 状态面板、Lab story                             |

不在范围：S4 Cloud（`/Users/su/oomol/open-flow`）。它需要先发布包含本修订的公共包，再由 Cloud 仓库按其
`AGENTS.md` 单独实现。完成后在交付说明中列出 Cloud 需要实现的内容（D1 迁移、内部执行协议操作、去重节点执行、
engine digest）。

## 版本基线（开工与交付均已核对）

- `npm view @oomol-lab/open-flow dist-tags` 开工时和交付复核均返回 `next: 0.1.0-beta.76`。
- beta.76 的 gitHead 是 `fd93811d8fdccc98be4511a43106bbc0fb7a6572`，tarball 包含 Model v12 / Engine v9。
- Flow State 使用 Model v13 / Engine v10。已发布 v9 的 digest 保留，v10 digest 追加 `state/1`。
- Cloud S4 在公共包发布后单独实施。Cloud 升级依赖及面向 v10 的客户端前，必须先准备好对应宿主、存储与执行协议。

## 必读

按顺序阅读：

1. [设计计划](flow-state-plan.md)：全部语义、存储结构、上限、决策。
2. 根目录 `AGENTS.md`：所有权、验证、提交前检查。
3. [架构](../architecture.md)：尤其第 3 节“Graph execution and side effects”与第 4 节 Capability 边界。
4. [Node authoring](../authoring/node-authoring.md)：新增节点必须同时交付读视图、编辑编译、schema 与示例、
   搜索、诊断，CLI 与 MCP 使用同一部署服务；“Module placement”约束公共包内的层级。
5. [Node 运行时契约](contracts/nodejs-runtime.md)：Artifact、workflow 工具、`fetch` 的 Capability 写法是
   `context.state` 的直接参照。
6. [CLI Lab](../authoring/cli-lab.md)：场景编写与验收。
7. 做 S5 前读 `.agents/skills/frontend-ui/SKILL.md`。

## 参照实现

| 要做的事                                          | 参照                                                                                                                                                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新节点类型的完整链路（authoring 到 Workbench）    | `94da6341` 新增 HTTP Request 节点：`flow/common/semantics.ts`、`graph.ts`、`change.ts`、`changeSchema.ts`，`control/common/authoring*.ts`，`workbench/.../editor/*`、`addNodeOptions.ts`、`blockLibrary.tsx`，Lab story，CLI Lab 场景 |
| 由部署直接执行的节点                              | `apps/server/node/application/run.ts` 中 `executeHttpRequest` 的接入与 `http-request.*` 错误码                                                                                                                                        |
| Code Capability、guest helper、宿主、迁移、digest | `d1f3708b`：`runtime/common/runtime.ts`（`createArtifacts`）、`apps/server/node/application/run-artifacts.ts`、`migrations/0056_run_artifacts.sql`、`storage/migrate.ts`、`isolated-vm.ts`、`types/index.ts`、`codeTypes.ts`          |
| 可被 `onError` 处理的失败                         | `run.ts` 中 `TaskError` 的 `catchable` 标记；Node authoring 的“Node error handling”                                                                                                                                                   |
| Run 来源                                          | `control/common/api.ts` 的 `source: 'draft' \| 'live'`，决定 State scope                                                                                                                                                              |
| Flow 删除                                         | `storage/flow-store.ts` 中删除 `retiring` Flow 的语句；State 清理加入同一生命周期 owner 的流程                                                                                                                                        |

## 实现顺序与要点

### 1. 架构文档

按计划“架构文档变更”一节更新 `docs/architecture.md`。边界已由用户确认，无需再次确认。

### 2. S1 公共包

- **标识哈希放在公共包 common 层。** 规范化（`typeof` 标记加规范文本）与 SHA-256 截断 16 字节必须由 Server 与
  Cloud 共用，否则同一 Flow 在两端的去重结果不同。common 代码不能依赖 Node，使用 WebCrypto `crypto.subtle`。
- **水位模式比较规则需先写定。** 计划只说“严格大于水位”。在契约中明确：数字按数值比较；字符串只接受
  ISO 8601 时间并按时间比较，或按其他明确规则；类型混用与无法解析的值如何报错。写定后回写设计计划。
- 去重节点的业务配置、输入、输出按计划“去重节点”一节，节点名称与 kind 遵循现有命名惯例。上限由部署提供，不进入
  节点配置。
- `TaskContext` 增加 `state` 与 `dedupe`；Code 编辑器类型同步（`workbench/browser/codeTypes.ts`）。
- conformance 用例列表见计划 S1 第 3 条。跨 Run 用例需要 harness 支持同一 Flow 的两次 Run，可能要扩展现有
  conformance harness。
- 文档：Node 运行时契约新增 State 一节；Node authoring 新增去重节点一节；Control API 参考同步节点与接口。

### 3. S2 Server

- 迁移 57（`apps/server/migrations/0057_*.sql`，并登记到 `storage/migrate.ts`），四张表见计划“存储”一节。
- State Store 存储模块：带配额的原子写入、整批检查并记录（单个 SQLite 事务）、按 Flow 删除。普通数据与空间条数按 Flow/source 主键前缀统计；标识总数汇总空间计数。
- Capability 宿主与 `run-artifacts.ts` 并列：scope 取自 Run 来源；`context.dedupe` 只能访问 `flow` 空间；节点空间
  只能由所属去重节点的执行访问。
- 错误：空间已满为可处理的 `dedupe.full`；业务状态超限与单 Run 写入次数超限为不可处理的 `limit-exceeded`；参数
  错误为 `capability.invalid`。
- 去重节点的模式与空间记录不一致时，在同一事务内先重置空间再记录。
- 单 Run 写入次数：一次 `set`、`insert`、`delete` 或去重批次计一次。
- Flow 删除时清理四张表。

### 4. S3 Control API、CLI、MCP

接口见计划“Control API、CLI 与 MCP”一节。公共包定义合同与 client，Server 实现端点，CLI 与 MCP 复用同一部署
服务。清空 `live` scope 需要在 CLI 与 MCP 中显式指定 scope，不提供默认值。

### 5. S5 Workbench

- 去重节点菜单：清空历史，编辑器默认只清 `draft`；清空 `live` 需要单独确认；用量达到 80% 时提示。
- Flow 状态面板：按 scope 展示业务状态、去重空间（含遗留空间）与条数配额，支持删除与清空。入口位于发布按钮旁的更多操作菜单。
- 所有新文案进入全部 locale 文件；Lab 增加对应 story，遵循 `AGENTS.md` 的 Lab 规则。

## 验证

- `packages/open-flow` 中运行 `bun run test`（不要直接用 `bun test`）。
- 仓库根目录运行 `bun run --filter @oomol-lab/open-flow test:package`（公共导出、类型与包内容都有变化）。
- Server 测试：新 conformance、迁移测试（`apps/server/test/migrate.test.ts`）、Flow 删除后状态清空、Draft 与 Live
  互不可见、满额整批失败、`dedupe.full` 可被 `onError` 处理。
- CLI Lab：新增“Cron 定时拉取 HTTP 列表，只处理新条目”场景，第二次运行无新条目；运行受影响的参照场景。
- 视觉：在 Lab 中检查节点菜单与状态面板。
- 提交前仓库根目录 `bun run check`。

## 已知风险

- **版本基线**：beta.76 已发布，已切换到 v13/v10。
- **Cloud 接入约束**：按本次范围，公共包发布后在 Cloud 仓库实施 S4；Cloud 采用 v10 客户端前先完成宿主与协议升级。
- **记录时机**：去重节点记录后下游失败会漏处理（计划 D-S2 与“记录时机”）。节点说明与 authoring 指引必须写明。

## 条数配额调整

2026-10-30：用户确认取消总容量配额。每个 Flow/source 最多 1,000 个 key、每值 64 KiB、全空间合计 10,000 个去重标识、100 个空间；key/空间名最多 256 UTF-8 字节。保留每 Run 1,000 次写入保护。迁移 58 移除旧容量记账表，将单值 size 统一为 JSON UTF-8 大小。满额允许更新、删除与重复标识批次，超额新增整批回滚。beta.76 仍是发布基线，继续使用未发布 Model v13 / Engine v10。
