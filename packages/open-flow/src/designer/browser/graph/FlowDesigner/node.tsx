import type { ReactNode } from 'react'
import type { Val } from 'value-enhancer'
import type {
  ConditionExpression,
  ConditionHandleDef,
  DefaultConditionHandleDef,
  GroupDividerDef,
  HandleInputFrom,
  HandleName,
  InputHandleDef,
  NodeId,
  OutputHandleDef,
  TriggerDescriptor,
  ValueHandleDef,
} from '../../../../schema/index.ts'
import type { CreateSchemaEditorFn } from '../../services/designerService.ts'
import type { DesignerUIStore } from '../../stores/designer/designerUI.store.ts'
import type { FlowDesignerStore } from '../../stores/designer/flowDesigner.store.ts'
import type { NodeStatus } from '../../stores/node/constants.ts'
import type { NodeStore } from '../../stores/node/node.store.ts'
import type { InlineTask } from '../../stores/node/taskNode.store.ts'
import type {
  FlowDesignerViewCommentNode,
  FlowDesignerViewConditionChange,
  FlowDesignerViewConditionNode,
  FlowDesignerViewConditionOperator,
  FlowDesignerViewInput,
  FlowDesignerViewNode,
  FlowDesignerViewOutput,
  FlowDesignerViewPosition,
  FlowDesignerViewSemanticNode,
  FlowDesignerViewTriggerPresentation,
  FlowDesignerViewValueNode,
  ViewCallbacks,
} from './model.ts'

import { attachSetter, combine, derive, val } from 'value-enhancer'
import { equalConfig } from '../../base/trivial.ts'
import { MarkdownPreview } from '../../preview/markdownPreview.tsx'
import { CommentNodeStore } from '../../stores/node/commentNode.store.ts'
import { ConditionNodeStore } from '../../stores/node/conditionNode.store.ts'
import { isHandleDef, NODE_STATUS } from '../../stores/node/constants.ts'
import { ConditionsSectionStore } from '../../stores/node/nodeSection/conditionsSection.store.ts'
import { InputSectionStore } from '../../stores/node/nodeSection/inputSection.store.ts'
import { OutputSectionStore } from '../../stores/node/nodeSection/outputSection.store.ts'
import { ValueSectionStore } from '../../stores/node/nodeSection/valueSection.store.ts'
import { SubflowNodeStore } from '../../stores/node/subflowNode.store.ts'
import { TaskNodeStore } from '../../stores/node/taskNode.store.ts'
import { TriggerNodeStore } from '../../stores/node/triggerNode.store.ts'
import { ValueNodeStore } from '../../stores/node/valueNode.store.ts'

interface NodeValues {
  conditionCases?: Val<ConditionHandleDef[]>
  defaultCondition?: Val<DefaultConditionHandleDef | undefined>
  readonly concurrency: Val<number | undefined>
  readonly description: Val<string | undefined>
  readonly diagnostics: Val<boolean>
  readonly executorName: Val<string | undefined>
  readonly icon: Val<string | undefined>
  readonly inputDefs: Val<(InputHandleDef | GroupDividerDef)[]>
  readonly additionalInputDefs: Val<InputHandleDef[] | undefined>
  readonly inputsFrom: Val<readonly HandleInputFrom[] | undefined>
  notice?: Val<Extract<FlowDesignerViewNode, { readonly kind: 'wait' }>['notice']>
  readonly outputDefs: Val<(OutputHandleDef | GroupDividerDef)[]>
  readonly outputsTo: Val<HandleName[]>
  readonly progress: Val<number | undefined>
  readonly rawIcon: Val<string | undefined>
  readonly rawTitle: Val<string | undefined>
  readonly reference: Val<string | undefined>
  readonly status: Val<NodeStatus>
  readonly successCount: Val<number | undefined>
  readonly timeout: Val<number | undefined>
  readonly title: Val<string>
  applyingModel?: boolean
  triggerPresentation?: Val<FlowDesignerViewTriggerPresentation | undefined>
  valueDefs?: Val<ValueHandleDef[] | undefined>
}

