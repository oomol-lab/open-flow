import type { DisposableStore } from '@wopjs/disposable'
import type { ReadonlyVal } from 'value-enhancer'
import type { Revision } from '../../base/common/revision.ts'
import type { ManifestSource } from './source.ts'

export interface FileManifest {
  revision?: Revision
  readonly error$: ReadonlyVal<Error | undefined>
  readonly dispose: DisposableStore
  updateSource(source: ManifestSource): void
  toJSON(): object
}

/** The unique ID within a workspace. */
export type WSId = string & {
  readonly __PHANTOM_TYPE__: unique symbol
}

/** A Task Block reference stored by a Node. */
export type BlockResourceName = string & {
  readonly __PHANTOM_TYPE__: unique symbol
}

/** The absolute path to a Block descriptor ending in `*.oo.yaml`. */
export type BlockPath = string & {
  readonly __PHANTOM_TYPE__: unique symbol
}

/** The Block directory name. */
export type BlockName = string & {
  readonly __PHANTOM_TYPE__: unique symbol
}

/** The absolute path to a Flow descriptor ending in `flow.oo.yaml`. */
export type FlowPath = string & {
  readonly __PHANTOM_TYPE__: unique symbol
}

/** The Flow directory name. */
export type FlowName = string & {
  readonly __PHANTOM_TYPE__: unique symbol
}

export type SearchPath = string & {
  readonly __PHANTOM_TYPE__: unique symbol
}

export type PackageName = string & {
  readonly __PHANTOM_TYPE__: unique symbol
}

/** The absolute path to a package descriptor ending in `package.oo.yaml`. */
export type PackagePath = string & {
  readonly __PHANTOM_TYPE__: unique symbol
}

export type PackageId = string & {
  readonly __PHANTOM_TYPE__: unique symbol
}

export type FlowLikeName = FlowName | BlockName

export type FlowLikePath = FlowPath | BlockPath

export type FlowLikeType = 'flow'

export type SharedBlockType = 'task'

export type InPackageManifestPath = FlowPath | BlockPath

export type InPackageManifestName = FlowName | BlockName

export type InPackageManifestType = FlowLikeType | SharedBlockType

export type ManifestPath = PackagePath | InPackageManifestPath

export type ManifestType = 'package' | InPackageManifestType
