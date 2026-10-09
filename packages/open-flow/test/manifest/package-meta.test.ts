import type { ResourceUriResolver } from '../../src/base/common/resource.ts'
import type { Revision } from '../../src/base/common/revision.ts'
import type { BlockPath, FlowPath, PackageName, PackagePath, SearchPath } from '../../src/manifest/common/manifestTypes.ts'
import type { PackageMetaContext } from '../../src/manifest/common/meta/package/packageMeta.ts'
import type { ManifestReadResult, ManifestSource } from '../../src/manifest/common/source.ts'
import type { WritableTaskBlockManifest } from '../../src/manifest/common/writable/block/writableTaskBlockManifest.ts'
import type { WritableFlowManifest } from '../../src/manifest/common/writable/writableFlowManifest.ts'

import { val } from 'value-enhancer'
import { describe, expect, it } from 'vitest'
import { PackageMeta } from '../../src/manifest/common/meta/package/packageMeta.ts'
import { WritablePackageManifest } from '../../src/manifest/common/writable/writablePackageManifest.ts'

class TestPackageMetaContext implements PackageMetaContext {
  public readonly lang$ = val('en')
  public readonly resolveResourceUri: ResourceUriResolver = (resourcePath) => resourcePath

  public async listManifestPaths(): Promise<[]> {
    return []
  }

  public async openFlowManifest(_path: FlowPath): Promise<WritableFlowManifest | undefined> {
    return undefined
  }

  public async openTaskManifest(_path: BlockPath): Promise<WritableTaskBlockManifest | undefined> {
    return undefined
  }

  public async readFile(path: string): Promise<ManifestSource | undefined>
  public async readFile(path: string, refRevision: Revision | undefined): Promise<ManifestReadResult>
  public async readFile(_path: string, _refRevision?: Revision): Promise<ManifestReadResult> {
    return undefined
  }

  public async readScriptletSource(): Promise<string | undefined> {
    return undefined
  }

  public async fileDirExists(): Promise<boolean> {
    return false
  }

  public async removeFileDir(): Promise<void> {}

  public async copyFileDir(): Promise<string> {
    throw new Error('Not used by the package meta smoke test.')
  }

  public async renameFileDir(): Promise<string> {
    throw new Error('Not used by the package meta smoke test.')
  }

  public async writeScriptletFile(): Promise<string> {
    throw new Error('Not used by the package meta smoke test.')
  }

  public async duplicateScriptletFile(): Promise<string> {
    throw new Error('Not used by the package meta smoke test.')
  }

  public async createFile(_filePath: string, source: string): Promise<ManifestSource> {
    return { source, revision: 'test-created' as Revision }
  }

  public async ensureFile(_filePath: string, defaultSource: string): Promise<ManifestSource> {
    return { source: defaultSource, revision: 'test-created' as Revision }
  }
}

describe('package meta', () => {
  it('normalizes an empty optional descriptor', () => {
    const manifest = new WritablePackageManifest('')

    try {
      expect(manifest.toJSON()).toEqual({})
    } finally {
      manifest.dispose()
    }
  })

  it('mutates an empty descriptor without dropping its comment', async () => {
    const manifest = new WritablePackageManifest('# Project metadata.\n')

    try {
      manifest.$$.name.set('local-package' as PackageName)
      await Promise.resolve()

      expect(manifest._toSaveFileString()).toBe('# Project metadata.\n\nname: local-package\n')
    } finally {
      manifest.dispose()
    }
  })

  it('constructs the writable package model from local metadata', () => {
    const source = 'name: local-package\ndisplayName: Local package\n'
    const revision = 'package-revision-1' as Revision
    const manifest = new WritablePackageManifest(source, revision)
    const context = new TestPackageMetaContext()
    const packageMeta = new PackageMeta({
      packagePath: '/workspace/package.oo.yaml' as PackagePath,
      searchPath: '/workspace' as SearchPath,
      manifest,
      ctx: context,
    })

    try {
      expect(packageMeta.packageId).toBe('self')
      expect(packageMeta.$.name.value).toBe('local-package')
      expect(packageMeta.$.displayName.value).toBe('Local package')
      expect(packageMeta.sharedBlocks.sharedBlocksByPath.size).toBe(0)
    } finally {
      packageMeta.dispose()
      context.lang$.dispose()
    }
  })
})
