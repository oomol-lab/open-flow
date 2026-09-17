import styles from './nodeInputValue.module.scss'
import type { TFunction } from 'val-i18n'
import type { InputSourceCandidate, InputSourceCheck, InputSourcesCheck } from '../../../../flow/common/graph.ts'
import type { ValueEditorProps } from '../../../../form/browser/valueEditor.tsx'
import type { VariablePickerProps } from '../../../../ui/browser/variable-picker.tsx'
import type { InputPort, JsonValue } from '../api.ts'
import type { InputSourceQuery } from '../revisionView.ts'

import { useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { variableInputCompatible } from '../../../../flow/common/schema.ts'
import { ValueEditor, ValueEditorFeedback } from '../../../../form/browser/valueEditor.tsx'
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
    readonly nodeName: string
    readonly output: string
    readonly check: InputSourceCheck | undefined
  }[]
  readonly groups: readonly {
    readonly icon?: string
    readonly nodeId: string
    readonly nodeName: string
    readonly outputs: readonly InputSourceCandidate[]
  }[]
  readonly onChange: (source: { readonly nodeId: string; readonly output: string }) => void
}
const draftIssue = () => {}
const variableSource = (name: string) => JSON.stringify(['variable', name])
const upstreamSource = (nodeId: string, output: string) => JSON.stringify(['upstream', nodeId, output])
const sourceItemClass = 'min-h-8 gap-2 px-2 py-1 text-xs'
const sourceEmptyItemClass = `${sourceItemClass} font-normal text-muted-foreground data-disabled:opacity-100`
const sourceSubTriggerClass = 'min-h-8 gap-2 px-2 py-1 text-xs'

