# Open Flow Lab

Run the local-only frontend component playground from the repository root:

```bash
bun run dev:designer
```

Build its static deployment or publish it to `design.openflow.run` with:

```bash
bun run build:designer
bun run deploy:designer
```

Deployment uses Cloudflare Workers Static Assets and requires an authenticated Wrangler session.
Production deployments use Cloudflare Workers Builds with the GitHub repository. Configure the
production branch as `main`, the root directory as `/`, the build command as
`bun run build:designer`, and the deploy command as
`bunx wrangler deploy --config packages/open-flow/dev/designer/wrangler.jsonc`. Use
`bunx wrangler versions upload --config packages/open-flow/dev/designer/wrangler.jsonc` for
non-production branches. Set the build variable `BUN_VERSION` to the version in the root
`packageManager` field.

The default **Cards · Content & records** gallery uses the production card, execution status and record controls. It compares compact identity-only cards, plain text summaries and framed report previews, alongside schedule, condition, approval, running and failed examples. Empty content creates no placeholder. Execution status appears once in the footer; lightweight record actions open sample results and logs. Preview surfaces are distinct from the card shell in both themes.

**Workflow components** shows the single execution canvas with a bottom command dock. It does not add an inspector or reserve a sidebar column. It includes Task, Trigger, Condition, Value, Subflow and Comment nodes, grouped inputs and connected ports. **Reset samples** restores the sample layout and selection.

**Comment / Properties** (`?story=comment-properties`) displays the production `EditorContextPanel` heading and `CommentInspector` Source/Markdown tabs, with editable, empty-content and read-only samples side by side. Each editable sample keeps its saved title and Markdown in local state. Trigger-specific property panels live under Triggers / [type] / Properties.

The **Nodes** section collects production canvas nodes under boundary inputs. Its **Condition / Node States** story covers empty, single and multiple cases, plus long rule labels, long output labels and both sides overflowing together.

**Value / Node States** (`?story=node-value`) displays hidden, empty, primitive, structured, nullable, long-content and invalid values using the production canvas. The node toolbar places the content visibility toggle immediately before Delete, only when the node has collapsible content. The story toolbar provides read-only and reset actions; canvas actions are logged.

The **Theme Preview** group also contains:

- **Node states**: idle, selected, waiting, running, success and error nodes together.
- **Node controls**: compact inputs, switches, checkboxes, selects, dates, buttons and popups.
- **Notifications** (`?story=notifications`): production Sonner presentation with success, error, long text and action samples. Add a burst to inspect the stack, or test timed dismissal.
- **Workbench controls**: shared buttons, inputs, choices, badges and feedback in the product theme.
- **Theme palette**: Canvas and product color tokens side by side, using the actual CSS variables.

Switch light/dark mode in the toolbar to review both themes. Story URLs are shareable locally with `?story=node-condition`, `?story=canvas-cards`, `?story=workflow`, `?story=node-states`, `?story=node-controls`, `?story=product-controls` or `?story=palette`. Sample content stays in English; the language picker changes the actual components' translations.

Canvas and product colors share `src/ui/browser/theme.css`. Edits update both previews through Vite.

Add production node boundary cases to `nodeStories.tsx`, layered card examples to `cards.tsx`, individual component scenarios to `stories.tsx`, component overviews to `overview.tsx`, and full graph samples to `workflow.tsx`. Keep scenarios deterministic and use the action logger instead of external services. Component stories render inside a real flow node so canvas scaling and popup placement use the same context as the production canvas. Standalone stories that exercise property-panel controls set `propertyPanel: true`; Lab then supplies the production `open-flow-property-panel` token boundary and `editor-context-panel` popup container. Full Workbench and `EditorContextPanel` stories omit this flag because they already mount the production panel. Other standalone stories provide their own layout; workflow samples use `FlowCanvasView` and log authoring actions without saving or running a Flow. The Lab is a development tool and has no package entry. Its production build exists only for the static design review deployment.

**Run Inputs** (`?story=run-inputs`) exercises the production input form without a canvas provider. It covers required fields, open objects, arrays, enums, explicit null and invalid JSON drafts.

`?story=node-library` 使用生产节点库，可切换正常、空列表、加载、错误和禁用状态，并检查搜索与动作记录。

`?story=node-metadata` 使用生产节点描述字段，展示编辑、只读及失焦保存结果。

`?story=value-node-editor` 使用生产值节点字段配置，展示结构化编辑、字段设置及只读状态。

`?story=trigger-schedule` 使用生产触发计划编辑器，展示定时间隔、Cron、多条规则、只读和未配置状态。

`?story=trigger-config` 使用生产服务触发器配置组件，展示与节点输入共用的固定字段、分组、nullable、默认值和只读状态。

`?story=webhook-editor` 使用生产 Webhook 配置组件，展示请求字段、HTTP 方法、响应配置及只读切换。

