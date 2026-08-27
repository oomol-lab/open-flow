import type { Revision } from '../../src/base/common/revision.ts'
import type { DesignerResourceService } from '../../src/designer/browser/resourceService.ts'
import type { InteractiveMode } from '../../src/designer/browser/stores/designer/designer.store.ts'
import type { DesignerHost, UIFileSaveCandidate, UIFileSaveResult } from '../../src/designer/common/designerHost.ts'
import type { FlowPath, SearchPath } from '../../src/manifest/common/manifestTypes.ts'
import type { CompareResult, CompareSchemaInfo } from '../../src/manifest/common/schemaCompare.ts'
import type { NodeId } from '../../src/schema/index.ts'

import { I18n } from 'val-i18n'
import { val } from 'value-enhancer'
import { reactiveMap } from 'value-enhancer/collections'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserTheme } from '../../src/designer/browser/browserTheme.ts'
import { BrowserDesignerConfirmation } from '../../src/designer/browser/confirmation.ts'
import { BrowserDirtyResourceTracker } from '../../src/designer/browser/dirtyResourceTracker.ts'
import { BrowserDesignerNotification } from '../../src/designer/browser/notification.ts'
import { BrowserResourceNavigation } from '../../src/designer/browser/resourceNavigation.ts'
import { FlowDesignerService } from '../../src/designer/browser/services/flowDesignerService.ts'
import { FlowDesignerStore } from '../../src/designer/browser/stores/designer/flowDesigner.store.ts'
import { ManifestPackageAuthoring } from '../../src/designer/common/manifestPackageAuthoring.ts'
import { createMemoryPackage, memoryFile } from '../support/memory-package-meta.ts'

vi.mock('@wopjs/dom', () => ({
  addEventListener: (target: EventTarget, type: string, listener: EventListener) => {
    target.addEventListener(type, listener)
    return () => target.removeEventListener(type, listener)
  },
  listen: (target: EventTarget, type: string, listener: EventListener) => {
    target.addEventListener(type, listener)
    return () => target.removeEventListener(type, listener)
  },
}))
const root = '/workspace' as SearchPath
const flowPath = `${root}/flows/main/flow.oo.yaml` as FlowPath
const revision = 'designer-revision' as Revision
const flowSource = `title: Main
nodes:
  - node_id: seed
    values:
      - handle: result
        value: 1
`

interface UIFileSource {
  readonly path: string
  readonly source: string | null
  readonly revision: string | undefined
}

class Deferred<T> {
  public readonly promise: Promise<T>
  public resolve: (value: T) => void = () => {}
  public reject: (reason?: unknown) => void = () => {}

  public constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}

class TestDesignerHost implements DesignerHost {
  public readonly writes: UIFileSaveCandidate[] = []
  public writeError: Error | undefined
  private revisionIndex = 0
  private currentUIFile: UIFileSource | undefined

  public constructor(private readonly uiFile: Promise<UIFileSource>) {}

  public async writeUIFile(path: string, candidate: UIFileSaveCandidate): Promise<UIFileSaveResult> {
    this.writes.push(candidate)
    if (this.writeError) {
      const error = this.writeError
      this.writeError = undefined
      throw error
    }
    if (candidate.expectedRevision != this.currentUIFile?.revision) {
      return {
        status: 'conflict',
        snapshot: { source: this.currentUIFile?.source ?? null, revision: this.currentUIFile?.revision },
      }
    }
    const savedRevision = `saved-${++this.revisionIndex}`
    this.currentUIFile = { path, source: candidate.source, revision: savedRevision }
    return { status: 'saved', snapshot: { source: candidate.source, revision: savedRevision } }
  }

  public async locateAndReadUIFile(): Promise<UIFileSource> {
    this.currentUIFile = await this.uiFile
    return this.currentUIFile
  }

  public changeUIFile(source: string): void {
    const path = this.currentUIFile?.path ?? `${flowPath}.ui.json`
    this.currentUIFile = { path, source, revision: `external-${++this.revisionIndex}` }
  }

  public get uiFileSource(): string | null | undefined {
    return this.currentUIFile?.source
  }

  public async compareJSONSchema(_fromSchema: CompareSchemaInfo, _toSchema: CompareSchemaInfo): Promise<CompareResult> {
    return { kind: 'compatible' }
  }
}

interface TestSetup {
  readonly context: ReturnType<typeof createMemoryPackage>['context']
  readonly packageMeta: ReturnType<typeof createMemoryPackage>['packageMeta']
  readonly host: TestDesignerHost
  readonly service: FlowDesignerService
  readonly store: FlowDesignerStore
  readonly theme: BrowserTheme
  readonly dirtyResources: BrowserDirtyResourceTracker
  readonly navigation: BrowserResourceNavigation
  readonly notification: BrowserDesignerNotification
}

