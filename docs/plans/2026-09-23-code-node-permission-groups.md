# Code 节点权限组实施计划

状态：实现保留，产品入口暂时隐藏。新建 Code 节点默认使用独立权限和空 Action 清单；共享模式的模型与执行实现保留。下文记录原实施设计。本文记录目标行为、实施顺序和验收条件；落地时同步更新架构与 Control API 合同。

## 1. 目标与已确认行为

复用现有 Flow 级 `ConnectorAccess.bindings` 作为 Code 共享权限组，不新增账号存储或第二套 Flow 级授权。每个 Code 节点可以选择是否使用该组；只有独立模式维护自己的 Action 允许清单。

- Code 节点未启用共享权限组时，每个 Action 单独选择一个账号；运行时固定使用该账号，代码不能替换。
- Code 节点启用共享权限组时，可直接调用该组账号已授权的全部 Actions，无需在节点重复添加；调用时可在 Flow 共享权限组中选择账号。
- 脚本不能改变节点的权限模式或使用授权范围外的账号；独立模式不能调用节点清单外 Action。
- Flow 共享账号属于部署侧 Flow 状态；权限模式与 Action 清单属于节点 Revision。
- Run 和 Publish 接受时固定所需的连接授权快照；后续 Draft 或共享授权变化不改写已接受的 Run 和 Publication。

新建 Code 节点默认启用共享组，声明为 `{ kind: "connector", mode: "shared" }`，不包含 `actions`。独立模式声明包含 `actions`。历史 Revision 保留其原有动态调用语义。

## 2. 配置与持久化

- 在现有 Code `ConnectorCapability` 中表达权限模式和该节点的 Action 清单，沿用严格 decoder、Schema、Change、canonical encoding 与 Revision digest。
- 共享模式不保存节点 Action 清单，直接复用 Flow 账号授权；独立模式为每条 Action 保存所选 `connectionId`。
- 校验 Action ID、重复 Action、模式与账号字段组合；独立模式允许 Draft 暂缺账号，但 Run／Publish eligibility 对需要认证的 Action 明确报错。
- 独立模式的 Action 清单是额外权限边界；共享模式由固定 Flow bindings 和账号实际授权决定权限。代码补全、Action catalog 和旧 Connection alias/default 提示不构成授权。
- 对旧 Revision 使用显式兼容语义，不能把旧的动态 API 静默解释成空白名单或自动授予新权限。需要确定兼容如何进入运行时声明及其生命周期。
- 节点新增、复制、撤销/重做、Subflow、manifest 投影和往返编码均保留权限配置。

## 3. Workbench 编辑体验

- 在 Code 节点配置区提供“使用 Flow 共享权限组”开关，仅独立模式显示 Action 清单。
- 复用现有 Action Picker、Connector Store、账号候选查询和 Action schema 类型生成，不复制目录或连接缓存。
- 共享模式隐藏 Action 清单和添加按钮，说明可直接使用共享组已授权的全部 Actions，并保留管理入口。
- 独立模式中，每个需认证 Action 单独选择一个账号；账号失效或缺失时保留配置并显示状态，不自动换号。
- 添加或移除 Action、切换模式和账号选择均作为 Draft 修改保存；失败时反馈错误并保留可恢复的编辑状态。
- 更新连接使用总览，使独立模式 Action 所选账号能定位到 Code 节点；共享模式继续显示为 Flow 级 Code 使用。
- Flow 总览移除账号时，清除独立模式 Action 对该账号的选择并保留 Action 本身；现有共享使用清理行为继续作用于 Flow bindings。
- 更新各语言文案及相关 Lab story，以真实生产组件覆盖共享和独立两种模式。

## 4. 执行与权限边界

