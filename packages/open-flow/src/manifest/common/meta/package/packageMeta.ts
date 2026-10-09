import type { DisposableStore } from '@wopjs/disposable'
import type { ReadonlyVal } from 'value-enhancer'
import type { BlockResourceName, PackageId, PackageName, PackagePath, SearchPath, SharedBlockType, WSId } from '../../manifestTypes.ts'
import type { WritablePackageManifest } from '../../writable/writablePackageManifest.ts'
import type { SharedBlockMeta } from '../block/shared/sharedBlockMeta.ts'
import type { NodeMeta, ResolveSharedBlockMeta$ } from '../nodeMeta.ts'
import type { FlowsManagerContext } from './flowManager.ts'
import type { ScriptletsManagerContext } from './scriptletManager.ts'
import type { SharedBlocksManagerContext } from './sharedBlockManager.ts'
import type { UserLocalesContext } from './userLocales.ts'

import { disposableStore } from '@wopjs/disposable'
import { compute, derive } from 'value-enhancer'
import { dirname } from '../../../../base/common/posixPath.ts'
import { createWeakMemoizedFunction } from '../../../../base/common/weakMemoize.ts'
import { decodeBlockResourceName } from '../../blockResourceName.ts'
import { WORKSPACE_PACKAGE_NAME } from '../../constants.ts'
import { FlowsManager } from './flowManager.ts'
import { ScriptletsManager } from './scriptletManager.ts'
import { SharedBlocksManager } from './sharedBlockManager.ts'
import { UserLocales } from './userLocales.ts'

export interface PackageMeta$ {
  readonly name: ReadonlyVal<PackageName | undefined>
  readonly icon: ReadonlyVal<string | undefined>
  readonly displayName: ReadonlyVal<string | undefined>
  /** Used for quick-pick search. */
  readonly detail: ReadonlyVal<string | undefined>
  readonly description: ReadonlyVal<string | undefined>
}

export interface PackageMetaProps {
  packagePath: PackagePath
  searchPath: SearchPath
  manifest: WritablePackageManifest
  ctx: PackageMetaContext
}

export interface PackageMetaContext
  extends FlowsManagerContext, SharedBlocksManagerContext, UserLocalesContext, Omit<ScriptletsManagerContext, 'removeFileDir'> {}

export class PackageMeta {
  public readonly dispose: DisposableStore = disposableStore()

  public readonly wsId: WSId

  public readonly packagePath: PackagePath

  public readonly packageDir: string

  public readonly searchPath: SearchPath

  public readonly l10n: UserLocales

  public readonly manifest: WritablePackageManifest

  public readonly $: PackageMeta$

  #flows?: FlowsManager
  public get flows(): FlowsManager {
    return (this.#flows ??= this.#createFlowsManager())
  }

  #scriptlets?: ScriptletsManager
  public get scriptlets(): ScriptletsManager {
    return (this.#scriptlets ??= this.#createScriptletsManager())
  }

  public readonly sharedBlocks: SharedBlocksManager

  /** The persisted block-reference namespace. */
  public readonly packageName: PackageName

  public readonly packageId: PackageId

  #createFlowsManager: () => FlowsManager
  #createScriptletsManager: () => ScriptletsManager

  public constructor({ packagePath, searchPath, manifest, ctx }: PackageMetaProps) {
    this.packagePath = packagePath
    this.packageDir = dirname(this.packagePath)
    this.packageName = WORKSPACE_PACKAGE_NAME
    this.manifest = this.dispose.add(manifest)
    this.searchPath = searchPath
    this.packageId = this.packageName as string as PackageId
    this.wsId = `package/${this.packageId}` as WSId

    this.l10n = this.dispose.add(new UserLocales(this, ctx))

    this.#createFlowsManager = () => this.dispose.add(new FlowsManager(this, ctx, this.resolveSharedBlockMeta$))

    this.#createScriptletsManager = () => this.dispose.add(new ScriptletsManager(ctx))

    this.sharedBlocks = this.dispose.add(new SharedBlocksManager(this, ctx))

    const name = this.dispose.add(manifest.$.name.ref())
    const displayName = this.dispose.add(this.l10n.display$(manifest.$.displayName))
    const detail = this.dispose.add(this.l10n.detail$(manifest.$.displayName, manifest.$.description))
    const description = this.dispose.add(this.l10n.display$(manifest.$.description))
    const icon = this.dispose.add(derive(manifest.$.icon, (iconValue) => ctx.resolveResourceUri(iconValue, packagePath, searchPath)))

    this.$ = {
      name,
      displayName,
      detail,
      description,
      icon,
    }
  }

  /** Cleans up scriptlets after nodes are explicitly removed. */
  public async cleanupRemovedNodes(toRemoveNodes: NodeMeta[]): Promise<void> {
    await this.scriptlets.clearUnusedScriptlets(toRemoveNodes)
  }

  public readonly resolveSharedBlockMeta$ = this.dispose.add(
    createWeakMemoizedFunction(
      (blockResourceName: BlockResourceName, _blockType: SharedBlockType): ReadonlyVal<SharedBlockMeta | undefined> => {
        const { blockName } = decodeBlockResourceName(blockResourceName)
        return compute((get) => get(this.sharedBlocks.taskBlocksByName).get(blockName))
      },
      (blockResourceName, blockType) => `${blockResourceName}|${blockType}`,
    ),
  ) as ResolveSharedBlockMeta$

  public resolveSharedBlockMeta(blockResourceName: BlockResourceName, _blockType: SharedBlockType): SharedBlockMeta | undefined {
    const { blockName } = decodeBlockResourceName(blockResourceName)
    return this.sharedBlocks.taskBlocksByName.get(blockName)
  }

  public toJSON(): object {
    return this.manifest.toJSON()
  }
}
