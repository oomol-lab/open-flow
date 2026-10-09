# Flow 命令调用合同

`oo flow` 通过宿主注入的 Control API 操作部署。CLI 不保存当前 Flow 或本地事务。`oo --team <name>` 由宿主选择本次调用的团队。Flow 引用接受 ID 或唯一完整名称；后续调用使用返回的 ID 可避免名称查找。

## Agent authoring

CLI 与 MCP 使用相同的节点接口。配置解析、节点执行配置装配、CodeModule 管理、变量绑定、源码 imports 和变更生成由公共 Open Flow 包拥有，服务端通过现有 Draft 提交 owner 保存。

| CLI                                                | MCP                           | 用途                                   |
| -------------------------------------------------- | ----------------------------- | -------------------------------------- |
| `read FLOW --input JSON`                           | `flow_read`                   | 概要、批量节点详情、代码或 prompt 片段 |
| `search FLOW --input JSON`                         | `flow_search`                 | 名称、类型、配置和源码搜索             |
| `schema [edits\|TYPE]`                             | `flow_schema`                 | 编辑语法、类型配置、端口与创建示例     |
| `schema read\|search\|edit\|check`                 | 各工具的 inputSchema          | 请求结构、约束与示例                   |
| `schema --flow FLOW --input '{"action":"ACTION"}'` | `flow_schema {flowId,action}` | 当前 Flow 作用域的 Action 端口         |
| `edit FLOW --file edits.json`                      | `flow_edit`                   | 原子批量编辑                           |
| `check FLOW --revision REVISION`                   | `flow_check`                  | 固定版本诊断                           |

`read/search/edit` 支持 `--input` 的 JSON、`@file`、`-`，或 `--file path|-`，两者不能同时提供。MCP 直接传入相同请求并增加 `flowId`。`schema TYPE` 和请求 schema 可离线查询，Action 查询需要部署。`read/search/edit/check --help --json` 直接包含该命令的请求 schema、约束和示例；普通文本帮助包含相同的使用说明和示例。`schema check` 描述公共请求的 `revisionId`，CLI 使用 `--revision` 传递。

```bash
oo flow read FLOW_ID --json
oo flow read --help --json
oo flow schema read --json
oo flow search FLOW_ID --input '{"query":"Customer summary","type":"agent"}' --json
oo flow read FLOW_ID --input '{"revision":"REVISION","nodes":["NODE"]}' --json
oo flow read FLOW_ID --input '{"revision":"REVISION","text":{"node":"NODE","field":"prompt","start":1,"lines":40}}' --json
oo flow schema agent --json
```

读取返回 `{flowId,revision,data,version:1}`。省略 `nodes` 和 `text` 返回概要，两者互斥。概要包含节点引用、名称、类型、端口 handle、压缩输入摘要与执行边，不展开 schema 或长文本。详情聚合实际配置、端口、输入来源和相邻边，不返回内部定义 ID。代码和 prompt 以文本元信息表示，正文通过 `text` 按行读取。默认 80 行，上限 200 行和 24000 字符；读取完整文本时，根据 `nextStart` 继续，直到 `truncated: false`。搜索返回匹配引用、字段、行号、有限上下文和 `nextOffset`。分页读取使用同一 `revision`。

## 编辑合同

```json
{
  "baseRevision": "REVISION",
  "requestId": "stable-request-id",
  "edits": [
    { "op": "node.add", "as": "start", "type": "manual", "name": "Start" },
    {
      "op": "node.add",
      "as": "format",
      "type": "code",
      "name": "Format",
      "config": { "outputs": { "value": { "schema": { "type": "string" } } } },
      "inputs": { "value": { "kind": "value", "value": 42 } },
      "code": "export default ({value}) => ({value: String(value)})"
    },
    { "op": "edge.connect", "source": "$start", "target": "$format" }
  ]
}
```

支持 `node.add/update/remove`、`input.set`、`edge.connect/disconnect`、`text.edit/set`。`$alias` 只能引用批次前面创建的节点；响应 `nodes` 将别名映射为稳定引用。批次顺序执行，任何应用错误均不写入部分结果。

`node.update.set` 包含名称、说明、图标、执行限制和 `config`。配置递归合并，未提供字段保留，数组整体替换。OpenAPI 的 `config.authentication` 是完整的鉴权选择，提供时整体替换，避免混合上一次选择的方案与参数。`clear` 是字段路径数组，例如 `[["description"],["config","connectionId"]]`。显式清除与 JSON `null` 不同；必填配置不能清除。配置具体字段通过 `schema TYPE` 获取。

`node.add.inputs` 按业务字段名提供数据来源，等同于创建后逐项执行 `input.set`。Code、Agent、LLM、Wait 和 Approval 的命名输入可随绑定自动声明，默认接受任意 JSON（包含 null）；需要约束时可提供 `config.inputs`。已有输入约束不会因重新绑定而放宽；Connector、OpenAPI 和 Provider Trigger 的字段由能力定义确定，LLM 的 `model/template/messages` 使用运行时已有约束。

