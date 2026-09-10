# 前端重构后续清单

本轮由用户于 2026-09-09 授权。收尾范围按用户最新要求调整：优先完成代码结构简化、保持侧栏逻辑接近原实现并消除明显矛盾；视觉细节和边缘优化留到后续。评论节点先做最小可读性修复，后续重做。

## 本轮完成

- 画布实现从 `src/designer/browser` 归入 `src/canvas/browser`；核心组件和状态统一为 FlowCanvas、FlowCanvasView、CanvasStore、CanvasStoreContext，CSS 前缀为 open-flow-canvas。
- Workbench 配置组件归入 `runtime/editor`，WorkbenchCanvas 负责工作区与画布组合。删除重复 DesignerTarget，直接复用 flow/common 的 GraphTarget。侧栏原有渲染和操作逻辑保留，主要变化为引用迁移与 Agent 保存保护。
- 删除没有生产调用的旧通知、确认、StringEditor、脚本模板、Schema preset，以及旧 Checkbox、Switch、DateTimePicker、Combobox、Range、Null、Label 包装和对应孤立样式/测试。日期 Story 使用生产 DateEditor；选择、开关、复选框 Story 使用共享 UI。移除 react-select 及其独占依赖。
- 宿主设置、变量和退出按钮复用公共 Button，删除 server-button 外观体系；共享 Button 类型与发布产物支持 React 18/19 消费者。宿主 SVG 自行声明描边。
- 主题值统一归 ui/browser/theme.css。保留 React Flow、主要导航、操作入口、持久化格式、公共包入口和执行合同。dev/designer 命令与公开 designer-* 构建入口暂保留兼容。
- Agent Tools Story 使用真实 AgentSettings、WorkspaceStore、ConnectorStore，只模拟 HTTP；草稿修改复用生产 reducer。覆盖工具选择、审批、有效/过期账户、model/input/value 参数来源、固定值保存和只读状态。
- 修复 Agent 切换固定值时无效默认数值提前保存：来源切换先进入草稿，统一保存入口校验固定参数，并用同步草稿有效性拦截其它字段触发的保存。
- 评论仅增加局部深色正文颜色规则，复用现有文字 token。用户已授权最简单处理，不重构评论机制。
- 更新前端集成说明与 Lab README，删除已失效的主题文件路径和旧控件说明。

## 验证依据与边界

- 目录迁移后的完整包测试曾通过 116 文件、1074 项；收尾最终结果见下方验收记录。工作区 check 覆盖格式、lint、包类型与平台边界。
- 发布包检查覆盖实际浏览器构建、公开导出及 React 18/19 消费者。宿主设置/变量/样式测试此前 17 项通过；明暗按钮浏览器检查完成。
- Agent 浏览器回归确认：审批及账户保存、节点输入映射、固定字符串失焦保存；无效数值0未保存，修改审批仍被拦截，改为5后一起保存；过期账户与只读编辑控件禁用。已检查明暗布局。实际外部账户授权和 Agent 执行未调用；本轮验证使用内存夹具。
- 侧栏源码与迁移前对照，除引用、名称和 Agent 保存保护外，主要配置组件无行为改写。
- 原始五组 Story 首轮已有像素比较：workflow、node-condition 一致；palette 相同可用宽度下一致；cards、states 排除动画后最大差2/255。后续路径迁移有明暗浏览器复核，本轮没有重做全部像素比较。评论正文是用户授权的视觉差异。
- 原始截图在 `/tmp/open-flow-frontend-baseline`，属于本地临时验收资料，不是永久测试资源。首屏截图不代表所有交互已覆盖。
- 自建验证服务与临时浏览器页均已关闭，没有新增用户 Flow、外部调用、提交或 staging 操作。

## 后续再做

- 节点菜单长描述与二级菜单窄宽度细节，保留现有截断与完整 title；不改变当前添加节点功能。
- 日期 Story 右侧间距、Lab 滚动条和其它非基准展示细节。
- 剩余 Designer 命名、旧 locale key、紧凑 Input 历史选项按实际使用清理；不要为纯改名改变公开入口或数据字段。
- 评论节点整体重做，包括 Markdown、代码块与复杂内容的主题处理；当前仅保证正文基本可读。
- Agent 非 JSON 文本、卸载/重开、通知参数及外部授权的更多边缘交互回归。
- 将临时视觉基准转为持久化资源，在后续视觉工作中按需重新捕获全部状态。

## 产品决策

“跳过节点”仍是临时 UI 状态，不改变持久化或执行；保留入口，后续由用户决定删除或实现完整语义。

## 最终验收

2026-09-09：115个测试文件、1074项测试通过；根工作区check通过；最终发布包合同、Browser运行时及React18/19消费者检查通过；git diff --check通过。按用户最新明确要求，结构简化、侧栏逻辑一致性与明显缺陷修复完成，以上细节和边缘优化留作后续。本轮未提交代码。