function inputSourceIssue(check: InputSourceCheck | undefined, source: NodeInputUpstreamSources['current'][number], t: TFunction): string | undefined {
  switch (check?.kind) {
    case undefined:
    case 'available':
      return
    case 'source-missing':
      return t('inspector.sources.sourceMissing', { source: source.nodeName })
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
  upstream,
  variableName,
  variables,
}: {
  readonly bound: boolean
  readonly connected: boolean
  readonly upstream?: NodeInputUpstreamSources
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
  const sourceIssue = missingVariable
    ? !variables.enabled
      ? t('variablePicker.variableUnavailableHelp')
      : t('variablePicker.variableMissingHelp', { name: variableName })
    : checks?.conflict
      ? t('inspector.sources.sourceConflict', { sources: current?.map((source) => `${source.nodeName} ${source.output}`).join(', ') })
      : invalidUpstream != null
        ? inputSourceIssue(invalidUpstream.check, invalidUpstream, t)
        : undefined
  const sourceLabel = bound
    ? variableName
    : current?.length
      ? current.map((source) => `${source.nodeName} ${source.output}`).join(' / ')
      : t('nodeInput.connected')
  const selectedUpstreamIcon = connected && current?.length === 1 ? current[0]?.icon : undefined
  const sourceTooltip = connected && current?.length ? current.map((source) => source.description?.trim() || source.output).join('\n') : undefined
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
              <i aria-hidden="true" className="i-heroicons:variable-20-solid mr-2 size-3.5 shrink-0 text-muted-foreground" />
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

export function NodeInputValue({
  definition,
  presentation,
  upstream: providedUpstream,
  embedded = false,
  handleNames = [],
  value,
  connected,
  variableName,
  variables,
  disabled,
  onValue,
  onVariable,
}: {
  readonly presentation?: Pick<
    ValueEditorProps,
    'layout' | 'header' | 'leadingControl' | 'valueAddon' | 'trailingControl' | 'description' | 'options' | 'onDefinitionChange'
  >
  readonly upstream?: NodeInputUpstreamSources
  readonly embedded?: boolean
  readonly handleNames?: readonly string[]
  readonly definition: InputPort
  readonly value: JsonValue | undefined
  readonly connected: boolean
  readonly variableName?: string
  readonly variables: InputVariables
  readonly disabled: boolean
  readonly onValue: (value: JsonValue | undefined) => void
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
  const llm = supportsLlmInput(definition.jsonSchema, value)
  const bound = variableName != null
  const variableCompatible = variableInputCompatible(definition.jsonSchema)
  const literalSource = JSON.stringify(['literal'])
  const currentSource = bound
    ? variableSource(variableName)
    : connected && upstream?.current.length === 1
      ? upstreamSource(upstream.current[0]!.nodeId, upstream.current[0]!.output)
      : connected
        ? JSON.stringify(['upstream'])
        : literalSource
  const sourceKind = bound ? 'variable' : connected ? 'upstream' : 'literal'
  const sourcePortal = sourceContainer?.closest<HTMLElement>('.editor-context-panel') ?? sourceContainer
  const sourceControl = disabled ? undefined : (
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
                    aria-label={`${definition.handle} ${t('inspector.sources.title')}`}
                    aria-pressed={sourceKind !== 'literal'}
                    disabled={disabled}
                  >
                    <i aria-hidden="true" className="i-lucide-light:link" />
                  </Button>
                }
              />
            }
          />
          <TooltipContent container={sourcePortal}>{t('inspector.sources.title')}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="w-44 min-w-44 rounded-[var(--ui-control-radius,var(--ui-radius))] p-1"
          container={sourcePortal}
        >
          <div className="px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{t('inspector.sources.title')}</div>
          <DropdownMenuSeparator className="mx-1 bg-border/50" />
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
          {variableCompatible ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={`${sourceSubTriggerClass} ${sourceKind === 'variable' ? 'bg-accent/60' : ''}`}>
                <i aria-hidden="true" className="i-heroicons:variable-20-solid size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{t('nodeInput.variable')}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48 min-w-48 rounded-[var(--ui-control-radius,var(--ui-radius))] p-1" container={sourcePortal}>
                <DropdownMenuRadioGroup
                  value={sourceKind === 'variable' ? currentSource : ''}
                  onValueChange={(next) => {
                    const [, name] = JSON.parse(next) as [string, string]
                    onVariable(name)
                  }}
                >
                  {bound && !variables.names.includes(variableName) && (
                    <DropdownMenuRadioItem className={sourceItemClass} value={variableSource(variableName)} disabled>
                      <i aria-hidden="true" className="i-heroicons:variable-20-solid size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate font-mono">{variableName}</span>
                    </DropdownMenuRadioItem>
                  )}
                  {variables.enabled &&
                    variables.names.map((name) => (
                      <DropdownMenuRadioItem className={sourceItemClass} key={name} value={variableSource(name)} closeOnClick>
                        <i aria-hidden="true" className="i-heroicons:variable-20-solid size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate font-mono">{name}</span>
                      </DropdownMenuRadioItem>
                    ))}
                  {variables.enabled && variables.loading && variables.names.length === 0 && (
                    <DropdownMenuItem className={sourceEmptyItemClass} disabled>
                      {t('variablePicker.variablesLoading')}
                    </DropdownMenuItem>
                  )}
                  {variables.enabled && !variables.loading && variables.names.length === 0 && !bound && (
                    <DropdownMenuItem className={sourceEmptyItemClass} disabled>
                      {t('nodeInput.noVariables')}
                    </DropdownMenuItem>
                  )}
                  {!variables.enabled && !bound && (
                    <DropdownMenuItem className={sourceEmptyItemClass} disabled>
                      {t('variablePicker.variableUnavailableHelp')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            <DropdownMenuItem className={`${sourceItemClass} data-disabled:opacity-70 ${sourceKind === 'variable' ? 'bg-accent/60' : ''}`} disabled>
              <i aria-hidden="true" className="i-heroicons:variable-20-solid size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{t('nodeInput.variable')}</span>
              <span className="ml-auto flex h-4 shrink-0 items-center justify-end text-right text-[10px] leading-4 text-muted-foreground">
                {t('nodeInput.unsupported')}
              </span>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator className="mx-1 bg-border/50" />
          {candidates.pending || candidates.failed ? (
            <DropdownMenuItem className={sourceEmptyItemClass} disabled>
              {t(candidates.failed ? 'inspector.sources.loadFailed' : 'inspector.sources.loading')}
            </DropdownMenuItem>
          ) : (
            (upstream?.groups.length ?? 0) === 0 && (
              <DropdownMenuItem className={sourceEmptyItemClass} disabled>
                <i aria-hidden="true" className="i-lucide-light:workflow size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{t('nodeInput.noUpstreamNodes')}</span>
              </DropdownMenuItem>
            )
          )}
          {upstream?.groups.map((group) => (
            <DropdownMenuSub key={group.nodeId}>
              <DropdownMenuSubTrigger
                className={`${sourceSubTriggerClass} ${connected && upstream.current.some((source) => source.nodeId === group.nodeId) ? 'bg-accent/60' : ''}`}
              >
                <ContentIcon
                  src={group.icon}
                  className="size-3.5 shrink-0 data-[icon-kind=initials]:text-[16px]"
                  fallback={<i aria-hidden="true" className="i-lucide-light:workflow size-3.5 shrink-0 text-muted-foreground" />}
                />
                <span className="min-w-0 flex-1 truncate">{group.nodeName}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48 min-w-48 rounded-[var(--ui-control-radius,var(--ui-radius))] p-1" container={sourcePortal}>
                <DropdownMenuRadioGroup
                  value={sourceKind === 'upstream' && upstream.current.length === 1 && upstream.current[0]?.nodeId === group.nodeId ? currentSource : ''}
                  onValueChange={(next) => {
                    const [, nodeId, output] = JSON.parse(next) as [string, string, string]
                    upstream?.onChange({ nodeId, output })
                  }}
                >
                  {upstream.current
                    .filter(
                      (source) =>
                        source.nodeId === group.nodeId &&
                        source.check != null &&
                        source.check.kind != 'available' &&
                        !group.outputs.some((candidate) => candidate.output === source.output),
                    )
                    .map((source) => (
                      <DropdownMenuRadioItem className={sourceItemClass} key={source.output} value={upstreamSource(source.nodeId, source.output)} disabled>
                        <i aria-hidden="true" className="i-lucide-light:corner-down-right size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate font-mono">{source.output}</span>
                      </DropdownMenuRadioItem>
                    ))}
                  {group.outputs.map(({ output, check }) => {
                    const selected = sourceKind === 'upstream' && currentSource === upstreamSource(group.nodeId, output)
                    const status =
                      check.kind == 'schema'
                        ? t('inspector.sources.incompatible')
                        : check.kind == 'schema-error'
                          ? t('inspector.sources.unverified')
                          : undefined
                    return (
                      <DropdownMenuRadioItem
                        className={`${sourceItemClass} ${status == null || selected ? 'pr-8' : 'pr-20'}`}
                        key={output}
                        value={upstreamSource(group.nodeId, output)}
                        closeOnClick
                      >
                        <i
                          aria-hidden="true"
                          className={`${
                            check.kind == 'available'
                              ? 'i-lucide-light:corner-down-right text-muted-foreground'
                              : check.kind == 'schema'
                                ? 'i-lucide-light:triangle-alert'
                                : 'i-lucide-light:circle-help'
                          } size-3.5 shrink-0`}
                          style={status == null ? undefined : { color: 'var(--warning-foreground)' }}
                        />
                        <span className="min-w-0 flex-1 truncate font-mono">{output}</span>
                        {!selected && status != null && (
                          <span className="pointer-events-none absolute right-2 shrink-0 text-[10px] leading-4" style={{ color: 'var(--warning-foreground)' }}>
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
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
  const editor =
    connected || bound ? (
      <SelectedSourceValue bound={bound} connected={connected} upstream={providedUpstream} variableName={variableName} variables={variables} />
    ) : llm ? (
      <LlmInputEditor addon={sourceControl} schema={definition.jsonSchema} value={value} disabled={disabled} handleNames={handleNames} onChange={onValue} />
    ) : undefined
  return (
    <Field className={embedded ? 'gap-0' : 'p-3'}>
      {!embedded && <FieldLabel>{definition.handle}</FieldLabel>}
      <ValueEditor
        {...presentation}
        valueAddon={llm && !connected && !bound ? undefined : sourceControl}
        description={presentation?.description ?? definition.description}
        schema={definition.jsonSchema}
        nullable={definition.nullable}
        value={value}
        label={definition.handle}
        path={`/${definition.handle.replaceAll('~', '~0').replaceAll('/', '~1')}`}
        disabled={disabled}
        valueEditable={!connected && !bound}
        editor={editor}
        onDraftIssue={draftIssue}
        onChange={(next) => onValue(next as JsonValue | undefined)}
      />
    </Field>
  )
}
