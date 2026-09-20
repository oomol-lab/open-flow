import styles from './nodeInputValue.module.scss'
import type { TFunction } from 'val-i18n'
import type { InputSourceCandidate, InputSourceCheck, InputSourcesCheck } from '../../../../flow/common/graph.ts'
import type { FieldValueEditorProps } from '../../../../form/browser/fieldValueEditor.tsx'
import type { FieldValueDeletion } from '../../../../form/common/fieldValue.ts'
import type { VariablePickerProps } from '../../../../ui/browser/variable-picker.tsx'
import type { JsonValue } from '../api.ts'
import type { InputSourceQuery } from '../revisionView.ts'

import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { useEffect, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { variableInputCompatible } from '../../../../flow/common/schema.ts'
import { sourceOutputLabel } from '../../../../flow/common/sourceField.ts'
import { editorComponentIcons } from '../../../../form/browser/editorComponentIcon.tsx'
import { ValueEditorFeedback } from '../../../../form/browser/fieldControl.tsx'
import { FieldValueEditor } from '../../../../form/browser/fieldValueEditor.tsx'
import { selectionMenuContentClass, selectionMenuItemClass } from '../../../../form/browser/selectionMenuStyles.ts'
import { Button } from '../../../../ui/browser/button.tsx'
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
  DropdownMenuTrigger,
} from '../../../../ui/browser/dropdown-menu.tsx'
import { Field, FieldLabel } from '../../../../ui/browser/field.tsx'
import { ContentIcon } from '../../../../ui/browser/icons/ContentIcon.tsx'
import { MenuHeader } from '../../../../ui/browser/menu-header.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { LlmInputEditor, supportsLlmInput } from './llmInputEditor.tsx'
import { schemaMismatchMessage } from './schemaMismatchMessage.ts'
import { useInputSourceQuery } from './useInputSourceQuery.ts'

