import type { Revision } from '../../base/common/revision.ts'

export interface ManifestSource {
  readonly source: string
  readonly revision: Revision
}

export type PackageManifestKind = 'flow' | 'task'

export type UnchangedManifestSource = 'unchanged'

export type ManifestReadResult = ManifestSource | UnchangedManifestSource | undefined

export const unchangedManifestSource: UnchangedManifestSource = 'unchanged'
