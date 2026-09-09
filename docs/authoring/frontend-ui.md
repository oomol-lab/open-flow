# 前端集成原则

本文说明 Workbench、Designer 与宿主之间的前端边界。具体组件用法以生产代码为准，验证遵循
[开发原则](../../AGENTS.md#verification)。

## 视觉所有权

共享 UI 拥有控件的外观和交互状态，feature 拥有业务布局。通用视觉能力通过共享组件表达，局部需求留在局部作用域，
避免用页面级覆盖改变其他调用方。Tailwind 负责 utility，UnoCSS 负责图标，Designer 的复杂布局使用 SCSS Modules；
采用何种写法应服务于正确性和维护成本。

共享滚动容器与 JSON 查看器归 `src/ui/browser` 所有。滚动条跟随继承的 CSS `color-scheme`，
不读取 Designer 主题上下文；共享 UI 文案由其 locale bundle 所有，再由各语言根组合。

宿主通过 `@oomol-lab/open-flow/ui` 复用 Input、Label 和 Textarea，发布包同时提供 `@oomol-lab/open-flow/ui.css`。
这些字段不依赖 Workbench 或 Designer 上下文；宿主保留业务布局，控件外观和状态由共享 UI 所有。

主题值统一由 `src/ui/browser/theme.css` 拥有。Workbench、宿主、画布和侧栏都使用 `open-flow-theme`
与 `data-theme`。画布节点、连线及其编辑弹层用 `data-surface="canvas"` 选择已认可的专用配色与密度，
固定外围控件使用产品默认配色；共享组件始终读取 `--ui-*` 合同。组件不再加载独立明暗主题模块或主题选择函数。

共享控件自行声明尺寸、边框、背景及交互状态；画布根只提供基础排版，不再按原生元素选择器覆盖所有后代控件。
紧凑文本编辑器和评论标题栏按钮的尺寸由各自组件声明，不能依赖祖先节点来补齐默认样式。

## 独立值表单

`src/form` 拥有受控 JSON 值编辑和 Schema 校验，不依赖画布 Store 或 Designer Provider。
运行输入与 Wait 通知参数复用它；节点配置的旧字段编辑尚在迁移。编辑器可保留尚未完成的文本草稿，
但草稿无效时不得提交上一个有效值。默认值只在用户明确创建值时插入。

## 组合与上下文

宿主、Workbench 和 Designer 通过各自拥有的公开接口组合。复用组件时同时保留它依赖的状态、语言、主题和坐标上下文，
避免复制内部实现或让上层依赖下层私有样式。

画布节点内容由传入的模型更新，卡片、分支和连线直接读取同一份内容；位置与选择归画布交互状态，
不再为每个显示字段维护可写镜像。侧栏挂载目标通过显式参数传递。

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

共享代码编辑器位于 `src/ui/browser/code-editor.ts`，直接封装 CodeMirror。
Workbench 负责 TypeScript 会话、保存与错误提示，编辑器不依赖 Designer 的 StringEditor 工厂或 Monaco 模拟接口。
主题变更更新现有编辑器配置，以保留选择与撤销历史。
