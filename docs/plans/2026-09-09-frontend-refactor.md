# 前端架构重构记录

首轮核心迁移已完成。本文件将迁移期间的重复日志压缩为结果摘要；当前边界以 [前端集成原则](../authoring/frontend-ui.md) 为准，本轮收尾及剩余工作见 [后续清单](frontend-refactor-followups.md)。历史实现名不构成当前约束。

## 已对齐要求

保留 React Flow、主要导航和操作入口、数据与执行合同。视觉以原始画布截图和 node-condition、canvas-cards、workflow、node-states、palette 明暗 Stories 为准。侧栏可以调整，但复用生产组件并保持业务语义。未经产品确认不删除可达功能。

## 核心结果

- 共享 UI、值表单、画布和 Workbench 分域，浏览器代码与 Node 边界由检查脚本约束。
- 值表单独立于画布 Store；统一 Schema、默认值和校验工具，不在不同编辑器中维护副本。
- 画布模型协调与交互归同一 Store。删除 View Adapter、旧 Service、节点继承链和可写内容镜像。
- 侧栏由 Workbench 直接组合标题、菜单和字段；删除画布向侧栏注入正文/标题的 Portal。评论直接保存 presentation。
- 共享主题是单一来源，组件拥有自己的外观，feature 只拥有业务布局。移除祖先控件覆盖、主题桥接与重复 Provider。
- 节点操作菜单共享受控接口；跳过节点保留 UI 语义，不扩展执行合同。

## 首轮验收

118个测试文件、1079项测试通过，包格式/lint/类型/平台边界、发布包、React18/19消费者和宿主检查通过。真实 dev 曾验证编辑保存、连线、运行、发布、评论操作和 Agent 任务说明保存；临时 Flow 已删除。

五组指定 Story 的首屏视觉差异完成归因：workflow 和 condition 一致，palette 补偿 Lab 滚动条后的内容一致；cards 与 states 排除动画后最大差2/255。该证据只覆盖首屏，不代表所有交互或外部 Agent 工具已验收。

首轮未完成的旧命名、控件残余、宿主按钮与 Agent 工具参数覆盖已转入后续清单执行。用户后续要求优先结构与主要逻辑收尾，精细视觉和边缘优化单独留档。
