import type { InputMapping } from '../../flow/common/model.ts'

/** Never allow credentials to enter a Revision as literal OpenAPI node inputs. */
export function assertOpenApiAuthBindings(inputs: Readonly<Record<string, InputMapping>>): void {
  for (const [handle, mapping] of Object.entries(inputs)) {
    if (handle.startsWith('auth.') && mapping.kind == 'value')
      throw new TypeError('OpenAPI authentication accepts deployment variables and upstream outputs only.')
  }
}
