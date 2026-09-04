import type { ReadonlyVal } from 'value-enhancer'
import type { Flow } from './api.ts'
import type { WorkbenchLocation, WorkbenchNavigationOptions, WorkbenchView } from './contract.ts'
import type { WorkbenchStore } from './stores/workbenchStore.ts'

import { val } from 'value-enhancer'

export class NavigationStore {
  readonly #navigate: (location: WorkbenchLocation, options: WorkbenchNavigationOptions) => void
  #location: WorkbenchLocation
  readonly #store: WorkbenchStore
  readonly #view = val<WorkbenchView>('design')
  #change = 0
  #disposed = false
  #ready = false
  #syncing = false
  readonly #stopReactions: (() => void)[] = []

  public readonly $: { readonly view: ReadonlyVal<WorkbenchView> } = { view: this.#view }

  public constructor(store: WorkbenchStore, location: WorkbenchLocation, navigate: (location: WorkbenchLocation, options: WorkbenchNavigationOptions) => void) {
    this.#location = location
    this.#navigate = navigate
    this.#store = store
    this.#view.set(location.view)
  }

  public async start(): Promise<void> {
    const location = this.#location
    const change = ++this.#change
    this.#syncing = true
    this.#stopReactions.push(this.#store.workspace.$.flowId.reaction(this.#sync))
    await this.#store.start(location.flowId)
    if (this.#disposed || change != this.#change) return
    this.#write(location.view, true)
    this.#syncing = false
    this.#ready = true
  }

  public dispose(): void {
    this.#disposed = true
    for (const stop of this.#stopReactions) stop()
    this.#view.dispose()
  }

  public open(view: WorkbenchView): void {
    this.#change += 1
    this.#syncing = false
    this.#write(view, false)
  }

  public async createFlow(name: string, create?: (name: string) => Promise<string>): Promise<boolean> {
    const change = ++this.#change
    this.#syncing = true
    try {
      const created = await this.#store.createFlow(name, create)
      if (created && change == this.#change) this.#write('design', false)
      return created
    } finally {
      if (change == this.#change) this.#syncing = false
    }
  }

  public async createSubflow(name: string): Promise<boolean> {
    const change = ++this.#change
    this.#syncing = true
    try {
      const created = await this.#store.workspace.createResource(name)
      if (created && change == this.#change) this.#write('design', false)
      return created
    } finally {
      if (change == this.#change) this.#syncing = false
    }
  }

  public async selectFlow(flow: Flow): Promise<void> {
    const change = ++this.#change
    this.#syncing = true
    this.#store.runRequests.dismissInputs()
    await this.#store.selectFlow(flow.flowId)
    if (change == this.#change) {
      this.#write('design', false)
      this.#syncing = false
    }
  }

  public openMainFlow(): void {
    if (this.#store.workspace.selectTarget({ kind: 'flow' })) this.#write('design', false)
  }

  public async openFlows(): Promise<void> {
    const change = ++this.#change
    this.#syncing = true
    await this.#store.selectFlow(undefined)
    if (change == this.#change) {
      this.#write('design', false)
      this.#syncing = false
    }
  }

  public async apply(location: WorkbenchLocation): Promise<void> {
    if (sameLocation(location, this.#location)) return
    this.#location = location
    const change = ++this.#change
    this.#syncing = true
    try {
      if (location.flowId != this.#store.workspace.$.flowId.value) await this.#store.selectFlow(location.flowId)
      if (change == this.#change) this.#write(location.view, true)
    } finally {
      if (change == this.#change) {
        this.#syncing = false
        this.#ready = true
      }
    }
  }

  readonly #sync = (): void => {
    if (this.#ready && !this.#syncing) this.#write(this.#view.value, true)
  }

  #write(view: WorkbenchView, replace: boolean): void {
    const flowId = this.#store.workspace.$.flowId.value
    const location: WorkbenchLocation = { flowId, view: flowId == null ? 'design' : view }
    if (!sameLocation(location, this.#location)) {
      this.#location = location
      this.#navigate(location, { replace })
    }
    this.#view.set(location.view)
  }
}

function sameLocation(left: WorkbenchLocation, right: WorkbenchLocation): boolean {
  return left.flowId == right.flowId && left.view == right.view
}
