# 前端架构重构

这是本次重构的执行记录，不是长期架构合同。最终边界更新到 architecture 和 frontend-ui 文档。

## 已对齐范围

覆盖整个 Workbench 与 Server 宿主页面（含登录与设置）。保留主要导航、操作入口和现有产品能力，侧栏允许重新设计。
删除无调用代码、旧项目专属且本产品未使用的机制与重复实现；删除仍可访问的产品功能需逐项与用户确认。
保持数据格式、公共产品与执行合同。保留 React Flow，不自研拖拽、缩放和连线引擎。

视觉以用户截图和 node-condition、canvas-cards、workflow、node-states、palette 的明暗主题为基准。
必要的基准视觉变更先使用 visualize 与用户对齐。Stories 必须复用生产组件。

## 迁移方向

- 共享 UI 拥有基础控件、滚动容器、JSON 展示及其文案，不依赖 Designer。
- 字段与 Schema 编辑独立于画布状态，供节点配置和运行输入复用。
- 画布直接消费产品视图模型，拥有临时交互状态；持久化变更仍由 Workbench 的权威 change owner 提交。
- 节点库和节点配置通过显式模型与操作接口组合，不借用 Designer Store、主题 Provider 或隐式弹层上下文。
- 统一主题与控件视觉归属，保留显式的画布和表单密度差异，移除祖先控件覆盖和局部豁免链。
- 迁移完成后删除旧 Designer 实现、适配链、无用依赖与构建入口，不保留长期双轨。

## 当前进度

初始工作树干净。未启动或停止用户已有的 5173 / 5174 服务。

已保存五个 Story、1600 × 1000、English、显式浅色与深色的十张首屏截图到
`/tmp/open-flow-frontend-baseline/`。目录 README 记录复现方式与局限；这些不是完整交互验收。
实际 Workbench 在独立浏览器会话中显示登录页，尚未完成登录后的验收。

已抽离到共享 UI 的能力：

- ScrollArea：直接使用继承的 CSS color-scheme，移除 Designer React ThemeProvider 依赖，保留滚动条尺寸、颜色和自动隐藏行为。
- JSON 查看器：所有生产消费者改用共享实现，七种语言文案归共享 UI 所有并由现有语言根组合。
- 通用 React hooks：迁移实际消费者，移除没有调用的 slot 与 update-effect 实现。

已通过 package 类型、lint、平台边界检查及 Bun 1.4.2 发布构建（含浏览器资源与类型产物）。Workbench、共享 UI、Designer 外部测试共 362 项：
最初 347 项通过；迁移导致的两类测试路径/资源组合预期问题修复后，涉及的 31 项重跑通过。
浏览器验证卡片结果弹层、JSON 折叠与 Esc 关闭。卡片明暗截图差异仅位于运行中动画小区域。

## 独立值表单迁移

`src/form` 现在拥有独立的受控 JSON 值编辑、对象字段操作和共享 Ajv 校验。运行输入及 Wait 通知参数已切换，
不再创建 InputSectionStore、HandleRowStore 或 Designer Provider，运行输入的百余行主题桥接已删除。
`FlowRunInputEditorStore` 只保存显式值和未完成文本草稿的错误状态，同步校验，不填充默认值或强制转换类型。
旧 runInputs 模块中没有生产消费者的 Trigger/FlowMeta 分支已删除，当前 RunRequestStore 仍是运行输入发现的所有者。

新增 `?story=run-inputs` 直接使用生产表单。浏览器确认 StrictMode effect 重建后校验仍更新；
确认空值、枚举、连续数字输入、无效数字及 JSON 阻止提交、对象字段新增和改名、数组复制，以及明暗和中文切换。
截图在 `/tmp/open-flow-form-*.png`。391 项表单、Workbench、旧节点字段和 Designer 外部回归通过，
类型、lint、平台边界与 Bun 1.4.2 发布构建通过。

anyOf/oneOf 已支持带标签的结构化分支选择，完整原始 Schema 继续负责验证；唯一枚举数组通过共享 Checkbox 多选，
结构化枚举值按内容比较。allOf 与引用目前使用 JSON 编辑模式，普通对象、数组、枚举和基础类型提供结构化编辑。
迁移节点配置前仍需审查旧日期、颜色和其余组合 Schema 的交互能力，不能把“JSON 可表达”当作完整交互等价证明。

## 尚未完成

画布与节点仍使用 FlowDesignerViewAdapter、FlowDesignerStore 和 NodeStore；节点配置的 Schema/字段编辑仍依赖旧 Store。
节点库的菜单类型、搜索和图标渲染已脱离 Designer；图标选择器与编辑器接口仍有 Designer 依赖。主题与根样式尚未统一，Server 宿主页面尚未迁移。
还需完整明暗、溢出、侧栏、弹层、画布编辑、保存、运行与宿主验收，以及最终构建/发布包检查。
不能把本轮共享能力抽离视为整个重构完成。

本机默认 Bun 为 1.4.0，仓库要求 1.4.2；构建使用 `bunx --package bun@1.4.2 bun scripts/build.ts --quiet`，不修改版本约束。

组合分支与多选增量：39 项表单/输入/i18n 测试通过；浏览器验证 Phone 分支和枚举勾选，结构化值比较与切换保留其它值由测试覆盖。

节点库增量：ContextPanel 删除 Designer ThemeProvider 和菜单类型依赖，直接使用产品 AddNodeOption kind。
图标渲染归属 ui/browser/icons，通用异步集合搜索归属 ui/browser/collectionSearch，拖拽载荷归属 canvas/browser。
旧画布与新侧栏共享同一拖拽协议。385 项相关测试、类型、lint、平台边界及发布构建通过。
实际 dev 登录后只读展开已有 Flow 节点库，未新增节点或运行用户 Flow。
新增 node-library Story 直接组合 ContextPanel/BlockLibrary，提供 ready/empty/loading/error/disabled 切换、搜索和动作记录。
浏览器已确认错误重试入口、加载提示及禁用行；深浅色截图在 /tmp/open-flow-library-*.png。

代码编辑器增量：删除 CodeMirror 对 Monaco StringEditor/Model 的模拟包装，以及无调用的尺寸、焦点事件与工厂类。
共享实现归属 `ui/browser/code-editor.ts`，产品代码与 Schema 编辑直接消费 createCodeEditor，不再导入 Designer 的编辑器工厂。
保留语言高亮、补全扩展、只读、换行、位置定位、内容回调和销毁；Schema 异步加载后同步最新值并传递 ariaLabel。
代码编辑主题切换改为更新主题 compartment，避免销毁编辑器导致撤销历史丢失；加载完成时再次应用最新只读状态。
16 项语言测试、类型、lint、平台边界通过，编辑器主体变更发布构建通过。
浏览器确认真实键盘输入与值回传、明暗渲染、切换主题后同一 DOM 实例及撤销恢复先前内容。
整体画布/节点配置旧链路仍未移除，不能据此判定 goal 完成。

独立日期字段：ValueEditor 按 date/time/date-time Schema format 提供原生选择器，并保留原始字符串编辑。
转换归属 form/common/dateValue.ts，不依赖 Designer、dayjs 或画布 Store；显示不改写原值，已有时区偏移保留，新增值使用选择日期对应本机偏移。
run-inputs Story 补三种日期字段。17 项表单/输入测试、类型与 lint 通过。
浏览器验证带 +05:30 与 Z 的值回显，使用小时 spinbutton 修改时间后原偏移与毫秒保留；暗色截图 /tmp/open-flow-date-dark.png。
颜色字段及其它旧字段交互仍需补齐后再迁移节点配置，未将 JSON 文本可编辑作为功能等价依据。

独立颜色字段：ColorEditor 复用 react-colorful、tinycolor 与共享 Input/Button，直接由值和 Schema 控制。
提供 HEX/HEX8 色板、透明度、RGB/HSV 通道及支持时的屏幕取色。展开不提交默认色；无效输入有就地错误并标记表单 draft issue。
禁用时关闭屏幕取色请求并使色板 inert；卸载取消异步请求。日期、颜色仍不依赖任何 Designer Provider/Store。
run-inputs Story 加 HEX8 字段。43 项表单/输入/i18n 测试、类型及 lint 通过；浏览器验证明暗、展开、键盘透明度修改及无效字符串。
屏幕取色、RGB/HSV 与禁用交互尚未实际浏览器验收。旧 ColorPicker 仍被节点配置使用，需在该链路迁移后删除。

节点描述迁移：NodeInspector 使用独立 NodeDescription，读取产品 selection.node.description，通过 WorkspaceStore.saveNodeDescription 保存。
删除 WorkbenchDesigner/FlowDesignerView/model/node 的 onChangeNodeDescription 命令，以及旧 NodeEditor 的 TranslationInput 描述块和专属样式。
画布描述仍由产品模型单向同步以供显示。节点标题、图标及主体字段尚走旧链路。
新增 node-metadata Story 使用生产字段，包含可编辑/只读状态和已保存值显示。浏览器验证失焦保存和明暗外观；清空由原生 textarea input + blur 事件确认保存为 undefined。
111 项原有相关回归通过，新增描述写入/清空/不存在节点测试通过；类型、lint、平台边界及发布构建通过。

