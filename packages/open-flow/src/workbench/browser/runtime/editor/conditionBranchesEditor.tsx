import './conditionBranchesEditor.scss'
import type { ConditionExpression, ConditionOperand, JsonValue, Source } from '../../../../flow/common/change.ts'
import type { FieldValueDeletion } from '../../../../form/common/fieldValue.ts'
import type { ConditionSettings } from './flowChanges.ts'
import type { PropertyDeletion } from './propertyDeletion.ts'
import type { InputVariables, NodeInputUpstreamSources } from './sourceValueEditor.tsx'

import { useEffect, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { operandHandle, operatorsForType, otherwiseOutput, unaryOperator, valueType, comparisonIssue } from '../../../../flow/common/condition.ts'
import { ValueEditorFeedback } from '../../../../form/browser/fieldControl.tsx'
import { FieldBody } from '../../../../form/browser/fieldLayout.tsx'
import { FieldSelect } from '../../../../form/browser/fieldSelect.tsx'
import { FieldTypeAddon } from '../../../../form/browser/fieldTypeAddon.tsx'
import { selectionMenuContentClass, selectionMenuItemClass } from '../../../../form/browser/selectionMenuStyles.ts'
import { valueForEditor } from '../../../../form/common/editorComponent.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../../../ui/browser/dropdown-menu.tsx'
import { Field, FieldLabel, FieldDescription } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Popover, PopoverPanelContent } from '../../../../ui/browser/popover.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { fieldPanelAnchor } from './fieldPanelAnchor.ts'
import { FieldSectionHeader } from './fieldSectionHeader.tsx'
import { SourceValueEditor } from './sourceValueEditor.tsx'

const emptyExpression = (): ConditionExpression => ({ left: { kind: 'value' }, operator: '==', right: { kind: 'value' } })
const operatorSymbols: Readonly<Record<string, string>> = { '==': '=', '!=': '≠', '<': '<', '<=': '≤', '>': '>', '>=': '≥' }
const noVariables: InputVariables = { enabled: false, loaded: true, loading: false, names: [], onOpen() {} }

export function conditionCaseIssues(
  item: ConditionSettings['cases'][number],
  operandErrors: Readonly<Record<string, boolean>>,
  operandType: (operand: ConditionOperand | undefined) => string | undefined,
): { readonly case: boolean; readonly groups: readonly ('incomplete' | 'contains' | undefined)[] } {
  const groups = item.groups.map((group, g) =>
    group.expressions.length === 0
      ? 'incomplete'
      : group.expressions.some(
            (expression, e) =>
              comparisonIssue(expression.operator, operandType(expression.left), operandType(expression.right)) != null ||
              operandErrors[`${item.output}/${g}/${e}/left`] ||
              (!unaryOperator(expression.operator) && operandErrors[`${item.output}/${g}/${e}/right`]),
          )
        ? 'contains'
        : undefined,
  )
  return { case: item.groups.length === 0 || groups.some(Boolean), groups }
}

function OutputName({
  value,
  names,
  disabled,
  error,
  onChange,
}: {
  error?: string
  value: string
  names: readonly string[]
  disabled: boolean
  onChange: (value: string) => void
}) {
  const t = useTranslate()
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    setDraft(value)
  }, [value])
  const invalid =
    draft.trim() === '' || draft === '__proto__' || draft === otherwiseOutput || names.filter((name) => name === draft).length > (draft === value ? 1 : 0)
  const save = () => {
    if (!disabled && !invalid && draft !== value) onChange(draft)
  }
  return (
    <ValueEditorFeedback error={error}>
      {(errorId) => (
        <Input
          aria-describedby={errorId}
          controlSize="field"
          aria-label={t('conditionEditor.handleKeyTitle')}
          aria-invalid={invalid || error != null}
          readOnly={disabled}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save()
            else if (event.key === 'Escape') setDraft(value)
          }}
        />
      )}
    </ValueEditorFeedback>
  )
}

