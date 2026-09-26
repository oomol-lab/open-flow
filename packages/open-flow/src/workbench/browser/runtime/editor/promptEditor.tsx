import type { WorkbenchTheme } from '../contract.ts'

import { useEffect, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { val } from 'value-enhancer'
import { createCodeEditor } from '../../../../ui/browser/code-editor.ts'

export function PromptEditor({
  ariaDescribedBy,
  invalid,
  value,
  inputs,
  disabled,
  theme,
  onChange,
  onSave,
}: {
  readonly ariaDescribedBy?: string
  readonly invalid?: boolean
  readonly value: string
  readonly inputs: readonly string[]
  readonly disabled: boolean
  readonly theme: WorkbenchTheme
  readonly onChange: (value: string) => void
  readonly onSave: () => void
}) {
  const t = useTranslate()
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<Awaited<ReturnType<typeof createCodeEditor>>>()
  const darkMode = useRef<ReturnType<typeof val<boolean>>>()
  const latest = useRef({ ariaDescribedBy, invalid, value, inputs, disabled, onChange, onSave })
  latest.current = { ariaDescribedBy, invalid, value, inputs, disabled, onChange, onSave }
  const syncing = useRef(false)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const label = t('agent.prompt')
  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    let current: Awaited<ReturnType<typeof createCodeEditor>> | undefined
    const dark = val(theme == 'dark')
    darkMode.current = dark
    const extension = Promise.all([import('@codemirror/view'), import('@codemirror/autocomplete')]).then(
      ([{ ViewPlugin, MatchDecorator, Decoration }, { autocompletion }]) => {
        const matcher = new MatchDecorator({ regexp: /\{\{\s*([^{}\s]+)\s*\}\}/g, decoration: Decoration.mark({ class: 'prompt-input-reference' }) })
        return [
          ViewPlugin.define(
            (view) => ({
              decorations: matcher.createDeco(view),
              update(update) {
                this.decorations = matcher.updateDeco(update, this.decorations)
              },
            }),
            { decorations: (plugin) => plugin.decorations },
          ),
          autocompletion({
            override: [
              (context) => {
                const match = context.matchBefore(/\{\{\s*[^{}\s]*/)
                if (match == null) return null
                const closing = context.state.sliceDoc(context.pos, context.pos + 2) == '}}'
                return {
                  from: match.from,
                  options: latest.current.inputs.map((name) => ({ label: '{{' + name + '}}', type: 'variable', apply: '{{' + name + (closing ? '' : '}}') })),
                }
              },
            ],
          }),
        ]
      },
    )
    void createCodeEditor(
      host.current!,
      'agent-prompt.md',
      {
        ariaDescribedBy: latest.current.ariaDescribedBy,
        invalid: latest.current.invalid,
        ariaLabel: label,
        language: 'markdown',
        value: latest.current.value,
        readOnly: latest.current.disabled,
        wordWrap: 'on',
      },
      { darkMode$: dark, extension },
    )
      .then((created) => {
        if (disposed) {
          created.dispose()
          return
        }
        editor.current = current = created
        created.setValue(latest.current.value)
        created.updateOptions({ readOnly: latest.current.disabled, invalid: latest.current.invalid, ariaDescribedBy: latest.current.ariaDescribedBy })
        unsubscribe = created.onChange(() => {
          if (!syncing.current) latest.current.onChange(created.getValue())
        })
        setState('ready')
      })
      .catch(() => {
        if (!disposed) setState('failed')
      })
    return () => {
      if (current != null && !latest.current.disabled) latest.current.onSave()
      disposed = true
      unsubscribe?.()
      current?.dispose()
      dark.dispose()
      editor.current = undefined
      darkMode.current = undefined
    }
  }, [label])
  useEffect(() => {
    editor.current?.updateOptions({ invalid, ariaDescribedBy })
  }, [invalid, ariaDescribedBy])
  useEffect(() => {
    darkMode.current?.set(theme == 'dark')
  }, [theme])
  useEffect(() => {
    editor.current?.updateOptions({ readOnly: disabled })
  }, [disabled])
  useEffect(() => {
    if (editor.current == null || editor.current.getValue() == value) return
    syncing.current = true
    editor.current.setValue(value)
    syncing.current = false
  }, [value])
  return (
    <div
      className="code-editor"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget) && !disabled) onSave()
      }}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() == 's') {
          event.preventDefault()
          event.stopPropagation()
          if (!disabled) onSave()
        }
      }}
    >
      <div className="code-editor-host" ref={host} />
      {state != 'ready' && (
        <span className="code-editor-state" role={state == 'failed' ? 'alert' : undefined}>
          {t(state == 'failed' ? 'inspector.task.editorUnavailable' : 'inspector.task.editorLoading')}
        </span>
      )}
    </div>
  )
}