图标选择迁移：共享 IconPickerButton 使用 Popover 管理打开、定位、关闭和焦点；IconPicker 面板归属 ui/browser/icons/picker。
删除旧 useOpenIconPicker 全局实例、IconPicker.open 临时 React 根/Promise 控制器，以及 anchor 定位函数与 500ms 轮询。
DesignerIcon2、FlowSettings、NodeHeadBlockSettings 三处使用共享按钮；保留 Emoji/Carbon、搜索、随机、颜色选择和图标编码。
面板采用共享主题 token，删除 graph/iconPicker.module.scss 祖先补丁；tab 宽度由面板自己负责。
node-metadata Story 加生产图标选择按钮和结果显示。浏览器验证搜索/选择、明暗、Escape 与选择后焦点返回。
24 项边界/无障碍检查、类型、lint、平台边界与发布构建通过。节点标题/图标的产品保存回调仍需继续从画布迁出。

节点标题/图标保存迁移：ContextPanel 直接渲染 Workbench NodeHeading，名称经产品 nodeNameIssue 校验后调用 WorkspaceStore.saveNodeTitle，图标直接 saveNodeIcon。
删除 WorkbenchDesigner/FlowDesignerView/model/node 的名称/图标修改及名称校验回调；画布适配层仅同步元信息供显示，不再维护该编辑命令。
旧 NodeHead 在产品侧栏只渲染剩余操作，注释节点保留原有标题入口；执行、跳过、更多菜单保留。
node-metadata Story 使用真实 NodeHeading，验证重复名称拦截与 Enter 保存。dev 只读选择已有手动触发，确认标题/图标只出现一份、描述独立、更多菜单仍包含跳过与删除，未修改用户节点。
111 项回归、类型、lint、平台边界及发布构建通过。截图 /tmp/open-flow-heading-dev.png。
节点主体字段、菜单操作及注释仍依赖旧 Store，整体验收尚未完成。

值节点主体迁移：NodeInspector 直接组合 ValueNodeEditor 与独立 ValueEditor，字段配置由产品 InputPort[] 驱动并通过现有乐观更新队列保存。
提供字段增删、名称去重、上移、描述、可空、Schema 类型/JSON 及结构化值编辑；旧 ValueSectionStore 不再为产品值节点实例化，onChangeValue 已从 Workbench/画布合同删除。
画布保留只读 valueDefs 投影与诊断；卡片执行入口/出口由 NodeLayout 的 ExecutionHandle 生成，不由旧字段 Section 生成。
新增 value-node-editor Story，浏览器确认对象修改、字段改名/新增与只读禁用状态，截图 /tmp/open-flow-value-editor-dark.png。
此前 110 项回归、类型、lint、边界、发布构建通过；后续 77 项字段/产品/画布测试覆盖显式 null、unset 与布尔 Schema。
颜色编辑调整为无效草稿仅留本地，不写入自动保存；浏览器确认无效文本与已保存合法颜色并存。Schema JSON 合法输入不再每次重排格式。
值节点真实 dev 保存/连接验收仍待完成，Schema 编辑体验仍可完善；条件、触发器等其它主体以及核心画布旧 Store 链路仍未迁完。

值节点真实 dev 验收：创建独立测试 Flow `flow_fdfa2f49c85a45e9bfb9ff5313a1df6a`，从 UI 新增手动触发和值节点。
通过新侧栏把值改为 42、Schema 改为 integer/minimum:0、字段名改为 amount；读取服务端 Draft 确认三者持久化。
重新打开 Flow 后卡片显示 amount:42；通过浏览器真实 drag 将手动触发出口连到值节点入口，服务端 edges 确认连接。
从测试按钮运行，Run `da0ae57a-cec1-4ccf-9c9c-fcb25d9a41df` 完成，节点输出与 Terminal result 均为 {amount:42}。
截图 /tmp/open-flow-value-connected-dev.png、/tmp/open-flow-value-run-dev.png。
该 Flow 是本次新建测试资源，已核对名称后请求删除（202 retiring），需继续确认清理状态。
测试 Flow 清理已确认：删除后 GET 返回 404 flow.not-found。未停止或重启用户 dev/lab 服务。

触发计划迁移：新增 TriggerScheduleEditor，直接由产品 TriggerSchedule[] 控制，NodeInspector 读取 cronTimes/pollTimes，通过 WorkspaceStore.saveTriggerSchedule 保存。
删除 WorkbenchDesigner、FlowDesignerView、NodeStore 的 onChangeTriggerSchedule/changeSchedule 转发，以及旧 TriggerNodeContent 的 ScheduleRule 和专属样式。
保留原有正整数间隔、五段 Cron 文本、非空时区规则与切换默认值；其它规则按数组原位置保留。Webhook/Provider 字段仍由旧组件负责，尚未迁完。
新增 trigger-schedule Story，使用生产组件展示多规则、只读和缺少计划；七种语言沿用现有翻译。
浏览器确认间隔保存、Cron 空白归一化、非法草稿恢复、类型切换和明暗外观。截图 /tmp/open-flow-schedule-light.png、/tmp/open-flow-schedule-dark.png。
49 项相关测试、类型、lint、平台边界及发布构建通过。新增产品变更测试覆盖多条规则持久化、元信息保留及 no-op；最初测试误将不存在节点的 undefined 当成空数组，已按现有产品合同修正。
触发计划真实 dev 保存验收尚待完成；未修改用户 Flow，未启动额外服务。

服务触发器配置迁移：新增 TriggerConfigEditor，NodeInspector 直接读取产品 definition.configSchema/config 并调用 saveTriggerConfig。
删除 workspace.triggerConfigFields/configSource、Designer 专用字段类型、TriggerNodeContent 字段表单/样式与 onChangeTriggerConfig/changeConfig 全链路。
独立 ValueEditor 处理结构化字段与无效草稿；EnumChoices 保留数组枚举多选。默认值仅回显，必填状态由产品配置是否存在确定，无渲染副作用。
空字符串、空数组与 unset 分开表达；清空显式删除字段，避免通用表单的设置空值按钮失效。
新增 trigger-config Story，包含必填、默认值、枚举、多选、对象、数值与只读状态。浏览器验证多选、清空、显式空字符串/空数组及无效数字不写入。
57 项产品/画布/i18n 测试及 2 项新字段渲染测试通过，类型、lint、平台边界通过；发布构建通过（之后仅调整显式空值与清空按钮，并通过类型/lint/组件测试）。
截图 /tmp/open-flow-trigger-config-light.png、/tmp/open-flow-trigger-config-dark.png 为显式空值调整之前的布局记录。服务触发器真实 dev 保存/外部服务运行未验收。
Webhook 配置、触发器剩余摘要与整体画布仍依赖旧 Designer；当前目标未完成。

触发计划真实 dev 验收：从 UI 创建临时 Flow flow_e195f79d1efe43a28be3ea71a42a4b68（Codex schedule acceptance temporary），新增 Schedule 节点 ppmdcez2qx。
通过新侧栏保存 every/day/3，读取服务端 Draft 确认；连续修改间隔并切换 Cron，保存 expression=0 9 * * *、timezone=Asia/Shanghai，重新打开确认画布与侧栏均正确回显。
验收发现 NodeDescription、TriggerScheduleEditor、TriggerConfigEditor 使用相同 sibling key，保存刷新后用途字段会不断重复。已分别使用 description/schedule/config 前缀，连续保存、切换计划及重新打开后 DOM 用途字段数量始终为 1。
截图 /tmp/open-flow-schedule-dev.png，类型与 lint 通过。此问题说明单组件 Story 不覆盖真实 NodeInspector 的 reconciliation，今后仍须验收组合侧栏。
测试 Flow 已核对名称后删除。未改动用户已有 Flow，未发布计划或启动周期执行，未启动/停止开发服务器。

Webhook 配置迁移：WebhookEditor 直接读取产品 inputsDef/options，通过 WorkspaceStore.saveWebhook 保存。删除 onChangeWebhook/changeWebhook 链路、Designer Webhook 专用类型及 workspace 的 Webhook 配置投影。
旧 TriggerNodeContent 只保留摘要和 payload 展示；其中请求/响应表单及样式已删除。触发器 Store 尚作为画布只读投影存在，未宣称 Designer 清除完成。
原 ValueNodeEditor 提炼为 InputPortEditor，由值节点及 Webhook 共同使用。Webhook 新建字段默认不可空；共享字段组件提供名称、Schema、描述、默认值、排序、增删，避免再实现一套字段编辑。
新增 webhook-editor Story。浏览器确认 PUT 方法、来源列表、响应状态保存/非法 999 恢复 202、正文保存、无正文时禁用但保留正文、响应头改名和值保存；只读时所有配置控件 disabled（可操作数 0）。
明暗截图 /tmp/open-flow-webhook-light.png、/tmp/open-flow-webhook-dark.png。58 项相关回归及新增 Webhook 产品变更测试通过，类型/lint/边界/发布构建通过；新增测试后再次类型通过。
Webhook 的真实 dev 保存/运行及新的字段配置组合仍需验收；本轮未创建服务端资源或启动服务。

