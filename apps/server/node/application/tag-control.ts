import type { FlowCatalogEvent } from '@oomol-lab/open-flow/control-api'
import type { Store } from '../storage/store.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { resourceNameIssue } from '@oomol-lab/open-flow/flow-change'
import { ControlError } from '../error.ts'

export class TagControl {
  private readonly store: Pick<Store, 'tags'>
  private readonly changed: (event?: FlowCatalogEvent, ownerId?: string) => void

  constructor(store: Pick<Store, 'tags'>, changed: (event?: FlowCatalogEvent, ownerId?: string) => void) {
    this.store = store
    this.changed = changed
  }

  listTags(ownerId: string) {
    return { tags: this.store.tags.list(ownerId), version: 1 as const }
  }

  saveTag(ownerId: string, input: string, tagId?: string) {
    const name = input.trim()
    if (resourceNameIssue(name) != null) throw new ControlError(controlErrorCode.tagInvalid, 'Tag name is invalid.')
    if (tagId != null) this.requireTag(ownerId, tagId)
    const tag = this.store.tags.save(ownerId, name, tagId)
    if (tag == null) throw new ControlError(controlErrorCode.tagConflict, 'A tag with this name already exists.')
    this.changed(undefined, ownerId)
    return tag
  }

  deleteTag(ownerId: string, tagId: string): void {
    this.requireTag(ownerId, tagId)
    this.store.tags.delete(ownerId, tagId)
    this.changed(undefined, ownerId)
  }

  private requireTag(ownerId: string, tagId: string): void {
    if (this.store.tags.get(ownerId, tagId) == null) throw new ControlError(controlErrorCode.tagNotFound, 'The tag was not found.')
  }
}