interface SemanticNodeEntry {
  readonly contentKey: string
  readonly editable: boolean
  readonly kind: Exclude<FlowDesignerViewNode['kind'], 'comment'>
  readonly store: NodeStore
  readonly values: NodeValues
}

interface CommentNodeEntry {
  readonly contentKey: string
  readonly kind: 'comment'
  readonly setTitle: (title: string | undefined) => void
  readonly store: CommentNodeStore
}

export type NodeEntry = CommentNodeEntry | SemanticNodeEntry

export function connectedOutputs(nodes: readonly FlowDesignerViewNode[]): ReadonlyMap<string, ReadonlySet<HandleName>> {
  const result = new Map<string, Set<HandleName>>()
  for (const node of nodes) {
    if (node.kind == 'comment') continue
    for (const input of node.inputs) {
      if (!('handle' in input)) continue
      for (const source of input.sources ?? []) {
        const handles = result.get(source.nodeId) ?? new Set<HandleName>()
        handles.add(source.output as HandleName)
        result.set(source.nodeId, handles)
      }
    }
  }
  return result
}

function inputDefs(node: FlowDesignerViewNode): (InputHandleDef | GroupDividerDef)[] {
  if (node.kind == 'comment') return []
  const additional = new Set(node.kind == 'task' ? node.additionalInputs?.map((input) => input.handle) : [])
  return node.inputs.filter((input) => 'group' in input || !additional.has(input.handle)).map(inputDef)
}

function additionalInputDefs(node: FlowDesignerViewSemanticNode): InputHandleDef[] {
  return node.kind == 'task'
    ? (node.additionalInputs ?? []).map((input) => ({
        handle: input.handle as HandleName,
        description: input.description,
        json_schema: input.jsonSchema,
        nullable: input.nullable,
        value: input.defaultValue,
      }))
    : []
}

function inputDef(input: FlowDesignerViewInput): InputHandleDef
function inputDef(input: FlowDesignerViewInput | GroupDividerDef): InputHandleDef | GroupDividerDef
function inputDef(input: FlowDesignerViewInput | GroupDividerDef): InputHandleDef | GroupDividerDef {
  return 'group' in input
    ? input
    : {
        handle: input.handle as HandleName,
        description: input.description,
        json_schema: input.jsonSchema,
        nullable: input.nullable,
        value: input.defaultValue,
      }
}

function inputsFrom(node: FlowDesignerViewNode): HandleInputFrom[] {
  if (node.kind == 'comment') return []
  return node.inputs.flatMap((input) => {
    if (!('handle' in input)) return []
    const fromNode = input.sources?.map((source) => ({
      node_id: source.nodeId as NodeId,
      output_handle: source.output as HandleName,
    }))
    if (input.value === undefined && fromNode?.length == null) return []
    return [
      {
        handle: input.handle as HandleName,
        ...(input.value === undefined ? {} : { value: input.value }),
        ...(fromNode?.length ? { from_node: fromNode } : {}),
      },
    ]
  })
}

function outputDefs(node: FlowDesignerViewNode): (OutputHandleDef | GroupDividerDef)[] {
  if (node.kind == 'comment') return []
  return node.outputs.map((output) =>
    'group' in output
      ? output
      : {
          handle: output.handle as HandleName,
          description: output.description,
          json_schema: output.jsonSchema,
          nullable: output.nullable,
        },
  )
}

function taskInputs(defs: readonly (InputHandleDef | GroupDividerDef)[]): (FlowDesignerViewInput | GroupDividerDef)[] {
  const inputs: (FlowDesignerViewInput | GroupDividerDef)[] = []
  for (const input of defs) {
    if (!isHandleDef(input)) {
      inputs.push(input)
      continue
    }
    inputs.push({
      ...(Object.hasOwn(input, 'value') ? { defaultValue: input.value } : {}),
      description: input.description,
      handle: input.handle,
      jsonSchema: input.json_schema,
      nullable: input.nullable,
    })
  }
  return inputs
}

function taskAdditionalInputs(defs: readonly InputHandleDef[]): FlowDesignerViewInput[] {
  return defs.map((input) => ({
    ...(Object.hasOwn(input, 'value') ? { defaultValue: input.value } : {}),
    description: input.description,
    handle: input.handle,
    jsonSchema: input.json_schema,
    nullable: input.nullable,
  }))
}

