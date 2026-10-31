import type { I18n } from 'val-i18n'
import type { Tag, TagListItem } from '../../../../control/common/api.ts'
import type { WorkbenchClient } from '../api.ts'
import type { SetNotice } from './workbenchNotice.ts'

import { val } from 'value-enhancer'
import { controlErrorCode } from '../../../../control/common/errors.ts'
import { ApiError } from '../api.ts'
import { errorNotice } from './workbenchNotice.ts'

export class TagCatalog {
  readonly state = val<{ readonly tags: readonly TagListItem[]; readonly loading: boolean; readonly failed: boolean }>({
    tags: [],
    loading: true,
    failed: false,
  })
  #controller?: AbortController
  #stop?: () => void
  #disposed = false

  constructor(
    private readonly client: WorkbenchClient,
    private readonly notice: SetNotice,
    private readonly i18n: I18n,
    private readonly changed: () => Promise<void> = async () => {},
  ) {}

  start(): void {
    if (this.#stop != null || this.#disposed) return
    const subscription = this.client.watchFlowCatalog(() => void this.reload())
    this.#stop = subscription.stop
    void this.reload()
    void subscription.ready.then(() => {
      if (!this.#disposed) void this.reload()
    })
  }

  async reload(): Promise<void> {
    if (this.#disposed) return
    this.#controller?.abort()
    const controller = (this.#controller = new AbortController())
    this.state.set({ ...this.state.value, failed: false })
    try {
      const result = await this.client.listTags(controller.signal)
      if (!controller.signal.aborted) this.state.set({ tags: result.tags, loading: false, failed: false })
    } catch (error) {
      if (!controller.signal.aborted) {
        this.state.set({ ...this.state.value, loading: false, failed: true })
        this.notice(errorNotice(error, this.i18n.t))
      }
    }
  }

  hasName(name: string, exceptTagId?: string): boolean {
    const normalized = name.trim().toLowerCase()
    return this.state.value.tags.some((tag) => tag.tagId != exceptTagId && tag.name.toLowerCase() == normalized)
  }

  async save(name: string, tagId?: string, onConflict?: () => void): Promise<Tag | undefined> {
    return this.mutate(async () => {
      const tag = tagId == null ? await this.client.createTag(name) : await this.client.renameTag(tagId, name)
      await this.changed()
      await this.reload()
      return tag
    }, onConflict)
  }

  async remove(tagId: string): Promise<boolean> {
    return (
      (await this.mutate(async () => {
        await this.client.deleteTag(tagId)
        await this.changed()
        await this.reload()
        return true
      })) ?? false
    )
  }

  private async mutate<Value>(operation: () => Promise<Value>, onConflict?: () => void): Promise<Value | undefined> {
    try {
      const result = await operation()
      return this.#disposed ? undefined : result
    } catch (error) {
      if (this.#disposed) return
      if (onConflict != null && error instanceof ApiError && error.code == controlErrorCode.tagConflict) onConflict()
      else this.notice(errorNotice(error, this.i18n.t))
    }
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#stop?.()
    this.#controller?.abort()
    this.state.dispose()
  }
}
