# Code 节点运行时对齐计划

状态：2026-10-30 审阅修订。阶段 0–5 与 A 已在公共包和 Server 提交；Cloud 在分支 `feat/engine-v9` 上以本地 tarball 接入 v9、`context.fetch` 与公共 guest bundle，artifact 仍拒绝。决策见末尾。

## 目标

Code 节点的定位是 Connector 之间的胶水与数据变换，不是通用 serverless 运行时。对齐目标不是 Cloudflare Workers
的完整 API，而是让 Server 与 Cloud 实现同一份公共契约：Workers 中与平台无关的纯计算 API，加上平台声明式授权的
I/O Capability。同一 Flow 在 Cloud 与自托管 Server 之间应可发布、可运行、行为一致。

不做：Workers bindings（KV、R2、D1、DO、Queues）、`caches`、`HTMLRewriter`、`WebSocket`、TCP/DNS/TLS、任意 npm
解析或运行时安装、`require`、动态 import、子进程与 worker_threads。它们与自托管可移植性、Cloud 的持久状态归属、
`INV-EXEC-NO-REPLAY` 及 CPU 计量冲突。

## 现状

| 项目             | Cloud（QuickJS Executor）                                       | Server（isolated-vm）                              |
| ---------------- | --------------------------------------------------------------- | -------------------------------------------------- |
| 声明的契约       | `v8/nodejs-compat-v1`（当前），`v8`（legacy）                   | 仅 `v8`                                            |
| 内置模块         | 24 个白名单模块，guest 打包实现加宿主原生桥接                   | 无，`resolve()` 不处理 builtin                     |
| 全局             | Buffer、URL、Web Streams、完整 AbortSignal、random crypto 等    | 计时器、TextEncoder/Decoder、atob/btoa、console 等 |
| 网络             | 无；HTTP Request Task 使用 Cloud 受限传输                       | 无；HTTP Request Task 使用 Server 传输             |
| artifact、egress | 占位，总是拒绝                                                  | 占位，总是拒绝                                     |
| 隔离粒度         | 每段一个 QuickJS runtime，每 Task 一个 context                  | 每 Task 一个 isolate，共享一个执行器子进程         |
| CPU／墙钟        | segment 级 interrupt 预算，5 分钟平台 CPU，Run deadline 30 分钟 | 首个同步段 1 s，单次调用固定墙钟 30 s              |
| conformance      | 运行公共用例，另有大量私有 Executor 验证                        | 只运行 `runtimeConformanceCases`                   |

编辑器同样未对齐：`TaskContext`（`src/types/index.ts`）声明了 `fetch`、`logger`、`preview`、`reportProgress` 和
接受 Blob/流的 `artifact`，TS worker 加载 `lib.dom`。补全会提示两端都不存在的 API；编辑器只报语法诊断，不会提示。
Lab 的 Code 编辑器示例（`dev/designer/storyCatalog.tsx`）也在使用 `context.fetch` 与 `context.reportProgress`。

版本基线：npm `0.1.0-beta.75`（gitHead `611c3a3d`）已发布 Model v11 / Engine v8 及 `v8/nodejs-compat-v1`。
[兼容记录](contracts/compatibility.md) 开头仍写着 beta.73 为最新、v11/v8 为 pending，需要另行更正。只实现已有
契约、修正类型或调整部署上限不需要新 Engine 版本；改变 guest 可见的 `context` 形状或新增 Capability 需要
Engine v9，阶段 4 与阶段 5 共用同一个未发布修订。

## 目标边界

| 所有者           | 持有的内容                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| Open Flow 公共包 | 契约身份、builtin 白名单、承诺的行为子集与 conformance、按契约生成的编辑器类型、Capability 声明与请求语义 |
| Open Flow Server | isolated-vm 宿主桥接、资源上限、HTTP 传输实现、engine digest                                              |
| Open Flow Cloud  | QuickJS 宿主桥接、资源上限、受限 HTTP 传输、engine digest、release 与计量                                 |