function taskOutputs(defs: readonly (OutputHandleDef | GroupDividerDef)[]): (FlowDesignerViewOutput | GroupDividerDef)[] {
  const outputs: (FlowDesignerViewOutput | GroupDividerDef)[] = []
  for (const output of defs) {
    if (!isHandleDef(output)) {
      outputs.push(output)
      continue
    }
    outputs.push({
      description: output.description,
      handle: output.handle,
      jsonSchema: output.json_schema,
      nullable: output.nullable,
    })
  }
  return outputs
}

function conditionCases(node: FlowDesignerViewConditionNode): ConditionHandleDef[] {
  return node.cases.map((item) => ({
    handle: item.output as HandleName,
    logical: item.relation == 'all' ? 'AND' : 'OR',
    expressions: item.expressions.map(
      (expression): ConditionExpression => ({
        input_handle: expression.input as HandleName,
        operator: expression.operator,
        value: expression.value,
      }),
    ),
  }))
}

function conditionChange(values: NodeValues): FlowDesignerViewConditionChange {
  const input = values.inputDefs.value.find(isHandleDef)
  if (input == null) throw new Error('Condition input is missing.')
  return {
    cases: values.conditionCases!.value.map((item) => ({
      expressions: (item.expressions ?? []).map((expression) =>
        Object.assign(
          {
            input: expression.input_handle,
            operator: expression.operator as FlowDesignerViewConditionOperator,
          },
          Object.hasOwn(expression, 'value') ? { value: expression.value } : {},
        ),
      ),
      output: item.handle,
      relation: item.logical == 'OR' ? 'any' : 'all',
    })),
    ...(values.defaultCondition!.value == null ? {} : { defaultOutput: values.defaultCondition!.value.handle }),
    input: Object.assign(
      {
        description: input.description,
        handle: input.handle,
        jsonSchema: input.json_schema,
        nullable: input.nullable,
      },
      'value' in input ? { defaultValue: input.value } : {},
    ),
  }
}

function valueDefs(node: FlowDesignerViewValueNode): ValueHandleDef[] {
  return node.values.map((item) => ({
    handle: item.handle as HandleName,
    description: item.description,
    json_schema: item.jsonSchema,
    nullable: item.nullable,
    value: item.value,
  }))
}

function createDiagnosticSection(diagnostics: Val<boolean>) {
  const uiState = val<undefined>()
  return {
    type: 'view-diagnostics',
    hasError$: diagnostics,
    uiState$: uiState,
    dispose: () => {
      diagnostics.dispose()
      uiState.dispose()
    },
  }
}

export function createCommentNodeEntry(
  node: FlowDesignerViewCommentNode,
  contentKey: string,
  designerUIStore: DesignerUIStore,
  designerStore: FlowDesignerStore,
  callbacks: ViewCallbacks,
): CommentNodeEntry {
  designerUIStore.setCommentNodeUIData(node.id as NodeId, {
    content: node.content,
    contentWidth: 350,
    rfNode: { position: node.position },
    title: node.title,
  })
  const dark = val(false)
  const preview = val<ReactNode>()
  const store = new CommentNodeStore(node.id as NodeId, {
    lang: val('en'),
    designerUIStore,
    duplicateNode: (offset) => designerStore.onDuplicate?.([node.id as NodeId], offset),
    mountCodeEditor: (container, content$) => {
      const editor = document.createElement('textarea')
      editor.className = 'nodrag nowheel'
      editor.value = content$.value ?? ''
      Object.assign(editor.style, {
        background: 'transparent',
        border: '0',
        boxSizing: 'border-box',
        color: 'inherit',
        font: 'inherit',
        minHeight: '120px',
        outline: 'none',
        padding: '12px',
        resize: 'vertical',
        width: '100%',
      })
      const input = () => content$.set(editor.value)
      const save = () =>
        callbacks.onChangeComment?.(node.id, {
          content: content$.value ?? '',
          title: store.$$.title.value ?? 'Comment',
        })
      editor.addEventListener('input', input)
      editor.addEventListener('blur', save)
      container.append(editor)
      editor.focus()
      return () => {
        editor.removeEventListener('input', input)
        editor.removeEventListener('blur', save)
        editor.remove()
      }
    },
    preview,
  })
  const setTitle = store.$$.title.set
  attachSetter(store.$$.title, (title) => {
    const previous = store.$$.title.value
    setTitle(title)
    if (store.$$.title.value === previous) return
    callbacks.onChangeComment?.(node.id, {
      content: store.$$.content.value ?? '',
      title: title ?? 'Comment',
    })
  })
  const entry: CommentNodeEntry = {
    contentKey,
    kind: 'comment',
    setTitle,
    store,
  }
  const renderPreview = (content = '') => preview.set(<MarkdownPreview content={content} dark$={dark} draggable onDoubleClick={store.togglePreview} />)
  renderPreview(node.content)
  store.dispose.add(store.$.content.reaction(renderPreview))
  store.dispose.add([dark, preview])
  return entry
}