触发器摘要迁移：TriggerSummary 直接读取产品 TriggerNode，通过产品 triggerPayloadSchema 展示 payload 类型与手动/服务触发说明。
NodeEditor 不再为触发器渲染旧 NodeBody；删除 TriggerNodeContent 及全部样式、TriggerNodeStore 的 presentation/editable 和 FlowDesigner 中对应 Val 投影。
画布 cardContent 仍使用原展示合同计算卡片摘要，避免改变已认可画布视觉。触发器头部菜单仍暂由旧 NodeHead 渲染，不能认为整个侧栏完全脱离 Designer。
schedule/webhook Story 复用真实摘要组件；中文暗色截图 /tmp/open-flow-trigger-summary-dark.png。91 项相关回归、类型/lint/发布构建通过。
仍待完成 Webhook/Provider 的真实 dev 保存运行验收、其它节点配置、菜单、画布及宿主页面迁移。

条件分支迁移：ConditionBranchesEditor 直接使用产品 ConditionSettings/ConditionOperator，通过 WorkspaceStore.saveCondition 保存；输入字段暂保留旧 InputSection，输入来源入口保留。
产品条件节点不再创建 ConditionsSectionStore，删除旧分支 Val/reaction、onChangeCondition 回调、conditionSettings 与运算符反向转换。画布仍由产品分支投影渲染。
新分支组件支持出口名去重、表达式增删、AND/OR、按输入类型筛选运算符、右值、分支上移/删除/新增、默认出口。使用已有产品 updateCondition 维护连线及下游引用。
新增 condition-editor Story。浏览器确认重复出口名不会提交、合法改名、isNull 清除右值、默认出口关闭、新增分支与只读全部禁用（可操作数 0）。数字/对象/数组等字段组合与真实 dev 保存运行仍待验收。
99 项相关回归、类型/lint/边界/发布构建通过。node-condition 在 1600x1000 下重新捕获明暗首屏，画布区域 (240,80)-(1600,960) 与固定基准逐像素一致，差异 bbox 均为 None。
截图 /tmp/open-flow-condition-editor-dark.png、/tmp/open-flow-condition-after-light.png、/tmp/open-flow-condition-after-dark.png。未创建服务端资源或启动服务。

输入迁移前置：VariablePicker 独立为共享 UI，由名称列表、加载状态、可用性和选择回调驱动；旧 HandleEditor 已复用它，删除内部 VariableBinding/react-select 实现及对应延迟加载依赖。
保留搜索、清空、缺失变量、不可用与只读状态，打开时请求刷新名称。Popover 负责关闭和焦点；支持搜索后 Enter、方向键选择、Escape。
新增 variable-picker Story，浏览器验证搜索 URL 并选中 API_URL、方向键选中 API_TOKEN、Escape 返回触发按钮、清空变为 unset。截图 /tmp/open-flow-variable-picker-dark.png、/tmp/open-flow-variable-picker-light.png。
50 项相关检查、类型/lint/边界/发布构建通过。条件节点输入仍未迁出 InputSection，后续复用此独立控件。
已向用户发出“跳过节点”去留确认：当前入口仅切换 Designer 内存 ignore，服务端没有对应保存或执行合同。等待明确回复，未删除入口，其它迁移继续。

条件输入迁移：NodeInputValue 复用 ValueEditor 和共享 VariablePicker，接收解析后的值、变量名及连接状态；NodeInspector 负责读取产品 mapping/binding，通过 setInputValue/setInputVariable 提交意图。组件不直接依赖持久化 InputMapping。
NodeEditor 不再为条件节点渲染旧 NodeBody；旧 InputSection 改为按需创建，仅 task/subflow/wait 仍创建。条件、触发器和值节点均不再创建旧输入编辑状态及其 reaction，清理了值节点遗留的无用实例。
新增 node-input Story，覆盖字面值、变量、连接来源和只读。浏览器确认编辑文字后进入变量模式不改写已保存字面值、选择 API_TOKEN 才保存绑定、回到 Literal 清除绑定但默认值只展示不保存、null 显式保存；只读控件禁用。
明暗截图 /tmp/open-flow-node-input-light.png、/tmp/open-flow-node-input-dark.png。92 项相关测试、类型/lint/边界与发布构建通过。真实 dev 条件组合侧栏的保存/运行尚未验收。
本轮未创建服务端资源或启动开发服务器，验收浏览器已关闭。整体 goal 仍在进行，任务/子流程/等待输入、旧菜单和画布适配器、宿主页面等尚待迁移。

子流程与等待输入迁移：NodeInspector 复用 NodeInputValue，根据子流程定义或等待节点 input 解析本地值、默认值和变量。条件输入合并到同一渲染路径。保留配置中仍存在但定义已不包含的输入，避免旧数据编辑入口消失。
FlowDesigner 仅为 task 创建旧 InputSection；subflow/wait 不再创建其编辑 Store/reaction。旧输出展示、连接状态和等待配置仍保留，尚不能视为整个侧栏脱离 Designer。
96 项产品保存/Inspector/画布回归测试通过，包括三类节点变量解析与保存意图，以及子流程/等待不持有 InputSection 但仍保留输出与输入显示数据。类型/lint/边界/发布构建通过（测试 fixture 随后补充子流程 reference 并再次通过类型）。
本轮复用已验收的 node-input 组件视觉，未做真实 dev 子流程/等待组合侧栏验收；该组合与运行链路仍待补充。未启动服务或修改服务端 Flow。下一阶段继续处理任务字段及旧输入/输出编辑机制。

任务附加输入定义迁移：TaskDefinition 使用 InputPortEditor 编辑 additionalInputs，直接调用 saveTaskAdditionalInputs。共享编辑器新增 reservedNames，新增及改名避开任务自带端口。七种语言增加“附加输入”标题。
删除 onChangeTaskAdditionalInputs 完整回调链、FlowWorkspace additionalTaskInputs 逆转换、旧 additionalInputDefs reaction 及 editableAdditionalInputs 展示标记。旧输入区将固定定义和附加定义合并为只读定义列表，仅继续编辑输入值。内联代码任务仍保留原可写定义 Val，因为其分组编辑尚未迁移；未丢弃分组合同。
新增 additional-inputs Story 复用真实 InputPortEditor。浏览器验证保留 value1 时新增名为 value2，改成保留名 message 不写入，改为 extra 成功；明暗截图 /tmp/open-flow-additional-light.png、/tmp/open-flow-additional-dark.png。
96 项相关回归及 10 项 workspace 展示测试通过，类型/lint/边界/发布构建通过；清理无用展示标记后再次类型通过。附加字段的真实 dev 保存与组合侧栏验收仍待完成。未启动开发服务或修改服务端资源，浏览器会话已关闭。

内联任务输入定义迁移：InputPortEditor 增加显式 groups 模式，保留产品 Group/InputPort 混合数组顺序，支持分组名称、默认折叠、增删和上移；普通字段调用仍接受/提交纯 InputPort[]。七种语言补充对应文案。
TaskDefinition 的输入端口区域直接 saveCodeTaskPorts，携带原 outputs。旧输入 Section 一律 user/guest，只显示定义并编辑输入值；删除 inputDefs 到 onChangeTaskPorts 的写入 reaction。旧输出定义编辑仍单独保留，后续迁移。
新增 grouped-inputs Story。浏览器确认 Request 改名 Request data、取消默认折叠、字段移到分组前后保持 Schema/default、追加新分组均按产品格式保存。明暗截图 /tmp/open-flow-grouped-light.png、/tmp/open-flow-grouped-dark.png。
74 项相关回归、类型/lint/边界/发布构建通过。旧输入定义写入测试替换为产品所有权约束；产品 updateCodeTaskPorts 仍覆盖分组、字段与引用变更。真实 dev 内联任务定义保存运行尚待验收。
未启动服务或改动服务端资源，浏览器会话已关闭。当前仍需迁出任务输入值，随后删除 InputSection 创建及旧输入回调；整体目标未完成。