资源上限属于部署，数值可以不同；超限的错误分类必须一致（`limit-exceeded`，不可被 `onError` 处理）。

## 阶段与依赖

| 阶段 | 内容                      | 前置       | 交付                       |
| ---- | ------------------------- | ---------- | -------------------------- |
| 0    | Server 资源限制修正       | 无         | 独立 PR，可立即开始        |
| 1    | 公共契约与 conformance    | 无         | 公共包，Cloud 跑一遍作基线 |
| A    | artifact 修正为可用       | 阶段 1     | 公共包、Server、Cloud 同步 |
| 2    | Server 实现 nodejs-compat | 阶段 1、D2 | Server                     |
| 3    | 编辑器类型按契约生成      | D1、D4     | 公共包与 Lab               |
| 4    | 受控出站 HTTP             | D3         | Model v12 / Engine v9      |
| 5    | 删除 egress 占位          | D4         | 与阶段 4 共用 Engine v9    |

### 阶段 0：Server 资源限制修正

状态：已在 `fix/isolated-vm-limits` 分支提交。实现与下列原方案的差异：取消直接 `dispose()`，不再调用
`cancelTask`（`globals.close()` 之后 guest 监听器已无法产生外部效果）；Flow 内 Task 不再有独立墙钟，由
Scheduler 的节点 deadline 与 Run deadline（`OPEN_FLOW_RUN_TIMEOUT_MS`，默认 30 分钟）约束，`wallMs` 只用于
独立调用（Agent 代码工具）；首段 `timeout` 移除，CPU 只由 watchdog 负责；配置项为 `OPEN_FLOW_TASK_CPU_MS`。

2026-10-30 本地探测（`isolatedVmLimits` 默认值，单个执行器子进程）：

| 场景                                | 结果                                 |
| ----------------------------------- | ------------------------------------ |
| 同步计算 1.5 s                      | `limit-exceeded`（1 s 超时）         |
| `await null` 后计算 1.5 s           | `limit-exceeded`（微任务仍在首段内） |
| `setTimeout` 后计算 1.5 s           | 成功                                 |
| 三次 `setTimeout` 后各计算 0.7 s    | 成功，合计 2.1 s                     |
| `setTimeout` 后死循环，`wallMs` 2 s | 墙钟超时                             |
| 紧接着执行 `() => 'alive'`          | 卡住 30 s 后墙钟超时                 |

1. **修复超时后执行器卡死。** 取消时 `abort()` 对仍在运行的 isolate 调用无超时的 `cancelTask.applySync`，
   阻塞执行器主线程；同一子进程上的其他 Task 全部无法推进。取消路径不能同步进入繁忙的 isolate：先用很短超时的
   异步调用通知 `cancelTask`，随后无条件 `dispose()`。回归测试：异步段死循环后，下一个 Task 和并发中的其他 Task
   能正常完成。
2. **`cpuMs` 改为单 Task 累计 CPU 预算。** 当前 `timeout` 只约束首个同步段；计时器和 Capability 回调通过
   `applyIgnored` 进入 isolate，不带超时，之后只受墙钟约束。改为执行器内的 watchdog：定期读取
   `isolate.cpuTime`，超过预算即 `dispose()` 并报告 `limit-exceeded`。这样覆盖所有入口，不依赖每个入口各自传
   `timeout`。首段 `timeout` 保留为同一预算的剩余值。
