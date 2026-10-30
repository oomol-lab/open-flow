import styles from './nodeInputValue.module.scss'
import type { TFunction } from 'val-i18n'
import type { InputSourceCandidate, InputSourceCheck, InputSourcesCheck } from '../../../../flow/common/graph.ts'
import type { FieldValueEditorProps } from '../../../../form/browser/fieldValueEditor.tsx'
import type { FieldValueDeletion } from '../../../../form/common/fieldValue.ts'
import type { VariablePickerProps } from '../../../../ui/browser/variable-picker.tsx'
import type { JsonValue } from '../api.ts'
import type { InputSourceQuery } from '../revisionView.ts'

import { Fragment, useEffect, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { variableInputCompatible } from '../../../../flow/common/schema.ts'
import { sourceOutputLabel } from '../../../../flow/common/sourceField.ts'
import { editorComponentIcons } from '../../../../form/browser/editorComponentIcon.tsx'
import { ValueEditorFeedback } from '../../../../form/browser/fieldControl.tsx'
import { FieldValueEditor } from '../../../../form/browser/fieldValueEditor.tsx'
import { selectionMenuContentClass } from '../../../../form/browser/selectionMenuStyles.ts'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '../../../../ui/browser/dropdown-menu.tsx'
import { Field, FieldLabel } from '../../../../ui/browser/field.tsx'
import { ContentIcon } from '../../../../ui/browser/icons/ContentIcon.tsx'
import { MenuHeader } from '../../../../ui/browser/menu-header.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { LlmInputEditor, supportsLlmInput } from './llmInputEditor.tsx'
import { schemaMismatchMessage } from './schemaMismatchMessage.ts'
import { SourceMenuOption, sourceMenuItemClass as sourceItemClass } from './sourceMenuOption.tsx'
import { SourceSelectorTrigger } from './sourceSelectorTrigger.tsx'
import { useInputSourceQuery } from './useInputSourceQuery.ts'

export type InputVariables = Pick<VariablePickerProps, 'enabled' | 'loaded' | 'loading' | 'names'> & { readonly onOpen?: () => void }
export interface NodeInputUpstreamSources {
  readonly query?: InputSourceQuery
  readonly describeGroups?: (outputs: Readonly<Record<string, readonly InputSourceCandidate[]>>) => NodeInputUpstreamSources['groups']
  readonly current: readonly {
    readonly description?: string
    readonly icon?: string
    readonly nodeId: string
    readonly nodeName?: string
    readonly system?: true
    readonly output: string
    readonly field?: string
    readonly check: InputSourceCheck | undefined
  }[]
  readonly groups: readonly {
    readonly icon?: string
    readonly nodeId: string
    readonly nodeName: string
    readonly outputs: readonly InputSourceCandidate[]
  }[]
  readonly onChange?: (source: { readonly nodeId: string; readonly output: string; readonly field?: string; readonly system?: true }) => void
}
const draftIssue = () => {}
const variableSource = (name: string) => JSON.stringify(['variable', name])
const upstreamSource = (nodeId: string, output: string, field?: string, system?: true) =>
  JSON.stringify(system ? ['upstream', nodeId, output, field, true] : ['upstream', nodeId, output, field])
const sourceEmptyItemClass = `${sourceItemClass} font-normal text-muted-foreground data-disabled:opacity-100`
const sourceSubTriggerClass = sourceItemClass

function inputSourceIssue(check: InputSourceCheck | undefined, source: NodeInputUpstreamSources['current'][number], t: TFunction): string | undefined {
  switch (check?.kind) {
    case undefined:
    case 'available':
      return
    case 'source-missing':
      return t('inspector.sources.sourceMissing')
    case 'field-missing':
      return t('inspector.sources.fieldMissing', { field: JSON.stringify(source.field), output: source.output })
    case 'output-missing':
      return t('inspector.sources.outputMissing', { output: source.output, source: source.nodeName })
    case 'not-ready':
      return t('inspector.sources.notReady', { handle: source.output, source: source.nodeName })
    case 'schema':
      return schemaMismatchMessage(check.mismatch, t)
    case 'schema-error':
      return t('inspector.sources.schemaCompareFailed')
  }
}
function SelectedSourceValue({
  bound,
  readOnly,
  connected,
  sourceMissing,
  onInvalidChange,
  validationError,
  upstream,
  variableCompatible,
  variableName,
  variables,
}: {
  readonly readOnly?: boolean
  readonly bound: boolean
  readonly connected: boolean
  readonly validationError?: string
  readonly onInvalidChange?: (invalid: boolean) => void
  readonly sourceMissing?: boolean
  readonly upstream?: NodeInputUpstreamSources
  readonly variableCompatible: boolean
  readonly variableName?: string
  readonly variables: InputVariables
}) {
  const t = useTranslate()
  let checks: InputSourcesCheck | undefined
  let checkFailed = false
  if (upstream?.query != null && upstream.current.length > 0) {
    try {
      checks = upstream.query.check()
    } catch {
      checkFailed = true
    }
  }
  const current = upstream?.query == null ? upstream?.current : upstream.current.map((source, index) => ({ ...source, check: checks?.sources[index] }))
  const missingVariable = !readOnly && variableName != null && (!variables.enabled || (variables.loaded && !variables.names.includes(variableName)))
  const invalidUpstream = connected ? current?.find((source) => source.check != null && source.check.kind != 'available') : undefined
  const sourceIssue = sourceMissing
    ? t('inspector.sources.sourceMissing')
    : missingVariable
      ? !variables.enabled
        ? t('variablePicker.variableUnavailableHelp')
        : t('variablePicker.variableMissingHelp', { name: variableName })
      : bound && !variableCompatible
        ? t('variablePicker.variableIncompatibleHelp')
        : checks?.conflict
          ? t('inspector.sources.sourceConflict', {
              sources: current
                ?.map((source) => (source.nodeName == null ? sourceOutputLabel(source) : `${source.nodeName} ${sourceOutputLabel(source)}`))
                .join(', '),
            })
          : invalidUpstream != null
            ? inputSourceIssue(invalidUpstream.check, invalidUpstream, t)
            : validationError
  useEffect(() => {
    onInvalidChange?.(sourceIssue != null)
  }, [sourceIssue, onInvalidChange])
  const sourceLabel = bound
    ? variableName
    : current?.length
      ? current.map((source) => (source.nodeName == null ? sourceOutputLabel(source) : `${source.nodeName} · ${sourceOutputLabel(source)}`)).join(' / ')
      : t('nodeInput.connected')
  const selectedUpstreamIcon = connected && current?.length === 1 ? current[0]?.icon : undefined
  const sourceDescriptions = connected && current?.length ? current.map((source) => source.description?.trim()).filter(Boolean) : []
  const sourceTooltip = connected && current?.length ? [sourceLabel, ...sourceDescriptions].join('\n') : undefined
  return (
    <>
      <SourceValueControl
        label={sourceLabel ?? ''}
        description={sourceTooltip}
        variable={bound}
        node={connected && current?.length === 1}
        icon={selectedUpstreamIcon}
        error={sourceIssue}
      />
      {checkFailed && (
        <p role="status" className="text-xs text-muted-foreground">
          {t('inspector.sources.checkFailed')}
        </p>
      )}
    </>
  )
}

/** The selected source surface shared by node inputs and response projections. */
export function SourceValueControl({
  label,
  description,
  variable = false,
  node = false,
  icon,
  error,
  name,
}: {
  readonly label: string
  readonly description?: string
  readonly variable?: boolean
  readonly node?: boolean
  readonly icon?: string
  readonly error?: string
  readonly name?: string
}) {
  const t = useTranslate()
  const [tooltipContainer, setTooltipContainer] = useState<HTMLDivElement | null>(null)
  return (
    <ValueEditorFeedback error={error}>
      {(errorId) => (
        <div
          ref={setTooltipContainer}
          data-field-control
          data-value-control
          className={`${styles.sourceControl} flex h-[30px] min-w-0 items-center rounded-[var(--ui-control-radius,var(--ui-radius))] border border-input bg-[var(--ui-control-background,var(--ui-muted))] px-[7px] text-xs`}
          aria-invalid={error != null}
          aria-label={name}
          aria-describedby={errorId}
          tabIndex={error ? 0 : undefined}
        >
          {variable ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span role="img" aria-label={t('nodeInput.variable')} className="-my-px mr-2 flex h-[30px] shrink-0 items-center text-muted-foreground" />
                }
              >
                <i aria-hidden="true" className="i-lucide-light:sliders-horizontal size-3.5" />
              </TooltipTrigger>
              <TooltipContent container={tooltipContainer} sideOffset={0}>
                {t('nodeInput.variable')}
              </TooltipContent>
            </Tooltip>
          ) : (
            node && (
              <ContentIcon
                src={icon}
                className="mr-2 size-3.5 shrink-0 data-[icon-kind=initials]:text-[16px]"
                fallback={<i aria-hidden="true" className="i-lucide-light:workflow mr-2 size-3.5 shrink-0 text-muted-foreground" />}
              />
            )
          )}
          <Tooltip disabled={description == null}>
            <TooltipTrigger render={<span className="min-w-0 flex-1 truncate" aria-description={description} />}>{label}</TooltipTrigger>
            <TooltipContent container={tooltipContainer} sideOffset={11} positionMethod="fixed" collisionBoundary={[]} className="whitespace-pre-wrap">
              {description}
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </ValueEditorFeedback>
  )
}

export function SourceValueEditor({
  fixed = false,
  sourceOnly = false,
  editor: customEditor,
  schema,
  label: fieldLabel,
  nullable,
  description: fieldDescription,
  presentation,
  upstream: providedUpstream,
  embedded = false,
  handleNames = [],
  value,
  connected,
  sourceMissing,
  onInvalidChange,
  validationError,
  variableName,
  variables,
  disabled,
  readOnly,
  onValue,
  onVariable,
  onReset,
}: {
  readonly sourceOnly?: boolean
  readonly fixed?: boolean
  readonly editor?: FieldValueEditorProps['editor']
  readonly presentation?: Pick<
    FieldValueEditorProps,
    | 'expansionPolicy'
    | 'columns'
    | 'gap'
    | 'layout'
    | 'header'
    | 'leadingControl'
    | 'valueAddon'
    | 'valueSuffix'
    | 'trailingControl'
    | 'description'
    | 'options'
    | 'onDefinitionChange'
    | 'compact'
    | 'hideOptions'
    | 'hideValueTools'
    | 'hideChildTypes'
    | 'valueOnly'
    | 'validateObjectFieldName'
    | 'renderObjectField'
    | 'depth'
    | 'objectChild'
    | 'actions'
  >
  readonly upstream?: NodeInputUpstreamSources
  readonly embedded?: boolean
  readonly handleNames?: readonly string[]
  readonly schema: JsonValue
  readonly label: string
  readonly nullable?: boolean
  readonly description?: string
  readonly value: JsonValue | undefined
  readonly connected: boolean
  readonly validationError?: string
  readonly onInvalidChange?: (invalid: boolean) => void
  readonly sourceMissing?: boolean
  readonly variableName?: string
  readonly variables: InputVariables
  readonly readOnly?: boolean
  readonly disabled: boolean
  readonly onValue: (value: JsonValue | undefined, deletion?: FieldValueDeletion) => void
  readonly onVariable: (name: string | undefined) => void
  readonly onReset?: () => void
}) {
  const t = useTranslate()
  const [sourceOpen, setSourceOpen] = useState(false)
  const candidates = useInputSourceQuery(providedUpstream?.query?.candidates, sourceOpen)
  const upstream =
    providedUpstream?.query == null
      ? providedUpstream
      : {
          ...providedUpstream,
          groups: candidates.value == null ? [] : (providedUpstream.describeGroups?.(candidates.value) ?? []),
        }
  const [sourceContainer, setSourceContainer] = useState<HTMLDivElement | null>(null)
  const llm = supportsLlmInput(schema, value)
  const bound = variableName != null
  const variableCompatible = variableInputCompatible(schema)
  const hasVariables = variables.enabled && variables.names.length > 0
  const literalSource = JSON.stringify(['literal'])
  const currentSource = bound
    ? variableSource(variableName)
    : connected && upstream?.current.length === 1
      ? upstreamSource(upstream.current[0]!.nodeId, upstream.current[0]!.output, upstream.current[0]!.field, upstream.current[0]!.system)
      : connected
        ? JSON.stringify(['upstream'])
        : literalSource
  const sourceKind = bound ? 'variable' : connected ? 'upstream' : 'literal'
  const sourcePortal = sourceContainer?.closest<HTMLElement>('.editor-context-panel') ?? sourceContainer
  const sourceOption = (nodeId: string, { description, output, field, fields, check, system }: InputSourceCandidate, label: string) => {
    const selected = sourceKind === 'upstream' && currentSource === upstreamSource(nodeId, output, field, system)
    const itemKey = upstreamSource(nodeId, output, field, system)
    return (
      <SourceMenuOption
        key={itemKey}
        value={itemKey}
        label={label}
        selected={selected}
        compatibility={check.kind === 'schema' ? 'incompatible' : check.kind === 'schema-error' ? 'unverified' : 'available'}
        icon={fields?.length ? editorComponentIcons.object : undefined}
        description={description}
        container={sourcePortal}
      />
    )
  }

  const selectUpstream = (next: string) => {
    const [, nodeId, output, field, system] = JSON.parse(next) as [string, string, string, string | null, true?]
    upstream?.onChange?.({ nodeId, output, ...(system ? { system } : {}), ...(field == null ? {} : { field }) })
  }
  const sourceControl =
    disabled || fixed ? undefined : (
      <div ref={setSourceContainer} className="flex items-center">
        <DropdownMenu
          open={sourceOpen}
          onOpenChange={(open) => {
            setSourceOpen(open)
            if (open && variables.enabled) variables.onOpen?.()
          }}
        >
          <SourceSelectorTrigger
            label={`${fieldLabel} ${t('inspector.sources.select')}`}
            description={t('inspector.sources.select')}
            open={sourceOpen}
            pressed={sourceKind !== 'literal'}
            disabled={disabled}
            container={sourcePortal}
          />
          <DropdownMenuContent align="start" sideOffset={6} className={`w-44 min-w-44 ${selectionMenuContentClass}`} container={sourcePortal}>
            <MenuHeader>{t('inspector.sources.title')}</MenuHeader>
            {!sourceOnly && (
              <DropdownMenuRadioGroup
                value={sourceKind === 'literal' ? literalSource : ''}
                onValueChange={() => {
                  if (bound) onVariable(undefined)
                  else if (connected) onValue(undefined)
                }}
              >
                <DropdownMenuRadioItem className={sourceItemClass} value={literalSource} closeOnClick>
                  <i aria-hidden="true" className="i-lucide-light:pen-line size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{t('nodeInput.literal')}</span>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            )}
            {hasVariables && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className={`${sourceSubTriggerClass} ${sourceKind === 'variable' ? 'bg-accent' : ''}`}>
                  <i aria-hidden="true" className="i-lucide-light:sliders-horizontal size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{t('nodeInput.variable')}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className={`w-48 min-w-48 ${selectionMenuContentClass}`} container={sourcePortal}>
                  <DropdownMenuRadioGroup
                    value={sourceKind === 'variable' ? currentSource : ''}
                    onValueChange={(next) => {
                      const [, name] = JSON.parse(next) as [string, string]
                      onVariable(name)
                    }}
                  >
                    {bound && !variables.names.includes(variableName) && (
                      <DropdownMenuRadioItem className={sourceItemClass} value={variableSource(variableName)} disabled>
                        <i aria-hidden="true" className="i-lucide-light:sliders-horizontal size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate font-mono" title={variableName}>
                          {variableName}
                        </span>
                      </DropdownMenuRadioItem>
                    )}
                    {variables.names.map((name) => {
                      const selected = sourceKind === 'variable' && currentSource === variableSource(name)
                      const status = variableCompatible ? undefined : t('inspector.sources.incompatible')
                      return (
                        <DropdownMenuRadioItem
                          className={`${sourceItemClass} ${status == null || selected ? 'pr-8' : 'pr-20'}`}
                          key={name}
                          value={variableSource(name)}
                          closeOnClick
                        >
                          <i
                            aria-hidden="true"
                            className={`${status == null ? 'i-lucide-light:sliders-horizontal text-muted-foreground' : 'i-lucide-light:triangle-alert'} size-3.5 shrink-0`}
                            style={status == null ? undefined : { color: 'var(--warning-foreground)' }}
                          />
                          <span className="min-w-0 flex-1 truncate font-mono" title={name}>
                            {name}
                          </span>
                          {!selected && status != null && (
                            <span
                              className="pointer-events-none absolute right-2 shrink-0 text-[10px] leading-4"
                              style={{ color: 'var(--warning-foreground)' }}
                            >
                              {status}
                            </span>
                          )}
                          {selected && status != null && <span className="sr-only">{status}</span>}
                        </DropdownMenuRadioItem>
                      )
                    })}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSeparator className="mx-2 bg-border/50" />
            {candidates.pending || candidates.failed ? (
              <DropdownMenuItem className={sourceEmptyItemClass} disabled>
                {t(candidates.failed ? 'inspector.sources.loadFailed' : 'inspector.sources.loading')}
              </DropdownMenuItem>
            ) : (
              (upstream?.groups.length ?? 0) === 0 && (
                <DropdownMenuItem className={sourceEmptyItemClass} disabled>
                  <i aria-hidden="true" className="i-lucide-light:corner-down-right size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{t('nodeInput.noUpstreamNodes')}</span>
                </DropdownMenuItem>
              )
            )}
            {upstream?.groups.map((group) => (
              <DropdownMenuSub key={group.nodeId}>
                <DropdownMenuSubTrigger
                  className={`${sourceSubTriggerClass} ${connected && upstream.current.some((source) => source.nodeId === group.nodeId) ? 'bg-accent' : ''}`}
                >
                  <ContentIcon
                    src={group.icon}
                    className="size-3.5 shrink-0 data-[icon-kind=initials]:text-[16px]"
                    fallback={<i aria-hidden="true" className="i-lucide-light:workflow size-3.5 shrink-0 text-muted-foreground" />}
                  />
                  <span className="min-w-0 flex-1 truncate" title={group.nodeName}>
                    {group.nodeName}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className={`w-48 min-w-48 ${selectionMenuContentClass}`} container={sourcePortal}>
                  <DropdownMenuRadioGroup
                    value={sourceKind === 'upstream' && upstream.current.length === 1 && upstream.current[0]?.nodeId === group.nodeId ? currentSource : ''}
                    onValueChange={selectUpstream}
                  >
                    {upstream.current
                      .filter(
                        (source) =>
                          source.nodeId === group.nodeId &&
                          source.check != null &&
                          source.check.kind != 'available' &&
                          !group.outputs.some(
                            (candidate) =>
                              candidate.output === source.output &&
                              candidate.system === source.system &&
                              (source.field === undefined || candidate.fields?.some((child) => child.field === source.field)),
                          ),
                      )
                      .map((source) => (
                        <DropdownMenuRadioItem
                          className={sourceItemClass}
                          key={upstreamSource(source.nodeId, source.output, source.field, source.system)}
                          value={upstreamSource(source.nodeId, source.output, source.field, source.system)}
                          disabled
                        >
                          <i aria-hidden="true" className="i-lucide-light:corner-down-right size-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate font-mono" title={sourceOutputLabel(source)}>
                            {sourceOutputLabel(source)}
                          </span>
                        </DropdownMenuRadioItem>
                      ))}
                    {group.outputs.map((candidate) => (
                      <Fragment key={JSON.stringify([candidate.system, candidate.output])}>
                        {candidate.system && <DropdownMenuSeparator className="mx-2 bg-border/50" />}
                        {candidate.fields?.length ? (
                          <DropdownMenuSub key={candidate.output}>
                            <DropdownMenuSubTrigger
                              className={`${sourceSubTriggerClass} ${connected && upstream.current.some((source) => source.nodeId === group.nodeId && source.system === candidate.system && source.output === candidate.output) ? 'bg-accent' : ''}`}
                            >
                              <i aria-hidden="true" className="i-lucide-light:corner-down-right size-3.5 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1 truncate font-mono" title={candidate.output}>
                                {candidate.system ? t('inspector.node.systemError') : candidate.output}
                              </span>
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className={`w-56 min-w-56 ${selectionMenuContentClass}`} container={sourcePortal}>
                              <DropdownMenuRadioGroup value={sourceKind === 'upstream' ? currentSource : ''} onValueChange={selectUpstream}>
                                {sourceOption(group.nodeId, candidate, t('inspector.sources.wholeObject'))}
                                <DropdownMenuSeparator className="mx-2 bg-border/50" />
                                {candidate.fields.map((child) => sourceOption(group.nodeId, child, child.field === '' ? '""' : child.field))}
                              </DropdownMenuRadioGroup>
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        ) : (
                          sourceOption(group.nodeId, candidate, candidate.system ? t('inspector.node.systemError') : candidate.output)
                        )}
                      </Fragment>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  const editor =
    connected || bound || sourceMissing ? (
      <SelectedSourceValue
        readOnly={readOnly}
        validationError={validationError}
        onInvalidChange={onInvalidChange}
        bound={bound}
        connected={connected}
        sourceMissing={sourceMissing}
        upstream={providedUpstream}
        variableCompatible={variableCompatible}
        variableName={variableName}
        variables={variables}
      />
    ) : llm && !sourceOnly ? (
      <LlmInputEditor
        readOnly={readOnly}
        addon={sourceControl}
        schema={schema}
        value={value}
        disabled={disabled}
        handleNames={handleNames}
        label={fieldLabel}
        onChange={onValue}
      />
    ) : undefined
  return (
    <Field className={embedded ? 'gap-0' : 'p-3'}>
      {!embedded && <FieldLabel>{fieldLabel}</FieldLabel>}
      <FieldValueEditor
        readOnly={readOnly}
        {...presentation}
        validationError={validationError}
        onInvalidChange={connected || bound || sourceMissing ? undefined : onInvalidChange}
        valueAddon={llm && !sourceOnly && !connected && !bound ? undefined : sourceControl}
        description={presentation?.description ?? fieldDescription}
        schema={schema}
        nullable={nullable}
        value={sourceOnly && !connected && !bound && !sourceMissing ? undefined : value}
        unset={
          sourceOnly && !connected && !bound && !sourceMissing
            ? {
                label: t('inspector.sources.select'),
                required: true,
                onActivate: fixed
                  ? undefined
                  : () => {
                      setSourceOpen(true)
                      if (variables.enabled) variables.onOpen?.()
                    },
              }
            : undefined
        }
        label={fieldLabel}
        path={`/${fieldLabel.replaceAll('~', '~0').replaceAll('/', '~1')}`}
        disabled={disabled}
        onReset={onReset}
        valueEditable={!sourceOnly && !connected && !bound && !sourceMissing}
        editor={customEditor ?? editor}
        onDraftIssue={draftIssue}
        onChange={(next, deletion) => onValue(next as JsonValue | undefined, deletion)}
      />
    </Field>
  )
}