export type InputVariables = Pick<VariablePickerProps, 'enabled' | 'loaded' | 'loading' | 'names' | 'onOpen'>
export interface NodeInputUpstreamSources {
  readonly query?: InputSourceQuery
  readonly describeGroups?: (outputs: Readonly<Record<string, readonly InputSourceCandidate[]>>) => NodeInputUpstreamSources['groups']
  readonly current: readonly {
    readonly description?: string
    readonly icon?: string
    readonly nodeId: string
    readonly nodeName?: string
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
  readonly onChange: (source: { readonly nodeId: string; readonly output: string; readonly field?: string }) => void
}
const draftIssue = () => {}
const variableSource = (name: string) => JSON.stringify(['variable', name])
const upstreamSource = (nodeId: string, output: string, field?: string) => JSON.stringify(['upstream', nodeId, output, field])
const sourceItemClass = `${selectionMenuItemClass} gap-2 px-2`
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
  connected,
  sourceMissing,
  onInvalidChange,
  validationError,
  upstream,
  variableCompatible,
  variableName,
  variables,
}: {
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
  const [tooltipContainer, setTooltipContainer] = useState<HTMLDivElement | null>(null)
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
  const missingVariable = variableName != null && (!variables.enabled || (variables.loaded && !variables.names.includes(variableName)))
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
      <ValueEditorFeedback error={sourceIssue}>
        {(errorId) => (
          <div
            ref={setTooltipContainer}
            data-field-control
            data-value-control
            className={`${styles.sourceControl} flex h-[30px] min-w-0 items-center rounded-[var(--ui-control-radius,var(--ui-radius))] border border-input bg-[var(--ui-control-background,var(--ui-muted))] px-[7px] text-xs`}
            aria-invalid={sourceIssue != null}
            aria-describedby={errorId}
            tabIndex={sourceIssue ? 0 : undefined}
          >
            {bound ? (
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
              connected &&
              current?.length === 1 && (
                <ContentIcon
                  src={selectedUpstreamIcon}
                  className="mr-2 size-3.5 shrink-0 data-[icon-kind=initials]:text-[16px]"
                  fallback={<i aria-hidden="true" className="i-lucide-light:workflow mr-2 size-3.5 shrink-0 text-muted-foreground" />}
                />
              )
            )}
            <Tooltip disabled={sourceTooltip == null}>
              <TooltipTrigger render={<span className="min-w-0 flex-1 truncate" aria-description={sourceTooltip} />}>{sourceLabel}</TooltipTrigger>
              <TooltipContent container={tooltipContainer} sideOffset={11} positionMethod="fixed" collisionBoundary={[]} className="whitespace-pre-wrap">
                {sourceTooltip}
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </ValueEditorFeedback>
      {checkFailed && (
        <p role="status" className="text-xs text-muted-foreground">
          {t('inspector.sources.checkFailed')}
        </p>
      )}
    </>
  )
}

export function SourceValueEditor({
  fixed = false,
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
  onValue,
  onVariable,
}: {
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
  readonly disabled: boolean
  readonly onValue: (value: JsonValue | undefined, deletion?: FieldValueDeletion) => void
  readonly onVariable: (name: string | undefined) => void
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
      ? upstreamSource(upstream.current[0]!.nodeId, upstream.current[0]!.output, upstream.current[0]!.field)
      : connected
        ? JSON.stringify(['upstream'])
        : literalSource
  const sourceKind = bound ? 'variable' : connected ? 'upstream' : 'literal'
  const sourcePortal = sourceContainer?.closest<HTMLElement>('.editor-context-panel') ?? sourceContainer
  const sourceOption = (nodeId: string, { description, output, field, fields, check }: InputSourceCandidate, label: string) => {
    const selected = sourceKind === 'upstream' && currentSource === upstreamSource(nodeId, output, field)
    const status = check.kind == 'schema' ? t('inspector.sources.incompatible') : check.kind == 'schema-error' ? t('inspector.sources.unverified') : undefined
    const itemKey = upstreamSource(nodeId, output, field)
    const sourceDescription = description?.trim()
    const item = (
      <DropdownMenuRadioItem
        key={itemKey}
        className={`${sourceItemClass} ${status == null || selected ? 'pr-8' : 'pr-20'}`}
        value={itemKey}
        closeOnClick
        aria-description={sourceDescription}
      >
        <i
          aria-hidden="true"
          className={`${
            fields?.length
              ? `${editorComponentIcons.object} ${status == null ? 'text-muted-foreground' : ''}`
              : check.kind == 'available'
                ? 'i-lucide-light:corner-down-right text-muted-foreground'
                : check.kind == 'schema'
                  ? 'i-lucide-light:triangle-alert'
                  : 'i-lucide-light:circle-help'
          } size-3.5 shrink-0`}
          style={status == null ? undefined : { color: 'var(--warning-foreground)' }}
        />
        <span className="min-w-0 flex-1 truncate font-mono" title={label}>
          {label}
        </span>
        {!selected && status != null && (
          <span className="pointer-events-none absolute right-2 shrink-0 text-[10px] leading-4" style={{ color: 'var(--warning-foreground)' }}>
            {status}
          </span>
        )}
        {selected && status != null && <span className="sr-only">{status}</span>}
      </DropdownMenuRadioItem>
    )
    if (sourceDescription == null || sourceDescription === '') return item
    // Intentionally use Base UI directly: source-option tooltips belong to a nested menu surface
    // and require its pointer-transparent portal and fixed side positioning, not the shared control-tooltip contract.
    return (
      <TooltipPrimitive.Root key={itemKey}>
        <TooltipPrimitive.Trigger render={item} />
        <TooltipPrimitive.Portal container={sourcePortal} className="contents">
          <TooltipPrimitive.Positioner side="right" align="start" sideOffset={8} positionMethod="fixed" className="pointer-events-none isolate z-[1000]">
            <TooltipPrimitive.Popup className="pointer-events-none max-w-64 rounded-md bg-foreground px-3 py-2 text-xs leading-5 text-background shadow-md outline-none">
              {sourceDescription}
              <TooltipPrimitive.Arrow className="size-2.5 rotate-45 rounded-[2px] bg-foreground fill-foreground data-[side=bottom]:top-1 data-[side=left]:-right-1 data-[side=right]:-left-1 data-[side=top]:-bottom-2.5" />
            </TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    )
  }
  const selectUpstream = (next: string) => {
    const [, nodeId, output, field] = JSON.parse(next) as [string, string, string, string | null]
    upstream?.onChange({ nodeId, output, ...(field == null ? {} : { field }) })
  }
  const sourceControl =
    disabled || fixed ? undefined : (
      <div ref={setSourceContainer} className="flex items-center">
        <DropdownMenu
          onOpenChange={(open) => {
            setSourceOpen(open)
            if (open && variables.enabled) variables.onOpen()
          }}
        >
          <Tooltip disabled={sourceOpen}>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="aria-pressed:bg-[var(--ui-control-hover-background,var(--ui-muted))] aria-pressed:text-foreground"
                      aria-label={`${fieldLabel} ${t('inspector.sources.select')}`}
                      aria-pressed={sourceKind !== 'literal'}
                      disabled={disabled}
                    >
                      <i aria-hidden="true" className="i-lucide-light:link" />
                    </Button>
                  }
                />
              }
            />
            <TooltipContent container={sourcePortal}>{t('inspector.sources.select')}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" sideOffset={6} className={`w-44 min-w-44 ${selectionMenuContentClass}`} container={sourcePortal}>
            <MenuHeader>{t('inspector.sources.title')}</MenuHeader>
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
                              (source.field === undefined || candidate.fields?.some((child) => child.field === source.field)),
                          ),
                      )
                      .map((source) => (
                        <DropdownMenuRadioItem
                          className={sourceItemClass}
                          key={upstreamSource(source.nodeId, source.output, source.field)}
                          value={upstreamSource(source.nodeId, source.output, source.field)}
                          disabled
                        >
                          <i aria-hidden="true" className="i-lucide-light:corner-down-right size-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate font-mono" title={sourceOutputLabel(source)}>
                            {sourceOutputLabel(source)}
                          </span>
                        </DropdownMenuRadioItem>
                      ))}
                    {group.outputs.map((candidate) =>
                      candidate.fields?.length ? (
                        <DropdownMenuSub key={candidate.output}>
                          <DropdownMenuSubTrigger
                            className={`${sourceSubTriggerClass} ${connected && upstream.current.some((source) => source.nodeId === group.nodeId && source.output === candidate.output) ? 'bg-accent' : ''}`}
                          >
                            <i aria-hidden="true" className="i-lucide-light:corner-down-right size-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate font-mono" title={candidate.output}>
                              {candidate.output}
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
                        sourceOption(group.nodeId, candidate, candidate.output)
                      ),
                    )}
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
    ) : llm ? (
      <LlmInputEditor addon={sourceControl} schema={schema} value={value} disabled={disabled} handleNames={handleNames} label={fieldLabel} onChange={onValue} />
    ) : undefined
  return (
    <Field className={embedded ? 'gap-0' : 'p-3'}>
      {!embedded && <FieldLabel>{fieldLabel}</FieldLabel>}
      <FieldValueEditor
        {...presentation}
        validationError={validationError}
        onInvalidChange={connected || bound || sourceMissing ? undefined : onInvalidChange}
        valueAddon={llm && !connected && !bound ? undefined : sourceControl}
        description={presentation?.description ?? fieldDescription}
        schema={schema}
        nullable={nullable}
        value={value}
        label={fieldLabel}
        path={`/${fieldLabel.replaceAll('~', '~0').replaceAll('/', '~1')}`}
        disabled={disabled}
        valueEditable={!connected && !bound && !sourceMissing}
        editor={customEditor ?? editor}
        onDraftIssue={draftIssue}
        onChange={(next, deletion) => onValue(next as JsonValue | undefined, deletion)}
      />
    </Field>
  )
}