3. **墙钟跟随节点 deadline。** 现在固定 30 s 的 `wallMs` 会覆盖用户配置的节点 `timeoutMs`，并且与
   [workflow 工具](contracts/nodejs-runtime.md#workflow-tools) 的承诺冲突：调用方在子 Run 等待审批期间保持活跃，
   但 30 s 后会被墙钟终止。改为使用节点剩余 deadline；部署只保留一个可配置的最大值，用于未设置 `timeoutMs`
   的节点。
4. **默认值与配置。** 语义修正后，建议默认 CPU 10 s，Server 部署可配置。1 MiB 输入与结果上限、128 MB 内存
   已限制数据规模，10 s 足以覆盖解析、正则、哈希等正常变换。Agent 代码工具（`deployment/agent-code.ts`）使用
   同一执行器与 CPU 默认值，保留它自己的 5 s 墙钟与 32 MiB 数据上限。
5. engine digest 不变：资源上限属于部署，不改变 guest 可见契约。

验证：`apps/server/test/isolated-vm.test.ts` 覆盖同步、微任务、计时器后、Capability 回调后的累计 CPU 超限，
超时后执行器恢复，以及 workflow 工具调用超过 30 s 仍按节点 deadline 运行。

### 阶段 1：公共契约与 conformance

状态：已提交。`nodejsRuntimeConformanceCases` 从 2 个扩充到 9 个，取自 Cloud `verify-builtins.ts` 中与实现无关的
部分；契约文档新增 Guaranteed behavior。以真实 Node 为参照核对断言，并在 Bun 中直接驱动 Cloud QuickJS `RunSession`
全部通过（未在 workerd 中运行）。

1. 把 Cloud `quickjs-nodejs-compat.md` 中与实现无关的承诺上移到 [Node 兼容契约](contracts/nodejs-runtime.md)：
   支持的模块范围、全局集合、内存文件系统语义、结果快照规则、明确不支持的 API。Cloud 文档只保留 QuickJS 实现
   细节与上限。
2. 扩充 `nodejsRuntimeConformanceCases`，覆盖契约承诺的行为：Buffer 编码、URL/URLSearchParams、Hash/HMAC、
   zlib 一次性压缩、Web Streams、`AbortSignal.any/timeout`、内存 fs 跨 Task 隔离、内置对象修改不跨 Task 泄漏、
   `node:` 与裸名解析到同一实例。跨 Task 用例通过同一 harness 的两次调用表达。
3. 用例只断言公共行为，不断言 QuickJS 或 V8 特有的错误文本。

验证：`bun run test`（packages/open-flow）；`bun run --filter @oomol-lab/open-flow test:package`；Cloud 以当前
Executor 运行扩充后的用例全部通过，作为基线。

### 阶段 2：Server 实现 `nodejs-compat-v1`

状态：已提交；Cloud 尚未切换到公共 bundle。guest bundle 由 `scripts/prepare-nodejs-builtins.ts` 生成并提交为
`nodejsGuest.generated.json`，`check` 校验其为最新。公共入口 `runtime-nodejs-compat` 提供模块表、specifier 解析和
`createNodejsPrimitives`（Buffer/hash/zlib 由部署注入，Workers 的 `nodejs_compat` 同样适用）。Server 按需编译 builtin，
`__hostBuiltin` 在宿主回调中同步求值并返回 namespace。isolated-vm 会把未处理的 rejection 当作调用失败，
`timers/promises` 因此改用自写实现（原 polyfill 会留下一个未处理的 `finally` promise）。digest 只追加在未发布的那个修订上，
beta.75 发布的 v8 digest 继续接受。

1. 在 `isolated-vm-executor.ts` 的模块解析中加入白名单 builtin，按契约安装扩展全局。nodejs-compat 使用可变
   内置对象；每 Task 独立 isolate 已满足隔离要求。基础 `v8` 保持现有行为。
2. builtin 的 guest 实现来源见 D2。宿主桥接（Buffer 编码、Hash/HMAC、zlib、URL、随机数）使用 Node 原生模块，
   沿用 Cloud 的字节与次数上限思路，计入现有内存与结果上限。
3. engine digest：现有 `isolatedVmEngineDigest` 已被 Server 上的 v8 Publication 固定，必须继续接受。兼容实现
   使用新的 digest（增加 `nodejs-compat/1`），按 v7/v6 的方式并列登记，不能直接改写现有 digest 字符串。
4. 发布与 Run 准入接受 `v8/nodejs-compat-v1`；新 Publication 的默认契约见 D1。
5. `apps/server/test/isolated-vm.test.ts` 同时运行两组 conformance。

验证：Server 两组 conformance 通过；已有 v8 Publication 仍可运行；同一 Flow 在 Cloud 导出、Server 导入后能发布
并运行；`bun run check`。

### 阶段 3：编辑器类型按契约生成

状态：已提交。`TaskContext` 去掉 `fetch`/`logger`/`preview`/`reportProgress`。共享的 `codeTypes.ts` 供 worker 与测试
共用：只含 ES 库、运行时真实提供的 Web 全局，以及白名单 builtin 对应的 `@types/node` 文件，去掉了 `lib.dom`，worker 体积净减少约
1.3 MB。与原方案不同：不从宿主传入契约。客户端检查、运行、发布都固定使用默认的 nodejs-compat 契约，编辑器直接跟随它，
白名单外的模块因此没有类型；违规导入仍由服务端检查报诊断（worker 目前只报语法诊断）。authoring 指引的 builtin 列表取自同一份
`builtinModules`。CLI Lab 场景未运行。

1. `TaskContext` 只保留运行时真实提供的成员：`inputs`、`actions`、`workflows`、`signal`、`flowId`、`runId`、
   `blockId`、`getPrevious`。`artifact` 按 D4 处理。这是公共类型的破坏性修改，在 beta 内随下一版发布并写入兼容
   记录。
2. TS worker 去掉 `lib.dom`，改为 `lib.es2024` 加按契约生成的全局声明；nodejs-compat 额外提供白名单模块的裁剪
   声明，并控制包体积。
3. Revision 不保存 Engine Contract，Draft 编辑时由部署决定。编辑器从宿主提供的部署能力中取得契约，再选择类型集；
   导入白名单外模块时给出语义诊断。
4. 更新 Lab 的 Code 编辑器示例，改为使用真实存在的 API。
5. authoring schema、CLI/MCP 指引写明可用 builtin 与网络边界，和类型使用同一份来源。

验证：Lab 中 Code 编辑器补全与运行时一致；`bun run test`（packages/open-flow）；`test:package`；CLI Lab 跑 Code
相关场景。

### 阶段 4（取决于 D3）：受控出站 HTTP

状态：已实现，未提交，与阶段 5 和 D1 的合约合并一起构成 Engine v9 / Model v12。v9 是单一合约（nodejs builtin +
`context.fetch`，无 `egress`），新请求只接受 v9；Agent code 内部固定用 v8 base。Code 的 `{ kind: "http", hosts }` 在属性面板
以每行一个主机编辑。guest `createFetch` 与共享 `createBase64` 由公共包提供（兼容层的 `atob`/`btoa` 走 1 MiB 宿主原语，
大块二进制会超限，所以 guest 自己做 base64）。Server 经 `executeCodeFetch` 发请求：host 白名单、手动重定向、去掉
`set-cookie`、请求与响应各 1 MiB、30 秒超时。CLI Lab 场景未建也未运行。发布前 Cloud 必须实现 v9。

1. Code `config.capabilities` 新增 `{ kind: "http", hosts: [...] }` 一类声明，和 workflows、actions 一样显式授权。
2. guest 提供缩减版 `fetch`：只支持 text/json/bytes 正文，正文 1 MiB，不自动重定向，不转发平台凭据。请求与
   响应语义复用公共包的 HTTP Request Task 实现，传输由部署提供。
3. 需要 Model v12 与 Engine v9；Server 与 Cloud 同步实现，conformance 覆盖拒绝未声明 host、超时与大小限制。

验证：CLI Lab 与 MCP 场景完成"Code 调用外部 HTTP 并变换"任务；Server/Cloud conformance。

### 阶段 5：删除 egress 占位

状态：随阶段 4 在 v9 中实现，未提交；v8 Publication 仍保留 `egress`。

在 Engine v9 中删除 `context.egress`，由阶段 4 的受控 `fetch` 取代；同步更新类型与文档。

### 阶段 A：artifact 在 v8 内修正为可用

状态：公共包与 Server 已提交；Cloud 未实现。公共 `createArtifacts` 负责 guest 分块协议，conformance 新增往返与
参数校验用例；Server 新增 `run_artifacts` 表（迁移 56）、`RunArtifacts` 宿主、`node.artifact` 事件与随事件保留期清理，
engine digest 加入 `artifact/1` 并保留原 v8 digest。单文件 10 MiB、单 Run 100 MiB 目前是常量。UI 下载入口未做。

位于阶段 1 之后、阶段 2 之前。不开 Engine v9：`put` 的旧调用全部被拒绝，没有需要兼容的旧行为。

1. API：`context.artifact.put(data, { name, mediaType? })`，`data` 为 `string | Uint8Array`，返回
   `ArtifactRef { kind: 'artifact', id, name, mediaType?, size, digest }`；`context.artifact.open(ref)` 返回
   `Uint8Array`。不提供 Blob 与流，类型同步去掉。
2. `ArtifactRef` 是 JSON 值，可经端口传给下游；下游 Code 用 `open` 读取，不新增端口类型。
3. 宿主：sha256 内容寻址，`put` 幂等；存储归属 Team 与 Run，随 Run 保留期清理；Server 存本地数据目录，Cloud
   存 R2；每次 `put` 产生 `node.artifact` 事件。
4. 单文件上限独立于普通 Capability 的 1 MiB（建议 10 MiB），部署可配置，超限为 `limit-exceeded`。
5. 公共 conformance：put/open 往返、digest、跨 Task 读取引用、超限；原先借 `artifact.put` 测试通用 Capability
   传输的用例改用 `actions`。
6. Server 与 Cloud 的 engine digest 都加入 `artifact/1`，同一版本上线。

不包括：Connector 与 HTTP Request 消费或产出文件，作为后续独立事项（需要 Connector 协议变更）。

## 决策（2026-10-30 已定）

- **D1**：Server 实现后，两端都以 `v8/nodejs-compat-v1` 为新 Publication 的默认契约；Engine v9 合并为单一契约。
  代价：基础契约的内置对象冻结会随之取消，改由每 Task 隔离保证安全。
- **D2**：Cloud `prepare-builtins.ts` 产出的平台无关 guest bundle 移入公共包，两端共用，部署只实现宿主桥接。
  公共包增加约 1.2 MB guest 源码。两仓库均为 Apache-2.0，版权方一致。
- **D3**：做受控 `fetch`（阶段 4）。
- **D4**：artifact 不删除，按阶段 A 在 v8 内修正为可用；egress 在 v9 删除（阶段 5）。

## 后续协作

Cloud 仓库需要随新包版本运行扩充后的 conformance；若 D2 采用公共 bundle，Cloud Executor 改为从公共包取得
guest 实现，再删除 Cloud 的重复部分。

Cloud 进度（`/Users/su/oomol/open-flow` 的 worktree `.claude/worktrees/engine-v9`，分支 `feat/engine-v9`，未提交）：

- 依赖临时指向本仓库 `dist/release` 的 tarball；合并前须改回精确的已发布版本。
- Executor 改用 `runtime-nodejs-compat`，删除 `prepare-builtins.ts` 与 compat 源码；能力消息上限 1 MiB 调为 2 MiB，
  以容纳 base64 后的 1 MiB fetch 正文。
- 引擎目录：v9 为当前合同，v8 两个合同保持 active，v7/v6 deprecated。
- `context.fetch` 由 `apps/cloud/src/integrations/code-fetch.ts` 承担，未声明 host 返回 `authorization.denied`。
- `artifact.*` 明确拒绝。R2 存储需要经 `ExecutionPersistence` RPC 新增方法，涉及 `execution-persistence-v2`
  协议升级与 retained release 兼容，单独决定。
