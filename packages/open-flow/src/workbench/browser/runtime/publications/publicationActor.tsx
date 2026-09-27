import type { WorkbenchActor } from '../contract.ts'
import type { ActorStore } from '../stores/actorStore.ts'

import { useEffect, useState } from 'react'

/** Keyed by actor identity so a late response never labels another publisher. */
export function PublicationActor({ actorId, store }: { readonly actorId: string; readonly store: ActorStore }) {
  const [actor, setActor] = useState<WorkbenchActor | null>(null)
  const [imageFailed, setImageFailed] = useState(false)
  useEffect(() => {
    let active = true
    void store.get(actorId).then(
      (value) => {
        if (active) setActor(value)
      },
      () => {
        /* Identity enrichment is optional; keep the recorded actor identity on failure. */
      },
    )
    return () => {
      active = false
    }
  }, [actorId, store])
  const name = actor?.name || actorId
  return (
    <span className="inline-flex min-w-0 items-center gap-1" title={actorId}>
      {actor?.avatarUrl && !imageFailed ? (
        <img className="size-4 shrink-0 rounded-full object-cover" src={actor.avatarUrl} alt="" onError={() => setImageFailed(true)} />
      ) : (
        <span aria-hidden="true" className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-xs">
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="truncate">{name}</span>
    </span>
  )
}