任务输入值迁移：NodeInspector 统一处理 condition/wait/subflow/task 的字段，按产品 Group 渲染分组及折叠，解析变量/来源与本地值，通过 WorkspaceStore 保存。未知但仍映射的输入保留编辑入口。
FlowDesigner 不再创建任何 InputSectionStore，删除 createInputSection、输入值反向 reaction、onChangeInput 回调链与 Story 无效回调。旧 InputSection 类仍被其它旧 Designer 模块引用，未宣称整体删除完成；旧输出编辑和变量投影等仍待清理。
86 项相关回归、4 项独立输入状态测试通过，类型/lint/边界/发布构建通过。移除仅验证已删除输入 Store 编辑行为的测试，保留画布输入投影/输出连接证据；新字段测试覆盖显式 false、缺失或不可用变量以及连接来源无字面值写入。
真实 dev 验收：UI 创建临时 Flow flow_18d73fe9c67c4feb96ef18a8aaaa1c8b（Codex input migration temporary），添加 manual ncwnvmhh2w 和 JavaScript ddswnzsdd2。
新输入组件保存 number 73，服务端 Draft 确认 inputs.value={kind:value,value:73}，定义默认值仍 null。通过真实拖拽连接执行边，服务端确认；UI Test Manual trigger 完成 Run 66c30e56-87d6-4ae8-9b85-c9bfacea6ef9，12ms，节点输出与终端结果均 {result:73}。
真实任务 Node settings 新增分组、改名 Request、上移至字段前、设为 collapsed:true，服务端读取确认分组定义和原输入值/输出定义均保留。重新打开任务时数值 73 回显正确（分组上移/折叠在重新打开后继续验收）。
截图 /tmp/open-flow-task-input-dev.png、/tmp/open-flow-task-group-dev.png。测试 Flow 核对名称后删除，DELETE 202，随后 GET 404。验收浏览器已关闭，未启动/停止开发服务器。整体 goal 继续，输出编辑、画布旧 Store、宿主页面等仍未迁完。

输出端口迁移：共享字段组件扩展为 PortDefinitionEditor（原 InputPortEditor），output 模式只编辑定义，不提供值编辑控件。内联任务输出通过 saveCodeTaskPorts 直接保存并保留原输入定义；固定任务、子流程和等待节点输出只读展示。已有分组、排序、Schema、描述与 nullable 能力保留。
FlowDesigner 删除全部 OutputSectionStore 创建、taskInputs/taskOutputs 逆转换和 onChangeTaskPorts 回调链。清理 editablePorts 展示标记。产品节点不再渲染旧 NodeBody，评论仍使用旧编辑入口。
删除 WorkbenchDesigner 的 Schema 编辑器注入函数及其主题 Val/订阅、FlowDesignerView 和 adapter 对 createSchemaEditor 的参数/合同依赖；共享代码编辑器本身保留用于真实代码编辑。旧 InputSection/OutputSection 类及其它引用仍待整个 Designer 清理阶段移除。
新增 output-ports Story，复用 PortDefinitionEditor。浏览器确认输出 message 改名 result、Schema 改 number/minimum:0、nullable true，保存仍包含原分组且无输入 value。明暗截图 /tmp/open-flow-output-light.png、/tmp/open-flow-output-dark.png。
75 项相关回归与 2 项输出定义渲染/只读测试通过，类型/lint/边界/发布构建通过。真实 dev 输出定义改名及下游引用更新尚待验收，本轮未创建服务端资源或启动开发服务器，浏览器已关闭。

变量投影清理：删除 FlowDesignerViewModel/adapter/DesignerStore 的变量列表、加载状态、绑定映射及 onChangeInputVariable/onOpenVariables 回调。Workbench 的画布投影不再读取变量目录状态，也不再随目录加载而重建。
删除已失去生产调用者的旧 InputSection/HandleEditor 变量模式分支，独立 NodeInputValue/VariablePicker 继续由 WorkbenchStore 的真实变量目录和产品绑定驱动。移除旧投影专属测试，保留独立字段缺失/不可用变量测试；增加目录刷新不通知或重建画布的断言。
60 项相关回归、类型/lint/边界/发布构建通过，追加缓存断言后 WorkbenchStore 测试再次通过。
Workflow 明暗截图 /tmp/open-flow-workflow-variable-light.png、/tmp/open-flow-workflow-variable-dark.png；真正画布区域 (240,98)-(1215,960) 与固定基准逐像素一致。范围外的旧 Story 侧栏因前轮删除 NodeBody 而空白，必须接入真实生产组件补回；不能声称整个 Workflow Story 验收完成。侧栏本身允许重设计，保留画布区域一致。
本轮未创建服务端资源或启动开发服务，浏览器已关闭。后续先修复 Workflow Story 组合展示，再继续评论/菜单及画布旧状态清理。

Workflow Story 侧栏补回：从真实 NodeInspector 提取 NodeInputs，负责按分组渲染 NodeInputValue、折叠及按 handle 提交字段意图。产品 Inspector 只负责把产品定义/mapping/binding 解析为字段数据。
Workflow Story 通过真实 NodeDescription、NodeInputs 和 PortDefinitionEditor 组合侧栏，样例提供本地状态、变量目录及日志，不恢复旧 Designer 输入/输出 Store。评论仍通过旧 portal 展示，后续单独迁移。
浏览器验证 URL 从 records 改为 updated、API_KEY 切换 BASE_URL，Reset samples 恢复目录与值；侧栏可滚动展示输入分组和输出 Schema。明暗截图 /tmp/open-flow-workflow-inspector-light.png、/tmp/open-flow-workflow-inspector-dark.png（侧栏处于滚动位置）。画布区域 (240,98)-(1215,960) 与原始基准逐像素一致，差异 bbox 均 None。
15 项字段/Inspector/输出回归、类型/lint/边界/发布构建通过。未启动开发服务或创建服务端资源，浏览器会话已关闭。整体重构未完成，继续评论、菜单及旧画布状态清理。

评论源码编辑清理：CommentNodeContent 直接渲染共享 Textarea，删除挂载 HTML textarea、手工样式/事件监听、mountCodeEditor 注入以及延迟卸载 setTimeout。CommentNodeStore 仅接收 onSaveContent 回调，输入本地更新与失焦提交分离；只读状态禁用源码编辑。
评论源码/预览按钮增加既有翻译文案的 aria-label。原 Markdown 预览和画布容器样式保留；评论 Store 本身、语言/主题及菜单依赖仍待进一步迁移，未视为整个评论架构完成。
Workflow 浏览器验收在侧栏编辑多行 Markdown，失焦触发 comment.change，切回预览后画布和侧栏都显示 Edited comment 标题及段落。截图 /tmp/open-flow-comment-editor.png。49 项 Store/画布回归、类型/lint/边界/发布构建通过。
本轮未启动服务或创建服务端资源，浏览器会话已关闭。整体目标继续。

画布冗余输出投影清理：删除无人读取的 NodeValues.outputsTo、connectedOutputs 全节点遍历以及相应的内容缓存依赖；删除已经没有读取者的 applyingModel 标志。实际连接仍由 adapter 的 connections 数据驱动。33 项 FlowDesigner 回归、类型/lint/边界及发布构建通过。此项无渲染样式修改，未新增浏览器验收；上轮评论源码浏览器证据仍适用。整体重构继续，旧 NodeBody 仍存在其它条件分支调用，尚未直接删除。

评论状态清理：确认唯一生产 CommentNodeStore 构造点没有 userLocales 后，删除不可达的逐节点语言/翻译键机制及菜单、TranslateIcon 和 getNextLang。保留全局 UI 翻译。评论 Store 不再接收或保存 ReactNode 预览；MarkdownPreview 由 CommentNodeContent 根据同一 content 直接渲染，删除预览 Val、reaction 和独立 dark Val。保留原 false Markdown 深色参数，避免擅自改变已认可视觉。
49 项 Store/画布回归、类型/lint/边界/发布构建通过。Workflow 明暗画布区域 (240,98)-(1215,960) 与固定基准逐像素一致，截图 /tmp/open-flow-comment-owner-light.png 与 /tmp/open-flow-comment-owner-dark.png。源码多行修改、失焦 comment.change 和画布/侧栏 Markdown 同步预览通过浏览器验证。Workflow 的 Interactive 菜单是鼠标/触控板模式，不是只读切换，本轮未新增只读浏览器证据。未启动服务或创建服务端资源，浏览器会话已关闭。整体目标继续。

Markdown 渲染器归属共享 UI：移动到 ui/browser/markdown，主题类归组件所有；视频播放器文案归入 7 语言共享 UI markdown 命名空间。评论预览容器删除无人传入的宽高/viewport Val、resize effect、高度订阅和遗留活动类；拖拽和滚轮交互保留在画布容器。代码块样式限制在容器内，消除其全局 pre 覆盖。
新增 standalone markdown Story，直接渲染真实共享 MarkdownContent，无 Designer Provider，覆盖表格、任务列表、代码、公式与 Mermaid。浏览器确认 Mermaid SVG/KaTeX 各 1 个，主题切换与源码更新正常；截图 /tmp/open-flow-markdown-light.png、/tmp/open-flow-markdown-dark.png。Workflow 明暗画布区域 (240,98)-(1215,960) 均与固定基准逐像素一致，截图 /tmp/open-flow-markdown-workflow-light.png 和 dark.png。26 项 i18n 回归、类型/lint/边界及发布构建通过。未启动服务，浏览器已关闭。整体重构继续。