`?story=condition-editor` 使用生产条件分支编辑组件，展示表达式、命名出口、默认出口和只读切换。

`?story=variable-picker` 使用生产变量选择器，展示搜索、正常、缺失、加载、空列表、不可用及只读状态。

`?story=node-picker` 使用生产添加节点面板，进入时直接展示。右键画布或将执行连线空放，在鼠标附近打开同一面板；覆盖双向连接、不兼容项、搜索、边缘避让及只读状态。选择节点会记录创建位置和连接，只使用确定性数据。

`?story=agent-tools` uses production AgentSettings, WorkspaceStore and ConnectorStore. Its HTTP fixture provides tools and active/expired accounts, and applies draft changes with the production reducer. It covers parameter sources, approval, validation and read-only controls without external requests.

## Trigger galleries

Each `Trigger [name]` group contains **Node states**, **Run menu states**, and **Properties**. The four groups are Manual, Schedule, Webhook, and Provider. Provider opens representative Integration and Poll cases, including long enums, event arrays, nested business objects, missing configuration and account failures. Its selector exposes every registered provider without repeating their stories in the sidebar. Provider schemas and names come directly from the production registry; the Vite plugin sends only definition snapshots to the browser.

Run panels are laid out open in the page, with empty, ready, invalid, starting and disabled cases. Test data and Properties share the form field table and panel surface. The test form edits values under fixed schemas without mounting the definition editor. Webhook includes empty fixed objects, open objects and nested arrays; compare these with Properties in both themes. Manual and Schedule also show direct execution and downstream input requests. Property cases use the production `EditorContextPanel` and `NodeInspector` with local transport responses and the production change reducer. Display, editing, missing configuration and account errors are separate visible samples; Webhook advanced settings start expanded. Node cases cover selection, diagnostics, execution states and long content. Select one node to view its exact sample configuration in the read-only production inspector beside the canvas; one sample is selected on entry.

Examples: `?story=trigger-webhook-nodes`, `?story=trigger-webhook-run`, `?story=trigger-webhook-sidebar`, and `?story=trigger-provider-run`. The generic `run-control-states` story remains a control-layout study with placeholder input content; provider-specific visual acceptance belongs in the Provider gallery. A selected provider is shareable through `?story=trigger-provider-run&provider=github-on-repo-event`.

The Lab shell uses a fixed viewport with a shared theme on the document body. The header sits on the background; the sidebar and preview are separate rounded surfaces. Scrolling stays inside the navigation and Story content. Theme and language menus use the shared dropdown components and their default body portal.

`lab.tsx` owns navigation, preferences, and the shell; `lab.css` owns its layout and navigation styles. `storyCatalog.tsx` registers the existing Stories, `storyStage.tsx` provides their canvas preview context, and `styles.css` contains Story presentation styles.

The sidebar uses collapsible groups with story links underneath. The current group opens and scrolls into view when entering a story directly. Multiple groups can stay open for comparison; each group can also be collapsed with the keyboard. The top bar shows the current group and story.

Directory icons are configured in `storyGroupIcons` in `lab.tsx`, using complete literal UnoCSS classes such as `i-carbon:flow`. `StoryGroup.icon` is optional; directories without an icon remain text-only. Individual stories and page headings do not own icons. The Lab UnoCSS configuration scans its source files and scopes the generated utilities to `.lab-shell`.

Story 可通过可选的 `description` 配置说明文字，由 Lab 统一显示在内容岛顶部。示例正文不再重复渲染页面说明；组件自身标题和交互控件仍由 Story 展示。
所有 Story 的 `log(name, value)` 显示在内容岛底部的固定状态区，正文独立滚动。

示例辅助按钮通过 `useStoryActions([{ label, onClick, disabled? }])` 声明（从 `./storyActions.tsx` 导入），每个 Story 由一个组件注册。回调和状态留在 Story 中，Lab 统一在说明栏右侧渲染按钮。画布自身的运行、缩放和节点操作仍属于被展示组件。

说明文字单行省略，只有截断时才提供悬停和键盘聚焦的全文 Tooltip。

**Undo & Redo** 目录使用生产 WorkspaceStore、WorkbenchCanvas 和 Flow reducer，包含三个 Story：

- **Canvas operations** (`?story=canvas-history`)：交互画布支持混合删除恢复、复制粘贴、移动、快捷键和文本焦点隔离；说明栏的 Hold saves / Release saves 控制模拟传输。
- **Button states** (`?story=canvas-history-controls`)：并排展示空历史、可撤销、可重做、保存中及失败状态；说明栏的 Finish save 完成保存，失败样例可重试同步。
- **Keyboard scope** (`?story=canvas-history-keyboard`)：两个独立编辑器覆盖焦点控件移除、文本编辑、对话框及宿主区域的快捷键隔离。

## Story sidebar

