# Open Flow Lab

Run the local-only frontend component playground from the repository root:

```bash
bun run dev:designer
```

The default **Cards · Content & records** gallery uses the production card, execution status and record controls. It compares compact identity-only cards, plain text summaries and framed report previews, alongside schedule, condition, approval, running and failed examples. Empty content creates no placeholder. Execution status appears once in the footer; lightweight record actions open sample results and logs. Preview surfaces are distinct from the card shell in both themes.

**Workflow components** shows the single execution canvas with a bottom command dock. It does not add an inspector or reserve a sidebar column. It includes Task, Trigger, Condition, Value, Subflow and Comment nodes, grouped inputs and connected ports. **Reset samples** restores the sample layout and selection.

**Comment / Properties** (`?story=comment-properties`) displays the production `CommentInspector` directly, with editable, empty-content and read-only samples side by side. Each editable sample keeps its saved title and Markdown in local state. Trigger-specific property panels remain in their existing Sidebar galleries.

The **Nodes** section collects production canvas nodes under boundary inputs. Its **Condition / Node States** story covers empty, single and multiple cases, plus long rule labels, long output labels and both sides overflowing together.

**Value / Node States** (`?story=node-value`) displays empty, primitive, structured, nullable, long-content and invalid values using the production canvas. The toolbar provides read-only and reset actions; canvas actions are logged.

The **Theme Preview** group also contains:

- **Node states**: idle, selected, waiting, running, success and error nodes together.
- **Node controls**: compact inputs, switches, checkboxes, selects, dates, buttons and popups.
- **Workbench controls**: shared buttons, inputs, choices, badges and feedback in the product theme.
- **Theme palette**: Canvas and product color tokens side by side, using the actual CSS variables.

Switch light/dark mode in the toolbar to review both themes. Story URLs are shareable locally with `?story=node-condition`, `?story=canvas-cards`, `?story=workflow`, `?story=node-states`, `?story=node-controls`, `?story=product-controls` or `?story=palette`. Sample content stays in English; the language picker changes the actual components' translations.

Canvas and product colors share `src/ui/browser/theme.css`. Edits update both previews through Vite.

Add production node boundary cases to `nodeStories.tsx`, layered card examples to `cards.tsx`, individual component scenarios to `stories.tsx`, component overviews to `overview.tsx`, and full graph samples to `workflow.tsx`. Keep scenarios deterministic and use the action logger instead of external services. Component stories render inside a real flow node so canvas scaling and popup placement use the same context as the production canvas. Standalone stories provide their own layout; workflow samples use `FlowCanvasView` and log authoring actions without saving or running a Flow. The Lab is a development tool and has no production build or package entry.

**Run Inputs** (`?story=run-inputs`) exercises the production input form without a canvas provider. It covers required fields, open objects, arrays, enums, explicit null and invalid JSON drafts.

`?story=node-library` 使用生产节点库，可切换正常、空列表、加载、错误和禁用状态，并检查搜索与动作记录。

`?story=node-metadata` 使用生产节点描述字段，展示编辑、只读及失焦保存结果。

`?story=value-node-editor` 使用生产值节点字段配置，展示结构化编辑、字段设置及只读状态。

`?story=trigger-schedule` 使用生产触发计划编辑器，展示定时间隔、Cron、多条规则、只读和未配置状态。

`?story=trigger-config` 使用生产服务触发器配置组件，展示 Schema 字段、多选、必填、默认值和只读状态。

`?story=webhook-editor` 使用生产 Webhook 配置组件，展示请求字段、HTTP 方法、响应配置及只读切换。

`?story=condition-editor` 使用生产条件分支编辑组件，展示表达式、命名出口、默认出口和只读切换。

`?story=variable-picker` 使用生产变量选择器，展示搜索、正常、缺失、加载、空列表、不可用及只读状态。

