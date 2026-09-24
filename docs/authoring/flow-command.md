# Flow 命令调用合同

`oo flow` 使用宿主注入的 Control API。命令本身不保存当前 Flow，不从目录推断 Flow，也不保存待提交事务。

## 发现与读取

- `oo flow --help --json` 返回命令索引；`oo flow node add --help --json` 等子命令返回参数、选项、退出码和示例。Help、schema、version 不需要已配置的宿主。
- `oo flow schema apply --json` 返回完整事务输入的 JSON Schema；`schema operations` 返回 ChangeOperation 数组的 schema；`schema graph.node.input.set` 等返回单个操作的独立 schema。
- `schema input` 描述 Run 输入覆盖（node ID → handle → JSON value）；`schema outputs` 描述 Trigger 输出对象。节点实际端口与 Trigger 合同仍由 Revision 决定。
- `inspect <flow> --json` 默认返回与 MCP `flow_get` 相同的精简视图（CLI 另有 `kind: "flow.inspect"`）：`flow`、`draft.revisionId`、`draft.graph`、`draft.subflows`、`draft.bindings`、模块摘要与 Live 状态。节点保留输入绑定、端口 handle、未被覆盖的输入默认值和执行配置；省略完整 Schema、代码源码和审计元数据。`--full` 返回完整 `draft.content`、修订元数据和 Live 详情，供需要精确 before 值的编辑使用。原 `--summary` 已由默认行为取代。Inspect 不执行 check。
- `check <flow> --json` 单独校验当前 Draft，返回 `valid`、`revisionId` 和 `check`。无效时退出码为 1，诊断只随 stdout 的这一份结果返回。
- `event-source list --json` 列出当前身份可见、独立于 Flow 的事件源及其 Team、Connection、事件类型和验证状态。实际使用关系见 `consumers`；给 Flow 配置 Trigger 时可对照 `connector connections <service> --flow <flow>` 的 Connection。空列表提示到 Workbench 创建并验证事件源。
- Flow 引用接受 ID 或唯一的完整名称。名称歧义返回候选 identity；保存后续调用所需的 ID 可以避免名称查找。
- `inspect` 遇到不可读的 Draft 时返回 `flow`、`draft: null` 和 `draftIssue`（code、message、revisionId）。`flow.live` 仍保留已发布版本身份；不能从缺失内容推断流程用途。权限、网络和其他调用错误仍然报错。只需元信息时使用 `show`。
- `list`、`runs list`、`publications list` 一次只返回一页，支持 `--cursor` 和 `--limit`（1–100）。继续时传入 `nextCursor`，并保持同样的过滤条件。

有值的选项统一支持 `--option value` 和 `--option=value`。不支持的选项及重复的单值选项会报错；`--set`、`--unset` 可以重复。
指定 `--json` 后，参数解析错误和宿主缺失错误也使用 JSON。普通结果写 stdout，调用错误写 stderr；事件跟随输出 NDJSON。

## 编辑与重试

完整批量编辑复用公开的 `ChangeOperation`，包含节点、执行边、输入映射、模块、Task、Wait、Subflow 和 Binding 操作：

```json
{
  "version": 1,
  "operations": [
    {
      "kind": "graph.node.create",
      "target": { "kind": "flow" },
      "nodeId": "start",
      "node": { "kind": "manual", "name": "Start" }
    }
  ]
}
```

```bash
oo flow inspect FLOW_ID --json
oo flow schema graph.node.input.set --json
oo flow apply FLOW_ID --file changes.json \
  --expected-revision REVISION_ID --idempotency-key EDIT_KEY --json
```

`operations` 按顺序原子提交，`before` 必须匹配指定 Revision 在前序操作执行后的值。执行边和数据映射是独立操作；节点 ID 显式指定。
Server 使用公共 decoder 校验请求结构；操作的图语义和并发条件由底层变更合同验证。

### 创建示例与 Provider Trigger

CLI 与 MCP 共用创建示例。先用 `oo flow schema examples --json` 或 MCP `flow_schema {"example":"index"}` 查看索引，按需获取一个完整批次：

```bash
oo flow schema example.connector --json
oo flow schema example.poll-notification --json > changes.json
```

MCP 对应 `flow_schema {"example":"connector"}` 和 `flow_schema {"example":"poll-notification"}`。返回的 `{version,operations}` 可直接作为 CLI apply 文件；MCP flow_apply 使用其中的 operations，并另传 flowId、expectedRevisionId 和 idempotencyKey。
示例中的 `ACTION_ID`、`CONNECTION_ID` 必须替换为目标 Flow 作用域内的真实 identity，Connector 输入输出端口必须按 `connector show` / `connector_get` 的定义调整。示例通过结构和图语义检查，不证明外部账号可用。

