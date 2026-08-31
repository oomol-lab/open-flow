import styles from './NodeHeadBlockSettings.module.scss'
import type { useStoreApi } from '@xyflow/react'
import type { JSX } from 'react/jsx-runtime'
import type { TFunction } from 'val-i18n'
import type { Val } from 'value-enhancer'
import type { HandleName } from '../../../../../schema/index.ts'
import type { InputHandleDef, OutputHandleDef } from '../../../../../schema/interface.d.ts'
import type { DesignerOption as IBasicOption } from '../../../components/select.tsx'
import type { SubflowNodeStore } from '../../../stores/node/subflowNode.store.ts'
import type { InlineTask, TaskNodeStore } from '../../../stores/node/taskNode.store.ts'

import { clsx } from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { setValue, val } from 'value-enhancer'
import { basename } from '../../../../../base/common/posixPath.ts'
import { NODE_HANDLE_CLASSNAME } from '../../../base/designer.ts'
import { asString, asTrue, toTrue } from '../../../base/trivial.ts'
import { Button } from '../../../components/button.tsx'
import { CssWrapper } from '../../../components/cssWrapper.tsx'
import { HandleNoActions } from '../../../components/handleNoActions.tsx'
import { HandleRow } from '../../../components/handleRow.tsx'
import { Input } from '../../../components/input.tsx'
import { TranslationInput } from '../../../components/input2.tsx'
import { Label } from '../../../components/label.tsx'
import { DesignerCombobox as Select } from '../../../components/select.tsx'
import { LabeledSwitch } from '../../../components/toggleSwitch.tsx'
import { DesignerTooltip } from '../../../components/tooltip.tsx'
import { useConnectorConnections } from '../../../connectorConnection.ts'
import { DesignerIcon } from '../../../icons/DesignerIcon.tsx'
import { useHandleTrack } from '../../../jsonSchema/useHandleTrack.ts'
import { BlockDesignerStore } from '../../../stores/designer/blockDesigner.store.ts'
import { SUBFLOW_VIEW_MODE, SubflowDesignerStore } from '../../../stores/designer/subflowDesigner.store.ts'
import { DESIGNER_TYPE } from '../../../stores/designer/typings.ts'
import { ConditionNodeStore } from '../../../stores/node/conditionNode.store.ts'
import { NodeStore } from '../../../stores/node/node.store.ts'
import { toSubflowNodeStore } from '../../../stores/node/subflowNode.store.ts'
import { toTaskNodeStore } from '../../../stores/node/taskNode.store.ts'
import { useDesignerStore } from '../../DesignerStoreContext.tsx'
import { useOpenIconPicker } from '../../iconPicker.tsx'
import { useSubflowViewMode } from '../../SubflowDesigner/SubflowViewModeContext.ts'
import { useNodeStore } from '../NodeStoreContext.tsx'
import { defaultNodeIcon, defaultSubflowIcon, iconForNodeType } from './constants.ts'
import { InlineSchemaEditor } from './InlineSchemaEditor.tsx'

export interface NodeHeadBlockSettingsProps {
  readonly isFlowDesigner: boolean
  readonly reactFlowStore?: ReturnType<typeof useStoreApi>
  readonly showSettings$?: Val<boolean>
  readonly panelWidth$: Val<number | undefined>
  readonly onDelete?: () => void
}

const MIN_CONFIG_WIDTH = 400