`?story=node-picker` 使用生产画布的新增节点菜单，覆盖分组、搜索、禁用项、服务动作二级选项，以及从执行端口拉线后创建节点的回调。点击底部 Add node 打开菜单；从任务左侧输入端拉到空白处可检查连接方向与不兼容项。样例只记录动作，不写入业务数据。

`?story=agent-tools` uses production AgentSettings, WorkspaceStore and ConnectorStore. Its HTTP fixture provides tools and active/expired accounts, and applies draft changes with the production reducer. It covers parameter sources, approval, validation and read-only controls without external requests.

## Trigger galleries

Each `Trigger [name]` group contains **Node states**, **Run menu states**, and **Sidebar display & edit**. The four groups are Manual, Schedule, Webhook, and Provider. Provider opens representative Integration and Poll cases, including long enums, event arrays, nested payloads, missing configuration and account failures. Its selector exposes every registered provider without repeating their stories in the sidebar. Provider schemas and names come directly from the production registry; the Vite plugin sends only definition snapshots to the browser.

Run panels are laid out open in the page, with empty, ready, invalid, starting and disabled cases. Manual and Schedule also show direct execution and downstream input requests. Sidebar cases use the full production `NodeInspector` with local transport responses and the production change reducer. Display, editing, missing configuration and account errors are separate visible samples; Webhook advanced settings start expanded. Node cases cover selection, diagnostics, execution states and long content.

Examples: `?story=trigger-webhook-nodes`, `?story=trigger-webhook-run`, `?story=trigger-webhook-sidebar`, and `?story=trigger-provider-run`. The generic `run-control-states` story remains a control-layout study with placeholder input content; provider-specific visual acceptance belongs in the Provider gallery. A selected provider is shareable through `?story=trigger-provider-run&provider=github-on-repo-event`.

The Lab shell uses a fixed viewport with a shared theme on the document body. The header sits on the background; the sidebar and preview are separate rounded surfaces. Scrolling stays inside the navigation and Story content. Theme and language menus use the shared dropdown components and their default body portal.

`lab.tsx` owns navigation, preferences, and the shell; `lab.css` owns its layout and navigation styles. `storyCatalog.tsx` registers the existing Stories, `storyStage.tsx` provides their canvas preview context, and `styles.css` contains Story presentation styles.

The sidebar uses collapsible groups with story links underneath. The current group opens and scrolls into view when entering a story directly. Multiple groups can stay open for comparison; each group can also be collapsed with the keyboard. The top bar shows the current group and story.

Directory icons are configured in `storyGroupIcons` in `lab.tsx`, using complete literal UnoCSS classes such as `i-carbon:flow`. `StoryGroup.icon` is optional; directories without an icon remain text-only. Individual stories and page headings do not own icons. The Lab UnoCSS configuration scans its source files and scopes the generated utilities to `.lab-shell`.

Story 可通过可选的 `description` 配置说明文字，由 Lab 统一显示在内容岛顶部。示例正文不再重复渲染页面说明；组件自身标题和交互控件仍由 Story 展示。
所有 Story 的 `log(name, value)` 显示在内容岛底部的固定状态区，正文独立滚动。

示例辅助按钮通过 `useStoryActions([{ label, onClick, disabled? }])` 声明（从 `./storyActions.tsx` 导入），每个 Story 由一个组件注册。回调和状态留在 Story 中，Lab 统一在说明栏右侧渲染按钮。画布自身的运行、缩放和节点操作仍属于被展示组件。

说明文字单行省略，只有截断时才提供悬停和键盘聚焦的全文 Tooltip。

`?story=canvas-history` 使用生产 WorkspaceStore、WorkbenchCanvas 和 Flow reducer，展示空历史、可撤销、可重做、保存中及失败状态。
下方交互画布支持混合删除恢复、复制粘贴、移动、快捷键和文本焦点隔离；Hold saves / Release saves 控制模拟传输，失败样例可重试同步。
