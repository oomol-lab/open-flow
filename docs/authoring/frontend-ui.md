# Workbench 与 Designer 前端注意事项

本文只记录容易重复出现、无法从组件类型直接判断的前端交互约束。修改 Select、popup、portal、focus
或 outside-click 行为时阅读对应小节；普通样式和布局修改不需要展开本文。

## Select 与原生 label

Designer 的 `DesignerCombobox` 基于 `react-select`；部分既有调用仍在本地将它别名为 `Select`。它的单选模式同时启用以下行为：

- 选择后关闭菜单；
- 选择后 blur 内部 input；
- 内部 input 获得 focus 时打开菜单。

不要用原生 `<label>` 包住整个 `Select`。如果下拉 option 也是该 label 的后代，选择 option 后浏览器会
执行 label 的默认激活行为，再次聚焦内部 input。菜单因此在关闭后立即重开，视觉上表现为“选择后无法
自动关闭”。

只需要布局和可见标题时，使用非 label 容器：

```tsx
<div className="field">
  <span>Trigger</span>
  <Select options={options} />
</div>
```

需要表单标签语义时，让 label 和 Select 成为兄弟，通过 `htmlFor` 与 `inputId` 关联。这样点击标签仍会
聚焦 Select，但 option 不在 label 内，不会在选择完成后再次触发聚焦：

```tsx
<div className="field">
  <label htmlFor="trigger-select">Trigger</label>
  <Select inputId="trigger-select" options={options} />
</div>
```

不要通过关闭 react-select 的选中后收起、输入 focus 后打开或 keyboard navigation 行为来掩盖这个问题；这些行为被普通 Handle Editor
和其他现有调用依赖。

DesignerCombobox 保持 react-select 的局部 absolute menu，使菜单继承节点缩放和精调样式，不要改成全局 portal。分组二级菜单使用 `@rc-component/tooltip`，并通过 `getTooltipContainer` 挂到 static Designer container 内的独立缩放容器。缩放必须施加在 popup 的父坐标系，不能直接施加在 popup 上。Tooltip 封装的 trigger 负责 transformed target 的定位以及 trigger 与 popup 之间的 hover 边界。不要直接使用 `@rc-component/trigger` 或换成 Base UI Popover：前者容易遗漏 Tooltip 层的交互约定，后者的关闭阶段会让 Positioner 变为 inert，在 transformed viewport 中横移到二级菜单时无法恢复 pointer hit-test。共享 Select 需要越过滚动容器时，保留现有局部 popup container 与必要祖先 `overflow: visible` 约定；全局 portal 会改变 outside-click 边界、缩放和主题变量继承。共享 shadcn/Base UI Select 的 `SelectContent` 必须保留局部 `container` 参数，并由 Content 自己组合 Portal、Positioner、List 和滚动按钮；feature 调用方只传定位参数和 option group，不应拆开这些内部结构。

Designer DateTimePicker 使用原生 `date`、`datetime-local` 和 `time` input，不持有 popup container。

## Designer 节点控件密度

Designer 节点内部的字段网格、Handle 行和卡片高度共同依赖 `styles/root.scss` 对所有 `button`、`input`、`select` 和 `textarea` 的紧凑归一化，包括
`--widget-height`、宽度、padding 和基础边框。共享 shadcn/Base UI primitive 也会出现在这些节点内部；它们带有 `data-slot`，但仍必须继续接受这套
Designer 归一化，才能与既有节点布局保持一致。

不要在 `styles/root.scss` 用 `:not([data-slot])` 或类似 selector 把所有 shadcn primitive 排除出这套规则。这样会让 Input、Select 和 Button 回到各自的默认
高度，同时节点父级仍按紧凑行高布局，导致字段溢出、列错位和节点尺寸失控。允许的例外只有 `[data-canvas-control-scope]` 内的 Button 和 Toggle，
以及 React Flow 官方 `.react-flow__controls` 内的 `ControlButton`；Canvas overlay 不参与节点的紧凑字段网格，必须保留对应组件自己的尺寸、圆角和状态。

