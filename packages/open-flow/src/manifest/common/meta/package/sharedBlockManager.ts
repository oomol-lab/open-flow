import type { DisposableStore } from '@wopjs/disposable'
import type { ReactiveMap, ReadonlyReactiveMap } from 'value-enhancer/collections'
import type { ResourceUriResolver } from '../../../../base/common/resource.ts'
import type { BlockName, BlockPath, SharedBlockType } from '../../manifestTypes.ts'
import type { ManifestSource, PackageManifestKind } from '../../source.ts'
import type { WritableSubflowBlockManifest } from '../../writable/block/writableSubflowBlockManifest.ts'
import type { WritableTaskBlockManifest } from '../../writable/block/writableTaskBlockManifest.ts'
import type { SharedBlockMeta } from '../block/shared/sharedBlockMeta.ts'
import type { ResolveSharedBlockMeta$ } from '../nodeMeta.ts'
import type { PackageMeta } from './packageMeta.ts'

import { disposableStore, dispose } from '@wopjs/disposable'
import { reactiveMap } from 'value-enhancer/collections'
import { basename, dirname, isParent, join } from '../../../../base/common/posixPath.ts'
import { SubflowBlockMeta } from '../block/subflowBlockMeta.ts'
import { TaskBlockMeta } from '../block/taskBlockMeta.ts'
import { renameNodeRefSharedBlockResource } from '../flowLike/tools.ts'

interface TaskBlockRefreshCandidate {
  readonly blockMeta: TaskBlockMeta | undefined
  readonly blockPath: BlockPath
  readonly manifest: WritableTaskBlockManifest
}

interface SubflowBlockRefreshCandidate {
  readonly blockMeta: SubflowBlockMeta | undefined
  readonly blockPath: BlockPath
  readonly manifest: WritableSubflowBlockManifest
}

export interface SharedBlocksManagerContext {
  readonly resolveResourceUri: ResourceUriResolver
  listManifestPaths(kind: PackageManifestKind): Promise<readonly string[]>
  openTaskManifest(path: BlockPath): Promise<WritableTaskBlockManifest | undefined>
  openSubflowManifest(path: BlockPath): Promise<WritableSubflowBlockManifest | undefined>
  fileDirExists(fileOrDirPath: string): Promise<boolean>
  removeFileDir(fileOrDirPath: string): Promise<void>
  copyFileDir(srcPath: string, destPath: string): Promise<string>
  renameFileDir(srcPath: string, destPath: string): Promise<string>
  createFile(filePath: string, source: string): Promise<ManifestSource>
}

export class SharedBlocksManager {
  public readonly dispose: DisposableStore = disposableStore()

  public readonly taskBlocksByName: ReadonlyReactiveMap<BlockName, TaskBlockMeta>
  readonly #taskBlocksByName: ReactiveMap<BlockName, TaskBlockMeta>

  public readonly subflowBlocksByName: ReadonlyReactiveMap<BlockName, SubflowBlockMeta>
  readonly #subflowBlocksByName: ReactiveMap<BlockName, SubflowBlockMeta>

  public readonly sharedBlocksByPath: ReadonlyReactiveMap<BlockPath, SharedBlockMeta>
  readonly #sharedBlocksByPath: ReactiveMap<BlockPath, SharedBlockMeta>

  public constructor(
    private readonly packageMeta: PackageMeta,
    private readonly ctx: SharedBlocksManagerContext,
    private readonly resolveSharedBlockMeta$: ResolveSharedBlockMeta$,
  ) {
    this.taskBlocksByName = this.#taskBlocksByName = this.dispose.add(reactiveMap(null, { onDeleted: dispose }))
    this.subflowBlocksByName = this.#subflowBlocksByName = this.dispose.add(reactiveMap(null, { onDeleted: dispose }))
    this.sharedBlocksByPath = this.#sharedBlocksByPath = this.dispose.add(reactiveMap())
  }

  public getTaskBlockPath(blockName: BlockName): BlockPath {
    return join(this.packageMeta.packageDir, 'tasks', blockName, 'task.oo.yaml') as BlockPath
  }