export function NodeHeadBlockSettings(props: NodeHeadBlockSettingsProps): JSX.Element {
  const t = useTranslate()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const handleTrack = useHandleTrack(MIN_CONFIG_WIDTH, props.panelWidth$, containerRef, props.reactFlowStore)

  return (
    <div ref={containerRef} className={styles.wrapper}>
      <header className={`${styles.header} ${NODE_HANDLE_CLASSNAME}`}>
        <h3 className={styles.title}>
          <span>{props.isFlowDesigner ? t('flowEditor.node.configHeader') : t('blockEditor.configHeader')}</span>
          {props.onDelete && (
            <Button wrapperClassName={styles.deleteBtn} onClick={props.onDelete}>
              <i className="i-codicon:trash" />
            </Button>
          )}
        </h3>
        <aside>
          {props.showSettings$ && (
            <Button ariaLabel={t('close')} title={t('close')} onClick={() => setValue(props.showSettings$!, false)}>
              <i className="i-codicon:close" />
            </Button>
          )}
        </aside>
      </header>
      <div className={`nodrag ${styles.content}`}>
        <HandleNoActions>
          <CssWrapper css={{ '--name-factor': 3, '--value-factor': 4 }}>
            <Configs />
          </CssWrapper>
        </HandleNoActions>
      </div>
      <div data-pos="e" className={`${styles.resizeHandle} ${styles.resizeHandleE}`} onPointerDown={handleTrack} />
    </div>
  )
}

function Configs() {
  const t = useTranslate()
  const nodeStore = useNodeStore()
  const taskNodeStore = toTaskNodeStore(nodeStore)
  const designerStore = useDesignerStore()
  const manifestTask = useVal(taskNodeStore?.manifest$?.task)
  const displayTask = useVal(taskNodeStore?.display$.task)
  const task = manifestTask ?? displayTask
  const inlineTask = task !== null && typeof task === 'object' ? task : null
  const subflowNodeStore = toSubflowNodeStore(nodeStore)
  const subflow = useVal(subflowNodeStore?.display$.subflow)
  const showRunningConfig =
    designerStore.designerType !== DESIGNER_TYPE.Block &&
    designerStore.flowNode !== nodeStore &&
    (taskNodeStore != null || subflowNodeStore != null || ConditionNodeStore.is(nodeStore))

  const [metadataExpanded, setMetadataExpanded] = useState(true)
  const [runningExpanded, setRunningExpanded] = useState(true)

  return (
    <>
      <HandleRow
        variant="value-only"
        value={<div className={styles.subtitle}>{t('blockEditor.metadata')}</div>}
        valueExpands
        expanded={metadataExpanded}
        onExpandedChange={setMetadataExpanded}
      />
      {metadataExpanded && <MetadataConfigs />}
      {showRunningConfig && (
        <HandleRow
          variant="value-only"
          value={<div className={styles.subtitle}>{t('blockEditor.runningConfig.title')}</div>}
          valueExpands
          expanded={runningExpanded}
          onExpandedChange={setRunningExpanded}
        />
      )}
      {showRunningConfig && runningExpanded && <RunningConfigs />}
      {taskNodeStore && (inlineTask ? <InlineTaskConfigs {...inlineTask} /> : taskNodeStore.openBlockDesigner && <TaskConfigs task={task as string | null} />)}
      {subflowNodeStore?.openBlockDesigner && <SubflowConfigs subflow={subflow} subflowNodeStore={subflowNodeStore} />}
    </>
  )
}

function SubflowConfigs(props: { readonly subflow: string | undefined; readonly subflowNodeStore: SubflowNodeStore }) {
  const t = useTranslate()
  const designerStore = useDesignerStore()
  const [expanded, setExpanded] = useState(true)

  // Do not show shared block information while editing the subflow block itself.
  if (props.subflowNodeStore === designerStore.flowNode) {
    return null
  }

  return (
    <>
      <HandleRow
        variant="value-only"
        value={<div className={styles.subtitle}>{t('blockEditor.taskHeader')}</div>}
        valueExpands
        expanded={expanded}
        onExpandedChange={setExpanded}
      />
      {expanded && (
        <>
          <HandleRow
            level=" "
            isLast
            name={
              <Label className={styles.label} tooltipClassName={styles.labelTooltip} title="subflow">
                {t('blockEditor.task')}
              </Label>
            }
            value={
              <Button
                className={styles.link}
                wrapperClassName={styles.linkWrapper}
                prefix={<i className={clsx(defaultSubflowIcon, 'text-[1rem]')} />}
                onClick={props.subflowNodeStore?.openBlockDesigner}
              >
                {props.subflow}
              </Button>
            }
          />
        </>
      )}
    </>
  )
}

