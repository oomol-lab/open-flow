import type { ResourceUriResolver } from '../../src/base/common/resource.ts'
import type { Revision } from '../../src/base/common/revision.ts'
import type { BlockPath, FlowPath, ManifestPath, PackagePath, SearchPath } from '../../src/manifest/common/manifestTypes.ts'
import type { PackageMetaContext } from '../../src/manifest/common/meta/package/packageMeta.ts'
import type { ManifestRefreshResult } from '../../src/manifest/common/session.ts'
import type { ManifestReadResult, ManifestSource, PackageManifestKind } from '../../src/manifest/common/source.ts'
import type { ProjectSourceChange, ProjectSourceSaveRequest, ProjectSourceSaveResult, ProjectSourceSnapshot } from '../../src/project/common/source-service.ts'

import { val } from 'value-enhancer'
import { PackageMeta } from '../../src/manifest/common/meta/package/packageMeta.ts'
import { ManifestSession } from '../../src/manifest/common/session.ts'
import { createYamlSourceValidator } from '../../src/manifest/common/sourceValidator.ts'
import { WritableTaskBlockManifest } from '../../src/manifest/common/writable/block/writableTaskBlockManifest.ts'
import { WritableFlowManifest } from '../../src/manifest/common/writable/writableFlowManifest.ts'
import { WritablePackageManifest } from '../../src/manifest/common/writable/writablePackageManifest.ts'
import { FlowSchema, TaskBlockSchema } from '../../src/schema/index.ts'

export interface MemoryPackageFile {
  readonly path: string
  readonly source: string
  readonly revision: Revision
}

export interface CreateMemoryPackageProps {
  readonly configureContext?: (context: MemoryPackageMetaContext) => void
  readonly root: SearchPath
  readonly packageSource: string
  readonly packageRevision: Revision
  readonly files: readonly MemoryPackageFile[]
}

export interface ListManifestPathsHook {
  (kind: PackageManifestKind): Promise<readonly string[]>
}

export interface ReadFileHook {
  (path: string, refRevision?: Revision): Promise<ManifestReadResult>
}

export class MemoryPackageMetaContext implements PackageMetaContext {
  public readonly lang$ = val('en')
  public readonly resolveResourceUri: ResourceUriResolver = (resourcePath) => resourcePath
  public readonly rootPath = '/'
  public listManifestPathsError: Error | undefined
  public listManifestPathsHook: ListManifestPathsHook | undefined
  public openManifestError: Error | undefined
  public openManifestErrorPath: string | undefined
  public readFileError: Error | undefined
  public readFileHook: ReadFileHook | undefined

  private readonly files: Map<string, ManifestSource>
  private readonly flowSessions = new Map<string, ManifestSession<WritableFlowManifest>>()
  private readonly taskSessions = new Map<string, ManifestSession<WritableTaskBlockManifest>>()

  public constructor(files: readonly MemoryPackageFile[]) {
    this.files = new Map(files.map((file) => [file.path, { source: file.source, revision: file.revision }]))
  }

  public async listManifestPaths(kind: PackageManifestKind): Promise<readonly string[]> {
    if (this.listManifestPathsError) throw this.listManifestPathsError
    if (this.listManifestPathsHook) return this.listManifestPathsHook(kind)
    const segment = `/${kind}s/`
    return Array.from(this.files.keys())
      .filter((path) => path.includes(segment) && path.endsWith(`/${kind}.oo.yaml`))
      .toSorted()
  }

  public async openFlowManifest(path: FlowPath): Promise<WritableFlowManifest | undefined> {
    this.throwOpenError(path)
    let session = this.flowSessions.get(path)
    if (!session && this.files.has(path)) {
      session = await ManifestSession.open({
        path,
        sourceService: this,
        validateSource: createYamlSourceValidator(FlowSchema),
        createManifest: (initial) => new WritableFlowManifest(initial.source, initial.revision),
        watch: false,
      })
      this.flowSessions.set(path, session)
    }
    return session?.manifest
  }