通过此接口创建 Code、Agent 和 LLM 时不注入示例业务数据；输入来自调用方提供的绑定或业务约束。既有节点的输入和默认值保持原样。

Code 的 `config.inputs/config.outputs`、Agent/LLM/Wait/Approval 的 `config.inputs`、Webhook 的 `config.body` 和 Value 的 `config.outputs` 使用字段映射，例如 `{"orders":{"schema":{"type":"array"},"nullable":false}}`。每个字段可指定 `schema`（默认 `{}`）、`nullable`（默认 `true`）和 `description`；输入还可指定 `default`。这些是业务数据约束，无需提供 `handle` 或 `jsonSchema` 等内部包装。字段映射遵循局部合并规则，移除字段使用 `clear`，例如 `[["config","inputs","obsolete"]]`。

Agent 和 LLM 的结果默认是文本，结构化结果使用 `config.resultSchema` 指定 JSON Schema。工具生成运行时输出定义；调用方不声明 `config.outputs`。创建一个读取订单对象的 Agent 只需：

```json
{
  "op": "node.add",
  "as": "summary",
  "type": "agent",
  "name": "Summarize orders",
  "config": { "model": "MODEL" },
  "inputs": { "orders": { "kind": "output", "node": "ORDERS_NODE", "port": "orders" } },
  "prompt": "Summarize {{orders}}."
}
```

输入来源支持：

- `{kind:"value",value:null}`：显式 null，仍受端口校验。
- `{kind:"unset"}`：显式未设置，不继承端口默认值。
- `{kind:"default"}`：删除覆盖，恢复端口默认值继承。
- `{kind:"output",node:"NODE",port:"value",field:"name"}`：节点输出或其一级属性。
- `{kind:"variable",name:"TOKEN"}`：按名称绑定部署变量。
- `{kind:"sources",sources:[...]}`：多个输出或变量来源，执行时使用既有来源解析规则。

节点只有一个输出时可省略 `port`，例如 `{kind:"output",node:"$summary"}`。多个输出时必须选定业务字段；省略会返回候选项供修正。`field` 在选定输出内部读取一级属性，不用于选择节点输出。

### 各节点的业务配置

提供数据使用 `inputs` 或 `input.set`；配置字段只描述业务选择和必要的数据约束。读取详情返回同一套业务配置，内部端口定义和能力快照由工具维护。

| 节点               | 配置与数据                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Value              | `config.values` 直接提供命名 JSON 值；`config.outputs` 可选，约束对应值。                                                   |
| Webhook            | `config.body` 描述请求体字段，`config.method/options` 保留请求处理选项。                                                    |
| Wait / Approval    | `prompt` 设置提示词，`inputs` 绑定待展示或确认的数据；`config.inputs` 可选，补充业务约束。                                  |
| LLM                | `config.model/template/messages` 设置默认模型、消息模板和历史消息；`inputs` 为这些字段或模板中的命名字段绑定数据来源。      |
| Condition          | `config.branches` 定义分支，每项包含 `name` 和 `when`；`config.match` 选择首个匹配或全部匹配。                              |
| Poll / Integration | `config.key/connectionId` 选择 Trigger 和账号，Poll 另外提供 `config.schedule`；参数统一通过 `inputs` 或 `input.set` 设置。 |
| OpenAPI            | `config.sourceUrl/path/method` 选择操作；可覆盖 `serverUrl` 和 `authentication`。请求字段及凭据输入由规范生成。             |

例如创建常量和 Webhook 时，只需描述值和请求体字段：

```json
[
  { "op": "node.add", "as": "settings", "type": "value", "name": "Thresholds", "config": { "values": { "minimumTotal": 100, "currency": "USD" } } },
  {
    "op": "node.add",
    "as": "webhook",
    "type": "webhook",
    "name": "Order received",
    "config": { "method": "POST", "body": { "orderId": { "schema": { "type": "string" }, "nullable": false } } }
  }
]
```

Value 的 `values` 与 `outputs` 分别保存取值和约束。只提供约束而不提供值表示该输出尚未设置；移除一个输出时，清除 `config.values.FIELD` 和 `config.outputs.FIELD`，避免把“清除取值”误当成“删除字段”。JSON 对象可以整体传递；通过来源的 `field` 引用其属性时，需要在 `config.outputs.FIELD.schema.properties` 声明该属性的业务结构，工具不会根据一次取值推断永久类型。

LLM 的 `template` 保留运行时消息模板语义，模板内容可使用 `{{orders}}` 等命名输入。`messages` 是不进行模板插值的历史消息，排在模板消息之前。配置中的值是默认值，节点输入绑定优先；使用 `input.set` 的 `default` 恢复默认值继承，`unset` 则显式不取默认值。修改默认模型或模板不会清除既有绑定。

