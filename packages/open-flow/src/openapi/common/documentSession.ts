import type { JsonValue } from '../../flow/common/change.ts'

import { listOperations } from './openapi.ts'

/** Owned by one mounted panel, never shared across nodes or persisted. */
export class OpenApiDocumentSession {
  #controller?: AbortController
  #request?: Promise<JsonValue>
  #value?: JsonValue
  #url?: string
  constructor(readonly load: (url: string, signal: AbortSignal) => Promise<JsonValue>) {}
  read(url: string, refresh = false): Promise<JsonValue> {
    if (this.#url == url && !refresh) {
      if (this.#value != null) return Promise.resolve(this.#value)
      if (this.#request != null) return this.#request
    }
    this.clear()
    this.#url = url
    const controller = new AbortController()
    this.#controller = controller
    const request = this.load(url, controller.signal)
      .then((value) => {
        if (controller.signal.aborted || this.#controller != controller) throw new Error('Document loading was cancelled.')
        listOperations(value)
        this.#value = value
        return value
      })
      .finally(() => {
        if (this.#controller == controller) this.#request = undefined
      })
    this.#request = request
    return request
  }
  clear(): void {
    this.#controller?.abort()
    this.#controller = undefined
    this.#value = undefined
    this.#request = undefined
    this.#url = undefined
  }
}