async function createTestSetup(uiFile: Promise<UIFileSource>): Promise<TestSetup> {
  const { context, packageMeta } = createMemoryPackage({
    root,
    packageSource: 'name: local-package\n',
    packageRevision: revision,
    files: [memoryFile(flowPath, flowSource, revision)],
  })
  const flowMeta = await packageMeta.flows.refreshFlow(flowPath, true)
  const host = new TestDesignerHost(uiFile)
  const confirmation = new BrowserDesignerConfirmation({ onConfirm: () => true })
  const dirtyResources = new BrowserDirtyResourceTracker()
  const navigation = new BrowserResourceNavigation({ focusedResource: flowPath })
  const notification = new BrowserDesignerNotification()
  const theme = new BrowserTheme({ preferredColorScheme$: val<'auto' | 'dark' | 'light'>('light') })
  const resourceService: DesignerResourceService = {
    resolveStaticResourceUri: (path) => path,
  }
  const service = new FlowDesignerService({
    i18n: new I18n('en', { en: {} }),
    service: host,
    designerStores: reactiveMap(null, { onDeleted: (store) => store.dispose() }),
    confirmation,
    dirtyResources,
    expandScriptletEditor: val(true),
    navigation,
    notification,
    resourceService,
    packageAuthoring: new ManifestPackageAuthoring({ packageMeta }),
    interactiveMode: val<InteractiveMode>('mouse'),
    theme,
    createSchemaEditor: () => () => {},
    createL10nMarkdownEditor: () => () => {},
  })
  const store = service.createFlowDesignerStore(flowMeta)
  return { context, packageMeta, host, service, store, theme, dirtyResources, navigation, notification }
}

function disposeTestSetup(setup: TestSetup): void {
  setup.store.dispose()
  setup.service.dispose()
  setup.dirtyResources.dispose()
  setup.navigation.dispose()
  setup.notification.dispose()
  setup.theme.dispose()
  setup.packageMeta.dispose()
  setup.context.dispose()
}

describe('Flow Designer service readiness', () => {
  const setups: TestSetup[] = []

  beforeEach(() => {
    vi.stubGlobal('cancelIdleCallback', vi.fn())
    vi.stubGlobal('navigator', { platform: '' })
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn(() => 1),
    )
    vi.stubGlobal('window', new EventTarget())
  })

  afterEach(() => {
    setups.splice(0).forEach(disposeTestSetup)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('resolves after UI data is loaded and node stores are migrated', async () => {
    const setup = await createTestSetup(
      Promise.resolve({
        path: `${flowPath}.ui.json`,
        source: JSON.stringify({ nodes: { seed: { rfNode: { position: { x: 20, y: 40 } } } }, viewport: { x: 12, y: 34, zoom: 0.75 } }),
        revision: undefined,
      }),
    )
    setups.push(setup)

    await setup.service.whenReady(setup.store)

    expect([...setup.store.$.nodes.keys()]).toEqual(['seed' as NodeId])
    expect(setup.store.$.nodes.get('seed' as NodeId)?.$.position.value).toEqual({ x: 20, y: 40 })
    expect(setup.store.$.viewport.value).toEqual({ x: 12, y: 34, zoom: 0.75 })
    expect(setup.service.pendingSaveUIFiles.has(flowPath)).toBe(true)
  })

  it('serializes sidecar saves and rejects an external revision change', async () => {
    const path = `${flowPath}.ui.json`
    const setup = await createTestSetup(Promise.resolve({ path, source: null, revision: undefined }))
    setups.push(setup)
    await setup.service.whenReady(setup.store)

    await Promise.all([setup.service.saveUIFile(path, { value: 1 }), setup.service.saveUIFile(path, { value: 2 })])
    expect(setup.host.writes.map((candidate) => candidate.expectedRevision)).toEqual([undefined, 'saved-1'])

    setup.host.changeUIFile('{"external":true}')
    await expect(setup.service.saveUIFile(path, { value: 3 })).rejects.toThrow('changed outside this session')
    await expect(setup.service.saveUIFile(path, { value: 4 })).rejects.toThrow('changed outside this session')
    expect(setup.host.writes).toHaveLength(4)
    expect(setup.host.uiFileSource).toBe('{"external":true}')
  })

  it('retries a sidecar save after a transient host failure', async () => {
    const path = `${flowPath}.ui.json`
    const setup = await createTestSetup(Promise.resolve({ path, source: null, revision: undefined }))
    setups.push(setup)
    await setup.service.whenReady(setup.store)
    const error = new Error('Sidecar write failed.')
    setup.host.writeError = error

    await expect(setup.service.saveUIFile(path, { value: 1 })).rejects.toBe(error)
    await expect(setup.service.saveUIFile(path, { value: 2 })).resolves.toBeUndefined()
    expect(setup.host.writes.map((candidate) => candidate.expectedRevision)).toEqual([undefined, undefined])
    expect(setup.host.uiFileSource).toBe('{\n  "value": 2\n}')
  })

  it('falls back to empty UI data when the sidecar read fails', async () => {
    const error = new Error('Sidecar read failed.')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const setup = await createTestSetup(Promise.reject(error))
    setups.push(setup)

    await setup.service.whenReady(setup.store)

    expect([...setup.store.$.nodes.keys()]).toEqual(['seed' as NodeId])
    expect(setup.service.pendingSaveUIFiles.has(flowPath)).toBe(false)
    expect(consoleError).toHaveBeenCalledWith(`Failed to load Designer UI data for ${flowPath}.`, error)
  })

  it('settles on disposal without applying a late sidecar result', async () => {
    const uiFile = new Deferred<UIFileSource>()
    const setup = await createTestSetup(uiFile.promise)
    setups.push(setup)

    const ready = setup.service.whenReady(setup.store)
    setup.store.dispose()
    await ready
    uiFile.resolve({ path: `${flowPath}.ui.json`, source: null, revision: undefined })
    await uiFile.promise
    await Promise.resolve()

    expect(setup.store.$.nodes.size).toBe(0)
    expect(setup.service.pendingSaveUIFiles.has(flowPath)).toBe(false)
  })
})