旧节点正文链路删除：核实生产仅构造 FlowDesignerStore、SubflowViewModeContext 没有 Provider 后，移除 NodeLayout/useShowNodeError 的不可达 Block 分支。NodeLayout 与 NodeEditor 直接渲染 CommentNodeContent，保留原正文容器的 overflow/nopan；删除 NodeBody 与其无用通知样式。整个 graph/NodeSection 无生产引用，删除旧输入/输出/条件/预览/Scriptlet UI、占位资产以及无人使用的 resizeHandle。独立 Workbench 配置与字段仍为真实产品入口。同步删除 accessibility 测试对已删除 UI 的源码断言，保留其它可访问性检查。
54 项画布/Store/可访问性回归、类型/lint/边界/发布构建通过。Workflow 明暗画布区域 (240,98)-(1215,960) 与原始基准逐像素一致，截图 /tmp/open-flow-node-body-light.png 与 dark.png；评论源码失焦保存及画布/侧栏 Direct comment body 双预览通过浏览器检查。旧 Section Store 类型仍有其它遗留引用，尚未宣称 Designer 完成移除。未启动服务或创建资源，浏览器已关闭。

旧正文 Store 清理：删除无生产写入/读取的 runtimeSections$ 与 setRuntimeSections，NodeUIStore 直接接收保留的 display sections；删除已无调用者的 EmptyNodeContent/ErrorNodeContent 及样式。删除 Task/Value 的旧 setupInputHandle/setupOutputHandle/setupHandle 和仅测试使用的 findSection，移除对应旧架构专属测试，保留真实输入投影、诊断、生命周期和 UI 持久化回归。
50 项 Store/画布/UI 持久化测试、类型/lint/边界/发布构建通过。本轮未修改可达渲染结构或样式，沿用上一轮明暗画布与评论交互证据；未启动浏览器、开发服务或创建外部资源。普通 Section 仍承担诊断与旧 UI 数据结构，后续继续消除其多余依赖，整体目标未完成。

节点诊断直接订阅：NodeStoreDisplay.hasError 成为错误布尔状态入口，NodeStore 不再遍历 Section 推导错误。FlowDesigner 直接传入模型 diagnostics 对应 Val，删除每节点构造的 view-diagnostics Section/UI 状态/释放函数；ErrorNodeStore 直接提供 true，删除构造后强行替换只读状态的补丁。普通 sections 暂为空并仍用于遗留 UI 数据，尚未全部移除。新增模型诊断更新与清除测试，保留生命周期检查。
50 项 NodeStore/DesignerStore/FlowDesigner 测试、类型/lint/边界/发布构建通过。Node-states 明暗画布截图 /tmp/open-flow-diagnostics-light.png 与 dark.png；区域 (240,98)-(1600,960) 仅运行图标 (全图约310,496)-(326,512) 动画差异，排除该16px区域后逐像素一致。错误描边和状态文字保持基准。未启动服务或创建资源，浏览器已关闭。整体重构继续。

NodeUIStore 解除 Section 实例依赖：构造器仅接收 UI 数据，删除预览实例观察列表、订阅/切换保存、动态 sectionStates 派生与 getPreviewSectionUIState。sections 作为普通已有布局数据通过统一解析/序列化保留，避免结构迁移删除持久化内容；节点位置和评论字段仍使用原更新机制。删除无人引用的 ConditionsSectionStore、PreviewSectionStore、ScriptletSectionStore 及常量。
52 项 NodeUI/Node/DesignerStore/FlowDesigner 回归通过，新增已有布局随位置更新保留与非法布局/评论更新测试。类型/lint/边界/发布构建通过。本轮无可达渲染变化，沿用前轮明暗与交互证据；未启动浏览器或服务。仍有输入/输出旧 Store 和 DesignerUIStore 等链路待迁移，整体目标继续。

删除无人调用且非公共导出的 DesignerStore.getDiagnostics/FlowDiagnostics 旧查询。其唯一引用的 InputSectionStore/OutputSectionStore 已删除，并清理常量。当前产品诊断与画布 hasError 仍由实际模型驱动，无诊断入口变更。伪节点 Store 仍被旧菜单/outline 类型链引用，后续继续清理，不视为 Section 体系全部移除。
52 项 Store/画布/UI 数据回归、类型/lint/边界/发布构建通过。本轮仅删除无调用链路，无渲染改变，沿用既有 Node-states/Workflow 明暗证据；未启动浏览器/服务或创建资源。整体目标继续。

伪节点 Section 链路清理：确认生产无 InputNodeStore/OutputNodeStore 构造点后，删除 NodeOutline 的伪节点连接查询及仅伪节点使用的虚线样式，删除两个 Store 的 connected$ 派生与转换辅助函数，删除无人引用的 SubflowInputSectionStore/SubflowOutputSectionStore。NodeStore 的 sections 只剩空数组，已从运行模型、构造器、dispose 和测试 fixture 中删除；NodeUIStore 的历史 sections 普通数据仍保留。
52 项 NodeUI/Node/DesignerStore/FlowDesigner 测试、类型/lint/边界/发布构建通过。Workflow 明暗画布区域 (240,98)-(1215,960) 与原始基准逐像素一致，截图 /tmp/open-flow-pseudo-cleanup-light.png 和 dark.png。浏览器已关闭，未启动服务。旧 Value/Trigger Section 类型尚被旧 Schema 链引用，核心 Designer 仍未完全移除，整体目标继续。

旧 NodeSection 目录彻底删除：剩余 ValueSectionStore/TriggerSectionStore 只被旧测试引用，删除其实现、接口、解析/克隆辅助代码和专属测试。旧 HandleEditor 也仅由该测试引用，一并删除组件/样式/测试。保留实际独立配置和字段实现，未删除当前产品入口。
50 项 form、TriggerConfigEditor、PortDefinitionEditor、产品诊断和 FlowDesigner 回归通过，类型/lint/边界/发布构建通过。旧 SchemaEditor 仍通过 InlineSchemaEditor 被 NodeHeadBlockSettings 引用，后续应继续清理旧 Block 设置链路。本轮无可达渲染改变，沿用已有视觉证据；未启动浏览器或服务。整体目标未完成。

旧 Block 设置链路删除：NodeHeadMoreMenu 的 Block 分支及无 CanvasContext 的设置分支在产品不可达，删除对应旧设置入口生成、NodeSettingsPanelHost、NodeHeadBlockSettings、InlineSchemaEditor。生产设置仍由 Workbench Inspector 承接。删除因此无人引用的旧 SchemaEditor，以及已无调用的旧 ConditionEditor 和尺寸追踪/样式。浮动菜单移除永远 false 的设置按钮选中状态，保留复制、删除、执行与待用户确认的 skip。
46 项可访问性/FlowDesigner/NodeInspector 回归、类型/lint/边界/发布构建通过。Workflow 明暗画布区域 (240,98)-(1215,960) 与基准逐像素一致，截图 /tmp/open-flow-block-cleanup-light.png 和 dark.png。评论 More actions 经滚动入视口后可打开，显示 Duplicate/Delete；未执行删除。浏览器已关闭，未启动服务或创建外部资源。整体目标继续。

删除无生产外部引用的 stores/conditionHandle 目录及其旧操作符专属测试。35 项产品诊断/FlowDesigner 回归、类型/lint/边界/发布构建通过。尝试定位 conditionBranchesEditor.test.tsx 未找到文件，本轮不声称新增条件组件测试覆盖。无可达 UI 改变，未启动浏览器或服务。
新发现需优先处理：旧 llm/ProductInputWidgetRenderer 无调用者，新的 form/Workbench 也未出现 llm/messages、llm/model 专用渲染入口。保留旧 LLM 实现，不能仅凭当前零调用就删除，因为可能属于先前字段迁移遗漏。后续核对原合同并将必要的模型选择/参数、消息角色/模板高亮迁移为独立受控组件并接回 NodeInput。nodeHandle/schemaEditor Store 尚由该旧 LLM renderer 类型链牵连，完成接入后再清除；连线依然使用 handleKind，需单独保留或归位。整体目标继续。

LLM 输入迁移补齐第一步：git HEAD 确认旧 InputHandleSection 调用 ProductInputWidgetRenderer；恢复该能力到 NodeInputValue，通过独立受控 LlmInputEditor 处理 ui:widget=llm/messages、llm/model，NodeInputs 提供实际字段名用于模板高亮。支持消息角色/增删/minItems、只读消息、模型名/参数和额外键保留；提供通用 JSON 编辑切换，非兼容数据回退 ValueEditor。共享 SimpleCodeEditor 归 ui，模板高亮归 Workbench，LLM 文案归共享 UI 7语言。重构前模型目录 Provider 无实际接入，当前恢复自定义模型输入；旧模型目录/图标实现暂留待后续收尾核对，不能宣称 LLM 全部迁移完毕。
新增 llm-inputs Story 复用 NodeInputValue。浏览器验收修改消息为 Analyze {{topic}} carefully.、追加 assistant 消息、模型 custom-model/temperature0.4，额外 custom:preserve 保留；两个只读 textarea 的 readOnly=true，模板 mark 正常。切换通用 JSON 后数据不变；明暗截图 /tmp/open-flow-llm-inputs-light.png、dark.png。42 项原相关测试加新增1项实际 NodeInput LLM/只读路由测试通过，类型/lint/边界/发布构建通过。真实 dev LLM 保存/运行及旧 LLM/nodeHandle/schemaEditor 清理仍待后续，整个目标未完成。浏览器已关闭，未启动服务或创建资源。