function TaskConfigs(props: { readonly task: string | null }) {
  const t = useTranslate()
  const nodeStore = useNodeStore()
  const taskNodeStore = toTaskNodeStore(nodeStore)
  const [expanded, setExpanded] = useState(true)

  return (
    <>
      <HandleRow
        variant="value-only"
        value={<div className={styles.subtitle}>{t('blockEditor.taskHeader')}</div>}
        valueExpands
        expanded={expanded}
        onExpandedChange={setExpanded}
      />
      {expanded && (
        <>
          <HandleRow
            level=" "
            isLast
            name={
              <Label className={styles.label} tooltipClassName={styles.labelTooltip} title="task">
                {t('blockEditor.task')}
              </Label>
            }
            value={
              <Button
                className={styles.link}
                wrapperClassName={styles.linkWrapper}
                prefix={<i className={clsx(defaultNodeIcon, 'text-[1rem]')} />}
                onClick={taskNodeStore?.openBlockDesigner}
              >
                {props.task}
              </Button>
            }
          />
        </>
      )}
    </>
  )
}

function MetadataConfigs() {
  const t = useTranslate()
  const nodeStore = NodeStore.to(useNodeStore())!
  const taskNodeStore = toTaskNodeStore(nodeStore)
  const designerStore = useDesignerStore()
  const canRenameNode = designerStore.onRenameNodeId != null
  const editable = useVal(designerStore.$.editable)
  const subflowViewMode = useSubflowViewMode()
  const isSharedBlock = BlockDesignerStore.is(designerStore) || (SubflowDesignerStore.is(designerStore) && subflowViewMode === SUBFLOW_VIEW_MODE.Block)

  const fallbackIcon = iconForNodeType(nodeStore.nodeType)
  const displayIcon = useVal(nodeStore.display$?.icon)
  const privateValue = useVal(nodeStore.manifest$?.private)

  const displayDescription = useVal(nodeStore.display$?.description)
  const [descriptionExpanded, setDescriptionExpanded] = useState(false)
  const toggleDescription = () => setDescriptionExpanded((e) => !e)
  const openIconPicker = useOpenIconPicker()

  const additionalInputs$ = taskNodeStore?.manifest$?.additional_inputs

  return (
    <>
      <HandleRow
        level=" "
        isLast={false}
        name={
          <Label className={styles.label} tooltipClassName={styles.labelTooltip} title="icon">
            {t('blockEditor.icon')}
          </Label>
        }
        value={
          nodeStore.manifest$ && nodeStore.manifest$.icon && editable ? (
            <Button className={styles.iconButton} onClick={() => openIconPicker(nodeStore.manifest$!.icon!.set)}>
              <DesignerIcon src={displayIcon} fallback={<i className={fallbackIcon} />} />
            </Button>
          ) : (
            <DesignerIcon src={displayIcon} fallback={<i className={fallbackIcon} />} />
          )
        }
      />
      <HandleRow
        level=" "
        isLast={false}
        name={
          <Label className={styles.label} tooltipClassName={styles.labelTooltip} title="title">
            {t('blockEditor.title')}
          </Label>
        }
        value={
          nodeStore.display$ && (
            <TranslationInput
              className={styles.input}
              displayValue$={nodeStore.display$.title}
              rawValue$={toTrue(editable) && nodeStore.manifest$?.title}
              placeholder={t('inputHandleEditor.unset')}
              translationFallback={isSharedBlock ? undefined : nodeStore.nodeId}
              useRealChange
            />
          )
        }
      />
      {(isSharedBlock || canRenameNode) && (
        <HandleRow
          level=" "
          isLast={false}
          name={
            <Label className={styles.label} tooltipClassName={styles.labelTooltip} title={toTrue(!isSharedBlock) && 'node_id'}>
              {isSharedBlock ? t('blockEditor.folder') : t('flowEditor.node.id')}
            </Label>
          }
          value={<NodeIdOrDirRenameInput />}
        />
      )}
      {isSharedBlock && nodeStore.manifest$?.private && (
        <HandleRow
          level=" "
          isLast={false}
          name={
            <Label className={styles.label} tooltipClassName={styles.labelTooltip} title="private">
              {t('blockEditor.privateField')}{' '}
              <DesignerTooltip placement="top" title={t('blockEditor.privateHelp')}>
                <span className="cursor-help mr-1 text-[1.2em]">
                  <i className="i-codicon:question" />
                </span>
              </DesignerTooltip>
            </Label>
          }
          value={
            <LabeledSwitch
              label={{ true: t('blockEditor.private'), false: t('blockEditor.public') }}
              checked={asTrue(privateValue)}
              onChange={nodeStore.manifest$.private.set}
            />
          }
        />
      )}
      <HandleRow
        level=" "
        isLast={!additionalInputs$}
        expanded={descriptionExpanded}
        onExpandedChange={setDescriptionExpanded}
        name={
          <Label className={styles.label} tooltipClassName={styles.labelTooltip} title="description">
            {t('blockEditor.description')}
          </Label>
        }
        value={
          <Button className={styles.expandButton} title={displayDescription} onClick={toggleDescription}>
            <span>{displayDescription}</span>
          </Button>
        }
      />
      {descriptionExpanded && (
        <HandleRow
          isLast
          resizable
          level={additionalInputs$ ? '| ' : '  '}
          variant="value-only"
          value={
            nodeStore.changeDescription != null ? (
              <Input
                multiline
                className={styles.input}
                placeholder={t('inputHandleEditor.unset')}
                readOnly={!editable}
                value={displayDescription}
                onRealChange={(value) => nodeStore.changeDescription?.(value.trim() == '' ? undefined : value.trim())}
              />
            ) : (
              <TranslationInput
                multiline
                className={styles.input}
                displayValue$={nodeStore.display$.description}
                rawValue$={toTrue(editable) && nodeStore.manifest$?.description}
                placeholder={t('inputHandleEditor.unset')}
                useRealChange
              />
            )
          }
        />
      )}
      {taskNodeStore && <AdditionalHandleSettings taskNodeStore={taskNodeStore} editable={editable} />}
    </>
  )
}

