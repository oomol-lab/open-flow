import type { Extension } from '@codemirror/state'
import type { EditorView as CodeMirrorEditorView } from '@codemirror/view'
import type { ReadonlyVal } from 'value-enhancer'
export interface CodeEditorOptions {
  readonly ariaLabel?: string
  readonly language?: string
  readonly readOnly?: boolean
  readonly value?: string
  readonly wordWrap?: string
}

export type CodeMirrorLanguage = 'javascript' | 'json' | 'markdown' | 'plaintext' | 'typescript' | 'yaml'

interface CodeMirrorModules {
  readonly Compartment: typeof import('@codemirror/state').Compartment
  readonly EditorState: typeof import('@codemirror/state').EditorState
  readonly EditorView: typeof import('@codemirror/view').EditorView
  readonly autocompletion: typeof import('@codemirror/autocomplete').autocompletion
  readonly basicSetup: typeof import('codemirror').basicSetup
  readonly indentWithTab: typeof import('@codemirror/commands').indentWithTab
  readonly keymap: typeof import('@codemirror/view').keymap
  readonly githubDark: typeof import('@uiw/codemirror-theme-github').githubDark
  readonly githubLight: typeof import('@uiw/codemirror-theme-github').githubLight
  readonly javascript: typeof import('@codemirror/lang-javascript').javascript
  readonly json: typeof import('@codemirror/lang-json').json
  readonly markdown: typeof import('@codemirror/lang-markdown').markdown
  readonly StateEffect: typeof import('@codemirror/state').StateEffect
  readonly yaml: typeof import('@codemirror/lang-yaml').yaml
}

interface CodeEditorEnvironment {
  readonly darkMode$?: ReadonlyVal<boolean>
  readonly extension?: Promise<Extension | undefined>
}

type Listener<T> = (event: T) => void

const completionIcons = new Map([
  ['class', 'i-codicon:symbol-class'],
  ['constant', 'i-codicon:symbol-constant'],
  ['enum', 'i-codicon:symbol-enum'],
  ['enumMember', 'i-codicon:symbol-enum-member'],
  ['function', 'i-codicon:symbol-method'],
  ['interface', 'i-codicon:symbol-interface'],
  ['keyword', 'i-codicon:symbol-keyword'],
  ['method', 'i-codicon:symbol-method'],
  ['namespace', 'i-codicon:symbol-namespace'],
  ['property', 'i-codicon:symbol-property'],
  ['text', 'i-codicon:symbol-string'],
  ['type', 'i-codicon:symbol-structure'],
  ['variable', 'i-codicon:symbol-variable'],
])

let codeMirrorModulesPromise: Promise<CodeMirrorModules> | undefined

export function canonicalizeCodeMirrorLanguage(language: string): CodeMirrorLanguage {
  switch (language.trim().toLowerCase()) {
    case 'application/javascript':
    case 'javascript':
    case 'js':
    case 'jsx':
    case 'text/javascript':
      return 'javascript'
    case 'application/json':
    case 'json':
      return 'json'
    case 'markdown':
    case 'md':
    case 'mdx':
    case 'text/markdown':
      return 'markdown'
    case 'application/typescript':
    case 'text/typescript':
    case 'ts':
    case 'tsx':
    case 'typescript':
      return 'typescript'
    case 'application/x-yaml':
    case 'application/yaml':
    case 'text/x-yaml':
    case 'text/yaml':
    case 'yaml':
    case 'yml':
      return 'yaml'
    default:
      return 'plaintext'
  }
}