已有 Connector Action 使用 `task.create`（executor.kind 为 connector）与引用 taskId 的节点。JavaScript 计算使用 `module.create` 与引用 moduleId 的 Code Task；仅做已有 Action 调用时无需写 JS。`poll-notification` 示例展示 events 数组转换为文本、执行连线及独立输入映射。

`graph.trigger.create` 是 Draft 请求操作，用 key 创建 Provider Trigger：

```json
{
  "kind": "graph.trigger.create",
  "nodeId": "mail",
  "key": "gmail.on_message_received",
  "connectionId": "CONNECTION_ID",
  "config": {},
  "schedule": [{ "type": "every", "unit": "minute", "value": 5 }]
}
```

它固定作用于根 Flow。connectionId 直接保存在 Trigger 节点，省略时表示尚未选择账号。schedule 仅供 Poll 使用，省略时每五分钟轮询。Integration 不接受 schedule。
服务端在提交时解析 key，并将完整 definition 固定进 Revision；check 不动态替换定义。同 key、同请求重试先返回原提交结果，不再读取当前目录。一个批次仍只产生一个 Revision。需要显式固定定义时仍可使用原有 graph.node.create。
CLI `trigger add` 也使用此操作；快速建图形式仍支持原有 Provider 配置。

原有 `{version,nodes,triggers,edges}` 快速建图输入继续用于创建节点和连接；它不能与 `operations` 混用。
`schema apply` 描述的是完整的 operations 形式。两种形式都是一次事务，重新用新 key 调用会发起新事务，不表示声明式同步。

创建 Flow、编辑 Draft、创建 Run、Publish 和 Rollback 支持 `--idempotency-key`。未指定时生成 key，并在成功结果或无法确认结果的错误中返回。
显式 key 的 Draft 编辑、Draft Run 和 Publish 必须同时固定 `--expected-revision`；Publish、Rollback、Live Run 必须固定 `--expected-publication`。
首次发布没有 Live 时使用 `--expected-publication none`。Live Run 使用该 Publication 的固定 Revision 解析 Trigger。

重试时保持相同的 key、Flow ID、Revision/Publication、参数和文件内容。便捷创建命令的生成 ID 由 key 固定；重试读取原 Revision，不能改用新的 Draft head。
需要完全固定 Connector 定义和 Connection 时，使用显式 operations，避免重新解析当前目录中的名称和默认账号。
服务端仍会拒绝同 key 不同请求、过期 Live 和不满足并发条件的新操作；CLI 不会自动换 key 或自动重放外部副作用。

Draft 编辑结果统一包含 `changed`、`revisionId`；真正提交的变更还包含 `baseRevisionId` 和 `idempotencyKey`。
Apply 的提交成功与校验结果分开：`changed: true` 表示变更已接受，`valid: false` 表示仍有诊断，`valid: null` 表示后续 check 不可用。
已接受的 Apply 返回 0，Agent 应在运行前处理 `valid` 或显式调用 `check`。不要因为 check 失败而用新 key 重复创建节点。

## Wait 节点

Wait 节点通过 `apply` 的 `operations` 创建和配置，目前没有 `node add wait` 便捷命令。
创建使用 `graph.node.create`（`node.kind` 为 `wait`），修改提示和操作使用 `graph.node.wait.set`。
先读取对应 schema，再按当前 Revision 提交事务：

```bash
oo flow schema graph.node.create --json
oo flow schema graph.node.wait.set --json
oo flow apply FLOW_ID --file changes.json --expected-revision REVISION_ID --json
```

Wait 在等待建立时触发固定的 `pending` 出口，可用 `connect FLOW_ID WAIT_NODE NOTIFY_NODE pending` 连接后续通知节点。
操作出口为 `continue` 或 `approve/reject`，同样通过 `connect` 的最后一个参数选择。
执行连线与输入映射独立；传递通知数据时，还需使用 `node input` 或 `graph.node.input.set` 配置输入来源。
`pending` 不是可决议的操作，不能传给 `runs resolve`。

查询待处理等待使用 `runs list --flow FLOW_ID --pending-wait --json`；`--pending-wait` 是无参数开关。
Run 即使仍为 `running`，也可能包含需要决议的 `waits`。决议时必须指定其中的 `waitId`。

## Agent 节点