export function updateCommentNodeEntry(entry: CommentNodeEntry, node: FlowDesignerViewCommentNode, contentKey: string): CommentNodeEntry {
  entry.store.$$.content.set(node.content)
  entry.setTitle(node.title)
  return { ...entry, contentKey }
}

export function createNodeEntry(
  node: FlowDesignerViewSemanticNode,
  connected: readonly HandleName[],
  contentKey: string,
  designerUIStore: DesignerUIStore,
  designerStore: FlowDesignerStore,
  callbacks: ViewCallbacks,
  createSchemaEditor: CreateSchemaEditorFn,
): SemanticNodeEntry {
  const nodeInputsFrom = inputsFrom(node)
  const variablePrefix = `${node.id}\0`
  const boundHandles = derive(designerStore.$.variableInputs, (inputs) => {
    const handles = new Set<HandleName>()
    for (const [key, input] of inputs) {
      if (key.startsWith(variablePrefix) && input.name != null) handles.add(key.slice(variablePrefix.length) as HandleName)
    }
    return handles
  })
  const values: NodeValues = {
    additionalInputDefs: val<InputHandleDef[] | undefined>(additionalInputDefs(node), equalConfig),
    concurrency: val(node.concurrency),
    description: val(node.description),
    diagnostics: val((node.diagnostics ?? 0) > 0),
    executorName: val(node.kind == 'task' ? node.executorName : undefined),
    icon: val(node.icon),
    inputDefs: val(inputDefs(node), equalConfig),
    inputsFrom: val<readonly HandleInputFrom[] | undefined>(nodeInputsFrom, equalConfig),
    outputDefs: val(outputDefs(node), equalConfig),
    outputsTo: val([...connected], equalConfig),
    progress: val(node.run?.progress),
    rawIcon: val(node.rawIcon),
    rawTitle: val(node.rawTitle),
    reference: val(node.kind == 'task' || node.kind == 'subflow' ? node.reference : undefined),
    status: val<NodeStatus>(node.run?.status ?? NODE_STATUS.Idle),
    successCount: val(node.run?.successCount),
    timeout: val(node.timeoutSeconds),
    title: val(node.title),
  }
  const showSettings = val()
  let inputRole: 'author' | 'guest' | 'user' = 'guest'
  if (designerStore.$.editable.value) inputRole = node.kind == 'task' && node.editablePorts ? 'author' : 'user'
  const inputSection = new InputSectionStore({
    role: inputRole,
    lang: designerStore.lang$,
    boundHandles,
    handleInputsFrom: values.inputsFrom,
    inputHandleDefs: values.inputDefs,
    additionalInputs: node.kind == 'task' && node.editableAdditionalInputs ? val(true) : undefined,
    additionalInputDefs: node.kind == 'task' && node.editableAdditionalInputs ? values.additionalInputDefs : undefined,
    showSettings,
    createSchemaEditor,
  })
  inputSection.dispose.add(boundHandles)
  let previousInputValues = new Map(nodeInputsFrom.flatMap((input) => (Object.hasOwn(input, 'value') ? [[input.handle, input.value] as const] : [])))
  inputSection.dispose.add(
    values.inputsFrom.reaction((inputs) => {
      const inputValues = new Map((inputs ?? []).flatMap((input) => (Object.hasOwn(input, 'value') ? [[input.handle, input.value] as const] : [])))
      if (!values.applyingModel && designerStore.$.editable.value) {
        for (const handle of new Set([...previousInputValues.keys(), ...inputValues.keys()])) {
          if (previousInputValues.has(handle) == inputValues.has(handle) && Object.is(previousInputValues.get(handle), inputValues.get(handle))) continue
          callbacks.onChangeInput?.(node.id, handle, inputValues.get(handle))
        }
      }
      previousInputValues = inputValues
    }, true),
  )
  const diagnosticSection = createDiagnosticSection(values.diagnostics)
  const duplicateNode = (offset?: FlowDesignerViewPosition) => designerStore.onDuplicate?.([node.id as NodeId], offset)
  const edit = <T,>(source: Val<T>, onChange: (value: T) => void): Val<T> =>
    attachSetter(
      derive(source, (value) => value),
      (value) => {
        const previous = source.value
        source.set(value)
        if (source.value !== previous && designerStore.$.editable.value) onChange(value)
      },
    )
  const manifest$ = {
    description: edit(values.description, (description) => callbacks.onChangeNodeDescription?.(node.id, description)),
    icon: edit(values.rawIcon, (icon) => callbacks.onChangeNodeIcon?.(node.id, icon)),
    title: edit(values.rawTitle, (title) => callbacks.onChangeNodeTitle?.(node.id, title)),
  }
  const changeDescription = callbacks.onChangeNodeDescription == null ? undefined : manifest$.description.set
  const commonDisplay = {
    icon: values.icon,
    title: values.title,
    description: values.description,
    timeout: values.timeout,
    concurrency: values.concurrency,
    progressWeight: val<number | undefined>(),
    status: values.status,
    progress: values.progress,
    successCount: values.successCount,
    showSettings,
    inputs_def: combine([values.inputDefs, values.additionalInputDefs], ([inputs, additionalInputs]) =>
      additionalInputs == null ? inputs : [...inputs, ...additionalInputs],
    ),
    outputs_def: values.outputDefs,
    inputs_from: values.inputsFrom,
    ignore: val<boolean | undefined>(),
  }

  let store: NodeStore
  switch (node.kind) {
    case 'condition': {
      values.conditionCases = val(conditionCases(node), equalConfig)
      values.defaultCondition = val(node.defaultOutput == null ? undefined : { handle: node.defaultOutput as HandleName }, equalConfig)
      const conditionInputs = derive(values.inputDefs, (defs) => defs.filter(isHandleDef))
      const conditionsSection = new ConditionsSectionStore({
        role: designerStore.$.editable.value ? 'author' : 'guest',
        lang: designerStore.lang$,
        handleOutputsTo: values.outputsTo,
        inputHandleDefs: conditionInputs,
        conditionHandleDefs: values.conditionCases,
        defaultConditionHandleDef: values.defaultCondition,
        showSettings,
      })
      const notifyChange = () => {
        if (values.applyingModel || !designerStore.$.editable.value) return
        callbacks.onChangeCondition?.(node.id, conditionChange(values))
      }
      store = new ConditionNodeStore(node.id as NodeId, {
        changeDescription,
        display$: {
          ...commonDisplay,
          sections: val([inputSection, conditionsSection, diagnosticSection]),
        },
        designerUIStore,
        duplicateNode,
        manifest$,
      })
      store.dispose.add(values.conditionCases.reaction(notifyChange, true))
      store.dispose.add(values.defaultCondition.reaction(notifyChange, true))
      store.dispose.add([values.conditionCases, values.defaultCondition, conditionInputs])
      break
    }
    case 'subflow': {
      const outputSection = new OutputSectionStore({
        role: 'guest',
        lang: designerStore.lang$,
        handleOutputsTo: values.outputsTo,
        outputHandleDefs: values.outputDefs,
        showSettings,
        createSchemaEditor,
      })
      store = new SubflowNodeStore(node.id as NodeId, {
        changeDescription,
        display$: {
          ...commonDisplay,
          sections: val([inputSection, outputSection, diagnosticSection]),
          subflow: values.reference,
        },
        designerUIStore,
        duplicateNode,
        manifest$,
      })
      break
    }
    case 'task': {
      const outputSection = new OutputSectionStore({
        role: designerStore.$.editable.value && node.editablePorts ? 'author' : 'guest',
        lang: designerStore.lang$,
        handleOutputsTo: values.outputsTo,
        outputHandleDefs: values.outputDefs,
        showSettings,
        createSchemaEditor,
      })
      store = new TaskNodeStore(node.id as NodeId, {
        changeDescription,
        display$: {
          ...commonDisplay,
          sections: val([inputSection, outputSection, diagnosticSection]),
          task: values.reference,
          executorName: values.executorName,
        },
        designerUIStore,
        duplicateNode,
        manifest$: {
          ...manifest$,
          task: val<string | InlineTask | undefined>(node.reference),
        },
      })
      if (node.editablePorts) {
        const changePorts = () => {
          if (values.applyingModel || !designerStore.$.editable.value) return
          callbacks.onChangeTaskPorts?.(node.id, taskInputs(values.inputDefs.value), taskOutputs(values.outputDefs.value))
        }
        store.dispose.add(values.inputDefs.reaction(changePorts, true))
        store.dispose.add(values.outputDefs.reaction(changePorts, true))
      }
      if (node.editableAdditionalInputs) {
        store.dispose.add(
          values.additionalInputDefs.reaction((inputs) => {
            if (values.applyingModel || !designerStore.$.editable.value) return
            callbacks.onChangeTaskAdditionalInputs?.(node.id, taskAdditionalInputs(inputs ?? []))
          }, true),
        )
      }
      break
    }
    case 'trigger': {
      inputSection.dispose()
      values.triggerPresentation = val(node.presentation, equalConfig)
      const outputSection = new OutputSectionStore({
        role: 'guest',
        lang: designerStore.lang$,
        handleOutputsTo: values.outputsTo,
        outputHandleDefs: values.outputDefs,
        showSettings,
        createSchemaEditor,
      })
      store = new TriggerNodeStore(node.id as NodeId, {
        changeDescription,
        changeConfig:
          callbacks.onChangeTriggerConfig == null
            ? undefined
            : (name, value) => {
                if (!values.applyingModel && designerStore.$.editable.value) callbacks.onChangeTriggerConfig?.(node.id, name, value)
              },
        changeSchedule:
          callbacks.onChangeTriggerSchedule == null
            ? undefined
            : (schedule) => {
                if (!values.applyingModel && designerStore.$.editable.value) callbacks.onChangeTriggerSchedule?.(node.id, schedule)
              },
        changeWebhook:
          callbacks.onChangeWebhook == null
            ? undefined
            : (webhook) => {
                if (!values.applyingModel && designerStore.$.editable.value) callbacks.onChangeWebhook?.(node.id, webhook)
              },
        display$: {
          ...commonDisplay,
          editable: designerStore.$.editable,
          presentation: values.triggerPresentation,
          sections: val([outputSection, diagnosticSection]),
          trigger: val(undefined),
        },
        designerUIStore,
        manifest$: {
          ...manifest$,
          trigger: val<TriggerDescriptor | undefined>(undefined),
        },
      })
      break
    }
    case 'value': {
      const defs = (values.valueDefs = val<ValueHandleDef[] | undefined>(valueDefs(node), equalConfig))
      const valueSection = new ValueSectionStore({
        role: designerStore.$.editable.value ? 'author' : 'guest',
        lang: designerStore.lang$,
        handleOutputsTo: values.outputsTo,
        valueHandleDefs: defs,
        showSettings,
        createSchemaEditor,
      })
      store = new ValueNodeStore(node.id as NodeId, {
        changeDescription,
        display$: {
          ...commonDisplay,
          sections: val([valueSection, diagnosticSection]),
          inputs_def: defs,
          outputs_def: defs,
        },
        designerUIStore,
        duplicateNode,
        manifest$,
      })
      store.dispose.add(
        valueSection.$.valueHandleDefs.reaction((nextDefs) => {
          if (values.applyingModel || !designerStore.$.editable.value) return
          callbacks.onChangeValue?.(
            node.id,
            (nextDefs ?? []).map((def) =>
              Object.assign(
                {
                  handle: def.handle,
                  description: def.description,
                  jsonSchema: def.json_schema,
                  nullable: def.nullable,
                },
                Object.hasOwn(def, 'value') ? { value: def.value } : {},
              ),
            ),
          )
        }, true),
      )
      store.dispose.add(defs)
      break
    }
    case 'wait': {
      values.notice = val(node.notice, equalConfig)
      const outputSection = new OutputSectionStore({
        role: 'guest',
        lang: designerStore.lang$,
        handleOutputsTo: values.outputsTo,
        outputHandleDefs: values.outputDefs,
        showSettings,
        createSchemaEditor,
      })
      store = new TaskNodeStore(node.id as NodeId, {
        changeDescription,
        display$: {
          ...commonDisplay,
          sections: val([inputSection, outputSection, diagnosticSection]),
          task: val('wait'),
          executorName: val('Wait'),
          notice: values.notice,
        },
        designerUIStore,
        duplicateNode,
        manifest$: { ...manifest$, task: val<string | InlineTask | undefined>() },
      })
      break
    }
  }
  store.dispose.add([manifest$.description, manifest$.icon, manifest$.title, values.outputsTo])
  return {
    contentKey,
    editable: designerStore.$.editable.value,
    kind: node.kind,
    store,
    values,
  }
}

