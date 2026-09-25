import { useSyncExternalStore } from 'react'

type Status = 'loading' | 'loaded' | 'failed'
function createResource(url: string) {
  let status: Status = 'loading'
  let started = false
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener)
      if (!started) {
        started = true
        const finish = (next: Status) => {
          status = next
          for (const notify of listeners) notify()
        }
        if (typeof Image == 'undefined') finish('failed')
        else {
          const image = new Image()
          const settle = (next: Status) => {
            image.removeEventListener('load', loaded)
            image.removeEventListener('error', failed)
            finish(next)
          }
          const loaded = () => settle('loaded')
          const failed = () => settle('failed')
          image.addEventListener('load', loaded, { once: true })
          image.addEventListener('error', failed, { once: true })
          image.referrerPolicy = 'no-referrer'
          image.src = url
        }
      }
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
// Versioned URLs are immutable. Retain failures too, so remounts never retry them.
const resources = new Map<string, ReturnType<typeof createResource>>()
export function spriteResource(url: string) {
  let resource = resources.get(url)
  if (!resource) {
    resource = createResource(url)
    resources.set(url, resource)
  }
  return resource
}
const serverSnapshot = (): Status => 'loading'
export function useSpriteStatus(url: string) {
  const resource = spriteResource(url)
  return useSyncExternalStore(resource.subscribe, resource.getSnapshot, serverSnapshot)
}
