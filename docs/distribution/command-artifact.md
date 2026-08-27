# Command Artifact v2 分发合同

本文定义 Open Flow 交付给 `oo flow` 宿主的 immutable Command Artifact、入口 host contract 和验证规则。产品边界以
[产品与架构边界](../architecture.md)为准。Command Artifact 是 CLI 的代码分发载体，不包含 Workbench、Server 或本地持久化实现。
其可编辑源码、构建、验证和发布入口只属于 `packages/command`；`packages/open-flow` 只提供 Command 消费的公开产品 API。

## 版本与发布记录

每个宿主 release 固定一个 Open Flow artifact：

```ts
interface OpenFlowCommandRelease {
  readonly format: 'open-flow-command-release'
  readonly version: 1
  readonly openFlowVersion: string
  readonly bunVersion: string
  readonly archive: {
    readonly url: string
    readonly length: number
    readonly digest: string
  }
}
```

`url` 指向 immutable object，`length` 和 `digest` 分别是 gzip archive 的精确字节数与 64 位小写 SHA-256。更新 artifact 必须先上传新
digest object，再由宿主固定新的 release record；不得覆盖旧 object 或使用可变 `latest` 地址。

## Archive 与 manifest

Artifact 是 deterministic gzip-compressed USTAR archive，只包含一个 `open-flow-command/` 根目录：

```text
open-flow-command/
├── command-artifact.json
├── entry.js
├── LICENSE
├── NOTICE
└── LICENSE.md
```

文件集合是封闭的。Manifest 没有列出的文件、link、directory entry、device、PAX metadata 和其他特殊 entry 全部非法。`entry.js` mode
固定为 `0755`，其余文件固定为 `0644`。

```ts
interface CommandArtifactManifest {
  readonly format: 'open-flow-command-artifact'
  readonly version: 2
  readonly openFlowVersion: string
  readonly bunVersion: string
  readonly entry: 'entry.js'
  readonly files: readonly {
    readonly path: string
    readonly length: number
    readonly digest: string
  }[]
}
```

Manifest 使用 UTF-8、LF 结尾和 canonical JSON。Object key 与 `files` 使用 Unicode code-point 顺序；禁止未知字段、重复 path、非有限
number 和非 canonical 表达。合法 path 必须是非空的相对 POSIX path，禁止绝对路径、Windows drive prefix、反斜杠、NUL、空 segment、
`.` 和 `..`，并且必须能由不使用扩展头的 USTAR 表达。

Builder 固定 uid、gid、mode、mtime、gzip header 和文件顺序；相同 source tree 与固定工具版本必须产生完全相同的 archive bytes。

## Command entry

`entry.js` 是使用固定 Bun version 构建的单文件 ESM bundle。入口导出：

```ts
export const commandArtifactVersion = 2

interface OpenFlowCommandHost {
  readonly cloudRequest: (path: string, init?: RequestInit) => Promise<Response>
  readonly getWorkbenchUrl: (flowId?: string) => Promise<string>
  readonly language?: string
}

export function runOpenFlowCommand(args: readonly string[], host: OpenFlowCommandHost): Promise<number>
```

`args` 是删除 `oo flow` 前缀后的参数，返回值是 `0..255` 的整数 exit code，entry 不调用 `process.exit()`。`cloudRequest` 只能请求当前
deployment 的 `/v1/` Control API path，不是通用 authenticated fetch；`getWorkbenchUrl` 只返回当前 deployment 的正式 Workbench deep
link。Artifact 不保存 Flow 或 deployment 选择，也不从当前工作目录推断资源 scope。

`language` 接受任意 BCP 47 tag，entry 会把它解析成 en、zh-CN、zh-TW、ja、ko、ru、fr 之一（fr-CA 归到 fr，zh-HK 与 zh-Hant-\*
归到 zh-TW，其余 zh\* 归到 zh-CN），无法识别的 tag 回退到 en。

CLI 的用户可见文案全部来自 `packages/command/src/cli/node/locales/<tag>.json`，由 val-i18n 加载并在构建时内联进 `entry.js`，
artifact 不额外分发 locale 文件。`--help` 在每种语言下都输出同一份完整命令清单，只有标题行、用法行和选项行被翻译。

Artifact 与宿主在同一个受信任 Bun process 中运行，不构成 JavaScript sandbox。宿主负责注入当前身份，并拒绝跨 origin、非 Control API
path 和 Artifact 伪造的授权 header。Artifact 不能直连 Connector、Provider 或 Cloud 返回的任意 URL。

## 下载、验证与 cache

宿主安装 artifact 时必须：

1. 使用 release record 的固定 URL；
2. 校验 HTTP 成功、精确 archive length 和 SHA-256；
3. 下载到 cache filesystem 内的临时文件；
4. 对相同 digest 使用跨进程 lock；
5. 严格解码 gzip、USTAR metadata、entry type 和 path；
6. 验证 manifest、完整 file set、每个文件 length 和 digest；
7. 只在全部验证通过后通过 atomic rename 提交 cache directory；
8. cache hit 不访问网络；损坏 entry 只重新下载同一个固定 archive；
9. 失败时不执行部分内容，也不回退到旧协议或未验证版本。

Cache 使用独立 namespace：

```text
<oo-cache>/open-flow/command-artifact-v2/<archiveDigest>/
```

## 发布验收

发布前至少验证：

- 两次 clean build 的 archive bytes 完全一致；
- archive exact file set、manifest 和每个文件 digest；
- 解压后的 entry 可以 import；
- fake host 完成主要 Flow 读取、创建和校验命令；
- 不同 cwd 读取相同远端 Flow 时得到相同结果；
- 宿主拒绝跨 origin/path，并覆盖伪造的身份 header；
- 旧 cache namespace 不会被当前 loader 执行。

上传必须先于 release record 修改。任何 byte 变化都生成新的 digest object；已发布宿主版本不能静默执行新代码。