需要调整节点内某个控件时，应在该控件或节点的局部布局中明确处理，并同时验证对应 Handle 行和节点尺寸；不要通过修改根级控件 selector 隔离整个
primitive 家族。页面级和 Canvas overlay 的 shadcn 组件可以采用自己的原生尺寸，但不能借此改变节点内部的密度合同。

## React Flow 画布外围

### Canvas Content 与 Canvas Chrome

Canvas Content 包括 Node、Node 内参数编辑器、Handle、Edge、选择框和随 viewport transform 的内容。它们继续使用 Designer 的紧凑字段密度、
`--widget-*` token 和节点组件样式；不能为了统一 Workbench 视觉而修改这套规则，也不能通过全局 `button`、`input` 或共享 radius token 间接改变它们。

Canvas Chrome 包括固定在画布四周的状态标记、添加或删除操作、Inspector 开关、缩放与布局控制、Display Mode、MiniMap 和设置控制。它们虽然视觉上
覆盖画布，但不属于 Canvas Content。Workbench 持有的 Chrome 使用共享 shadcn/Base UI primitive 的原生 variant、size、radius、surface、focus 和 disabled
状态，feature CSS 只负责定位与 gap。React Flow 持有的 `Controls` 和 `ControlButton` 保留官方结构与行为，并通过 `--xy-*` 映射共享 `--ui-*` token；官方
组件未覆盖的圆角与 focus ring 只允许在 React Flow 的 Chrome selector 中补齐，不能影响 `.react-flow__node` 或其后代。

独立操作必须作为有间距的独立圆角 Button；不要把它们包成一个 surface 后再对所有子按钮设置 `border-radius: 0`。有单一组合语义的 ToggleGroup 可以保留
原生的整体圆角和内部连接边，但 feature stylesheet 不得重新声明其 border、background、radius、color、typography 或状态样式。不要为 Canvas Chrome 新增
平行的颜色或 radius token，也不要为了调整 Chrome 修改 `--ui-radius`，因为共享 primitive 同样会出现在 Node 内部。

Designer 持有、固定在画布 viewport 四周的内容优先使用 React Flow 官方定位与控制结构：

- 任意固定浮层使用 `Panel`；
- zoom、fit、layout 和其他画布命令使用 `Controls` 与 `ControlButton`；
- 小地图使用 `MiniMap` 自己的 `position`、`pannable` 和 `zoomable` 接口；
- 需要随 viewport transform 的 flow-space 内容使用 `ViewportPortal`，不要用它承载固定的四角控件。

React Flow 已提供的颜色、边框和阴影优先通过官方 `--xy-*` CSS variables 映射到共享 `--ui-*` token。官方变量未覆盖的尺寸、圆角和 focus ring
集中放在 `ReactFlowContainer` 的 theme override 中；不要为每组画布命令复制 ButtonGroup、surface 或绝对定位实现。

React Flow `ControlButton` 不转发 DOM ref，不能作为 Base UI `TooltipTrigger render` 的 child。图标 ControlButton 使用 React Flow 官方的 `title` 和
`aria-label`；不要用 Tooltip wrapper 破坏 Controls 的直接子元素、边框或 ref 语义。共享 shadcn `Button` 必须保持 `forwardRef<HTMLButtonElement>`，以支持
Dialog、Tooltip 和宿主 focus restoration。连续的 React Flow 命令组在 `Controls` 上按实际布局复用共享 `ButtonGroup` 的 horizontal 或 vertical variant，并在每个
`ControlButton` 上复用共享 Button 的 `outline`、`icon` variant 与 `data-slot="button"`；这样保留 React Flow 行为，同时由 shadcn 原生规则负责整体圆角、
内部连接边、focus 和 disabled 状态。方向必须通过 `Controls orientation` 传入，并以 React Flow 实际输出的 `.horizontal` / `.vertical` class 作为 Chrome
适配 selector；`Controls` 不转发任意 `data-*` 属性，不能依赖调用方添加的 `data-orientation` 或 `data-slot`。

