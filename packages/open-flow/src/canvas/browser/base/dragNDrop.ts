const TRANSFER_SHARED_BLOCK_KEY = 'application/oomol-designer/sharedBlock'
const TRANSFER_SCRIPTLET_KEY = 'application/oomol-designer/scriptlet'
const TRANSFER_VALUE_KEY = 'application/oomol-designer/value'
const TRANSFER_CONDITION_KEY = 'application/oomol-designer/condition'
const TRANSFER_COMMENT_KEY = 'application/oomol-designer/comment'
const TRANSFER_TRIGGER_KEY = 'application/oomol-designer/trigger'

export type AddNodeType = 'scriptlet' | 'block' | 'value' | 'condition' | 'comment' | 'connector' | 'llm' | 'trigger' | 'wait'

export const setSharedBlockPath = (dataTransfer: DataTransfer, blockPath: string): void => {
  dataTransfer.setData(TRANSFER_SHARED_BLOCK_KEY, blockPath)
  dataTransfer.effectAllowed = 'copy'
}

export const getSharedBlockPath = (dataTransfer: DataTransfer): string => dataTransfer.getData(TRANSFER_SHARED_BLOCK_KEY)

export const isWithSharedBlockPath = (dataTransfer: DataTransfer): boolean => dataTransfer.types.includes(TRANSFER_SHARED_BLOCK_KEY)

export const setScriptletType = (dataTransfer: DataTransfer, type: string): void => {
  dataTransfer.setData(TRANSFER_SCRIPTLET_KEY, type)
  dataTransfer.effectAllowed = 'move'
}

export const getScriptletType = (dataTransfer: DataTransfer): string => dataTransfer.getData(TRANSFER_SCRIPTLET_KEY)

export const isWithScriptletType = (dataTransfer: DataTransfer): boolean => dataTransfer.types.includes(TRANSFER_SCRIPTLET_KEY)

export const setValueType = (dataTransfer: DataTransfer): void => {
  dataTransfer.setData(TRANSFER_VALUE_KEY, 'value')
  dataTransfer.effectAllowed = 'move'
}

export const isWithValueType = (dataTransfer: DataTransfer): boolean => dataTransfer.types.includes(TRANSFER_VALUE_KEY)

export const setConditionType = (dataTransfer: DataTransfer): void => {
  dataTransfer.setData(TRANSFER_CONDITION_KEY, 'condition')
  dataTransfer.effectAllowed = 'move'
}

export const isWithConditionType = (dataTransfer: DataTransfer): boolean => dataTransfer.types.includes(TRANSFER_CONDITION_KEY)

export const setCommentType = (dataTransfer: DataTransfer): void => {
  dataTransfer.setData(TRANSFER_COMMENT_KEY, 'comment')
  dataTransfer.effectAllowed = 'move'
}

export const isWithCommentType = (dataTransfer: DataTransfer): boolean => dataTransfer.types.includes(TRANSFER_COMMENT_KEY)

export const setTriggerType = (dataTransfer: DataTransfer, identity: string): void => {
  dataTransfer.setData(TRANSFER_TRIGGER_KEY, identity)
  dataTransfer.effectAllowed = 'copy'
}

export const getTriggerType = (dataTransfer: DataTransfer): string => dataTransfer.getData(TRANSFER_TRIGGER_KEY)

export const isWithTriggerType = (dataTransfer: DataTransfer): boolean => dataTransfer.types.includes(TRANSFER_TRIGGER_KEY)

export const isWithDragInfo = (dataTransfer: DataTransfer): boolean =>
  isWithScriptletType(dataTransfer) ||
  isWithSharedBlockPath(dataTransfer) ||
  isWithValueType(dataTransfer) ||
  isWithConditionType(dataTransfer) ||
  isWithCommentType(dataTransfer) ||
  isWithTriggerType(dataTransfer)