interface AdditionalHandleOption extends IBasicOption {
  value: 'allow' | 'disallow' | 'restrict'
}

const internalHandleDef: OutputHandleDef = { handle: '[internal]' as HandleName, json_schema: { type: 'string' } }
const additionalHandleOptions: (boolean | OutputHandleDef)[] = [true, internalHandleDef, false]

function mapAdditionalToData(value: AdditionalHandleOption['value'] | undefined): boolean | OutputHandleDef | undefined {
  if (value === 'allow') {
    return true
  } else if (value === 'restrict') {
    return internalHandleDef
  } else {
    return void 0
  }
}

function additionalInputToOption(value: boolean | InputHandleDef | undefined, t: TFunction): AdditionalHandleOption {
  if (value === true) {
    return { label: t('blockEditor.additionalInputsHelp.allow'), value: 'allow' }
  } else if (value) {
    return { label: t('blockEditor.additionalInputsHelp.restrict'), value: 'restrict' }
  } else {
    return { label: t('blockEditor.additionalInputsHelp.disallow'), value: 'disallow' }
  }
}

function additionalOutputToOption(value: boolean | OutputHandleDef | undefined, t: TFunction): AdditionalHandleOption {
  if (value === true) {
    return { label: t('blockEditor.additionalOutputsHelp.allow'), value: 'allow' }
  } else if (value) {
    return { label: t('blockEditor.additionalOutputsHelp.restrict'), value: 'restrict' }
  } else {
    return { label: t('blockEditor.additionalOutputsHelp.disallow'), value: 'disallow' }
  }
}

function doesAdditionalHandleHasSubpanel(value: boolean | OutputHandleDef | undefined): boolean {
  return !!value && value !== true
}

