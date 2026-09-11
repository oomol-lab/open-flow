# 旧 Server Project 草稿导入

这个离线工具将支持的旧 Project 当前草稿转换到独立的当前 Flow 数据库。它不改写原库，不切换运行中的服务，也不恢复旧 Live。
旧模型与当前执行引擎不同，不能把历史 Publication 或 Run 改一个版本号后继续执行。

在仓库根目录安装依赖后，用仓库指定的 Node 版本执行：

```sh
node apps/server/scripts/migrate-project.ts /absolute/path/legacy.sqlite /absolute/path/new-output-directory
```

输出目录必须不存在；工具拒绝覆盖已有目录。目录只允许当前用户访问，内含：

- `source.sqlite`：SQLite backup API 生成的一致性完整备份，包括 WAL 中已提交的记录。
- `open-flow.sqlite`：当前 schema 的独立数据库，只包含成功转换的未发布 Flow 草稿。
- `report.json`：旧 Project / Revision 到新 Flow / Revision 的对应关系，以及逐 Flow 未转换的原因。

有未转换的 Flow 时退出码为 2，成功结果仍保留。文件或数据库操作失败会以非零状态退出，原库不变；输出目录可能只包含备份或部分结果，不能据此切换服务。

目前只转换无 Project bindings、managed tasks、subflows 的图：空图，或一个显式 Manual / Cron Trigger 加单一执行链。没有 Trigger 但只有一条任务链时，补充明确的手动入口；重复节点名称通过当前命名规则消歧，节点 ID 与引用不变。
Task 必须使用内联代码模块，每个非根 Task 恰有一个节点依赖，同一前驱不能分出多个后继；旧 concurrency 只接受 1 或缺省。
字典式端口转换为有序端口数组，节点依赖转换为显式执行边。输入、输出与源码保留，通过当前 Revision decoder 和完整 Flow validation 后才写入。
未知字段、多前驱、并行分支、循环、缺失模块、损坏 digest 等均不作为成功导入；工具不会猜测合流、执行顺序或凭据对应关系。

Flow ID 保留，新 Revision ID 按旧 Project、Flow 和转换结果确定；不同 Flow 的相同内容不会共用 Revision identity。
旧的 Revision 历史、Publication、Run、监听进度、订阅、Presentation 和部署设置仅保留在 `source.sqlite`，不装入当前运行时。
需要启用转换结果时，应在当前服务中检查草稿、补齐部署配置并正常发布；不能把“草稿已转换”当作完整部署迁移完成。

此工具读取 Server 的内联 Revision 存储。Cloud 的旧 Project Revision 正文保存在 R2，不能直接把 D1 文件作为这个工具的输入。