LLM 旧实现及字段 Store 清理：独立 LlmInputEditor 已接真实 NodeInputValue 后，删除旧 llm 目录及其无调用的模型目录 Provider/图标/渲染器/专属测试。删除不再被生产使用的 stores/nodeHandle、stores/schemaEditor 及旧架构测试；连线仍使用的 handleKind 原样归 components 并更新3处消费者。新增 LLM 路由边界测试确保异常消息/模型值走通用编辑器，未支持的 ui:options 不误判。模型 max_tokens 输入只接受整数。
类型/lint/边界/发布构建与41项 LLM/字段/模板高亮/画布回归通过；stores/edge 目录没有本轮匹配的独立测试，不声称新增连线专项测试。本轮沿用前轮 LLM Story 明暗交互证据，无新浏览器/服务。真实 dev LLM 编辑保存与运行尚待验收；全范围前端重构仍未完成。

真实 dev LLM 输入保存/执行验收：UI 创建临时 Flow Codex LLM migration temporary (flow_b0b8de9bdbb64a9f87e5dc41e138f68c)，UI 加手动触发6kukemqmda和JS节点fyx3krmtaq，API配置临时fixture的LLM消息/模型Schema与回显源码、执行边。侧栏编辑消息 Check {{topic}} in the saved draft. 和模型 acceptance-model，原模型 extra:keep/temperature0.7保留；清除fixture原默认value残余后校验Valid。刷新并重新选择节点后值正确回读。
UI触发Run13e57e16-9920-46f7-8a8a-e6f35876d09c completed，执行结果 messages/model/topic与保存值及默认topic example一致。截图 /tmp/open-flow-llm-dev-run.png。本验收只执行JS回显以证明专用输入保存和执行传递，没有调用外部LLM，不能当成模型服务端到端验收。确认临时Flow名称后DELETE并GET404；浏览器关闭，未启动开发服务。整体目标继续。

旧 Designer 服务死代码清理：仓库全量引用检查确认 AbstractDesignerService 无继承者、实例或导入，删除该服务及仅由它使用的 DesignerHost、PackageAuthoring、旧 addNodeMenuItems、DirtyResourceTracker、ResourceNavigation、ResourceService；删除对应旧菜单测试与 browser-hosts 中仅覆盖被删实现的测试，保留确认/通知能力测试。当前 FlowDesigner adapter 节点菜单与 Workbench 保存路径保持原实现。
类型/lint/平台边界检查、保留的 browser-hosts 1项测试与发布构建通过。此轮没有更改可达渲染与样式，不新增视觉验收；未启动服务或浏览器。Designer 主画布 Store/上下文与主题仍有待迁移，整体目标继续。

旧画布编辑模式收敛：确认唯一 FlowDesigner 调用始终提供 view，唯一 Store 构造不提供旧 manifest 后，删除不可达 FlowSettings 面板/容器/样式及画布旧设置按钮传递。删除没有实例的 BlockDesignerStore、SubflowDesignerStore、SubflowViewModeContext，NodeHead 移除旧 Block 模式代码入口。删除无调用的类型筛选 Context hooks。FlowDesignerStore 不再有独立行为或消费者，合并为唯一 DesignerStore(props)，删除模式枚举和无用 Flow 元数据/设置宽度状态；真实子流程节点与 Workbench 配置保留。
60项 Store/FlowDesigner/可访问性回归、类型/lint/平台边界/发布构建通过。workflow 明暗画布区域 (240,98)-(1215,960) 与固定基准逐像素一致，截图 /tmp/open-flow-modes-light.png、/tmp/open-flow-modes-dark.png；评论 More actions 菜单的 Duplicate/Delete 验证可见。浏览器已关闭，未启动服务或创建外部资源。Designer 主 Store、伪节点与主题架构仍有待迁移，整体目标继续。

伪节点运行时清理：删除无构造者的 InputNodeStore/OutputNodeStore 与无调用者的 rfConnection 解码；连接 ID 常量归 rfHelpers，保留已有 from_flow/to_flow 数据标识。DesignerStore 删除 pseudoNodes/flowNode、伪节点布局/选择/位置更新，applyNodeChanges 仅接受普通节点集合与评论集合。EdgeStore 删除无人注入的 flowNode 渐变和静音分支。NodeStore 移除伪节点初始化及无人使用的位置哨兵函数。DesignerUIStore 不再观察或实例化伪节点，已有 pseudoNodes 布局按普通数据保存，新增视口变化后保留数据且不生成节点的回归。
58项 Store/节点/FlowDesigner 回归、类型/lint/平台边界/发布构建通过（构建后仅删无人调用的位置哨兵函数）。本轮没有更改可达渲染结构或样式，沿用前轮 workflow 明暗基准与评论菜单证据，未新增浏览器验收或启动服务。伪节点类型/渲染残余以及主画布主题仍待后续清理，整体目标继续。

伪节点渲染与旧节点设置状态清理：删除 InputNode/OutputNode 组件和注册、NodeLayout/CanvasNode/多选菜单的伪节点分支。节点 showSettings 无产品写入和面板消费者，删除其 display/派生状态/初始化、fit-view 收起方法与423px占位样式；NodeShowSettings 仅作为已有 UI 数据类型归 nodeUI.store，未新增运行时。Workbench 实际配置入口与 skip 保留。
58项 Store/FlowDesigner 回归、类型/lint/平台边界/发布构建通过。workflow 明暗画布区域 (240,98)-(1215,960) 与固定基准逐像素一致，截图 /tmp/open-flow-node-cleanup-light.png 与 dark.png；点击fit view后6节点4连线保留，viewport变为translate(-113px,360px) scale(1)。浏览器已关闭，未启动服务。整体重构仍在继续。

旧节点正文渲染清理：五种 Condition/Value/Subflow/Error/Comment 转发组件删除，React Flow 注册直接复用 BasicNode。NodeLayout 非卡片仅为评论，移除其不可达状态浮签/Running/描述弹层与隐藏进度条；NodeMinimap 保留原容器和尺度，移除对评论始终隐藏的进度组件。删除 NodeDescriptionPopup、NodeTopLeftLabel、NodeProgress、Running 及对应样式。NodeStatusLabel 文件保留菜单实际使用的 NodeStatusIcon/NodeStatusContent，删除无人渲染的旧浮签导出；现有跳过节点入口保留。
63项 Store/FlowDesigner/可访问性回归、类型/lint/平台边界/发布构建通过。workflow 明暗画布区域 (240,98)-(1215,960) 与固定基准逐像素一致，截图 /tmp/open-flow-render-cleanup-light.png 与 dark.png。浏览器已关闭，未启动服务或创建资源。整体目标继续，主画布Store/主题与宿主范围尚未完成。

评论标题解除翻译注入：NodeHead 的普通节点标题/图标分支已不可达，移除该分支；评论直接复用 Input 的回车/失焦提交并保留focus nodrag。删除唯一旧 TranslationInput、DesignerIcon2、UserLocalesProvider、无人使用的 l10n helper，以及 DesignerStore 的userLocales/翻译事件上下文。旧input2专属测试及对应源码命名断言删除。保留WorkBench标题、连接标记和操作菜单。
workflow明暗画布区域 (240,98)-(1215,960) 与固定基准逐像素一致，截图 /tmp/open-flow-comment-title-light.png 与 dark.png；评论标题改为Review migration title并回车触发正确comment.change，原content保留。扩展control边界测试发现四处旧迁移原生label及测试文本误判：配置编辑器改共享Label并保留原排版字重，扫描排除.test文件。此前66项通过/1项失败，修复后相关11项通过；类型/lint/边界与构建通过。Label统一未新增专项浏览器验收，评论画布截图先于Label修复。浏览器关闭，未启动服务。整体目标继续，侧栏Portal主链尚未移除。

旧连接账户与Block打开链清理：确认唯一DesignerStore构造不注入connectorConnections，Task构造仅传reference字符串，NodeHead的inline executor连接徽标不可达。删除旧ConnectorConnectionStore及专属测试、账户hook/徽标和Store注入；真实Workbench账户状态/配置保留。删除Task的InlineTask/旧additional端口字段、无调用openExecutorEntry，以及Task/Subflow从未注入的openSharedTaskSource/openBlockDesigner与对应不可达菜单项。保留实际执行、复制、删除、跳过入口。
类型/lint/边界检查、63项Store/FlowDesigner/可访问性回归及发布构建通过。本轮仅删除不可达分支，没有新增视觉验收，沿用前轮明暗画布与评论标题证据；未启动浏览器/服务或创建资源。整体目标继续。

节点Store继承层收敛：Task/Subflow/Condition/Value的旧端口查询方法无调用，Trigger旧描述字段始终undefined；删除这五种Store子类，工厂直接构造NodeStore并保留各nodeType。Value输入输出共用真实defs，Trigger原无duplicate行为保留。连线按nodeType判断Value/Trigger虚线状态。删除无人读取的reference/executorName/notice投影；卡片继续从唯一Canvas模型读取。Wait回归改为验证模型通知更新、节点身份保留及端口无冗余发布。
58项Store/节点/FlowDesigner回归、类型/lint/边界和发布构建通过。workflow明暗画布区域 (240,98)-(1215,960) 与固定基准逐像素一致，截图 /tmp/open-flow-node-store-light.png 与 dark.png。浏览器关闭，未启动服务或创建资源。主NodeStore/DesignerStore及主题尚在，整体目标继续。

