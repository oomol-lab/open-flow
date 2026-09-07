# Code 节点调用 Connector Action 实施计划

状态：本仓库实现与工作区检查已完成；上游原子执行身份仍是未完成的外部依赖。本文保留原设计与验收清单，实际字段与脚本合同见 [Control API 技术参考](../control/contracts/control-api.md#9-code-action-合同)。

## 目标与范围

允许用户在 Code 节点配置 Connector Action 及允许使用的 Connection，然后在代码中直接调用并取得结果。
支持顺序调用、循环、并发、同一 Action 使用不同账号，以及无需 Connection 的公开 Action。

同时支持完整 Action ID 索引和 provider 分层访问，不配置本地调用别名。以下 Action ID 和业务字段仅为示例：

```js
export default async (inputs, context) => {
  const user = await context.actions.github.get_current_user({ id: inputs.userId })
  const message = await context.actions.slack.send_message({
    channel: inputs.channel,
    text: `Hello, ${user.name}`,
  })
  return { messageId: message.id }
}
```

完整 Action ID 包含 provider/service 前缀（例如 `github.get_current_user`），不同 provider 的同名动作通过完整 ID 区分。配置、代码和目录使用同一个 ID，不增加名称映射。
方法直接返回 Action data，失败时抛出可按稳定 code 识别的错误。
Action 调用属于当前 Code 节点的执行，不产生新的图节点、Run 或 Scheduler 生命周期。

本次不增加运行时搜索并授权任意 Action、Provider SDK、全局 Action 注册表、整节点自动重试、独立调用恢复机制或新的调用详情产品界面。
保留独立 Connector 节点，复用其 Connector host 和错误语义。必要的调用身份进入既有宿主日志，暂不扩展 RunEvent 协议。

## 两种等价的访问方式

```js
// 静态调用优先使用 provider 分层访问。
const user = await context.actions.github.get_current_user({})

// 完整 ID 索引便于使用目录原始 ID 或动态选择已声明的 Action。
const actionId = 'github.get_current_user'
const sameUser = await context.actions[actionId]({})
```

上述代码发起两次独立调用，参数语义相同。两种访问方式引用同一已绑定函数，不重复保存声明、不维护两套授权或 transport 路径，也不去重两次业务调用。
通过任一方式取得的方法都不依赖 `this`，可以使用普通 JavaScript 解构后调用。

持久化始终保留原始完整 Action ID。分层访问按现有 ID 合同中的第一个 `.` 分为 provider 与剩余动作名，只提供两级结构，不自动转换大小写、连字符或下划线。
非标识符名称使用 JavaScript 方括号，例如 `context.actions['google-drive'].list_files({})`；其完整 ID 入口仍为 `context.actions['google-drive.list_files']({})`。
实现前以公共 ID 合同与目录数据验证这一拆分规则，明确 provider 命名约束，避免完整 ID 与 provider 根属性碰撞；不通过覆盖已有属性消解冲突。

两种入口具有相同的参数类型、Connection ID/alias 选择、返回值、错误、取消和资源限制。动态完整 ID 仅能选择节点已声明的 Action，不扩大授权。
编辑器和文档默认推荐分层访问，同时提供完整 ID 索引补全；不增加用于切换两种风格的用户设置。

## Connection 选择

默认 Connection 是可选项。普通调用省略账号选项时，宿主使用声明中固定的默认 Connection；需认证 Action 没有默认项时，该次调用必须显式选择账号。
配置界面在首次仅绑定一个账号时可以代选默认，但允许清除；绑定多个账号不强制选择默认，不增加独立模式开关。
无需认证的公开 Action 可以完全不绑定 Connection。

显式账号选择同时支持 Connection ID 和 Connector 已有的账号别名。使用互斥字段区分两者，不从同一个字符串猜测 ID 或别名：

```js
const work = await context.actions['github.get_current_user']({}, { connectionId: 'connection-work' })
const personal = await context.actions['github.get_current_user']({}, { connectionAlias: 'personal' })
```

`connectionId` 和 `connectionAlias` 只能提供一个；省略整个选项时使用固定默认。空值、同时提供两者或未知字段由严格 decoder 拒绝。
ID 和别名都可以在循环和 `Promise.all` 中使用；每次调用选择一个 Connection，同一节点可以同时使用多个 Connection。

别名复用 Connector 的现有 alias，不是 displayName，也不要求用户给 Action 或账号再创建一层本地别名。
配置绑定账号时，将选中 Connection 的稳定 ID 与当时的可选 alias 一起固定到 Revision；运行时只在当前 Action 声明的允许集合中匹配。
别名按原值精确匹配，在当前 Action 的允许集合中必须唯一；不同 provider 的同名别名由完整 Action ID 及固定 Run scope 区分。
解析后始终使用稳定 Connection ID 校验权限和执行；别名是该绑定的固定选择名称，不能成为绕过允许集合的动态目录查询。

Connector 侧 alias 改名或被重新分配后，Open Flow 内的旧 Revision 仍按固定映射选择原 ID，绑定账号失效时明确失败。
这项本地选择保证不等于上游执行身份保证：当前 client 先按 ID 查询 alias，再通过独立 POST 以 alias 执行，两步之间的 alias 改绑需要上游原子身份合同保障。
用户重新绑定或显式刷新绑定才能采纳新的 alias，并生成新 Revision；移除或改变旧 alias 后为相关源码提供诊断，不自动重写代码。
不能把源码里的 alias 直接转发为授权依据。上游执行必须使用下述前置核查确认的身份机制，不能仅靠重复查询当前 alias 声称已消除竞态。

Revision 未保存选择用 alias 时，仍可按 ID 选择账号。上游缺少执行所需的 transport alias 是另一种情况：当前 adapter 即使接收 ID 也无法执行，必须明确失败，除非已接入经验证的稳定 ID 执行能力。

需认证 Action 在 Publish/Run eligibility 中必须至少声明一个有效的允许账号，并检查允许集合；默认项缺失本身不阻止发布或 Run admission。
Draft 允许尚未完成账号绑定的声明。具体调用缺少默认且未显式选择时明确失败，不按允许集合顺序猜测。
实际 Connection 字段布局在阶段一按现有模型确定；固定 alias 是可重现的绑定选择事实，不能以可变目录缓存取代。

## 实施前确认的基础与缺口

- `packages/open-flow/src/flow/common/change.ts` 的 `ConnectorCapability` 已保存 Action 与 Connection，Inline Task 已有 `capabilities`。
- `apps/server/node/isolated-vm-executor.ts` 已暴露 `context.connector(payload)`，`apps/server/node/service.ts` 已验证声明并调用 Connector host。
- `apps/server/test/connector.test.ts` 已覆盖声明后允许调用、未声明时拒绝及无效请求。
- `packages/open-flow/src/types/index.ts` 的公开 `TaskContext` 尚未声明 Connector 能力，Workbench 尚未提供 Code Action 配置闭环。
- Server 已读取 Connector 原始 alias 用于上游请求，但当前公共 Connection catalog 未投影 alias，需要补齐可选字段。
- Code capability 强制要求 Connection，独立 Connector Task 已支持无账号 Action。
- Code capability 将 Task invocation ID 直接用于每次 Action 请求，`ConnectorClient.execute` 将其作为幂等键，不能区分同一节点的多次业务调用。
- Publish 的 Connector eligibility 收集尚未覆盖 Code capability；未配置 Connector 时，Code 路径的错误码也与独立节点不一致。

## 设计约束

1. Revision 是 Action 声明的唯一事实源；完整 Action ID、允许的 Connection ID、可选的固定 alias 和默认 Connection 选择参与编码和 digest。账号凭据和部署 Team 不进入代码或声明。
2. 授权按当前 Task invocation 的固定声明执行。用户 payload 提供完整 Action ID、业务参数和可选的显式 Connection ID 或 alias，宿主按声明验证 Action 与 Connection，并使用 Run 固定的 Team。
3. 每次业务调用有独立调用身份；同一次传输的重复投递使用相同身份。Task invocation 身份继续用于授权与生命周期，两种身份不能互相替代。
4. Run 取消、deadline、节点结束和兄弟节点失败沿现有执行生命周期传播。结束后的能力失效，不得产生脱离节点生命周期的后台调用。
5. 普通调用错误可被用户代码捕获；取消、超时和资源限制不能通过捕获错误使已终止节点继续执行。取消外部请求不承诺撤销已发生的副作用。
6. 不增加通配符授权、运行时查询部署默认账号或客户端独有的校验补丁。默认 Connection 固定在 Revision；显式选择也只能使用该 Action 已声明允许的 Connection，缺失或失效时不得回退到其他账号。

## 前置核查：上游执行身份

- [x] 在冻结执行 adapter 方案前，核实 Connector 是否支持按稳定 Connection ID 原子执行、执行时校验 ID 与 alias/版本条件，或具有等价的不可重分配身份保证，并记录可验证的协议依据。
- [ ] 若有相应能力，使用该机制并验证查询与执行之间 alias 改绑的行为；以稳定 ID 执行原账号或因身份条件不匹配而拒绝，不能执行其他账号。
- [x] 若当前上游无法提供保证，明确记录尚未解决的外部依赖及必要协议变更；公共模型和测试宿主工作可以继续，但不能将端到端身份验收标为完成。再次查询 alias 不能替代原子身份校验。
- [x] 区分 adapter 能力：是否必须存在 transport alias，或能直接按稳定 ID 执行。该能力决定上游缺失 alias 时的行为，不改变 Revision 中选择用 alias 可省略的合同。

## 阶段一：公共声明与 authoring 合同

完成本阶段的模型和规格测试后，再修改 Server、Workbench 和 Command 客户端。

- [x] 演进现有 `ConnectorCapability`，支持完整 Action ID、无账号调用，以及同一 Action 允许的 Connection、固定 alias 和默认选择；保持一种声明表示，不并存两套 Action 配置。
- [x] 明确 Action ID 与 Connection 声明规则：保留目录中的原始完整 ID，不生成调用别名，持久化不另存 provider 分层表示；每个 Action 只有一份声明，允许的 Connection ID 不重复，同一 Action 内已固定的 alias 不重复，默认 Connection 可省略，存在时必须属于允许集合。
- [x] 更新严格 decoder、canonical encoding、digest、结构 validation，覆盖空值、重复 Action/Connection/alias、空 alias、无效默认引用和额外字段；外部账号状态不进入确定性 validation。
- [x] 增加符合现有 change 风格的节点 Action 编辑 operation，覆盖添加、删除、更换 Action、调整允许的 Connection、刷新固定 alias 及默认选择，并保留预期旧值、Revision 冲突与幂等语义。
- [x] 为公共 Connection catalog 补齐 Connector 原始 alias 的可选投影及 decoder，保持 alias 与 displayName 分离；Revision 未保存 alias 不影响按 ID 选择；上游没有 transport alias 的执行限制按前置核查处理，不能由 catalog 可选字段推导执行支持。Server adapter 随阶段三实现。
- [x] 打通既有程序化 authoring、manifest 投影和往返序列化，确保普通代码编辑、端口编辑、复制和重载不会丢失声明。
- [x] 从固定执行 closure 收集 Code 与 managed Task 的 Connector 使用，覆盖嵌套 Subflow，供下游 eligibility 与客户端读取消费。
- [x] 明确旧 `context.connector` 的公开合同及 Engine Contract 版本影响；对可删除的未发布入口直接更新消费者并删除，不增加旧名转发层。

验收：合法声明往返一致；语义变化影响 digest；无账号声明可保存；根图与 Subflow 检查一致；并发编辑按现有冲突合同处理。

## 阶段二：公共调用合同与 conformance

- [x] 将 `context.actions` 作为公共脚本能力，补齐 `TaskContext` 及相关类型导出。仅暴露当前节点已声明的方法；完整 ID 属性与 provider 分层属性共享同一个不依赖 `this` 的函数，隔离对象原型并冻结根表及 provider 表。
- [x] 明确公开 `TaskContext` 与节点生成的精确 Action 类型如何衔接；根对象同时含 provider 对象和完整 ID 函数，不能用统一函数索引或 `any` 掩盖差异。
- [x] 增加编译级验收：分层访问、完整 ID 字面量、已声明 ID 联合、普通 `string` 和未声明 ID。普通字符串先通过用户代码收窄为已声明 ID；联合中各 Action 参数不同则继续收窄到与参数匹配的动作，不承诺不安全的联合调用，也不新增专用收窄 API。
- [x] 固化完整 ID 的两级拆分和键空间约束，验证特殊属性名称不会访问或污染原型；不为双入口新增动态 Proxy 或第二套执行分发。
- [x] 固化可选第二参数的 Connection 选择合同：省略时使用固定默认；`connectionId` 与 `connectionAlias` 互斥，二者最终必须指向已授权 ID；覆盖未知或歧义 alias、同时提供两者、无默认、未授权 ID、公开 Action 及无效选项。
- [x] 区分 Task invocation ID 与 Action call ID；由可信运行时桥接分配调用序号或等价身份，并在宿主侧约束其归属。
- [x] 明确 Promise 成功结果与错误结构：直接返回可序列化 Action data；保留稳定错误 code，不将所有失败降为普通 message。
- [x] 规定参数可序列化性、对象形状、未知 Action ID、未声明调用和结束后调用的失败行为；复用现有调用数量及响应大小限制。
- [x] 更新 Runtime conformance，先以测试宿主证明顺序、并发、多账号、无账号、取消和错误捕获语义，再实现具体 isolate adapter。

验收：连续三次相同 Action 调用得到三个不同 call ID；并发请求与响应不串位；不同 Task invocation 不碰撞；直接伪造桥接请求也不能扩大授权。

## 阶段三：Server 执行与资格检查

- [ ] 在 Server Connection catalog adapter 中投影上游原始 alias，验证外部字段；依照前置核查结果接入执行身份机制，不预设现有 ID 查询后按 alias 执行的路径满足端到端身份保证。
- [x] 更新 `isolated-vm` 两侧桥接，按固定声明构造共享函数的完整 ID 与 provider 方法表并保留结构化错误，继续在 invocation 结束时关闭能力。
- [x] 更新 Server capability mediation，通过完整 Action ID 解析声明，将固定 alias 解析为允许集合中的 ID，再验证显式或默认 Connection，验证当前 invocation、声明和生命周期，复用 `ConnectorHost.execute`。
- [x] 将独立 call ID 传给 Connector 幂等键；一次调用中固定 Connector 配置快照，沿既有 AbortSignal 边界传播取消。
- [x] 在 Publish eligibility 中纳入完整 closure 的 Code Action，检查 Action 存在、授权要求、允许集合内 Connection 的 service、状态与所属作用域；需认证 Action 至少有一个允许账号，不因默认项缺失而拒绝。
- [x] 复用现有 Run admission 与执行边界的职责检查 Code 声明；资格检查针对允许集合，不套用独立节点必须提供单个 connectionId 的条件。具体调用仍检查当前外部授权状态，不能因曾经发布成功而跳过。
- [x] 统一 Code 与独立节点的未配置、不可用、Action 不存在和 Connection 错误。确认错误经过 IPC、用户 catch 和节点失败投影后仍能识别。
- [x] 核实并保持公共 JSON 参数语义；Code 业务参数不套用图端口专用的 null/default 转换，不改变用户显式传入的数据。
- [x] 验证用户未 await 的调用在节点退出时按现有生命周期清理；不新增隐式后台任务或重试。

验收：真实 Server 测试宿主验证同一节点循环与并发结果、Team 隔离、错误捕获、未捕获失败、取消以及节点退出后失效。
无效账号阻止相应操作；公开 Action 无需 Connection；取消或进程失败不触发整个 Code 节点重放。

## 阶段四：Workbench 与编辑器

- [x] 为 Code 节点提供 Actions 配置区，复用现有目录搜索、详情、Connection 查询和外部授权入口，并始终携带当前 Flow scope。
- [x] 实现选择 Action、绑定账号和调用示例预览，默认使用 provider 分层访问，非标识符使用方括号，支持切换完整 ID 写法并复制当前示例，不直接插入编辑器，不提供调用名输入框；多账号时允许配置授权集合、设置或清除固定默认 Connection，展示 ID 与 Connector alias，支持显式刷新绑定中的 alias；公开 Action 不显示账号要求。
- [x] 为当前 Action 允许的 Connection ID 与固定 alias 提供选择参数补全和调用片段；显示名仅用于账号展示，不作为可执行 alias。
- [x] 所有编辑通过阶段一的公共 operation 保存；切换节点、Flow 或 scope 后丢弃过期异步响应。
- [x] 删除或更换 Action 声明后更新代码诊断，不通过字符串替换自动重写用户代码；已有调用保留在源码中供用户修改。
- [x] 按当前节点选中 Action 的 schema 生成局部方法输入、返回值、provider/动作属性及完整 Action ID 字符串补全，复用现有 schema-to-TypeScript 与语言服务设施，不加载整个目录的 SDK。
- [x] 编辑器提示来自目录 projection，不成为新的运行时或持久化合同。目录不可用时显示加载错误并保留代码和声明；不能把临时目录错误当作声明被删除。
- [x] 补全中区分未声明的 Action ID 与无法取得 schema；未知结构使用诚实的宽类型，不编造必需字段或非空保证。
- [x] 更新相关文案和本地化，遵守共享 UI primitive、portal、focus 与 outside-click 规范。

验收：保存重载后仍可调用；使用默认 Connection 的调用换账号无需修改源码；显式指定 Connection 的代码在该授权被移除后得到对应诊断；删除和更换 Action 得到对应代码诊断；两个账号调用互不混淆；catalog 失败可恢复且不丢配置。
仅使用仓库测试、检查和构建验证，不启动或自动化浏览器，不保留只断言类名或组件接线的测试。

## 阶段五：交付与文档

- [x] 使现有 CLI / authoring 入口能够表达并保留 Action、Connection ID、固定 alias 与默认选择，优先复用已有编辑命令，不新增独立命令体系。
- [x] 更新脚本 API 示例、序列化与 operation 技术参考。仅当本次确定了新的持久产品边界或运行时不变量时更新 `docs/architecture.md`。
- [x] 确认公开类型、Engine Contract、运行时实现和 Workbench 静态资源随同版本 package 发布，清除被替代的未发布入口及测试。
- [x] 完成回归检查并记录结果与任何未完成项。

## 必须保留的行为测试

| 场景                                                        | 预期                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| 同一 Action 顺序调用三次，参数不同                          | 三个独立幂等键及对应结果                                    |
| 同一 Action 并发调用                                        | 调用身份唯一，响应匹配各自 Promise                          |
| 同一 Action 显式选择不同已授权账号                          | 严格使用各自 Connection                                     |
| 不同 provider 具有相同动作短名                              | 按原始完整 Action ID 独立调用                               |
| 默认 Connection 调用与显式账号选择                          | 默认固定，显式选择受允许集合约束，无静默回退                |
| ID 与 alias 分别选择同一账号                                | 解析到同一个已授权 Connection ID                            |
| alias 在不同 provider 重名                                  | 按当前 Action 与固定 scope 正确区分                         |
| 同一 Action 内 alias 重复、未知 alias、ID 与 alias 同时提供 | 明确拒绝，不猜测、不回退                                    |
| 上游 alias 改名或重新分配                                   | Open Flow 内固定映射仍选择原 ID；上游身份按前置核查单独验证 |
| 刷新或移除固定 alias 后重载                                 | 新 Revision 保存新映射，旧源码得到对应诊断                  |
| 完整 ID 与 provider 分层访问同一 Action                     | 共享绑定函数及语义，每次调用仍有独立身份                    |
| 解构方法后调用、动态 ID 选择                                | 不依赖 this，动态 ID 仍受声明授权限制                       |
| 连字符、特殊属性及键空间冲突                                | 原始名称保留，无原型泄漏或静默属性覆盖                      |
| 查询 alias 后、执行前发生改绑                               | 按已验证上游合同执行原 ID 或拒绝；不可执行其他账号          |
| Revision 无选择 alias，上游有 transport alias               | 按 ID 选择并执行                                            |
| 上游缺少 transport alias                                    | 当前 alias adapter 明确失败；仅经验证的 ID 执行能力可成功   |
| 需认证 Action 无默认但有有效允许账号                        | 可发布及准入；显式调用成功，省略选择失败                    |
| 分层调用、ID 字面量、ID 联合与任意 string                   | 类型与参数匹配；宽字符串及不匹配联合需先收窄                |
| 公开 Action 无 Connection                                   | 保存、发布及执行成功                                        |
| 私有 Action 缺失或失效 Connection                           | 明确失败，无默认账号回退                                    |
| 未声明 Action、伪造 Connection/Team                         | 拒绝，不向 Connector 发起越权请求                           |
| 根图和嵌套 Subflow 的声明                                   | 同一 validation、eligibility 与执行语义                     |
| 用户捕获普通调用错误                                        | 可读取稳定 code，并继续合法业务逻辑                         |
| 未捕获错误、Run 取消、deadline、节点退出                    | 正确失败或取消，旧能力失效                                  |
| Revision 冲突、编辑后重载、目录短暂失败                     | 不覆盖他人修改，不丢声明或源码                              |

实施时运行相关阶段的规格测试，最后执行：

```bash
bun run format
bun run check
bun run test
bun run build
bun run test:package
```

本次会涉及 Workbench 静态资源和公共交付，因此包含 `test:package`。不使用仓库根目录的 `bun test`。

## 实施前确认事项

- 同时支持 `context.actions.provider.action(input)` 与 `context.actions["provider.action"](input)`，共用一种声明与调用合同，不引入本地调用别名；如果目标改成运行时动态发现任意 Action，需要重新确定授权与产品范围。
- 优先修改现有类型。确实需要新增或提取 TypeScript type/interface 时，按仓库要求先请用户选定名称；本计划不预先创建类型。
- 开始阶段一时核实已有 capability API 的发布状态和 Engine Contract 版本要求，以实际公开合同决定版本变更，不能仅凭“没有 UI”认定其未发布。

## 实施结果（2026-09-07）

- 公共模型采用 `connections: [{ connectionId, alias? }]` 与可选顶层 `connectionId` 默认值；公开 `setCodeActions` 与 `graph.node.task.capabilities.set` 统一编辑，CLI `flow apply` 直接接受相同声明。
- 两种 `context.actions` 入口、ID / alias 显式选择、原始 JSON 参数、结构化错误与独立 call ID 已落地；发布、手动 Run admission 和固定 Run 开始前检查允许集合。
- Workbench 已加入目录搜索、账号绑定、默认账号、保存 alias 的显式刷新、两种调用片段以及原始 schema 生成的类型补全。类型诊断随声明变化；延迟的其他 Flow 目录响应不会覆盖当前状态。
- 已核查 npm `@oomol-lab/open-flow@0.1.0-alpha.0` 发布包：旧 Connector capability 属于公开 runtime conformance。因此此次使用 `open-flow-engine/v2`，删除旧脚本入口，明确拒绝 v1，不做静默兼容。
- 已核查上游公开实现 commit `6e9d55b70d765566d83ff5c2604da8250086811b`：[`action-runner.ts`](https://github.com/oomol-lab/open-connector/blob/6e9d55b70d765566d83ff5c2604da8250086811b/src/server/actions/action-runner.ts) 的执行输入使用 `connectionName`；当前 adapter 使用查询 ID 后按 alias 执行的协议，没有可验证的稳定 ID 或条件身份校验参数。Server Connection catalog 的 alias 投影已完成，但阶段三第一项的原子执行机制尚未完成，因此保持未勾选。
- 上游缺少 transport alias 时明确失败；Revision 中选择用 alias 可省略。现有测试覆盖目录改名、alias 已转给其他 ID 的查询状态，以及本地固定映射，不能证明查询与 POST 之间不存在重分配竞态。

验收记录：`bun run format`、`bun run check` 和 `bun run test` 已通过；工作区测试共 1,219 项（公共包 852、Command 61、Server 306）。`bun run build` 与 `bun run test:package` 的最终产物复核也已通过，覆盖 npm 导出、React 18/19 消费端和 Command Artifact。没有启动浏览器。

剩余项：Connector 上游提供按稳定 ID 原子执行，或在执行请求中校验 ID 与 alias / 版本条件后，再接入 adapter 并增加查询至执行之间改绑的端到端测试。其余本地功能不依赖对这一保证的假设。
