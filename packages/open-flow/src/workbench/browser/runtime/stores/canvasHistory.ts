import type { GraphTarget } from '../../../../flow/common/change.ts'
import type { FlowChanges } from '../editor/flowChanges.ts'
import type { CanvasPresentationChange } from '../workspace.ts'

import { val } from 'value-enhancer'

export type CanvasAction = 'add' | 'delete' | 'paste' | 'connect' | 'disconnect' | 'move'
export interface CanvasHistoryEntry {
  readonly action: CanvasAction
  readonly count: number
  readonly target: GraphTarget
  readonly forward: FlowChanges
  readonly inverse: FlowChanges
  readonly presentation: CanvasPresentationChange
  readonly beforeSelection: readonly string[]
  readonly afterSelection: readonly string[]
}

export class CanvasHistory {
  readonly state$ = val({
    canUndo: false,
    canRedo: false,
    applying: false,
    failed: false,
    undo: undefined as CanvasHistoryEntry | undefined,
    redo: undefined as CanvasHistoryEntry | undefined,
  })
  readonly #undo: CanvasHistoryEntry[] = []
  readonly #redo: CanvasHistoryEntry[] = []
  generation = 0
  pending = 0
  applying = false
  failed = false

  clear(): boolean {
    const hadHistory = this.#undo.length + this.#redo.length > 0
    this.generation++
    this.#undo.length = 0
    this.#redo.length = 0
    this.publish()
    return hadHistory
  }

  record(entry: CanvasHistoryEntry): boolean {
    this.#redo.length = 0
    this.#undo.push(entry)
    if (this.#bytes([entry]) > 10 * 1024 * 1024) {
      this.clear()
      return false
    }
    while (this.#undo.length > 30 || this.#bytes(this.#undo) > 10 * 1024 * 1024) this.#undo.shift()
    this.publish()
    return true
  }

  complete(redo: boolean): void {
    const source = redo ? this.#redo : this.#undo
    const destination = redo ? this.#undo : this.#redo
    const entry = source.pop()
    if (entry != null) destination.push(entry)
    this.publish()
  }

  publish(): void {
    const available = this.pending == 0 && !this.applying && !this.failed
    this.state$.set({
      canUndo: available && this.#undo.length > 0,
      canRedo: available && this.#redo.length > 0,
      applying: this.applying,
      failed: this.failed,
      undo: this.#undo.at(-1),
      redo: this.#redo.at(-1),
    })
  }

  #bytes(entries: readonly CanvasHistoryEntry[]): number {
    return new TextEncoder().encode(JSON.stringify(entries)).byteLength
  }
}