interface AdditionalHandleSettingsProps {
  readonly taskNodeStore?: TaskNodeStore
  readonly editable?: boolean
}

function AdditionalHandleSettings({ taskNodeStore, editable }: AdditionalHandleSettingsProps) {
  const t = useTranslate()

  const inputs$ = taskNodeStore?.manifest$?.additional_inputs
  const inputs = useVal(inputs$)
  const inputOptions = useMemo(() => additionalHandleOptions.map((v) => additionalInputToOption(v, t)), [t])
  const [inputExpanded, setInputExpanded] = useState<boolean | null>(null)

  useEffect(() => {
    setInputExpanded((prev) => {
      const next = doesAdditionalHandleHasSubpanel(inputs)
      if (next && prev === null) return true
      if (!next && prev != null) return null
      return prev
    })
  }, [inputs])

  const outputs$ = taskNodeStore?.manifest$?.additional_outputs
  const outputs = useVal(outputs$)
  const outputOptions = useMemo(() => additionalHandleOptions.map((v) => additionalOutputToOption(v, t)), [t])
  const [outputExpanded, setOutputExpanded] = useState<boolean | null>(null)

  useEffect(() => {
    setOutputExpanded((prev) => {
      const next = doesAdditionalHandleHasSubpanel(outputs)
      if (next && prev === null) return true
      if (!next && prev != null) return null
      return prev
    })
  }, [outputs])

  return (
    <>
      {inputs$ && (
        <HandleRow
          level=" "
          isLast={!outputs$}
          expanded={inputExpanded}
          onExpandedChange={setInputExpanded}
          name={
            <Label className={styles.label} tooltipClassName={styles.labelTooltip} title="additional_inputs">
              {t('blockEditor.additionalInputs')}
            </Label>
          }
          value={
            <Select
              options={inputOptions}
              value={additionalInputToOption(inputs, t)}
              onChange={(option) => {
                inputs$.set(mapAdditionalToData(option?.value))
              }}
              disabled={!editable}
            />
          }
        />
      )}
      {inputs$ && inputs && inputs !== true && inputExpanded && <InlineSchemaEditor def$={inputs$} level="| " role="author" inout="in" />}
      {outputs$ && (
        <HandleRow
          level=" "
          expanded={outputExpanded}
          onExpandedChange={setOutputExpanded}
          name={
            <Label className={styles.label} tooltipClassName={styles.labelTooltip} title="additional_outputs">
              {t('blockEditor.additionalOutputs')}
            </Label>
          }
          value={
            <Select
              options={outputOptions}
              value={additionalOutputToOption(outputs, t)}
              onChange={(option) => {
                outputs$.set(mapAdditionalToData(option?.value))
              }}
              disabled={!editable}
            />
          }
        />
      )}
      {outputs$ && outputs && outputs !== true && outputExpanded && <InlineSchemaEditor def$={outputs$} level="  " role="author" inout="out" />}
    </>
  )
}

