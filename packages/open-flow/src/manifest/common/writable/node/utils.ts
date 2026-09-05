import type { HandleInputFrom, InputHandleDef, OutputHandleDef } from '../../../../schema/index.ts'
import type { YamlParent } from '../../yaml.ts'

import { isEqual } from 'radash'
import { parseBoolean, parseNumber, parseString } from '../../../../base/common/parse.ts'
import { parseInputsDef, parseOutputsDef } from '../../model/block/base/parse.ts'
import { parseHandleInputsFrom } from '../../model/handle/parse.ts'
import { parseProgressWeight } from '../../model/node/parse.ts'
import { bindWritableValGroup } from '../../writableFileManifest.ts'
import { writeMultilineStringYamlScalar } from '../../yaml.ts'

interface WritableNodeValGroupConfig {
  title: string
  description: string
  icon: string
  inputs_from: readonly HandleInputFrom[]
  ignore: boolean
  inputs_def: InputHandleDef[]
  outputs_def: OutputHandleDef[]
}

export const bindWritableNodeValGroup = (yamlParent: YamlParent): ReturnType<typeof bindWritableValGroup<WritableNodeValGroupConfig>> =>
  bindWritableValGroup(yamlParent, {
    title: parseString,
    description: {
      parser: parseString,
      writeYamlValue: writeMultilineStringYamlScalar,
    },
    icon: parseString,
    inputs_from: { parser: parseHandleInputsFrom, config: { equal: isEqual } },
    ignore: parseBoolean,
    inputs_def: { parser: parseInputsDef, config: { equal: isEqual } },
    outputs_def: { parser: parseOutputsDef, config: { equal: isEqual } },
  })

interface WritableProgressNodeValGroupConfig {
  progress_weight: number | undefined
}

export const bindWritableProgressNodeValGroup = (yamlParent: YamlParent): ReturnType<typeof bindWritableValGroup<WritableProgressNodeValGroupConfig>> =>
  bindWritableValGroup(yamlParent, {
    progress_weight: parseProgressWeight,
  })

interface WritableScheduledNodeValGroupConfig {
  timeout: number
}

export const bindWritableScheduledNodeValGroup = (yamlParent: YamlParent): ReturnType<typeof bindWritableValGroup<WritableScheduledNodeValGroupConfig>> =>
  bindWritableValGroup(yamlParent, {
    timeout: parseNumber,
  })
