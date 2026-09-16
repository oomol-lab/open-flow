import type { DesignerEdge } from '../workspace.ts'
import type { AddNodeOption } from './addNodeOptions.ts'

export interface NodePickerDrag {
  readonly token: string
  readonly option: AddNodeOption
  readonly connection?: (nodeId: string) => Omit<DesignerEdge, 'id'>
}

export class NodePickerDragSession {
  #drag: NodePickerDrag | undefined
  #sequence = 0

  register(option: AddNodeOption, connection?: NodePickerDrag['connection']): string {
    const token = `open-flow-node-drag:${++this.#sequence}`
    this.#drag = { token, option, connection }
    return token
  }

  consume(token: string): NodePickerDrag | undefined {
    const drag = this.#drag?.token == token ? this.#drag : undefined
    if (drag != null) this.#drag = undefined
    return drag
  }

  clear(): void {
    this.#drag = undefined
  }
}