function NodeIdOrDirRenameInput() {
  const designerStore = useDesignerStore()
  const nodeStore = useNodeStore()
  const editable = useVal(designerStore.$.editable)

  // This check is quite fast so we do not wrap it in useMemo().
  let validate: ((newValue: string, oldValue: string) => string | undefined) | undefined
  let doRename: ((oldValue: string, newValue: string) => void) | undefined
  if (designerStore.designerType === DESIGNER_TYPE.Flow) {
    validate = designerStore.validateRenameNodeId as typeof validate
    doRename = designerStore.onRenameNodeId as typeof doRename
  } else if (designerStore.designerType === DESIGNER_TYPE.Block) {
    validate = designerStore.validateRenameDirName
    doRename = designerStore.onRenameDirName
  } else if (designerStore.designerType === DESIGNER_TYPE.Subflow) {
    if (nodeStore === designerStore.flowNode) {
      validate = designerStore.validateRenameDirName
      doRename = designerStore.onRenameDirName
    } else {
      validate = designerStore.validateRenameNodeId as typeof validate
      doRename = designerStore.onRenameNodeId as typeof doRename
    }
  }

  const renameError$ = useMemo(() => val<string | undefined>(), [])
  const onUpdateName = useCallback((name: string): void => renameError$.set(validate?.(name, nodeStore.nodeId)), [validate, nodeStore, renameError$])
  const onCommit = useCallback(
    (name: string): void => {
      if (renameError$.value) {
        return
      } else if (name && name !== nodeStore.nodeId) {
        // A block Designer uses the block directory name as its node ID.
        doRename?.(nodeStore.nodeId, name)
      } else {
        renameError$.set(undefined)
      }
    },
    [doRename, nodeStore, renameError$],
  )
  const renameError = useVal(renameError$)

  return (
    <DesignerTooltip open={!!renameError} placement="bottomLeft" title={renameError}>
      <div className={styles.nodeIdWrapper}>
        <Input
          returnToCommit
          className={clsx(styles.input, renameError && styles.renameError)}
          value={nodeStore.nodeId}
          readOnly={!editable || !doRename}
          onChange={onUpdateName}
          onRealChange={onCommit}
          onBlur={(input) => {
            input.value = nodeStore.nodeId
            renameError$.set(undefined)
          }}
        />
      </div>
    </DesignerTooltip>
  )
}

function RunningConfigs() {
  const t = useTranslate()
  const nodeStore = useNodeStore()
  const designerStore = useDesignerStore()
  const editable = useVal(designerStore.$.editable)

  const timeout = useVal(nodeStore.display$?.timeout)
  const concurrency = useVal(nodeStore.display$?.concurrency)
  const progressWeight = useVal(nodeStore.display$?.progressWeight)
  const showTimeout = !ConditionNodeStore.is(nodeStore)
  const showConcurrency = nodeStore.display$?.concurrency != null
  const showProgressWeight = designerStore.designerType !== DESIGNER_TYPE.Block && designerStore.flowNode !== nodeStore

  return (
    <>
      {showTimeout && (
        <HandleRow
          level=" "
          isLast={!showConcurrency && !showProgressWeight}
          name={
            <Label className={styles.label} tooltipClassName={styles.labelTooltip} title="timeout">
              {t('blockEditor.runningConfig.timeout')}
            </Label>
          }
          value={
            <div className={styles.inputWithUnit}>
              <Input
                readOnly={!editable || nodeStore.manifest$?.timeout == null}
                className={styles.input}
                type="number"
                placeholder={t('inputHandleEditor.unset')}
                value={formatOptionalNumber(timeout)}
                onRealChange={(value) => nodeStore.manifest$?.timeout?.set(parsePositiveNumber(value))}
                onBlur={(input) => {
                  input.value = formatOptionalNumber(timeout)
                }}
              />
              <span className={styles.unit}>{t('s')}</span>
            </div>
          }
        />
      )}
      {showConcurrency && (
        <HandleRow
          level=" "
          isLast={!showProgressWeight}
          name={
            <Label className={styles.label} tooltipClassName={styles.labelTooltip} title="concurrency">
              {t('blockEditor.runningConfig.concurrency')}
            </Label>
          }
          value={
            <div className={styles.inputWithUnit}>
              <Input
                readOnly={!editable || nodeStore.manifest$?.concurrency == null}
                className={styles.input}
                type="number"
                placeholder={t('inputHandleEditor.unset')}
                value={formatOptionalNumber(concurrency)}
                min={1}
                step={1}
                onRealChange={(value) => nodeStore.manifest$?.concurrency?.set(parsePositiveInteger(value))}
                onBlur={(input) => {
                  input.value = formatOptionalNumber(concurrency)
                }}
              />
            </div>
          }
        />
      )}
      {showProgressWeight && (
        <HandleRow
          level=" "
          name={
            <Label className={styles.label} tooltipClassName={styles.labelTooltip} title="progress_weight">
              {t('blockEditor.runningConfig.progressWeight')}
            </Label>
          }
          value={
            <div className={styles.inputWithUnit}>
              <Input
                readOnly={!editable || nodeStore.manifest$?.progressWeight == null}
                className={styles.input}
                type="number"
                placeholder={t('inputHandleEditor.unset')}
                value={formatProgressWeight(progressWeight)}
                min={0}
                step={1}
                onRealChange={(value) => nodeStore.manifest$?.progressWeight?.set(parseProgressWeight(value))}
                onBlur={(input) => {
                  input.value = formatProgressWeight(progressWeight)
                }}
              />
            </div>
          }
        />
      )}
    </>
  )
}