  public getSubflowBlockPath(blockName: BlockName): BlockPath {
    return join(this.packageMeta.packageDir, 'subflows', blockName, 'subflow.oo.yaml') as BlockPath
  }

  public async refreshSharedBlock(blockType: 'task', blockPath: BlockPath): Promise<TaskBlockMeta | undefined>
  public async refreshSharedBlock(blockType: 'subflow', blockPath: BlockPath): Promise<SubflowBlockMeta | undefined>
  public async refreshSharedBlock(blockType: SharedBlockType, blockPath: BlockPath): Promise<SharedBlockMeta | undefined>
  public async refreshSharedBlock(blockType: SharedBlockType, blockPath: BlockPath): Promise<SharedBlockMeta | undefined> {
    switch (blockType) {
      case 'subflow': {
        return this.refreshSubflowBlock(blockPath)
      }
      case 'task':
      default: {
        return this.refreshTaskBlock(blockPath)
      }
    }
  }

  public async refreshTaskBlock(blockPath: BlockPath): Promise<TaskBlockMeta | undefined> {
    const manifest = await this.ctx.openTaskManifest(blockPath)
    if (manifest) return this.#upsertTaskBlockMeta(blockPath, manifest)
  }

  public async refreshSubflowBlock(blockPath: BlockPath): Promise<SubflowBlockMeta | undefined>
  public async refreshSubflowBlock(blockPath: BlockPath): Promise<SubflowBlockMeta | undefined> {
    const manifest = await this.ctx.openSubflowManifest(blockPath)
    if (manifest) return this.#upsertSubflowBlockMeta(blockPath, manifest)
  }

  public async writeNewTaskBlock(blockName: BlockName, yamlContent: string): Promise<TaskBlockMeta> {
    const blockPath = this.getTaskBlockPath(blockName)
    await this.ctx.createFile(blockPath, yamlContent)
    const manifest = await this.ctx.openTaskManifest(blockPath)
    if (!manifest) throw new Error(`Task manifest failed to open after creation: ${blockPath}`)
    return this.#upsertTaskBlockMeta(blockPath, manifest)
  }

  public async writeNewSubflowBlock(blockName: BlockName, yamlContent: string): Promise<SubflowBlockMeta> {
    const blockPath = this.getSubflowBlockPath(blockName)
    await this.ctx.createFile(blockPath, yamlContent)
    const manifest = await this.ctx.openSubflowManifest(blockPath)
    if (!manifest) throw new Error(`Subflow manifest failed to open after creation: ${blockPath}`)
    return this.#upsertSubflowBlockMeta(blockPath, manifest)
  }