React Flow 没有提供的通用应用控件可以组合在 `Panel` 中，例如 Display Mode 使用共享 shadcn/Base UI `ToggleGroup`。这类 primitive 需要放在
`[data-canvas-control-scope]` 内，避免接受节点字段网格的紧凑归一化。

Workbench 持有且位于 `FlowDesignerView` 兄弟位置的顶部 action 可以继续由宿主相对 `.canvas-panel` 定位；不要仅为了使用 `Panel` 扩张 Designer 公共 API，
也不要让 Workbench 导入 Designer 的具体 light/dark theme module。Workbench 中确实嵌入 Designer 控件时，只能通过 Designer-owned
`designerThemeClass` adapter 取得 root theme class；具体 SCSS module 的所有权仍留在 Designer。

## Utility 与图标生成

Tailwind CSS v4 是 `src/ui/browser`、`src/designer/browser` 和 `src/workbench/browser` 中布局与视觉 utility 的唯一 owner。不要使用 UnoCSS Wind3
专有语法；共享 stylesheet 显式注册这三个 source。important modifier 使用 Tailwind v4 后缀形式（例如 `justify-start!`），任意值使用方括号形式
（例如 `mb-[2px]`）。

UnoCSS 只负责现有 Iconify 图标，包括 `i-carbon:*`、`i-codicon:*`、`i-custom:*` 和 file icon。不要重新启用 `presetWind3`，也不要依赖 UnoCSS 为
`flex`、`gap-*`、`w-*`、`text-*` 等普通 utility 生成样式。复杂 Designer 布局继续优先使用 SCSS Modules，避免为了 Tailwind 统一而迁移精调节点。

## 共享 UI 主题合同

共享 shadcn/Base UI primitive 只消费 `--ui-*` 语义 token。`src/ui/browser/theme.css` 是 Workbench 与部署宿主唯一的产品 palette owner；Designer Light 和
Designer Dark 只在 Canvas Content compatibility scope 内实现相同的 token key。新增 primitive token 时，必须同时更新产品主题、两个 Designer compatibility
theme 和发布 CSS 产物测试，不能遗漏、重命名或增加只由单个宿主理解的共享 token。

Workbench 的 `styles/tokens.css` 只能消费共享 `--ui-*` token，并定义非 palette 的 Workbench 状态扩展；不得声明或覆盖 light/dark `--ui-*` 值，也不得重新引入
`--canvas`、`--surface`、`--subtle`、`--border`、`--text`、`--muted`、`--primary`、`--focus` 或 `--danger` 作为平行主题事实源。Server-owned chrome
不能 deep-import Workbench 源码，但必须消费同名 `--ui-*` 合同，避免通过逐组件 dark selector 维护第二套视觉。Designer 的 `--widget-*`、`--node-*`、
`--edge-*` 和 `--fill-*` 继续只服务 Canvas Content compatibility scope，不能成为 Workbench shell 的主题来源。

React Flow 画布外围通过固定的 `--xy-*` 映射消费共享 UI、node 和 widget token。Light/Dark 必须保持同一组 `--xy-*` key 与引用关系；不要重新增加
`--rf-*` 中间 token，也不要在单个 Canvas component 中重新定义 palette。

## 共享 popup 动画与 Designer 例外

共享 Dialog、Select、DropdownMenu、Popover 和 Combobox 的 Popup 必须统一使用语义 popover surface、`tw-animate-css` 的 open/closed 动画，并同时提供
`motion-reduce:animate-none` 与 `motion-reduce:transition-none`。不要在 feature stylesheet 重复声明同类淡入、缩放或关闭动画。Progress Indicator 只允许
过渡实际变化的 `width`；不要使用会让颜色、布局和未来新增属性一起进入动画的 `transition-all`。

Designer 的 `DesignerCombobox`、节点菜单、翻译面板和 Block Quick Pick 仍可通过 SCSS Modules 控制紧凑尺寸、最大高度、复杂网格和特定布局。这些属于已经精调
的 Workflow 编辑体验，不应为了追平 registry 最新 DOM 结构而机械覆盖。共享 primitive 负责 surface、focus、disabled、item state 和 reduced-motion；Designer
feature 只保留确有产品含义的布局覆盖。DropdownMenuItem 即使只有一个也必须放在 DropdownMenuGroup 中。