interface InlineTaskConfigsProps extends InlineTask {}

function InlineTaskConfigs(props: InlineTaskConfigsProps) {
  const t = useTranslate()
  const [executorExpanded, setExecutorExpanded] = useState(true)

  return (
    <>
      <HandleRow
        variant="value-only"
        value={<div className={styles.subtitle}>{t('blockEditor.executor.title')}</div>}
        valueExpands
        expanded={executorExpanded}
        onExpandedChange={setExecutorExpanded}
      />
      {executorExpanded && <ExecutorConfigs {...props} />}
    </>
  )
}

function ExecutorConfigs(props: InlineTaskConfigsProps) {
  const t = useTranslate()
  const executor = useVal(props.executor)
  const nodeStore = useNodeStore()
  const taskNodeStore = toTaskNodeStore(nodeStore)
  const designerStore = useDesignerStore()
  const editable = useVal(designerStore.$.editable)

  const [editEntry, setEditEntry] = useState(false)

  const isJavascript = executor?.name === 'javascript'
  const isConnector = executor?.name === 'connector'
  const isLlm = executor?.name === 'llm'
  const executorName = isConnector ? 'Connector' : isJavascript ? 'JavaScript' : isLlm ? 'LLM' : t('inputHandleEditor.unset')

  return (
    <>
      <HandleRow
        level=" "
        isLast={!isJavascript && !isConnector && !isLlm}
        name={
          <Label className={styles.label} tooltipClassName={styles.labelTooltip} title="executor.name">
            {t('blockEditor.executor.name')}
          </Label>
        }
        value={<Label className={styles.executorName}>{executorName}</Label>}
      />
      {isConnector && (
        <>
          <HandleRow
            level=" "
            isLast={false}
            name={
              <Label className={styles.label} tooltipClassName={styles.labelTooltip} title="executor.options.action">
                {t('blockEditor.executor.action')}
              </Label>
            }
            value={
              <Label className={styles.executorName} title={executor.options.action}>
                {executor.options.action}
              </Label>
            }
          />
          <ConnectorConnectionConfig action={executor.options.action} connection={executor.options.connection} editable={editable} executor$={props.executor} />
        </>
      )}
      {isLlm && (
        <HandleRow
          level=" "
          name={
            <Label className={styles.label} tooltipClassName={styles.labelTooltip} title="executor.options.mode">
              {t('blockEditor.executor.mode')}
            </Label>
          }
          value={<Label className={styles.executorName}>{t(`blockEditor.executor.mode_${executor.options.mode}`)}</Label>}
        />
      )}
      {isJavascript && (
        <>
          <HandleRow
            level=" "
            isLast={false}
            name={
              <Label className={styles.label} tooltipClassName={styles.labelTooltip} title="executor.options.entry">
                {t('blockEditor.executor.entry')}
              </Label>
            }
            value={
              <div className={styles.linkWithEdit}>
                {editEntry ? (
                  <Input
                    readOnly={!editable}
                    className={styles.linkWrapper}
                    value={asString(executor.options?.entry)}
                    placeholder={t('inputHandleEditor.unset')}
                    onRealChange={(value) => {
                      if (executor?.name != 'javascript' || value == '') return
                      setValue(props.executor, { ...executor, options: { ...executor.options, entry: value } })
                    }}
                  />
                ) : (
                  <Button
                    className={styles.link}
                    wrapperClassName={styles.linkWrapper}
                    htmlTitle={executor.options?.entry}
                    disabled={!executor.options?.entry || !taskNodeStore?.openExecutorEntry}
                    onClick={taskNodeStore?.openExecutorEntry}
                  >
                    {formatEntry(executor.options?.entry, t('inputHandleEditor.unset'))}
                  </Button>
                )}
                {editable && (
                  <Button className={styles.edit} onClick={() => setEditEntry((e) => !e)} title={t('edit')} titlePlacement="right">
                    <i className="i-codicon:edit" />
                  </Button>
                )}
              </div>
            }
          />
          <HandleRow
            level=" "
            isLast={false}
            name={
              <Label className={styles.label} tooltipClassName={styles.labelTooltip} title="executor.options.function">
                {t('blockEditor.executor.function')}
              </Label>
            }
            value={
              <Input
                readOnly={!editable}
                className={styles.executorFunction}
                value={asString(executor.options?.function)}
                placeholder={t('inputHandleEditor.unset')}
                onRealChange={(value) => {
                  if (executor?.name != 'javascript') return
                  const functionName = value == '' ? void 0 : value
                  setValue(props.executor, { ...executor, options: { ...executor.options, function: functionName } })
                }}
              />
            }
          />
        </>
      )}
    </>
  )
}