```json
{
  "op": "node.add",
  "as": "summary",
  "type": "llm",
  "name": "Order summary",
  "config": {
    "model": { "model": "MODEL" },
    "template": [{ "role": "user", "content": "Summarize {{orders}}." }]
  },
  "inputs": { "orders": { "kind": "output", "node": "ORDERS_NODE", "port": "orders" } }
}
```

Condition 的比较两侧直接使用值、节点输出或变量来源，无需 `kind:"source"` 包装。分支名称用于 `edge.connect.branch`，执行连线仍单独编辑。`when` 可以是单个比较、`{all:[比较,...]}`，或 `{any:[比较,{all:[比较,...]},...]}`。没有分支匹配时使用固定的 `otherwise` 分支：

```json
{
  "op": "node.add",
  "as": "threshold",
  "type": "condition",
  "name": "Above threshold",
  "config": {
    "match": "first",
    "branches": [
      {
        "name": "above",
        "when": { "left": { "kind": "output", "node": "TOTAL_NODE", "port": "total" }, "operator": ">", "right": { "kind": "value", "value": 100 } }
      }
    ]
  }
}
```

Poll 和 Integration 的参数来自目录定义，仅支持固定 `value`、显式 `unset` 或恢复 `default`，不能依赖其他节点的执行输出或变量来源。不再使用单独的 `config.values` 包装；输入名称和默认值可通过 Trigger 目录及节点详情查看。

OpenAPI 节点详情提供操作支持的鉴权选项。`authentication:{schemes:["bearer","apiKey"]}` 选择一个完整选项，其中多个方案必须同时满足；不能随意组合不同选项或只选择其中一部分。`{schemes:[]}` 仅在规范允许匿名访问时有效。也可手动选择 `{type:"bearer"}`、`{type:"basic"}` 或 `{type:"apiKey",name:"X-Token",in:"header"}`；手动 bearer 可用于规范声明 OAuth、但调用方已持有访问令牌的情况。凭据通过节点详情列出的输入绑定部署变量，配置中不填写密钥。

创建时省略鉴权和服务地址，使用操作默认选择。修改同一操作的名称、地址或鉴权时复用已保存的规范快照；切换 `sourceUrl/path/method` 时重新读取规范，并使用新操作的默认鉴权与地址，除非本次同时显式指定。清除 `config.authentication` 或 `config.serverUrl` 会恢复已保存操作的默认选择。手动或规范鉴权的选择整体替换，既有输入绑定仍按输入名称保留。

执行边独立于输入来源。连接使用 `source`、`target` 和可选 `branch`，不会隐式绑定输入；输入修改不会隐式增加执行边。

```json
{ "op": "text.edit", "node": "NODE", "field": "prompt", "oldText": "Include internal costs.", "newText": "Exclude internal costs." }
```

精确替换必须恰好匹配一次。零匹配或多匹配返回 `flow.invalid`，其 `details` 包含 `reason:"text.match-count"`、`matches`、`node`、`field` 和 `editIndex`。读取更多上下文后修正请求。`text.set` 替换全部正文。执行配置由各节点独立拥有；修改共享代码模块时，工具按需复制模块，保持节点 ID、连线和其他节点的实际配置不变。

仅支持当前模型的单个 Flow 图。Subflow 已退役，包含旧子图或 Subflow 节点的 Revision 拒绝读取和修复；接口不会忽略这些内容后继续编辑。旧版根图的读取与升级规则见[公共契约与版本演进](../control/contracts/compatibility.md)。

## 保存、校验和重试

编辑返回 `{saved:true,revision,nodes,changes,validation,version:1}`。`validation.status` 为 `valid`、`invalid` 或 `unavailable`。保存成功可包含语义诊断，CLI 返回 0；运行前处理诊断并用固定版本 `check` 复验。诊断提供节点引用、字段路径和可用的代码行列，隐藏存储路径和定义 ID。

`requestId` 是稳定幂等身份。响应丢失时重复相同 Flow、baseRevision、requestId 和完整 edits。服务端先查原请求记录，再检查 Draft 版本与解析目录。同身份不同请求返回 `flow.conflict`；新请求的旧版本返回 `flow.revision-conflict`，不自动合并。冲突后重读相关节点，保留用户修改，使用新的请求身份提交新版本。

Flow 创建、运行、发布和回滚保留原职责及 `--idempotency-key`。Draft Run 与 Publish 固定 `--expected-revision`；Publish、Rollback、Live Run 固定 `--expected-publication`，首次发布使用 `none`。

旧 `apply`、`inspect`、`node`、`code`、`connect/disconnect` 和节点创建/修改便捷命令已由新接口替代；不再通过 CLI/MCP 暴露底层 ChangeOperation。Workbench 所需的低层 Control API 保留。