Base UI Trigger 的 `render` 如果是共享 Button，保留默认 `nativeButton=true`；如果 render 为定位锚点 `<div>`、整行 `<div>` 或其他非 button 元素，必须显式传
`nativeButton={false}`。这适用于 DropdownMenuTrigger、PopoverTrigger 和同类 trigger，避免开发态语义警告，也不能为了消除警告把画布坐标锚点伪装成可交互 button。

共享 DropdownMenu 使用传统 click-release 触发：鼠标按下只显示 Button active 状态，完整 click 后才打开。共享 Root 必须取消 Base UI 的 `trigger-hover`
关闭请求，使按钮菜单和坐标锚定的 Canvas 菜单都不会因 pointer 离开 trigger 或 popup 关闭。菜单只因选择、再次触发、外部点击、焦点离开或 Escape 关闭。
ContextMenu 保留右键和长按触发，并遵循相同的持久关闭规则。

## Workbench stylesheet 入口

`src/ui/browser/theme.css` 是产品主题的唯一 palette 事实源，并以 `.open-flow-theme[data-theme]` 发布 `--open-flow-*` 语义 token，再映射到 shadcn 使用的
`--ui-*` token。Workbench 与部署宿主必须在自己的根元素同时挂载 `.open-flow-theme` 和 `data-theme`；不得在各自 feature stylesheet 复制 light/dark palette。
宿主若只需要产品主题，可单独导入公开的 `@oomol-lab/open-flow/theme.css`。

`src/workbench/browser/runtime/styles.css` 是发布 Workbench CSS 的唯一 feature entry。它按 cascade 顺序导入产品主题、共享 UI、tokens、shell、resource browser、status、
workspace、canvas、context panel、runs、publications 和 responsive 样式。拆分样式时只移动连续的原始区段，并同步入口顺序测试；第一轮不得同时改
selector、property、class name 或 TSX。

所有 Workbench feature stylesheet 继续以 `.open-flow-workbench` 为根 scope。不要在 feature 文件中引入未限定的全局 reset，也不要因为拆文件而改变
规则相对顺序。

Designer 的 Node、Handle、Edge、节点字段和节点 popup 继续使用 Designer 自己的 `--widget-*`、`--node-*`、`--edge-*`、`--fill-*` 与本地 `--ui-*` 映射。
React Flow Controls 和带 `[data-canvas-control-scope]` 的浮层属于 Canvas Chrome，必须在最小 scope 内把 `--ui-*` 重新桥接到继承的 `--open-flow-*`；禁止把桥接
放到 `.oo-designer-root`，否则会把产品主题扩散到 Canvas Content。

Workbench 的 Block Library 不得复用 Designer `BlockPickerRow`、`designerThemeClass` 或 `.oo-designer-picker-*` selector；列表行、分组与展开入口使用共享 Button variant、
Separator 和 Workbench 布局。Run Input Editor 可以继续复用 Designer 的 schema/HandleEditor 行为，但必须通过局部 `data-workbench-control-scope` adapter 把尺寸、颜色、
边框、focus 和 radius 映射到 `--ui-*`，不得挂载 Designer light/dark theme class。普通 Workbench panel、card、icon surface 的圆角必须从 `--ui-radius` 派生；状态圆点、
拖拽手柄和 inline code token 可以保留自身几何圆角。

## Resource Browser primitive 所有权

Resource Browser 的 Button、Input、InputGroup、Select、Empty、Skeleton 和表单 Field 使用共享 shadcn/Base UI primitive 的 variant、尺寸、focus、disabled 和
invalid 视觉。`resource-browser.css` 只负责页面、列表、行和确认区的业务布局；不要重新为共享 Input、Button、Select 或 Dialog 定义高度、padding、border、
颜色、hover 或 disabled opacity。

整行 Flow 选择器可以保留 grid、最小高度、padding 和分隔线，但 hover 由 `Button variant="ghost"` 负责。行内更多操作使用 `aria-expanded` 表达展开
状态，不要同时伪装成 pressed toggle。跨 feature 的 `.workspace-*` selector 必须留在 `workspace.css`。

