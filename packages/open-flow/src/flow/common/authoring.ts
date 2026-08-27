import { customAlphabet } from 'nanoid'

const randomAuthoringId = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 10)

export const createAuthoringId = randomAuthoringId

export { connect, disconnect } from './edgeChanges.ts'
export { imports as moduleImports, rename as renameModule, replaceSource as replaceModuleSource } from './moduleChanges.ts'
export {
  createBuiltinTrigger,
  createCodeTask,
  createCondition,
  createLlmTask,
  createManagedTask,
  createProviderTrigger,
  createValue,
  deleteNodes,
  cleanVariableBindings,
  setConnectorConnection,
  setInputVariable,
  setInputValues,
  setTriggerConnection,
  updateSettings,
  updateTrigger,
} from './nodeChanges.ts'