const toggle = (key: string, set: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>) =>
  set((previous) => {
    const next = new Set(previous)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

export function ConditionBranchesEditor({
  value: configuration,
  disabled,
  onChange,
  renderSource,
  variables = noVariables,
  variableName,
  onVariable,
  sourceType,
}: {
  readonly value: ConditionSettings
  readonly disabled: boolean
  readonly onChange: (value: ConditionSettings, deletion?: PropertyDeletion) => void
  readonly renderSource?: (handle: string) => NodeInputUpstreamSources | undefined
  readonly variables?: InputVariables
  readonly variableName?: (source: Source) => string | undefined
  readonly onVariable?: (handle: string, name: string | undefined) => void
  readonly sourceType?: (source: Source) => string | undefined
}) {
  const value: ConditionSettings = { cases: configuration.cases, matchMode: configuration.matchMode }
  const t = useTranslate()
  const operandType = (operand: ConditionOperand | undefined) =>
    operand?.kind == 'source' ? sourceType?.(operand.source) : operand?.value === undefined ? undefined : valueType(operand.value)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(value.cases.filter((item) => !conditionCaseIssues(item, {}, operandType).case).map((item) => item.output)),
  )
  const manuallyToggledCases = useRef<ReadonlySet<string>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set())
  const [sorting, setSorting] = useState(false)
  const [drag, setDrag] = useState<number>()
  const [editingCase, setEditingCase] = useState<number>()
  const [menuContainer, setMenuContainer] = useState<HTMLDivElement | null>(null)
  const [operandErrors, setOperandErrors] = useState<Readonly<Record<string, boolean>>>({})
  const caseIssues = new Map(value.cases.map((item) => [item.output, conditionCaseIssues(item, operandErrors, operandType)]))
  const invalidCases = value.cases.filter((item) => caseIssues.get(item.output)?.case).map((item) => item.output)
  const invalidCaseKey = invalidCases.join('\0')
  useEffect(() => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      for (const output of invalidCases) if (!manuallyToggledCases.current.has(output)) next.delete(output)
      return next.size === previous.size ? previous : next
    })
  }, [invalidCaseKey])
  const names = value.cases.map((item) => item.output)
  const nextName = () => {
    let name = 'case'
    let index = 2
    while (names.includes(name)) name = `case${index++}`
    return name
  }
  const addCase = () => onChange({ ...value, cases: [...value.cases, { output: nextName(), groups: [{ expressions: [emptyExpression()] }] }] })
  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.cases.length || from === to) return
    const cases = [...value.cases]
    cases.splice(to, 0, cases.splice(from, 1)[0]!)
    setEditingCase(undefined)
    onChange({ ...value, cases })
  }
  const iconButton = (label: string, icon: string, click: () => void, danger = false) => (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={click}
      className={danger ? 'hover:bg-destructive/10 hover:text-destructive' : undefined}
    >
      <i aria-hidden="true" className={icon} />
    </Button>
  )
  return (
    <div data-inspector-section="condition">
      <section className="condition-editor">
        <FieldSectionHeader
          title={t('conditionEditor.cases')}
          disabled={disabled}
          canSort={value.cases.length > 1}
          sorting={sorting}
          onToggleSorting={() => {
            setDrag(undefined)
            setEditingCase(undefined)
            setSorting(!sorting)
          }}
          addLabel={t('conditionEditor.addCase')}
          onAdd={addCase}
        />
        <div ref={setMenuContainer} className="condition-editor-content">
          {value.cases.map((item, c) => {
            const save = (next: typeof item, deletion?: FieldValueDeletion) => onChange({ ...value, cases: value.cases.with(c, next) }, deletion)
            const renameOutput = (output: string) => {
              setCollapsed((previous) => new Set([...previous].map((name) => (name === item.output ? output : name))))
              manuallyToggledCases.current = new Set([...manuallyToggledCases.current].map((name) => (name === item.output ? output : name)))
              save({ ...item, output })
            }
            const open = !collapsed.has(item.output)
            const singleCondition = item.groups.length === 1 && item.groups[0]?.expressions.length === 1
            const groupErrors = caseIssues
              .get(item.output)!
              .groups.map((issue) =>
                issue == 'incomplete' ? t('conditionEditor.incomplete') : issue == 'contains' ? t('conditionEditor.containsErrors') : undefined,
              )
            const add = (g: number, e: number, or: boolean) =>
              save({
                ...item,
                groups: or
                  ? item.groups.toSpliced(g + 1, 0, { expressions: [emptyExpression()] })
                  : item.groups.map((group, index) => (index !== g ? group : { expressions: group.expressions.toSpliced(e + 1, 0, emptyExpression()) })),
              })
            const addMenu = (g: number, e: number) => (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('conditionEditor.addCondition')}
                      title={t('conditionEditor.addCondition')}
                      disabled={disabled}
                    />
                  }
                >
                  <i aria-hidden="true" className="i-tabler-light:square-rounded-plus text-lg" />
                </DropdownMenuTrigger>
                <DropdownMenuContent container={menuContainer} align="end" className={`min-w-56 ${selectionMenuContentClass}`}>
                  <DropdownMenuItem className={`${selectionMenuItemClass} gap-2 px-2`} onClick={() => add(g, e, false)}>
                    <span className="condition-logic w-10 shrink-0">AND</span>
                    <span className="ml-auto text-right">{t('conditionEditor.addAnd')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem className={`${selectionMenuItemClass} gap-2 px-2`} onClick={() => add(g, e, true)}>
                    <span className="condition-logic w-10 shrink-0">OR</span>
                    <span className="ml-auto text-right">{t('conditionEditor.addOr')}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )
            const removeCase = () => onChange({ ...value, cases: value.cases.toSpliced(c, 1) }, { target: 'case', name: item.output })
            const caseSettings = (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      data-case-settings
                      aria-label={t('conditionEditor.caseSettings')}
                      aria-expanded={editingCase === c}
                      onClick={() => setEditingCase(editingCase === c ? undefined : c)}
                    />
                  }
                >
                  <i aria-hidden="true" className="i-lucide-light:settings text-base" />
                </TooltipTrigger>
                <TooltipContent container={menuContainer}>{t('conditionEditor.caseSettings')}</TooltipContent>
              </Tooltip>
            )
            return (
              <div
                className="condition-case"
                key={item.output}
                onDragOver={(event) => {
                  if (sorting) event.preventDefault()
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  if (drag != null) move(drag, c)
                  setDrag(undefined)
                }}
              >
                <div className="condition-case-heading" data-condition-case-index={c}>
                  {sorting && !disabled ? (
                    <Button
                      type="button"
                      variant="disclosure"
                      size="icon-xs"
                      draggable
                      aria-label={t('inspector.ports.reorder', { name: item.output })}
                      title={t('inspector.ports.reorderHint')}
                      onDragStart={() => setDrag(c)}
                      onDragEnd={() => setDrag(undefined)}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                          event.preventDefault()
                          move(c, c + (event.key === 'ArrowUp' ? -1 : 1))
                        }
                      }}
                    >
                      <i aria-hidden="true" className="i-lucide-light:grip-vertical" />
                    </Button>
                  ) : item.groups.length === 0 && disabled ? (
                    <span aria-hidden="true" />
                  ) : (
                    <Button
                      type="button"
                      variant="disclosure"
                      size="icon-xs"
                      aria-expanded={open}
                      aria-label={item.output}
                      onClick={() => {
                        manuallyToggledCases.current = new Set(manuallyToggledCases.current).add(item.output)
                        toggle(item.output, setCollapsed)
                      }}
                    >
                      <i aria-hidden="true" className={open ? 'i-lucide-light:chevron-down' : 'i-lucide-light:chevron-right'} />
                    </Button>
                  )}
                  <OutputName
                    error={item.groups.length === 0 ? t('conditionEditor.conditionRequired') : !open ? groupErrors.find(Boolean) : undefined}
                    value={item.output}
                    names={names}
                    disabled={disabled}
                    onChange={renameOutput}
                  />
                  {!disabled && caseSettings}
                </div>
                {(item.groups.length > 0 || !disabled) && (
                  <FieldBody
                    placement="branch"
                    className="condition-groups"
                    endpoint={singleCondition || item.groups.length === 0 ? 'control' : 'marker'}
                    hidden={!open}
                  >
                    {item.groups.length === 0 && !disabled && (
                      <div className="condition-case-empty">
                        <Button
                          type="button"
                          variant="ghost"
                          size="field"
                          onClick={() => {
                            setCollapsed((previous) => new Set([...previous].filter((name) => name !== item.output)))
                            save({ ...item, groups: [{ expressions: [emptyExpression()] }] })
                          }}
                        >
                          <i aria-hidden="true" className="i-lucide-light:plus" />
                          {t('conditionEditor.addCondition')}
                        </Button>
                      </div>
                    )}
                    {item.groups.map((group, g) => {
                      const groupKey = `${item.output}/${g}`
                      const groupOpen = !collapsedGroups.has(groupKey)
                      return (
                        <div key={g} className="condition-group">
                          {g > 0 && (
                            <div className="condition-or">
                              <span className="condition-logic">OR</span>
                            </div>
                          )}
                          {!singleCondition && (
                            <ValueEditorFeedback error={groupOpen && group.expressions.length === 0 ? groupErrors[g] : undefined}>
                              {(errorId) => (
                                <div
                                  className="condition-group-heading"
                                  data-invalid={group.expressions.length === 0 || (!groupOpen && groupErrors[g] != null) || undefined}
                                >
                                  <Button
                                    type="button"
                                    variant="disclosure"
                                    size="icon-xs"
                                    aria-expanded={groupOpen}
                                    aria-label={`AND ${g + 1}`}
                                    aria-describedby={errorId}
                                    aria-invalid={groupOpen && group.expressions.length === 0}
                                    onClick={() => toggle(groupKey, setCollapsedGroups)}
                                  >
                                    <i aria-hidden="true" className={groupOpen ? 'i-lucide-light:chevron-down' : 'i-lucide-light:chevron-right'} />
                                  </Button>
                                  <span className="condition-logic">AND</span>
                                  <span className="condition-group-summary">{t('conditionEditor.groupSummary')}</span>
                                </div>
                              )}
                            </ValueEditorFeedback>
                          )}
                          <div className="condition-expressions" hidden={!singleCondition && !groupOpen}>
                            {group.expressions.length === 0 && <div className="flex items-center justify-between">{!disabled && addMenu(g, -1)}</div>}
                            {group.expressions.map((expression, e) => {
                              const change = (next: typeof expression, deletion?: FieldValueDeletion) =>
                                save({ ...item, groups: item.groups.with(g, { expressions: group.expressions.with(e, next) }) }, deletion)
                              const available = operatorsForType(operandType(expression.left))
                              const issue = comparisonIssue(expression.operator, operandType(expression.left), operandType(expression.right))
                              const invalid = issue?.target === 'operator'
                              const rightInvalid = issue?.target === 'right'
                              const renderOperand = (side: 'left' | 'right') => {
                                const operand = expression[side] ?? { kind: 'value' as const }
                                const handle = operandHandle(c, g, e, side)
                                const schema =
                                  operand.kind === 'value'
                                    ? (operand.jsonSchema ?? { type: operand.value === undefined ? 'string' : valueType(operand.value) })
                                    : {}
                                const changeDefinition = (jsonSchema: unknown, next: unknown, deletion?: FieldValueDeletion) =>
                                  change(
                                    {
                                      ...expression,
                                      [side]: {
                                        kind: 'value',
                                        jsonSchema: jsonSchema as JsonValue,
                                        ...(next === undefined ? {} : { value: next as JsonValue }),
                                      },
                                    },
                                    deletion,
                                  )
                                return (
                                  <div className="condition-operand">
                                    <SourceValueEditor
                                      embedded
                                      validationError={side === 'right' && rightInvalid ? t('conditionEditor.incompatibleRight') : undefined}
                                      onInvalidChange={(operandInvalid) => {
                                        const key = `${item.output}/${g}/${e}/${side}`
                                        setOperandErrors((previous) => (previous[key] === operandInvalid ? previous : { ...previous, [key]: operandInvalid }))
                                      }}
                                      label={t(side === 'left' ? 'conditionEditor.left' : 'conditionEditor.right')}
                                      schema={schema}
                                      nullable={operand.kind === 'source' || (operand.kind === 'value' && operand.value === null)}
                                      presentation={{
                                        compact: true,
                                        layout: 'ports',
                                        hideOptions: true,
                                        onDefinitionChange: changeDefinition,
                                        valueSuffix:
                                          operand.kind === 'value' && !disabled ? (
                                            <FieldTypeAddon
                                              schema={schema}
                                              name={t(side === 'left' ? 'conditionEditor.left' : 'conditionEditor.right')}
                                              onChange={(next) => changeDefinition(next, valueForEditor(next, operand.value))}
                                            />
                                          ) : undefined,
                                      }}
                                      value={operand.kind === 'value' ? operand.value : undefined}
                                      connected={operand.kind === 'source' && operand.source.kind !== 'binding'}
                                      sourceMissing={operand.kind === 'source' && operand.source.kind === 'binding' && variableName?.(operand.source) == null}
                                      variableName={operand.kind === 'source' ? variableName?.(operand.source) : undefined}
                                      variables={variables}
                                      disabled={disabled}
                                      upstream={renderSource?.(handle)}
                                      onValue={(next, deletion) =>
                                        change(
                                          {
                                            ...expression,
                                            [side]: {
                                              kind: 'value',
                                              jsonSchema: schema,
                                              ...(next === undefined ? {} : { value: next }),
                                            },
                                          },
                                          deletion,
                                        )
                                      }
                                      onVariable={(name) => onVariable?.(handle, name)}
                                    />
                                  </div>
                                )
                              }
                              return (
                                <div key={e} className="condition-expression" data-unary={unaryOperator(expression.operator) || undefined}>
                                  {renderOperand('left')}
                                  <ValueEditorFeedback error={invalid ? t('conditionEditor.incompatible') : undefined}>
                                    {(errorId) => (
                                      <FieldSelect
                                        aria-label={t('conditionEditor.label')}
                                        aria-invalid={invalid}
                                        aria-describedby={errorId}
                                        disabled={disabled}
                                        value={expression.operator}
                                        displayValue={operatorSymbols[expression.operator]}
                                        showTooltip
                                        onChange={(next) => {
                                          const operator = next as ConditionExpression['operator']
                                          const { right, ...base } = expression
                                          change({ ...base, operator, ...(unaryOperator(operator) ? {} : { right: right ?? { kind: 'value' } }) })
                                        }}
                                      >
                                        {[...new Set([expression.operator, ...available])].map((operator) => (
                                          <option key={operator} value={operator}>
                                            {t(`conditionEditor.operator.${operator}`)}
                                          </option>
                                        ))}
                                      </FieldSelect>
                                    )}
                                  </ValueEditorFeedback>
                                  {!unaryOperator(expression.operator) && renderOperand('right')}
                                  {!disabled && (
                                    <div className="condition-expression-actions">
                                      {addMenu(g, e)}
                                      {iconButton(
                                        t('valueEditor.remove'),
                                        'i-tabler-light:square-rounded-minus text-lg',
                                        () =>
                                          onChange(
                                            {
                                              ...value,
                                              cases: value.cases.with(c, {
                                                ...item,
                                                groups:
                                                  group.expressions.length === 1
                                                    ? item.groups.toSpliced(g, 1)
                                                    : item.groups.with(g, { expressions: group.expressions.toSpliced(e, 1) }),
                                              }),
                                            },
                                            { target: group.expressions.length === 1 ? 'conditionGroup' : 'condition' },
                                          ),
                                        true,
                                      )}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </FieldBody>
                )}
                {editingCase === c && (
                  <Popover
                    open
                    onOpenChange={(panelOpen) => {
                      if (!panelOpen) {
                        setEditingCase(undefined)
                        menuContainer?.querySelector<HTMLButtonElement>(`[data-condition-case-index="${c}"] [data-case-settings]`)?.focus()
                      }
                    }}
                  >
                    <PopoverPanelContent
                      sectionTitle={t('conditionEditor.cases')}
                      title={t('conditionEditor.caseSettings')}
                      closeLabel={t('common.close')}
                      container={menuContainer?.closest<HTMLElement>('.editor-context-panel') ?? menuContainer}
                      anchor={() => fieldPanelAnchor(menuContainer?.querySelector(`[data-condition-case-index="${c}"]`))}
                      footer={
                        <Button
                          type="button"
                          size="field"
                          variant="destructive"
                          className="ml-auto"
                          onClick={() => {
                            setEditingCase(undefined)
                            removeCase()
                          }}
                        >
                          {t('conditionEditor.deleteCase')}
                        </Button>
                      }
                    >
                      <Field className="gap-1.5">
                        <FieldLabel className="text-xs font-normal text-muted-foreground">{t('conditionEditor.handleKeyTitle')}</FieldLabel>
                        <OutputName value={item.output} names={names} disabled={false} onChange={renameOutput} />
                      </Field>
                      <Field className="gap-1.5">
                        <FieldLabel className="text-xs font-normal text-muted-foreground">{t('inspector.node.description')}</FieldLabel>
                        <Textarea
                          aria-label={t('inspector.node.description')}
                          rows={2}
                          className="min-h-16 max-h-40 resize-y text-xs md:text-xs"
                          value={item.description ?? ''}
                          onChange={(event) => save({ ...item, description: event.target.value })}
                        />
                      </Field>
                    </PopoverPanelContent>
                  </Popover>
                )}
              </div>
            )
          })}
          {value.cases.length === 0 && !disabled && (
            <Button type="button" variant="outline" size="sm" onClick={addCase}>
              {t('conditionEditor.addCase')}
            </Button>
          )}
        </div>
      </section>
      <Field className="inspector-field-section">
        <FieldLabel className="inspector-section-title">{t('conditionEditor.matchMode')}</FieldLabel>
        <div className="node-settings">
          <Field>
            <FieldSelect
              aria-label={t('conditionEditor.matchMode')}
              disabled={disabled}
              value={value.matchMode}
              onChange={(matchMode) => onChange({ ...value, matchMode: matchMode as 'first' | 'all' })}
            >
              <option value="first">{t('conditionEditor.first')}</option>
              <option value="all">{t('conditionEditor.all')}</option>
            </FieldSelect>
            <FieldDescription className="pl-2 text-xs">
              {t(value.matchMode == 'first' ? 'conditionEditor.firstHelp' : 'conditionEditor.allHelp')}
            </FieldDescription>
          </Field>
        </div>
      </Field>
    </div>
  )
}