共享 Dialog 必须拥有 Overlay、Content、Header、Footer、Title、Description、动画和 reduced-motion 视觉，同时保留局部 `container` 参数，让 Portal 继承当前
Workbench/Designer root 的主题。Feature 调用只负责表单布局、本地化关闭按钮和 initial focus，不要重新创建 `resource-dialog-*` surface selector。

共享 Select 必须拥有 Trigger、Value、Content、List、Item、Indicator、滚动按钮、focus/disabled 状态和 popup 动画。Workbench 可以通过 Trigger `className`
设置业务所需的最小宽度，并通过 Content 的 `align`、`alignItemWithTrigger` 和 `container` 控制定位；不要重新创建 `workbench-select-*` visual selector。

## Workbench 通用 primitive 所有权

Workbench 的 Diagnostics、Runs、Publications 和 Context Panel 继续使用共享 Button、InputGroup、Empty 与 Skeleton 的 surface、focus、hover、selected、disabled、
radius、typography 和 motion。Feature `className` 只表达容器尺寸、grid/flex、margin、最小高度和数据排版；不要用 feature selector 重新设置共享 primitive 的 border、
background、color、shadow、focus ring 或 disabled opacity。

可选择的数据行通过语义状态驱动共享组件：当前 Run 使用 `aria-current="true"`，共享 ghost Button 负责 selected surface；不要并行维护 `.active` visual class。加载更多
操作使用 Button 的 `size` 与 `variant`，feature 只保留外边距。Empty 的标题、描述、图标与间距由完整 Empty composition 负责，feature 只传可用高度和是否隐藏边框。
Skeleton 自己处理 `prefers-reduced-motion`，不要在 responsive stylesheet 按调用位置重复关闭动画。InputGroup 的 focus-within ring 由 shared primitive 负责，不要为某个
搜索框另建 focus selector。

空画布推荐操作虽然位于 Canvas Panel 内，仍是普通 Workbench Button：调用方选择 `size="sm"` 与 `variant="outline"`，Canvas stylesheet 只处理推荐列表的
flex/wrap/gap 和 pointer-events，不得通过后代 selector 改回透明背景、专用圆角或字号。Context Panel Inspector 的 Input、Textarea 和 NativeSelect 同样使用共享
surface 与 focus ring；JSON/Textarea 可以保留等宽字体和紧凑行高，但 feature CSS 不得重新声明 border、background、radius、padding、color 或 disabled 状态。

响应式 Header 操作通过 Button 的显式 `size` 保持密度，不要在 media/container query 中批量改写所有 Button 的 padding 或 font-size。共享 TabsTrigger 自己承担
transition 与 reduced-motion。Workbench 的 coarse pointer 规则可以增加最小触屏命中区，但必须使用 Button 的 `data-size` 保持 icon variant 的方形命中区；不要用固定
`height` 覆盖所有视觉尺寸，也不要把该规则扩张到 Designer 节点或 React Flow ControlButton。

Workbench root 始终建立 `open-flow-workbench` inline-size container；响应式业务布局只维护 1100、980、720、520 四个 container breakpoint。不要并行增加
`max-width` viewport fallback，也不要在文件尾重复较宽 breakpoint 来争夺 cascade。与 viewport 本身相关的 pointer 和 reduced-motion media query 可以保留。

共享 Alert 与 Card 消费 `--ui-card` / `--ui-card-foreground`，三个 theme owner 必须与其他 `--ui-*` token 同步实现。Workbench 的 error/warning feedback 使用
`--danger-*` / `--warning-*` surface、border、foreground token；除 JSON/code syntax highlighting 外，不要在 Runs、Context Panel、Status 或 responsive stylesheet
直接维护浅色主题 red/amber hex。单条终止错误优先使用完整 Alert composition，而不是重新创建 feature error box。