function ConnectorConnectionConfig(props: {
  readonly action: string
  readonly connection: string | undefined
  readonly editable: boolean
  readonly executor$: InlineTask['executor']
}) {
  const t = useTranslate()
  const connections = useConnectorConnections(props.action)

  if (connections == null) {
    return (
      <HandleRow
        level=" "
        name={
          <Label className={styles.label} tooltipClassName={styles.labelTooltip} title="executor.options.connection">
            {t('blockEditor.executor.connection')}
          </Label>
        }
        value={
          <Label className={styles.executorName} title={props.connection}>
            {props.connection ?? t('addNode.connectorNoActiveConnection')}
          </Label>
        }
      />
    )
  }

  const active = connections.filter((connection) => connection.status == 'active')
  const selected = props.connection == null ? undefined : connections.find((connection) => connection.id == props.connection)
  const resolved = selected?.status == 'active'
  const options: IBasicOption[] = active.map((connection) => ({
    label: `${connection.displayName} (${connection.id})`,
    value: connection.id,
  }))
  if (props.connection != null && !resolved) {
    options.unshift({
      isDisabled: true,
      label: `${props.connection} (${t('blockEditor.executor.connectionUnresolved')})`,
      value: props.connection,
    })
  }

  return (
    <HandleRow
      level=" "
      name={
        <Label className={styles.label} tooltipClassName={styles.labelTooltip} title="executor.options.connection">
          {t('blockEditor.executor.connection')}
        </Label>
      }
      value={
        <Select
          disabled={!props.editable || active.length == 0}
          labelInMenu={active.length == 0 ? t('addNode.connectorNoActiveConnection') : undefined}
          options={options}
          value={options.find((option) => option.value == props.connection)}
          variant={resolved ? 'default' : 'danger'}
          onChange={(option) => {
            if (option?.value == null || option.value == props.connection) return
            const executor = props.executor$.value
            if (executor?.name != 'connector') return
            setValue(props.executor$, { ...executor, options: { ...executor.options, connection: option.value } })
          }}
        />
      }
    />
  )
}

function formatEntry(value: string | undefined, unset: string): string {
  return value ? basename(value) : unset
}

function parsePositiveInteger(value: string): number | undefined {
  if (value === '') return
  const parsed = Number.parseInt(value, 10)
  return String(parsed) === value && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : void 0
}

function parsePositiveNumber(value: string): number | undefined {
  if (value === '') return
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : void 0
}

function formatOptionalNumber(value: number | undefined): string {
  return value == null ? '' : String(value)
}

function formatProgressWeight(value: number | undefined): string {
  return value == null ? '' : String(value)
}

function parseProgressWeight(value: string): number | undefined {
  if (value === '') return
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : void 0
}