NodeStore可写镜像清理：删除无生产读取的manifest$/NodeStoreManifest及泛型、changeDescription/titleIssue空回调。画布工厂和Workbench模型不再投影rawTitle/rawIcon；显示title/icon/description仍由模型更新。删除无画布消费者的timeoutSeconds/timeout/progressWeight和outputs_from；产品实际超时配置和执行合同不变。元数据回归验证实际display字段，生命周期测试仅覆盖现存owned display状态。
首轮旧manifest专属断言失败，其余67项通过；同步旧测试后节点/FlowDesigner/Workbench workspace 51项通过，类型/lint/边界与最终发布构建通过。本轮没有改可达渲染结构与样式，沿用前轮明暗画布证据，无新增浏览器/服务。整体目标继续。

旧ErrorNodeStore清理：无生产/Story/测试构造点，删除该Store、错误文本解析、类型/ReactFlow注册、连线错误节点专属分支和节点初始化旁路；模型diagnostics与run.status显示保持原链路。删除同文件无调用的旧HandleIndex/matchesIndex/分组类型守卫和WidgetAction/ErrorMessage。
58项Store/节点/FlowDesigner回归、最终类型/lint/边界与发布构建通过。node-states明暗截图 /tmp/open-flow-error-model-light.png 与 dark.png，区域 (240,98)-(1600,960) 仅运行spinner差异，排除相对(70,398)-(86,414)动画区域后逐像素一致。浏览器已关闭，未启动服务或创建资源。整体目标继续。

节点空合同清理：NodeStore.edges无读写者，execute/remove无生产注入，删除这些字段及CommentNode对应空合同。删除旧NodeHead/菜单中不可达执行按钮和每菜单多余runStatus订阅；实际执行由Workbench拥有，浮栏状态订阅保留。包含hook的菜单构造函数明确命名useNodeMenuItems。复制/删除/跳过现有入口保持原行为。
63项Store/节点/FlowDesigner/可访问性回归、类型/lint/平台边界/发布构建通过。本轮仅移除空合同和不可达分支，未新增视觉验收，沿用前轮node-states/workflow基准证据。未启动浏览器或服务，整体目标继续。

孤立旧控件清理：引用图和文本搜索确认colorPicker/handleRow/handleIcon无生产或Story使用，删除组件与样式。其余仅供这条链使用的Designer Button包装、HandleNoActions上下文、ColorType选项也删除。保留独立form/colorEditor与仍被Story引用的Range。删除可访问性测试中只检查已删旧源码的两项断言，保留现存控件检查。
类型/lint/平台边界/发布构建通过，7项可访问性及control边界回归通过；本轮命令的src/form/browser未匹配测试，不声称新增表单专项覆盖。无可达渲染改动，沿用前轮视觉证据，未启动浏览器/服务。整体目标继续。

宿主导航状态收敛：apps/server Shell将route/settingsOpen/variablesOpen三份状态改为pathname单一来源，其余通过解析与比较派生。保留原history push/replace与popstate处理、导航链接和页面入口。宿主类型/lint检查与route/settingsPage/variablesPage共16项测试通过。dev浏览器登录后只读检查Flows首页、Settings、Variables，以及后退恢复/settings、前进恢复/variables均与页面标题一致。最后尝试用失效ref点击Flows失败，未把该动作计入通过证据。浏览器host-nav已关闭，未启动服务或改动用户Flow。宿主共享控件接入与Designer核心迁移仍未完成，整体目标保持active。

宿主字段统一：新增公开ui入口，直接导出真实Input/Label/Textarea，包含源代码及发布JS、CSS、React类型声明。Settings/Variables改用共享字段，删除宿主重复输入样式，保留业务布局和搜索组合样式。共享CSS作用域加入open-flow-theme，使字段无需Workbench/Designer根。按钮迁移仍待完成。发布校验增加新产物/exports及React18/19字段消费者；删除无源码引用的justify-start!/mb-[2px]旧打包断言。类型/lint/边界、宿主15项测试、发布构建与发布包消费者检查通过。
现有5174的Vite持续缓存旧exports，触碰/格式恢复config未解决，报ui未导出；未终止用户服务。临时5175直接加载同一Vite配置，过滤开发backend插件并代理现有3001，成功验收变量名称非法状态、文本输入、焦点和设置表单明暗样式。截图/tmp/open-flow-host-fields-{light,dark}.png、/tmp/open-flow-host-settings-{light,dark}.png。深色通过根data-theme切换，仅验证样式；设置未提交、变量未保存。常规5175启动曾因3001占用正常退出，之后才用无backend前端。临时进程86062已SIGTERM退出，5175监听消失；浏览器关闭，用户5173/5174仍监听。5174需刷新服务导出缓存，不能声称该端口验收通过；画布因共享scope变化尚待重验。整体Goal仍active。

节点内容所有权收敛：删除NodeStoreDisplay$与工厂NodeValues十多份可写显示Val，节点仅保留来自model的单一content$；位置独立归交互状态，content不含position，ignore仍为原临时功能。CanvasNode/NodeLayout/状态浮栏直接读取content，EdgeStore与ConnectingLine通过portSchema读取真实端口，不再转换inputs_def/outputs_def/inputs_from。删除editable切换时节点重建，保留位置/选择身份。移除已无模型消费者的CanvasContext，NodeEditor挂载目标改显式props。
回归修正两个夹具：诊断测试此前复用已dispose的Store，改在同一有效生命周期更新；独立NodeStore位置测试补上生产工厂已有的初始UI位置。67项Store/FlowDesigner/控件边界测试通过，新增2项端口Schema回归通过；类型/lint/边界、最终发布构建通过。workflow明暗区域(240,98)-(1215,960)与原基准逐像素一致，最终截图/tmp/open-flow-node-content-final-{light,dark}.png。node-states区域(240,98)-(1600,960)仅spinner动画差异，排除相对(70,398)-(86,414)后逐像素一致，截图/tmp/open-flow-node-content-states-{light,dark}.png（移除Context前拍摄；移除Context后再验workflow）。fit view保留6节点4边，transform translate(-113px,360px)scale(1)；跳过/启用入口往返成功，未修改执行合同。浏览器content-visual已关闭，本轮未启动服务或创建业务数据。整体目标仍active，DesignerStore/NodeUIStore/主题与侧栏Portal等仍待移除或收敛。

画布UI缓存层移除：全库引用确认DesignerUIStore的toUIData/onChanged无生产消费者，实际持久化由Workbench回调拥有。删除DesignerUIStore，节点构造直接接收position/评论内容；首次自动布局由DesignerStore的autoLayout/完成标记管理，保留测量重试边界。删除NodeUIStore与无人使用的旧布局解析/sections/showSettings/序列化，普通节点和评论共用createNodeInteraction，直接拥有RFNode、位置、选择、测量与评论宽度；评论title/content/sourceCode归CommentNodeStore且完整释放。
保留真实布局、位置、生命周期回归，删除只检验已无消费者旧序列化的断言；新增位置更新保持选择/测量且相同位置不重复通知回归。最终60项相关测试、类型/lint/边界、发布构建通过。workflow区域(240,98)-(1215,960)明暗与固定基准逐像素一致，截图/tmp/open-flow-node-interaction-{light,dark}.png。真实拖动task到(484.44444444444446,38.888888888888886)，渲染transform与node.move一致；首次只有一次move触发阈值未移动，不计入成功，第二次含中间move已验证。评论标题Interaction migration note提交产生comment.change且正文保留。Reset samples请求未返回，终止该请求后关闭浏览器interaction-visual；未声称重置成功，样例改动仅在本浏览器内存中。本轮未启动服务或创建业务数据，整体目标仍active。

删除事件所有权收敛：移除DesignerStore.cleanupConnections和Adapter的pendingDisconnects/第二层timer，统一由DesignerStore一次收集ReactFlow同次动作的节点/边删除，按节点过滤附属边并对独立边去重。节点级联边/数据源清理继续由Workbench调用的graph.node.delete合同拥有。Store释放、FlowDesignerView effect cleanup均取消待处理删除，避免卸载后回调。
新增4项回归覆盖节点/边回调两种顺序、重复边事件和dispose/effect cleanup取消；Store/FlowDesigner共64项通过。检视change.ts的graph.node.delete级联实现，并跑change.test.ts的21项合同测试通过。曾误选不存在nodeChanges.test.ts，结果无测试，不计入覆盖。最终类型/lint/边界及发布构建通过；Lab键盘Delete后显示node.delete [task]，测试断言确认无冗余incident断连。本轮未改渲染/样式，沿用前轮明暗workflow视觉证据。浏览器delete-visual关闭，未创建业务数据或启动服务。整体目标仍active。