export function updateNodeEntry(
  entry: SemanticNodeEntry,
  node: FlowDesignerViewSemanticNode,
  connected: readonly HandleName[],
  contentKey: string,
): SemanticNodeEntry {
  entry.values.applyingModel = true
  entry.values.description.set(node.description)
  entry.values.diagnostics.set((node.diagnostics ?? 0) > 0)
  entry.values.concurrency.set(node.concurrency)
  entry.values.executorName.set(node.kind == 'task' ? node.executorName : undefined)
  entry.values.icon.set(node.icon)
  entry.values.notice?.set(node.kind == 'wait' ? node.notice : undefined)
  entry.values.rawIcon.set(node.rawIcon)
  entry.values.rawTitle.set(node.rawTitle)
  const nextInputDefs = inputDefs(node)
  const nextAdditionalInputDefs = additionalInputDefs(node)
  const nextOutputDefs = outputDefs(node)
  if (JSON.stringify(entry.values.inputDefs.value) != JSON.stringify(nextInputDefs)) entry.values.inputDefs.set(nextInputDefs)
  if (JSON.stringify(entry.values.additionalInputDefs.value) != JSON.stringify(nextAdditionalInputDefs)) {
    entry.values.additionalInputDefs.set(nextAdditionalInputDefs)
  }
  entry.values.inputsFrom.set(inputsFrom(node))
  if (JSON.stringify(entry.values.outputDefs.value) != JSON.stringify(nextOutputDefs)) entry.values.outputDefs.set(nextOutputDefs)
  entry.values.outputsTo.set([...connected])
  entry.values.progress.set(node.run?.progress)
  entry.values.reference.set(node.kind == 'task' || node.kind == 'subflow' ? node.reference : undefined)
  entry.values.status.set(node.run?.status ?? NODE_STATUS.Idle)
  entry.values.successCount.set(node.run?.successCount)
  entry.values.timeout.set(node.timeoutSeconds)
  entry.values.title.set(node.title)
  if (node.kind == 'condition') {
    entry.values.conditionCases!.set(conditionCases(node))
    entry.values.defaultCondition!.set(node.defaultOutput == null ? undefined : { handle: node.defaultOutput as HandleName })
  }
  if (node.kind == 'value') {
    entry.values.valueDefs!.set(valueDefs(node))
  }
  if (node.kind == 'trigger') entry.values.triggerPresentation!.set(node.presentation)
  entry.values.applyingModel = false
  return { ...entry, contentKey }
}