  public async openTaskManifest(path: BlockPath): Promise<WritableTaskBlockManifest | undefined> {
    this.throwOpenError(path)
    let session = this.taskSessions.get(path)
    if (!session && this.files.has(path)) {
      session = await ManifestSession.open({
        path,
        sourceService: this,
        validateSource: createYamlSourceValidator(TaskBlockSchema),
        createManifest: (initial) => new WritableTaskBlockManifest(initial.source, initial.revision),
        watch: false,
      })
      this.taskSessions.set(path, session)
    }
    return session?.manifest
  }

  public async readFile(path: string): Promise<ManifestSource | undefined>
  public async readFile(path: string, refRevision: Revision | undefined): Promise<ManifestReadResult>
  public async readFile(path: string, refRevision?: Revision): Promise<ManifestReadResult> {
    if (this.readFileError) throw this.readFileError
    if (this.readFileHook) return this.readFileHook(path, refRevision)
    const snapshot = this.files.get(path)
    return snapshot != null && refRevision == snapshot.revision ? 'unchanged' : snapshot
  }

  public async read(path: string): Promise<ProjectSourceSnapshot | undefined> {
    const snapshot = this.files.get(path)
    return snapshot && { path, ...snapshot }
  }

  public async save(_request: ProjectSourceSaveRequest): Promise<ProjectSourceSaveResult> {
    throw new Error('Saving is not implemented by the memory package context.')
  }

  public watch(_path: string, _listener: (change: ProjectSourceChange) => void): () => void {
    return () => undefined
  }

  public async readScriptletSource(path: string): Promise<string | undefined> {
    return this.files.get(path)?.source
  }

  public async fileDirExists(path: string): Promise<boolean> {
    const prefix = `${path}/`
    return this.files.has(path) || Array.from(this.files.keys()).some((filePath) => filePath.startsWith(prefix))
  }

  public async removeFileDir(): Promise<void> {}

  public async copyFileDir(): Promise<string> {
    throw new Error('Copy is not implemented by the memory package context.')
  }

  public async renameFileDir(): Promise<string> {
    throw new Error('Rename is not implemented by the memory package context.')
  }

  public async writeScriptletFile(): Promise<string> {
    throw new Error('Scriptlet writes are not implemented by the memory package context.')
  }

  public async duplicateScriptletFile(): Promise<string> {
    throw new Error('Scriptlet copies are not implemented by the memory package context.')
  }

  public async createFile(path: string, source: string): Promise<ManifestSource> {
    if (this.files.has(path)) throw new Error(`File already exists: ${path}`)
    const snapshot = { source, revision: `memory-${this.files.size + 1}` as Revision }
    this.files.set(path, snapshot)
    return snapshot
  }

  public async ensureFile(filePath: string, defaultSource: string): Promise<ManifestSource> {
    const current = this.files.get(filePath)
    if (current) return current
    const revision = `memory-${this.files.size + 1}` as Revision
    const snapshot = { source: defaultSource, revision }
    this.files.set(filePath, snapshot)
    return snapshot
  }

  public setExternalFile(path: string, source: string, revision: Revision): void {
    this.files.set(path, { source, revision })
  }

  public async refreshManifest(path: string): Promise<ManifestRefreshResult> {
    const session = this.flowSessions.get(path) ?? this.taskSessions.get(path)
    if (!session) throw new Error(`Manifest is not open: ${path}`)
    return session.refresh()
  }

  public dispose(): void {
    for (const session of this.flowSessions.values()) session.dispose()
    for (const session of this.taskSessions.values()) session.dispose()
    this.lang$.dispose()
  }

  private throwOpenError(path: string): void {
    if (this.openManifestError && (this.openManifestErrorPath == null || this.openManifestErrorPath == path)) {
      throw this.openManifestError
    }
  }
}

export function createMemoryPackage(props: CreateMemoryPackageProps): {
  readonly context: MemoryPackageMetaContext
  readonly packageMeta: PackageMeta
} {
  const context = new MemoryPackageMetaContext(props.files)
  props.configureContext?.(context)
  const packagePath = `${props.root}/package.oo.yaml` as PackagePath
  const manifest = new WritablePackageManifest(props.packageSource, props.packageRevision)
  const packageMeta = new PackageMeta({
    packagePath,
    searchPath: props.root,
    manifest,
    ctx: context,
  })
  return { context, packageMeta }
}

export function memoryFile(path: ManifestPath, source: string, revision: Revision): MemoryPackageFile {
  return { path, source, revision }
}