`oo flow node add <flow> agent <name>` 创建可继续配置的 Agent 草稿。完整配置通过 `task.agent.set` 原子更新，`before` 是读取到的完整 Task；模型、任务说明、工具与参数来源属于同一个配置。使用 `oo flow schema task.agent.set --json` 查看操作结构。

快速建图形式也接受 `nodes.<id> = { "kind": "agent", "task": <完整 ManagedTaskDefinition> }`，其中 `task.executor.kind` 必须为 `agent`。它保留显式工具定义与账号，不重新解释当前 Connector 目录。精确字段、参数约束与审批语义见 [Agent Task 合同](../control/contracts/control-api.md#11-agent-task)。

`task.executor.code: true` 启用 JavaScript 代码计算，允许 `tools: []`；这类 Agent 无需 Connector 部署。
代码只处理当前输入和已取得的结果，不修改 Flow 或获得业务工具权限。结果列表的 `source.kind` 区分 `code` 与 `connector`，后者提供 `source.action`。

Agent 审批沿用 Run 的等待查询与决议命令。每次以当前 `waitId` 提交 `approve` 或 `reject`；历史等待的重复决议返回原事实，不会批准下一次工具调用。

## Connector 作用域

`connector providers/search/show/connections --flow FLOW_ID` 按该 Flow 的 Team 查询。Connector 添加、修改及 Apply 中的 Action 与 Connection 查询自动使用目标 Flow。
Provider Trigger 的 Connection 选择也使用目标 Flow。Trigger Key 是部署提供的静态定义目录，不按 Team 改写。

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

| 退出码 | 含义                                                                      |
| ------ | ------------------------------------------------------------------------- |
| 0      | 操作成功、异步创建已接受，或等待到成功终态。Apply 的有效性另看 valid。    |
| 1      | 调用错误、校验失败，或等待/结果查询得到 failed、canceled、indeterminate。 |
| 2      | Run 正在 Wait，需处理返回的 actions。                                     |
| 3      | 等待超时，或查询的发布操作仍 pending。底层操作继续进行。                  |

`node set --timeout` 仍设置节点的执行时限，与上述 CLI 等待预算属于不同命令语境。

### 查看 Agent 工具结果

完整工具结果独立于运行日志保存。列表返回 `resultId`，读取支持 JSON Pointer 与分页，下载输出原始 JSON，可使用 shell 重定向保存：

```bash
oo flow runs results RUN_ID --json
oo flow runs read-result RUN_ID RESULT_ID /emails 0 --json
oo flow runs download-result RUN_ID RESULT_ID > result.json
```

列表存在 `nextAfter` 时，将其作为 `runs results RUN_ID NEXT_AFTER` 的最后一个参数继续读取。
页面存在 `nextOffset` 时，用该值替换 `read-result` 的 offset。对于长字符串，offset 按 Unicode code point 计数。
这些命令读取已有结果，不会重新调用外部工具。

## 精确读取与命令入口

Connector Provider 发现使用 `oo flow connector providers [--flow FLOW_ID]`，原 `connector list` 已移除。Action 搜索使用 `connector search QUERY`，返回不含完整 Schema 的摘要；`connector show ACTION_ID` 返回完整定义。两端搜索摘要包含 authenticated 与当前默认连接摘要。

`trigger search [QUERY]` 搜索可用 Trigger 定义；省略 query 列出全部摘要。`trigger list FLOW_ID` 列出 Flow 内的触发器实例。`connector set` 只修改连接和输入；节点重命名统一使用 `node set FLOW_ID NODE_ID --name NAME`，不再接受被忽略的 `connector set --name`。

```bash
oo flow connector teams --json
oo flow create "My Flow" --team TEAM_ID --json
oo flow check FLOW_ID --revision REVISION_ID --json
oo flow disable FLOW_ID --expected-publication PUBLICATION_ID --json
oo flow enable FLOW_ID --expected-publication PUBLICATION_ID --json
oo flow runs results RUN_ID --after RESULT_ID --json
oo flow runs read-result RUN_ID RESULT_ID --pointer /items --offset 20 --limit 20 --max-bytes 15000 --json
```

Team 选择使用公共 Control API，并保留创建幂等语义。启停必须指定观察到的 publication ID；发布版本发生变化时返回冲突，不自动修改新版本。指定 `check --revision` 检查该固定版本；省略时检查当前 Draft。

结果列表游标 `--after` 是结果 ID，事件命令的 `--after` 是数字序号。结果读取的 pointer/offset 已改为命名选项，旧位置参数不再接受；`limit` 默认为 20（1–100），`max-bytes` 默认为 15000（1–1048576），offset 默认为 0，pointer 默认为根。下载完整结果仍使用 `runs download-result`。