Context Panel 的 overlay 判定必须观察 `.open-flow-workbench` named container，而不是使用 viewport `matchMedia`；否则嵌入式窄容器会出现 CSS 已切换 Overlay、React 语义仍是
complementary 的分裂状态。Diagnostics、Run Input 和 overlay Context Panel 的程序化焦点必须有 `:focus-visible` 替代 outline，并保持 Escape、focus trap 与关闭后恢复。
窄屏全高 panel 使用 `100dvh`、`overscroll-behavior: contain` 与四向 safe-area inset，避免滚动穿透、刘海和虚拟键盘遮挡；异步检查/启动状态通过 `aria-busy`，变化摘要通过
`aria-live="polite"` 播报。

Workbench 的浏览器能力基线是 ES modules、CSS custom properties、CSS container queries、`ResizeObserver` 和 dynamic viewport units。响应式语义与布局都以
Workbench container 为准，不维护并行的 viewport fallback。`ResizeObserver` 缺失时必须保留初始容器测量且不能抛错，但宿主后续改变容器宽度时无法同步 React overlay 语义；
需要支持这类旧 WebView 的宿主必须提供等价能力。应用构建必须保持 Run input editor、Carbon/Twemoji collection 和 Markdown renderer 在 Flow browser 初始路由之外，
并通过构建期预算阻止可选编辑能力重新进入初始 JavaScript。

## Designer 键盘与图标控件

可聚焦的 React Flow Canvas 根必须在 `:focus-visible` 下显示不影响节点测量的 inset ring；不要只使用 `outline: none !important`。视口外 NodeIndicator 是导航动作，必须
使用原生 button，并让键盘 click 以按钮中心计算目标坐标。其淡出 transition 必须支持 reduced-motion。

Icon Picker 的 icon、tab、关闭、随机、颜色面板和具体颜色都使用原生 `type="button"`；icon-only action 必须有 `aria-label`，选中的 tab/color 使用 `aria-pressed`，颜色
面板 trigger 使用 `aria-expanded`。搜索框必须有可访问名称与 `autocomplete="off"`。这些语义改动不得改变 Icon Picker 的网格、颜色或 Designer 节点图标系统。

HandleRow 的折叠箭头必须是带 `aria-expanded`、`aria-labelledby` 和 `type="button"` 的原生按钮。需要保留整段 value 点击区的标题行使用 `valueExpands`，由 HandleRow
生成唯一的 value trigger，并把箭头降为装饰；调用方不要在 subtitle `<div>` 上重复 `onClick`。这样展开语义、键盘触发和 focus ring 由一处维护，同时保持节点行高。

Workbench Breadcrumb、Validation、Run Back 和 Event Locate 等 Button 通过既有 `variant`、`size` 与布局 utility 表达，不得在 feature CSS 重写 padding、radius、
background、font-size 或 hover。Validation 的 invalid 状态使用 destructive variant，普通状态使用 ghost；feature class 只保留响应式显示与 flex/grid 位置。

Workbench Button 内的 typed SVG Icon 不传 `size`；Button 的 default/sm/xs/icon variants 已统一控制内部 SVG。状态图标、EmptyMedia、InputGroup addon 和节点内容等非 Button
场景可以按各自布局传尺寸。不要让 SVG width/height attribute 与 Button variant 的 CSS 同时竞争。

Designer Label 只负责表单标签与 tooltip，不提供通用 `onClick`。Iframe Preview 由 iframe 自己的 focus 激活并始终提供 title，不在包装 div 上模拟交互。JSON Viewer 的
展开图标、字段、括号与折叠摘要都使用原生 button；只有主展开按钮进入 Tab 顺序，冗余鼠标目标使用 `tabIndex=-1`，不要重新使用带 `role="button"` 的 span。

Workbench Host 通过必需的 `hrefFor(WorkbenchLocation)` 拥有 URL 序列化。Flow 与 Breadcrumb 使用 Base UI Button `render={<a href />}` 和
`nativeButton={false}` 输出真实链接；普通主键点击由 `followWorkbenchLink` 拦截后走 NavigationStore，modified click、非主键和已处理事件保留浏览器默认行为。不要把
URL-changing action 回退为只有 `onClick` 的 Button。
