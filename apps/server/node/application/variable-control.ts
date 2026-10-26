import type { Variable, VariableListItem } from '@oomol-lab/open-flow/control-api'
import type { Store } from '../storage/store.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { ControlError } from '../error.ts'
import { variable, variableListItem } from './control-views.ts'

export class VariableControl {
  constructor(private readonly store: Pick<Store, 'variables' | 'resourceReferences'>) {}

  listVariables(actorId: string): { readonly variables: readonly VariableListItem[]; readonly version: 1 } {
    return {
      variables: this.store.variables.list(actorId).map(variableListItem),
      version: 1,
    }
  }

  getVariableReferences(actorId: string, name: string) {
    this.getVariable(actorId, name)
    return this.store.resourceReferences.variableReferences(actorId, name)
  }

  getVariable(actorId: string, name: string): Variable {
    const stored = this.store.variables.get(actorId, name)
    if (stored == null) throw new ControlError(controlErrorCode.variableNotFound, 'The variable was not found.')
    return variable(stored)
  }

  putVariable(actorId: string, name: string, value: string): Variable {
    const saved = this.store.variables.put(actorId, name, value)
    if (saved.kind == 'limit-reached') {
      throw new ControlError(controlErrorCode.variableLimitReached, 'The account has reached its variable limit.')
    }
    return variable(saved.variable)
  }

  deleteVariable(actorId: string, name: string): void {
    if (!this.store.variables.delete(actorId, name)) throw new ControlError(controlErrorCode.variableNotFound, 'The variable was not found.')
  }
}