async function loadCodeMirrorModules(): Promise<CodeMirrorModules> {
  if (codeMirrorModulesPromise == null) {
    codeMirrorModulesPromise = Promise.all([
      import('codemirror'),
      import('@codemirror/state'),
      import('@codemirror/view'),
      import('@uiw/codemirror-theme-github'),
      import('@codemirror/lang-javascript'),
      import('@codemirror/lang-json'),
      import('@codemirror/lang-markdown'),
      import('@codemirror/lang-yaml'),
      import('@codemirror/commands'),
      import('@codemirror/autocomplete'),
    ]).then(([codeMirror, state, view, github, javascript, json, markdown, yaml, commands, autocomplete]) => ({
      autocompletion: autocomplete.autocompletion,
      basicSetup: codeMirror.basicSetup,
      indentWithTab: commands.indentWithTab,
      keymap: view.keymap,
      Compartment: state.Compartment,
      EditorState: state.EditorState,
      EditorView: view.EditorView,
      githubDark: github.githubDark,
      githubLight: github.githubLight,
      javascript: javascript.javascript,
      json: json.json,
      markdown: markdown.markdown,
      StateEffect: state.StateEffect,
      yaml: yaml.yaml,
    }))
  }
  return codeMirrorModulesPromise
}

function createLanguageExtension(modules: CodeMirrorModules, language: CodeMirrorLanguage): Extension {
  switch (language) {
    case 'javascript':
      return modules.javascript({ jsx: true })
    case 'json':
      return modules.json()
    case 'markdown':
      return modules.markdown()
    case 'typescript':
      return modules.javascript({ jsx: true, typescript: true })
    case 'yaml':
      return modules.yaml()
    case 'plaintext':
      return []
  }
}

function createEditorTheme(modules: CodeMirrorModules, dark: boolean): Extension {
  return dark ? modules.githubDark : modules.githubLight
}

function isWordWrapEnabled(wordWrap: string): boolean {
  return wordWrap != 'off'
}

class CodeMirrorEditor {
  private readonly changeListeners = new Set<Listener<void>>()
  private readonly editableCompartment: import('@codemirror/state').Compartment
  private readonly languageCompartment: import('@codemirror/state').Compartment
  private readonly readOnlyCompartment: import('@codemirror/state').Compartment
  private readonly themeCompartment: import('@codemirror/state').Compartment
  private readonly themeReactionDisposer: (() => void) | undefined
  private readonly view: CodeMirrorEditorView
  private readonly wrappingCompartment: import('@codemirror/state').Compartment
  private disposed: boolean = false
  private language: CodeMirrorLanguage
  private readOnly: boolean
  private wordWrap: string