- 更新 `resolveAction` 与 capability mediation：从可信 Task 声明读取模式和独立模式白名单，脚本参数不能覆盖模式。
- 共享模式无需节点清单，Action 必须在共享账号的授权范围内；省略账号时沿用已确认的默认选择规则，显式账号只能在该 Flow 共享 bindings 中解析。
- 独立模式要求 Action 在节点清单内；始终使用该 Action 固定的 Connection。若代码传入不同账号，拒绝调用。
- 公开且无需账号的 Action 遵循 Connector 目录的认证要求，不合成 Connection identity。
- Run／Publish eligibility 对固定执行 closure 中独立模式的 Code Actions 检查 Action 存在性和账号要求；共享模式不枚举动态调用清单，在调用时检查授权。Draft 可以保留未完成的账号配置，并提供可定位诊断。
- 调用时继续由 Connector 检查实时外部授权。缺失、失效、跨 Provider、跨 Team 或不属于固定快照的 binding 必须 fail closed。
- 账号选择来源由宿主固定：共享模式读取固定 Flow shared bindings，独立模式读取节点配置及对应固定 `nodeBindings`。不按当前用户或当前 Draft 临时选取其他账号。
- 扩展 Publication 与 Run 的 access snapshot，使两种模式均保存足以重放和校验的身份；旧快照继续按既有 `nodeBindings` 缺失兼容合同处理。

## 5. 实施步骤

### 第一步：冻结数据和兼容合同

- 梳理 `ConnectorCapability`、`ConnectorAccess.bindings`、`nodeBindings`、`captureNodeAccess`、Run/Publish admission 与 Action mediation。
- 确定新 Code 节点默认模式和旧 Revision 的兼容行为。
- 明确共享模式调用时账号省略、显式选择、单账号/多账号的行为，以及独立模式缺失账号时的诊断时机。
- 更新 `docs/architecture.md` 与 `docs/control/contracts/control-api.md`，说明节点 Action 白名单、两种账号来源和快照合同。

### 第二步：公共节点配置合同

- 演进 Code capability 类型与严格 schema/decoder。
- 更新 Code 创建默认值、Change operation、inverse change、encoding、语义校验和 Revision round-trip。
- 增加纯合同测试，验证独立模式重复 Action、共享模式拒绝 actions 字段、未知字段、模式/账号组合、兼容旧 Revision 和 digest 变化。

### 第三步：执行授权和固定快照

- 实现两种模式下的 Action/Connection 解析及拒绝规则。
- 更新 Code Action 收集、Run/Publish eligibility、Draft 测试运行和实际调用。
- 扩展 capture/snapshot 以固定独立模式的连接引用，并验证共享模式不能借用节点连接或其他 Flow 的授权。
- 更新连接使用派生和账号移除逻辑。
- 先以 Server 行为测试验证授权隔离，再接入 UI。

### 第四步：Workbench 配置

- 实现模式开关、Action 列表、共享模式说明、独立账号选择与保存失败状态。
- 更新类型补全，共享模式使用 Flow 授权目录，独立模式仅暴露节点清单中的 Action；共享模式提示共享账号选择能力，独立模式使用固定账号。
- 更新连接使用总览、移除账号后的 Draft 状态、国际化和相关 Lab story。
- 在 Lab 中并列检查两种模式、缺失/失效账号和窄视口布局。

### 第五步：验证与交付

- 覆盖旧 Revision、模式切换、Action 清单增删、共享/独立账号约束、越权传参、公开 Action、失效账号、并发 Draft 修改和已接受快照。
- 运行 `packages/open-flow` 中的 `bun run test` 与受影响的 Server 测试和类型检查。
- 依据传播范围补充根目录 `bun run check`；不提交，除非用户另行要求。

## 6. 核心验收场景

1. 共享模式无需添加节点 Action，可直接调用共享账号已授权的全部 Actions；多个 Flow 共享账号可用时，显式选择只能解析到该 Flow 固定 bindings。
2. 共享模式代码尝试使用未绑定账号、其他 Flow 账号或其他 Provider 账号时被拒绝。
3. 独立模式的 Action 始终使用节点选定账号；脚本传入同 Provider 的其他账号也被拒绝。
4. 修改共享 bindings 或 Draft 不会改变已接受 Run 与 Publication 的固定快照。
5. 缺少账号的需认证 Action 可保存在 Draft，但 Run/Publish 给出可定位的 eligibility 错误。
6. 无需账号的 Action 不会获得合成的 Connection identity。
7. Flow 连接使用总览能区分共享 Code 使用和各 Code 节点独立账号使用；移除账号后只清除相关使用引用，不删除 Action 或节点。
8. 旧 Revision 按既有动态 Code 行为执行，不会因新节点白名单合同而意外扩大或缩小权限。
9. 根图和 Subflow 的 Code 节点遵循相同配置、授权和快照规则。
10. Connector 当前策略撤销或账号失效时，后续调用拒绝执行，不回退到其他账号。
