# 前端集成原则

本文说明 Workbench、Designer 与宿主之间的前端边界。具体组件用法以生产代码为准，验证遵循
[开发原则](../../AGENTS.md#verification)。

## 视觉所有权

共享 UI 拥有控件的外观和交互状态，feature 拥有业务布局。通用视觉能力通过共享组件表达，局部需求留在局部作用域，
避免用页面级覆盖改变其他调用方。Tailwind 负责 utility，UnoCSS 负责图标，Designer 的复杂布局使用 SCSS Modules；
采用何种写法应服务于正确性和维护成本。

产品主题由 `src/ui/browser/theme.css` 拥有，Workbench 和宿主共享其语义 token。
Canvas Content 的节点、Handle、Edge 和字段由 Designer 拥有主题与密度；Canvas Chrome 的固定控件使用产品主题。
共享 `--ui-*` 合同在这些主题中保持完整一致，主题桥接不得扩散到无关区域。

样式入口、cascade 和祖先 scope 共同决定组件外观。当前 Designer 根样式会归一化后代控件，包括共享 primitive；
Canvas Chrome 通过局部 scope 豁免。局部视觉修复应保持节点字段与画布外围各自的布局约定。

## 组合与上下文

宿主、Workbench 和 Designer 通过各自拥有的公开接口组合。复用组件时同时保留它依赖的状态、语言、主题和坐标上下文，
避免复制内部实现或让上层依赖下层私有样式。

画布内容随 viewport 缩放，外围控件和侧栏不随之缩放。弹层的坐标、主题、裁切、层叠和关闭边界必须与其所在区域一致。
挂载位置属于组件行为的一部分，不能只以“能显示出来”判断集成正确。

应用与动作选择复用 Workbench 的 `BlockLibrary` 和 `ActionPicker`，目录状态、Flow 作用域与取消语义由 ConnectorStore 统一拥有。
调用方负责场景筛选及选中后的配置与保存。

## 交互与可访问性

交互语义由组件统一拥有。组合后仍应保持键盘操作、可访问名称、状态表达、焦点恢复及预期的打开和关闭行为。
导航保留真实链接语义，动画尊重 reduced-motion。

Workbench 的响应式依据是宿主分配的容器尺寸。视觉布局与交互状态使用同一尺寸来源，避免嵌入环境中两者分离。

当前有两项不易从调用类型发现的集成限制：

- `DesignerCombobox` 的 focus 会打开菜单；包裹整个控件的原生 label 可能使选中后的菜单再次打开。label 应关联内部 input。
- React Flow `ControlButton` 不转发 DOM ref，不能直接用于依赖 ref 的 trigger 组合。

## 语言与内容

产品文案与可访问名称归所属 feature 的 locale bundle 所有，覆盖 `uiLanguages` 并保持 key、占位符和术语一致。
全局语言偏好归宿主所有。用户内容、Provider 数据、日志和代码输出保持原文；协议错误通过稳定 error code 与参数本地化，
未知错误保留原始信息。