  /** Removes a shared block after an explicit authoring action. */
  public async userRemoveSharedBlock(blockMeta: SharedBlockMeta): Promise<void> {
    if (!this.#isInScope(blockMeta.blockPath)) return

    await this.removeSharedBlockMeta(blockMeta)
  }

  /** Removes a shared block as part of an internal rename or conversion. */
  public async removeSharedBlockMeta(blockMeta: SharedBlockMeta): Promise<void> {
    await this.ctx.removeFileDir(blockMeta.blockDir)

    this.onSharedBlockFilesDidRemove(blockMeta)
  }

  public onSharedBlockFilesDidRemove(blockMeta: SharedBlockMeta): void {
    switch (blockMeta.blockType) {
      case 'subflow': {
        this.#subflowBlocksByName.delete(blockMeta.blockName)
        break
      }
      case 'task': {
        this.#taskBlocksByName.delete(blockMeta.blockName)
        break
      }
      default: {
        blockMeta.blockType satisfies never
      }
    }
    this.#sharedBlocksByPath.delete(blockMeta.blockPath)
  }

  public async renameSharedBlock<T extends SharedBlockMeta>(blockMeta: T, newName: BlockName): Promise<T | undefined> {
    if (!this.#isInScope(blockMeta.blockPath)) return

    let newBlockMeta: SharedBlockMeta | undefined

    switch (blockMeta.blockType) {
      case 'subflow': {
        if (this.subflowBlocksByName.has(newName)) {
          return
        }
        const newBlockDir = await this.ctx.renameFileDir(blockMeta.blockDir, join(blockMeta.blockDir, '..', newName))

        const newBlockPath = join(newBlockDir, basename(blockMeta.blockPath)) as BlockPath

        newBlockMeta = await this.refreshSubflowBlock(newBlockPath)

        this.onSharedBlockFilesDidRemove(blockMeta)

        break
      }
      case 'task': {
        if (this.taskBlocksByName.has(newName)) {
          return
        }
        const newBlockDir = await this.ctx.renameFileDir(blockMeta.blockDir, join(blockMeta.blockDir, '..', newName))

        const newBlockPath = join(newBlockDir, basename(blockMeta.blockPath)) as BlockPath

        newBlockMeta = await this.refreshTaskBlock(newBlockPath)

        this.onSharedBlockFilesDidRemove(blockMeta)

        break
      }
      default: {
        blockMeta.blockType satisfies never
      }
    }

    if (!newBlockMeta) return

    const oldBlockResourceName = blockMeta.blockResourceName
    const newBlockResourceName = newBlockMeta.blockResourceName
    renameNodeRefSharedBlockResource(this.packageMeta.flows.flowsByName.values(), oldBlockResourceName, newBlockResourceName)
    renameNodeRefSharedBlockResource(this.packageMeta.sharedBlocks.subflowBlocksByName.values(), oldBlockResourceName, newBlockResourceName)
    await this.removeSharedBlockMeta(blockMeta)

    return newBlockMeta as T
  }

  public async duplicateSharedBlock(blockMeta: SharedBlockMeta, newName: BlockName): Promise<SharedBlockMeta | undefined> {
    if (!this.#isInScope(blockMeta.blockPath)) return

    const newDir = (await this.ctx.copyFileDir(blockMeta.blockDir, join(dirname(blockMeta.blockDir), newName))) as BlockPath
    const newBlockPath = join(newDir, basename(blockMeta.blockPath)) as BlockPath

    let newBlockMeta: SharedBlockMeta | undefined
    switch (blockMeta.blockType) {
      case 'subflow': {
        newBlockMeta = await this.refreshSubflowBlock(newBlockPath)
        break
      }
      case 'task': {
        newBlockMeta = await this.refreshTaskBlock(newBlockPath)
        break
      }
      default: {
        blockMeta.blockType satisfies never
      }
    }
    return newBlockMeta
  }

  public async isBlockNameAvailable(blockName: string): Promise<boolean> {
    if (this.taskBlocksByName.has(blockName as BlockName) || this.subflowBlocksByName.has(blockName as BlockName)) {
      return false
    }

    if (
      (await this.ctx.fileDirExists(join(this.packageMeta.packageDir, 'tasks', blockName))) ||
      (await this.ctx.fileDirExists(join(this.packageMeta.packageDir, 'subflows', blockName)))
    ) {
      return false
    }

    return true
  }

  #refreshId = 0
  public async refreshAll(): Promise<void> {
    const refreshId = (this.#refreshId = (this.#refreshId + 1) | 0)

    const taskCandidates = await this.#listTaskBlocks()
    if (refreshId !== this.#refreshId) return

    const subflowCandidates = await this.#listSubflowBlocks()
    if (refreshId !== this.#refreshId) return

    const taskBlocks = taskCandidates.map((candidate) => {
      if (candidate.blockMeta?.manifest == candidate.manifest) {
        return candidate.blockMeta
      } else {
        return this.#createTaskBlockMeta(candidate.blockPath, candidate.manifest)
      }
    })
    const subflowBlocks = subflowCandidates.map((candidate) => {
      if (candidate.blockMeta?.manifest == candidate.manifest) {
        return candidate.blockMeta
      } else {
        return this.#createSubflowBlockMeta(candidate.blockPath, candidate.manifest)
      }
    })

    this.#taskBlocksByName.replace(taskBlocks.map((taskBlock) => [taskBlock.blockName, taskBlock] as const))
    this.#subflowBlocksByName.replace(subflowBlocks.map((subflowBlock) => [subflowBlock.blockName, subflowBlock] as const))
    this.#sharedBlocksByPath.replace([...taskBlocks, ...subflowBlocks].map((blockMeta) => [blockMeta.blockPath, blockMeta] as const))
  }

  async #listTaskBlocks(): Promise<TaskBlockRefreshCandidate[]> {
    const paths = await this.ctx.listManifestPaths('task')
    return Promise.all(
      paths.map(async (path): Promise<TaskBlockRefreshCandidate> => {
        const taskBlockPath = path as BlockPath
        const blockMeta = TaskBlockMeta.to(this.sharedBlocksByPath.get(taskBlockPath))
        const manifest = await this.ctx.openTaskManifest(taskBlockPath)
        if (!manifest) throw new Error(`Listed Task manifest does not exist: ${taskBlockPath}`)
        return { blockMeta, blockPath: taskBlockPath, manifest }
      }),
    )
  }

  async #listSubflowBlocks(): Promise<SubflowBlockRefreshCandidate[]> {
    const paths = await this.ctx.listManifestPaths('subflow')
    return Promise.all(
      paths.map(async (path): Promise<SubflowBlockRefreshCandidate> => {
        const subflowPath = path as BlockPath
        const blockMeta = SubflowBlockMeta.to(this.sharedBlocksByPath.get(subflowPath))
        const manifest = await this.ctx.openSubflowManifest(subflowPath)
        if (!manifest) throw new Error(`Listed Subflow manifest does not exist: ${subflowPath}`)
        return { blockMeta, blockPath: subflowPath, manifest }
      }),
    )
  }

  #insertTaskBlockMeta(blockPath: BlockPath, manifest: WritableTaskBlockManifest): TaskBlockMeta {
    const taskBlockMeta = this.#createTaskBlockMeta(blockPath, manifest)
    this.#taskBlocksByName.set(taskBlockMeta.blockName, taskBlockMeta)
    this.#sharedBlocksByPath.set(taskBlockMeta.blockPath, taskBlockMeta)
    return taskBlockMeta
  }

  #upsertTaskBlockMeta(blockPath: BlockPath, manifest: WritableTaskBlockManifest): TaskBlockMeta {
    const taskBlockMeta = this.sharedBlocksByPath.get(blockPath)
    if (TaskBlockMeta.is(taskBlockMeta) && taskBlockMeta.manifest == manifest) {
      return taskBlockMeta
    } else {
      return this.#insertTaskBlockMeta(blockPath, manifest)
    }
  }

  #createTaskBlockMeta(blockPath: BlockPath, manifest: WritableTaskBlockManifest): TaskBlockMeta {
    const taskBlockMeta = new TaskBlockMeta(blockPath, this.packageMeta, this.packageMeta.searchPath, manifest, this.ctx.resolveResourceUri)
    return taskBlockMeta
  }

  #insertSubflowBlockMeta(blockPath: BlockPath, manifest: WritableSubflowBlockManifest): SubflowBlockMeta {
    const subflowBlockMeta = this.#createSubflowBlockMeta(blockPath, manifest)
    this.#subflowBlocksByName.set(subflowBlockMeta.blockName, subflowBlockMeta)
    this.#sharedBlocksByPath.set(subflowBlockMeta.blockPath, subflowBlockMeta)
    return subflowBlockMeta
  }

  #upsertSubflowBlockMeta(blockPath: BlockPath, manifest: WritableSubflowBlockManifest): SubflowBlockMeta {
    const subflowBlockMeta = this.sharedBlocksByPath.get(blockPath)
    if (SubflowBlockMeta.is(subflowBlockMeta) && subflowBlockMeta.manifest == manifest) {
      return subflowBlockMeta
    } else {
      return this.#insertSubflowBlockMeta(blockPath, manifest)
    }
  }

  #createSubflowBlockMeta(blockPath: BlockPath, manifest: WritableSubflowBlockManifest): SubflowBlockMeta {
    const subflowBlockMeta = new SubflowBlockMeta(
      blockPath,
      this.packageMeta,
      this.packageMeta.searchPath,
      manifest,
      this.resolveSharedBlockMeta$,
      this.ctx.resolveResourceUri,
    )
    return subflowBlockMeta
  }

  #isInScope(blockPath: BlockPath): boolean {
    if (!isParent(blockPath, this.packageMeta.packageDir)) {
      console.error(new Error(`block path ${blockPath} out of scope: ${this.packageMeta.packageDir}`))
      return false
    }

    return true
  }
}
