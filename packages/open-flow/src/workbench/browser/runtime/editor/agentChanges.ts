import type { InputPort, ManagedTaskExecutor } from '../../../../flow/common/change.ts'

import { compile } from '../../../../form/common/validation/validator.ts'

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