The Lab reserves an optional rounded sidebar beside the content frame, inside the Story card beneath its shared header. Use `useStorySidebar(content)` from `storySidebar.tsx` and include its returned portal in the Story's JSX. The portal preserves the caller's React providers and lifetime; selection and data remain owned by the Story. Pass `null` to hide the sidebar. Stories with multiple canvases must choose one active sidebar content, as the Provider trigger gallery does. The shell owns sidebar width, scrolling, rounded frame, and the gap beside the content frame. Story content fills this sidebar directly without another card or outer padding.

Drag the centered three-dot handle in the 8px gap to resize the sidebar. Focus the handle to use Left/Right (Shift for larger steps), Home/End for width limits, or double-click to restore the default width. The sidebar stays within 60% of the available panel space.

**Canvas / Node content** (`?story=node-content`) compares collapsible Schedule, Value, Task and Comment content with empty nodes and Condition. Collapse preserves run status and branches.

`?story=node-picker-preview` compares the open node catalog and the button dock popover. Built-in nodes use compact rows with tooltips; the Triggers tab lists real definitions by app, and the Nodes tab browses sample connector actions. Story actions expose loading, errors and disabled controls.

`?story=inspector-panel` uses the production Workbench editor and stores with a deterministic transport. Verify persistent panel visibility, toolbar opening, return-to-outline without deselection, repeat selection, marquee completion, and code draft saves. Empty, outline, single and multiple selection panels appear together below. Its browser preference is isolated under the `lab:` prefix.

`?story=inspector-ports` 使用生产 NodeInspector、WorkspaceStore、Flow reducer 和画布展示节点属性。输入与输出复用 Fixed Values 的区块标题、表头、字段控件和行内设置结构；支持拖动组内排序，也可聚焦手柄后按上下键；Reload saved data 验证排序持久化。字段保留名称、类型、值和操作列，固定定义以只读控件展示。Source 选择器保留结构可用但 Schema 不兼容的端口，选择后由值编辑器展示错误；修改上游类型可清除错误。长文本和 JSON 在主行下展开，省去展开时的重复摘要。下方并排展示结构化 Payload、嵌套数组、只读接口及未设置、空数组、null、false，圆弧线标示嵌套关系。辅助按钮提供只读切换和重置。

## Node and Trigger properties

Nodes / Fixed Values, Task, Condition, Wait, Subflow, Agent, and LLM each have a **Properties** story (`?story=node-[type]-properties`, using `value` for Fixed Values). Comment retains its production CommentInspector story. Read-only and editable samples appear side by side. Workbench and these galleries share `EditorContextPanel`, including NodeHeading, NodeActions, and ContextPanel; sample transports use WorkspaceStore and the production Flow reducer. Close reopens through a sample button; Reset samples restores the fixture, and Reload saved data verifies persisted edits within the session.

Triggers / Manual, Schedule, Webhook, and Provider use the same production panel in **Properties**. Webhook request data uses the same field-table presentation as node ports. Existing `trigger-[type]-sidebar` URLs are retained (`cron` for Schedule). Gallery widths and the read-only-first order are preserved. Trigger Node states also reuse this panel for the selected sample.

Fixed Values now lives under Nodes, including Node States and Fixed Values Editor. Type-specific editors formerly under Workbench now live with their node or trigger: schedule, provider configuration, webhook, condition, Agent tools, LLM inputs, task metadata, input/group/output ports, and code. **Ports & sources** (`?story=inspector-ports`) remains the Task integration story for canvas selection, mappings and persistence. Workbench retains cross-node tools and panel-shell studies.

字段的附加设置与输入来源使用同一个带标题和关闭按钮的浮动面板，锚定字段左侧，按视口避让；在 Ports & sources 中检查打开、关闭、Escape 和主题继承。

Fixed Values 的 Properties 样板使用名称／值布局，名称可原位编辑；多选、颜色和日期通过紧凑入口打开编辑弹层。并排只读样板用于检查禁用状态，Reload saved data 检查改名与值保存。

`?story=field-settings` 并排打开生产字段设置面板，展示可编辑与只读状态。检查名称、多行用途说明、带标题的类型选择，以及高级设置中的 Schema 编辑与校验。值节点不重复显示空值开关，输入／输出保留该开关；移除操作独立置底；Reset samples 重置并重新打开样本。

JSON 值编辑器支持通过右下角手柄调整高度，宽度跟随面板；二级面板的 JSON Schema 编辑器按完整内容高度展示，仅由面板统一滚动。

高级设置使用原生折叠，不执行高度动画。展开后面板保持定位并限制可用高度，长内容由面板统一滚动；编辑器保持挂载，收起后不进入 Tab 顺序。

Node and Trigger **Properties** galleries include a **Fixed types · editable values** card using production `NodeInputs`. It compares all shared value editors, empty fixed/open objects, missing choices, nested definitions and array limits without granting schema-editing callbacks. These card edits stay local and Reset samples resets the node-gallery card. Comment has no typed fields.