Designer React主题上下文删除：全库唯一useThemeData消费者是NodeEditor，改为FlowDesigner的dark参数显式传递。删除ThemeProvider/index与Canvas/Lab/侧栏重复Provider；NodeEditor的Handle禁用与MiniMap上下文无后代消费者，一并移除。保留当前CSS主题根和局部popup容器，以维持视觉及缩放边界。
64项Store/FlowDesigner测试、类型/lint/边界及发布构建通过。workflow明暗区域(240,98)-(1215,960)逐像素等于基准，截图/tmp/open-flow-context-theme-{light,dark}.png。新增node-inspector Story复用WorkflowStory/FlowDesignerView真实生产Portal，挂载header目标；原workflow视觉保持。侧栏菜单light背景rgb(255,255,255)、dark为rgb(36,36,36)，均在aside内；截图/tmp/open-flow-inspector-menu-{light,dark}.png。首次评论操作未取得结果不计通过；新会话重新选择评论后View source显示1个侧栏textarea，切dark保留源码并更新主题，Preview恢复Workflow palette正文。两浏览器均已关闭，未启动服务。最后Story编辑后类型/lint通过，生产代码与已通过构建相同。整体目标仍active，CSS主题桥接和侧栏Store依赖尚在。

连线模型收敛：删除ManifestConnection/from_node/to_node/from_flow/to_flow旧结构文件，EdgeStore/deriveEdges/删除过滤/ReactFlow边change直接使用FlowDesignerViewEdge，Adapter直接接收model.edges。ReactFlow连接入口只做ID前缀解码，回调保持现有规范化edge.id和端点；保留旧RFEdge字符串ID以免改变选择身份。删除无人使用的RF_INPUT_NODE_ID/RF_OUTPUT_NODE_ID常量。脚本替换造成重复导入导致首轮类型/构建失败，已修正后完整重跑。
最终65项Store/FlowDesigner回归、类型/lint/边界、发布构建通过，新增连接标识中冒号/分支名的边界回归。workflow明暗区域(240,98)-(1215,960)与原基准逐像素一致，截图/tmp/open-flow-flat-edges-{light,dark}.png。浏览器选边产生selection.change，id与端点保持旧合同；随后Delete未观察到断连事件，不计入浏览器断连验收，保留已通过删除协调回归证据。浏览器edges-flat关闭，未启动服务。整体目标仍active。

独立断连验收补齐：agent-browser右键连线菜单Delete正确产生edge.disconnect。该工具press Delete/Backspace被实际页面记录为Unidentified/KeyW与Unidentified/KeyM，故此前无回调不能归因于产品。临时焦点属性/console诊断均已移除，合成事件尝试未作为通过证据。改用CUA新建后台Lab页，以Enter选择task到condition连线，再pressKey(Delete)，AX明确显示edge.disconnect及规范化id/端点；键盘与菜单入口现均有浏览器证据。旧日志中单凭agent-browser press断言键盘行为的证据需谨慎，本次CUA结果为可靠补充。
清理已无运行实例的InputNode/OutputNode枚举、i:/o:内部RF编解码分支、INPUT_NODE_ID/OUTPUT_NODE_ID、无引用GroupedInput/OutputHandleDef别名和RF_HANDLE_TYPE分类。NodeHead直接按评论/普通节点决定菜单，保留原评论duplicate条件和所有实际节点菜单。真实节点m:/评论c:/句柄h:与公开模型合同保持。最终类型、lint、边界、65项Store/FlowDesigner回归及Bun1.4.2发布构建通过；无渲染/CSS改动，沿用上一轮workflow明暗像素基准。CUA测试页与edge-delete-check浏览器均已关闭，未启动服务或创建业务数据。整体Goal仍active，Designer核心和CSS桥接/宿主按钮等迁移待继续。

节点菜单目录收敛：删除DesignerStore的IAddNodeMenuItem及Adapter.#items/#menuItems二次模型，菜单直接接收FlowDesignerViewAddItem，保留原id/choices/ports。连接来源只由ReactFlowContainer持有，目录provider不再接收连接来源。nodePickerItems仅加入分组展示及按执行连接方向禁用不兼容节点；删除旧多端口/伪端口子菜单与对应Schema图标转换。服务动作选择直接提交choice.id，画布依据来源方向生成原有$out/$in执行连接。新增node-picker Story复用生产FlowDesignerView，原workflow仍使用空目录且原导航入口保持。
CUA浏览器验证：搜索script后Enter提交javascript；Mail二级Send message提交mail.send；从task左输入端拖到空白处，Condition点击不产生动作，Mail→Send message提交new-node.$out到task.$in且位置正确。明暗菜单截图在本轮工具记录中检查，最终provider签名收敛后再验证搜索创建成功。67项Store/FlowDesigner/目录测试、边界及Bun1.4.2发布构建通过；清理未使用HandleName导入后workspace lint通过，最终类型检查另补跑。无渲染/CSS变更，原画布视觉证据沿用，整体5个基准最终完整重验仍待后续。测试浏览器已关闭，本轮未启动服务、未创建业务数据。Designer核心/样式桥接等未完成，Goal保持active。
补验结果：最终类型检查退出0，全部本轮检查完成。

用户要求集中解决主要架构矛盾，小细节和残余清理延期，清单在frontend-refactor-followups.md。核心状态合并完成：删除FlowDesignerViewAdapter文件，将产品model协调、回调与节点/边交互状态归于同一个Store；删除旧DesignerStoreProps外部注入合同、无人使用的重命名/验证/焦点配置以及生产中恒为true的确认适配。FlowDesignerView直接创建并同步Store，节点工厂/删除队列/布局使用同一所有者。保留当前名字以免把改名当作推进；目录/类名清理延期。Store现在拥有其节点Map，测试不再向已释放Map写入（此前外部Map归测试所有）；取消等待与无超时日志断言保留。类型、lint、边界、65项Store/画布回归、Bun1.4.2发布构建通过。CUA实际验证选边Delete产生edge.disconnect，选task Delete产生node.delete，侧栏随选择恢复；明暗workflow渲染检查通过，本轮未做像素diff。临时浏览器已关闭，无新服务/业务数据。统一样式机制仍是下一核心缺口，目标保持active。

主题入口收敛：删除Designer light.module.scss/dark.module.scss/_mixins.scss及designerThemeClass，全部主题声明归src/ui/browser/theme.css。画布/节点编辑Portal/Lab画布样例用open-flow-theme + data-theme + data-surface=canvas，保留原canvas数值；Workbench/宿主继续默认surface。补充独立FlowDesignerView的theme.css导入，更新前端说明。最初脚本为Lab外壳和CodeEditor误加surface，已立即移除后才验收。类型/lint/边界与发布构建通过。workflow明暗画布逐像素一致，node-states浅色一致深色仅spinner；condition缺少诊断模型导致原错误描边缺失，夹具补diagnostics:1后浅色像素一致。cards/palette与初始基准有未归因差异，记录核心验收清单而非宣称通过；本轮尚未完成旧根样式后代覆盖清理。theme-owner浏览器关闭，无新服务。目标仍active。

控件样式所有权收敛：删除root.scss对button/input/select/textarea/checkbox/color/progress的全局尺寸、外观、hover/focus/disabled与VSCode补丁规则，仅保留画布排版及连线拖拽穿透禁用输入的事件需要。紧凑Input在自身module声明原生字段样式；评论标题栏动作在自身module声明原有20px尺寸、15px字号/1.5行高，不再依赖全局button:has(i)。临时浏览器基准探针样式已移除。workflow明暗画布像素均与原始基准一致；cards/states与上轮截图比较，差异大于1色阶约40–50像素，散布于少量状态图标区域，其余为1色阶渲染差异；不能算严格像素一致，完整基准仍须最终验收。最初完整基准中cards/palette累计差异仍按核心验收清单待核对。最终类型/lint/发布构建通过；仅样式所有权变更，复用已通过行为回归。root-styles会话关闭，无新服务。下一步集中检查共享UI残余画布依赖及完整宿主编辑/保存/运行验收，不展开延期细节。

核心宿主验收：5174本轮正常加载最新产品界面，之前exports缓存问题未再出现。通过真实UI创建临时Flow flow_e621db78fcea4958a10491a8883fd4c1，添加手动触发器、修改标题Acceptance trigger及Purpose，刷新后画布保留两项内容。通过节点库添加JavaScript，共享字段选择String并输入refactor-ok，拖拽执行端口连接触发器与代码节点。点击Test Acceptance trigger，Run 8bf64e74-851d-4820-bed7-7b0b30f649b4完成，时间线节点输出与终态均为{result:"refactor-ok"}。Publish to Live成功，Publications页显示当前发布publication_63ea9a465eb94612898cf3044b7a26b9及固定revision_b8e020da6a7b43d4a7b4bb4b50f3aa73。最后通过列表操作删除该临时Flow，界面恢复原有3个Flow；未修改原有Flow。本轮浏览器core-acceptance已关闭，未启动或终止服务。证据覆盖真实侧栏字段保存、连线、运行结果与发布，不代表全部前端验收完成。共享UI/form无TS画布依赖，但侧栏NodeEditorPortal仍承载菜单与评论编辑，列为核心剩余项；细节继续延期。Goal保持active。
