import type { ReactElement } from 'react'
import type { WorkbenchTheme } from '../contract.ts'

import { useEffect, useRef, useState } from 'react'
import { val } from 'value-enhancer'
import { CodeMirrorStringEditorFactory } from '../../codeMirrorStringEditor.ts'

type Editor = Awaited<ReturnType<CodeMirrorStringEditorFactory['create']>>

const editorTails = new Map<string, Promise<void>>()

function noop(): void {}

async function claimEditor(uri: string): Promise<() => void> {
  const previous = editorTails.get(uri) ?? Promise.resolve()
  let release = noop
  const active = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => active)
  editorTails.set(uri, tail)
  await previous
  return () => {
    release()
    if (editorTails.get(uri) == tail) editorTails.delete(uri)
  }
}

interface Props {
  readonly ariaLabel: string
  readonly disabled: boolean
  readonly errorLabel: string
  readonly loadingLabel: string
  readonly location?: { readonly column: number; readonly line: number }
  readonly onChange: (value: string) => void
  readonly theme: WorkbenchTheme
  readonly typing: string
  readonly uri: string
  readonly value: string
}

export function CodeEditor({ ariaLabel, disabled, errorLabel, loadingLabel, location, onChange, theme, typing, uri, value }: Props): ReactElement {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<Editor>()
  const syncing = useRef(false)
  const valueRef = useRef(value)
  const disabledRef = useRef(disabled)
  const locationRef = useRef(location)
  const onChangeRef = useRef(onChange)
  const typingRef = useRef(typing)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  valueRef.current = value
  disabledRef.current = disabled
  locationRef.current = location
  onChangeRef.current = onChange
  typingRef.current = typing

  useEffect(() => {
    const container = host.current!
    let current: Editor | undefined
    let changeListener: { dispose(): void } | undefined
    let release: (() => void) | undefined
    let disposed = false
    const darkMode$ = val(theme == 'dark')
    setFailed(false)
    setLoading(true)
    const extension = import('../../typeScriptSession.ts')
      .then(({ loadTypeScriptExtension }) => loadTypeScriptExtension(uri, typingRef.current))
      .catch(() => undefined)
    void claimEditor(uri)
      .then((nextRelease) => {
        release = nextRelease
        if (disposed) {
          release()
          release = undefined
          return
        }
        return new CodeMirrorStringEditorFactory({ darkMode$, extension }).create(container, uri, {
          ariaLabel,
          automaticLayout: true,
          language: 'javascript',
          readOnly: disabledRef.current,
          value: valueRef.current,
          wordWrap: 'off',
        })
      })
      .then((created) => {
        if (created == null) return
        if (disposed) {
          created.dispose()
          release?.()
          release = undefined
          return
        }
        current = created
        editor.current = created
        if (created.monacoEditor.getValue() != valueRef.current) created.monacoEditor.setValue(valueRef.current)
        changeListener = created.monacoEditor.onDidChangeModelContent(() => {
          if (!syncing.current) onChangeRef.current(created.monacoEditor.getValue())
        })
        const position = locationRef.current
        if (position != null) created.revealPosition?.(position.line, position.column)
        setLoading(false)
      })
      .catch(() => {
        release?.()
        release = undefined
        if (!disposed) {
          setFailed(true)
          setLoading(false)
        }
      })
    return () => {
      disposed = true
      changeListener?.dispose()
      current?.dispose()
      darkMode$.dispose()
      release?.()
      release = undefined
      if (editor.current === current) editor.current = undefined
    }
  }, [ariaLabel, theme, uri])

  useEffect(() => {
    const current = editor.current
    if (current == null || current.monacoEditor.getValue() == value) return
    syncing.current = true
    current.monacoEditor.setValue(value)
    syncing.current = false
  }, [value])

  useEffect(() => {
    editor.current?.monacoEditor.updateOptions({ readOnly: disabled })
  }, [disabled])

  useEffect(() => {
    void import('../../typeScriptSession.ts').then(({ updateTypeScriptTyping }) => updateTypeScriptTyping(uri, typing)).catch(noop)
  }, [typing, uri])

  useEffect(() => {
    if (location != null) editor.current?.revealPosition?.(location.line, location.column)
  }, [location?.column, location?.line])

  return (
    <div className="code-editor">
      <div className="code-editor-host" ref={host} />
      {loading && <span className="code-editor-state">{loadingLabel}</span>}
      {failed && <span className="code-editor-state error">{errorLabel}</span>}
    </div>
  )
}
