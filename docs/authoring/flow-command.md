# Flow 命令调用合同

`oo flow` 使用宿主注入的 Control API。命令本身不保存当前 Flow，不从目录推断 Flow，也不保存待提交事务。

## 发现与读取

- `oo flow --help --json` 返回命令索引；`oo flow node add --help --json` 等子命令返回参数、选项、退出码和示例。Help、schema、version 不需要已配置的宿主。
- `oo flow schema apply --json` 返回完整事务输入的 JSON Schema；`schema operations` 返回 ChangeOperation 数组的 schema；`schema graph.node.input.set` 等返回单个操作的独立 schema。
- `schema input` 描述 Run 输入覆盖（node ID → handle → JSON value）；`schema payload` 描述 Trigger payload。节点实际端口与 Trigger 合同仍由 Revision 决定。
- `inspect <flow> --json` 返回完整 `content`、Revision metadata 和 `revisionId`，包含 modules、tasks、subflows、bindings 和 graph。`--summary` 改为紧凑的 nodes、triggers、edges。Inspect 不执行 check。
- `check <flow> --json` 单独校验当前 Draft，返回 `valid`、`revisionId` 和 `check`。无效时退出码为 1，诊断只随 stdout 的这一份结果返回。
- Flow 引用接受 ID 或唯一的完整名称。名称歧义返回候选 identity；保存后续调用所需的 ID 可以避免名称查找。
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

## Connector 作用域

`connector list/search/show/connections --flow FLOW_ID` 按该 Flow 的 Team 查询。Connector 添加、修改及 Apply 中的 Action 与 Connection 查询自动使用目标 Flow。
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

Run 固定一个 Trigger。图中仅有一个 Manual Trigger 时自动选择，否则使用 `--trigger`。`--payload` 默认为 `{}`。
到达 Wait 后，等待命令立即返回 `run.waiting`，其中包含 `waitId`、`nodeId`、`prompt`、`actions` 和过期时间。
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
