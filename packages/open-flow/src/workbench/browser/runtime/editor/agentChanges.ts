import type { InputPort, ManagedTaskExecutor } from '../../../../flow/common/change.ts'

import { dequal } from 'dequal/lite'
import { compile } from '../../../../form/common/validation/validator.ts'

export class AgentChanges {
  public value: ManagedTaskExecutor
  #saved: ManagedTaskExecutor
  #pending?: ManagedTaskExecutor
  #running?: Promise<boolean>
  readonly #write: (before: ManagedTaskExecutor, value: ManagedTaskExecutor) => Promise<boolean>

  public constructor(value: ManagedTaskExecutor, write: (before: ManagedTaskExecutor, value: ManagedTaskExecutor) => Promise<boolean>) {
    this.value = value
    this.#saved = value
    this.#write = write
  }

  public sync(value: ManagedTaskExecutor): void {
    if (this.#running != null || !dequal(this.value, this.#saved)) return
    this.value = value
    this.#saved = value
  }

  public save(): Promise<boolean> {
    if (this.#running == null && dequal(this.value, this.#saved)) return Promise.resolve(true)
    this.#pending = this.value
    if (this.#running != null) return this.#running
    this.#running = this.#flush().finally(() => {
      this.#running = undefined
    })
    return this.#running
  }

  async #flush(): Promise<boolean> {
    while (this.#pending != null) {
      const value = this.#pending
      this.#pending = undefined
      if (dequal(value, this.#saved)) continue
      if (!(await this.#write(this.#saved, value))) return false
      this.#saved = value
    }
    return true
  }
}

export function agentFixedValuesValid(config: ManagedTaskExecutor, notificationInputs: readonly InputPort[] = []): boolean {
  if (config.kind !== 'agent') return true
  const values = config.tools.flatMap((tool) => tool.inputs.map((port) => ({ port, source: port.source })))
  for (const port of notificationInputs) {
    const source = config.notification?.inputs[port.handle]
    if (source != null) values.push({ port: { ...port, source }, source })
  }
  return values.every(({ port, source }) => {
    if (source.kind !== 'value' || (source.value === null && port.nullable)) return true
    const [validator, error] = compile(port.jsonSchema)
    return error == null && (validator == null || validator(source.value) === true)
  })
}