## 能力发现与账号

`connector providers/search/show/connections --flow FLOW_ID` 按 Flow 的 Team 查询；Action 配置使用发现的 Action ID 和 Connection ID。`trigger search/show` 发现 Provider Trigger；创建时设置 `config.key`，服务端固定定义快照。Agent 配置的工具使用业务名称、Action、账号和参数，内部工具 ID 由服务端装配。

Agent 工具的 `inputs` 按 Action 参数名指定来源：`{kind:"model"}` 交给模型填写，`{kind:"value",value:...}` 固定取值，`{kind:"input",input:"orders"}` 引用 Agent 的命名输入。无需提供参数 schema；新工具或更换 Action 时由目录装配，未指定参数默认由模型填写。同一 Action 的既有工具保留原参数约束和未覆盖来源，修改说明或审批设置不会刷新目录定义；未知参数名返回可选参数列表。

`event-source list` 列出独立事件源及其账号和验证状态。`connector code-access FLOW [--publication ID]`、`connector candidates FLOW PROVIDER...` 保留 Code 连接管理职责。列表支持原有游标分页，详情读取不代表验证通过。

## 执行、暂停与发布

```bash
oo flow run FLOW_ID --expected-revision REVISION_ID \
  --idempotency-key RUN_KEY --wait --timeout 60000 --json
oo flow runs wait RUN_ID --timeout 60000 --json
oo flow runs resolve RUN_ID WAIT_ID approve --json
oo flow runs wait RUN_ID --json
oo flow runs events RUN_ID --after 0 --follow --timeout 60000 --json
```

Run 固定一个 Trigger。图中仅有一个 Manual Trigger 时自动选择，否则使用 `--trigger`。`--outputs` 接受按端口名索引的 JSON 对象，默认为 `{}`，适用于 Manual；其他 Trigger 必须提供完整输出。
检测到待决议项后，等待命令返回 Run detail 的 `waits` 数组，其中各项包含 `waitId`、`nodeId`、`prompt`、`actions` 和过期时间；Run 此时可以仍为 running。使用 `runs list --pending-wait` 查询所有有待处理等待的 Run。
`runs resolve` 显式指定 run、wait 和 action（continue/approve/reject），不自动替用户决议。

等待预算 `--timeout` 的单位是毫秒，默认 60000；它只限制 CLI 等待，不取消 Run 或发布。
`runs events --follow --json` 每取到一页就输出一行，不累计整段历史；使用返回的 `nextAfter` 恢复。
后续读取失败时错误中保留 run ID 与已输出的 cursor。

`publish` 等待发布操作完成或超时。超时结果保留 `flowId` 和 `operation.operationId`；用
`publications operation FLOW_ID OPERATION_ID` 查询，或 `publications wait FLOW_ID OPERATION_ID --timeout 60000` 继续等待。

| 退出码 | 含义                                                                       |
| ------ | -------------------------------------------------------------------------- |
| 0      | 操作成功、异步创建已接受，或等待到成功终态。Edit 的有效性另看 validation。 |
| 1      | 调用错误、校验失败，或等待/结果查询得到 failed、canceled、indeterminate。  |
| 2      | Run 正在 Wait，需处理返回的 actions。                                      |
| 3      | 等待超时，或查询的发布操作仍 pending。底层操作继续进行。                   |

节点执行时限通过 `node.update.set.timeoutMs` 设置。

### 查看 Agent 工具结果

完整工具结果独立于运行日志保存。列表返回 `resultId`，读取支持 JSON Pointer 与分页，下载输出原始 JSON，可使用 shell 重定向保存：

```bash
oo flow runs results RUN_ID --json
oo flow runs read-result RUN_ID RESULT_ID --pointer /emails --offset 0 --json
oo flow runs download-result RUN_ID RESULT_ID > result.json
```

列表存在 `nextAfter` 时，将其作为 `runs results RUN_ID --after NEXT_AFTER` 的游标参数继续读取。
页面存在 `nextOffset` 时，用该值替换 `read-result` 的 offset。对于长字符串，offset 按 Unicode code point 计数。
这些命令读取已有结果，不会重新调用外部工具。

## 输出与错误

普通结果写 stdout，调用错误写 stderr，`--json` 使两者可解析。`check` 失败只在 stdout 返回一次结构化诊断并退出 1；事件跟随使用 NDJSON。`read/search/edit` 直接返回与 MCP、HTTP 一致的业务对象。其他既有命令保留自身包装，例如 `check.check`、`runs show.run`。

`--help --json` 不访问部署。选项支持 `--option value` 或 `--option=value`；以 `-` 开头的值使用后者，单独的 `-` 表示 stdin。不支持的选项、重复单值选项和缺少值均在请求前拒绝。