  public constructor(
    layoutRoot: HTMLElement,
    uri: string,
    options: CodeEditorOptions,
    private readonly modules: CodeMirrorModules,
    darkMode$: ReadonlyVal<boolean> | undefined,
    extension: Promise<Extension | undefined> | undefined,
  ) {
    this.language = canonicalizeCodeMirrorLanguage(options.language ?? 'plaintext')
    this.readOnly = options.readOnly === true
    this.wordWrap = options.wordWrap ?? 'off'
    this.editableCompartment = new modules.Compartment()
    this.languageCompartment = new modules.Compartment()
    this.readOnlyCompartment = new modules.Compartment()
    this.themeCompartment = new modules.Compartment()
    this.wrappingCompartment = new modules.Compartment()
    const dark = darkMode$?.value ?? layoutRoot.closest('[data-theme=dark]') != null
    this.view = new modules.EditorView({
      doc: options.value ?? '',
      parent: layoutRoot,
      extensions: [
        modules.basicSetup,
        modules.autocompletion({
          icons: false,
          addToOptions: [
            {
              position: 20,
              render: (completion, _state, view) => {
                const icon = view.dom.ownerDocument.createElement('span')
                const name = completion.type
                  ?.split(/\s+/)
                  .map((type) => completionIcons.get(type))
                  .find((value) => value != null)
                icon.className = `cm-symbolIcon ${name ?? 'i-codicon:symbol-misc'}`
                icon.setAttribute('aria-hidden', 'true')
                return icon
              },
            },
          ],
        }),
        modules.EditorView.baseTheme({
          '.cm-symbolIcon': {
            width: '14px',
            height: '14px',
            marginRight: '6px',
            verticalAlign: '-2px',
          },
        }),
        modules.keymap.of([modules.indentWithTab]),
        this.themeCompartment.of(createEditorTheme(modules, dark)),
        this.languageCompartment.of(createLanguageExtension(modules, this.language)),
        this.readOnlyCompartment.of(modules.EditorState.readOnly.of(this.readOnly)),
        this.editableCompartment.of(modules.EditorView.editable.of(!this.readOnly)),
        this.wrappingCompartment.of(isWordWrapEnabled(this.wordWrap) ? modules.EditorView.lineWrapping : []),
        modules.EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            for (const listener of this.changeListeners) listener(undefined)
          }
        }),
      ],
    })
    this.view.dom.dataset.uri = uri
    this.view.dom.dataset.language = this.language
    if (options.ariaLabel != null) this.view.contentDOM.ariaLabel = options.ariaLabel
    this.themeReactionDisposer = darkMode$?.reaction(
      (nextDark) => this.view.dispatch({ effects: this.themeCompartment.reconfigure(createEditorTheme(this.modules, nextDark)) }),
      true,
    )
    void extension?.then((value) => {
      if (!this.disposed && value != null) this.view.dispatch({ effects: this.modules.StateEffect.appendConfig.of(value) })
    })
  }

  public focus(): void {
    if (!this.disposed) this.view.focus()
  }

  public revealPosition(line: number, column: number): void {
    if (this.disposed) return
    const document = this.view.state.doc
    const targetLine = document.line(Math.min(Math.max(line, 1), document.lines))
    const anchor = Math.min(targetLine.from + Math.max(column, 0), targetLine.to)
    this.view.dispatch({
      effects: this.modules.EditorView.scrollIntoView(anchor, { y: 'center' }),
      selection: { anchor },
    })
    this.focus()
  }

  public getValue(): string {
    return this.view.state.doc.toString()
  }

  public onChange(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => {
      this.changeListeners.delete(listener)
    }
  }

  public setValue(value: string): void {
    if (value != this.getValue()) {
      this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: value } })
    }
  }

  public updateOptions(options: CodeEditorOptions): void {
    if (options.ariaLabel != null) this.view.contentDOM.ariaLabel = options.ariaLabel
    if (options.language != null) this.setLanguage(options.language)

    if (options.readOnly != null) {
      if (options.readOnly != null) this.readOnly = options.readOnly
      this.view.dispatch({
        effects: [
          this.readOnlyCompartment.reconfigure(this.modules.EditorState.readOnly.of(this.readOnly)),
          this.editableCompartment.reconfigure(this.modules.EditorView.editable.of(!this.readOnly)),
        ],
      })
    }

    if (options.wordWrap != null && options.wordWrap != this.wordWrap) {
      this.wordWrap = options.wordWrap
      this.view.dispatch({ effects: this.wrappingCompartment.reconfigure(isWordWrapEnabled(this.wordWrap) ? this.modules.EditorView.lineWrapping : []) })
    }
  }

  public setLanguage(language: string): void {
    const canonicalLanguage = canonicalizeCodeMirrorLanguage(language)
    if (canonicalLanguage != this.language) {
      this.language = canonicalLanguage
      this.view.dom.dataset.language = canonicalLanguage
      this.view.dispatch({ effects: this.languageCompartment.reconfigure(createLanguageExtension(this.modules, canonicalLanguage)) })
    }
  }

  public dispose(): void {
    if (!this.disposed) {
      this.disposed = true
      this.themeReactionDisposer?.()
      this.changeListeners.clear()
      this.view.destroy()
    }
  }
}

export async function createCodeEditor(
  dom: HTMLElement,
  uri: string,
  options: CodeEditorOptions = {},
  environment: CodeEditorEnvironment = {},
): Promise<CodeMirrorEditor> {
  const modules = await loadCodeMirrorModules()
  return new CodeMirrorEditor(dom, uri, options, modules, environment.darkMode$, environment.extension)
}
