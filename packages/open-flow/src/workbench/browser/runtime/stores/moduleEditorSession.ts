import type { I18n } from 'val-i18n'
import type { Draft } from '../api.ts'
import type { FlowChanges } from '../editor/flowChanges.ts'
import type { SetNotice } from './workbenchNotice.ts'
import type { ModuleEditorDraft, WorkspaceState } from './workspaceModel.ts'

import { imports as moduleImports, replaceSource as replaceModuleSource } from '../../../../flow/common/moduleChanges.ts'
import { Latest } from './latest.ts'
import { errorNotice } from './workbenchNotice.ts'
import { WorkspaceModel } from './workspaceModel.ts'

export class ModuleEditorSession {
  readonly #moduleDrafts = new Map<string, { editor: ModuleEditorDraft; base: Draft['content']['modules'][string] }>()
  #moduleSave?: Promise<boolean>
  #disposed = false
  readonly #model: WorkspaceModel
  readonly #draftSession: Latest
  readonly #setNotice: SetNotice
  readonly #i18n: I18n

  public constructor(
    model: WorkspaceModel,
    session: Latest,
    private readonly changeDraft: (changes: FlowChanges) => Promise<Draft | undefined>,
    setNotice: SetNotice,
    i18n: I18n,
  ) {
    this.#model = model
    this.#draftSession = session
    this.#setNotice = setNotice
    this.#i18n = i18n
  }

  public dispose(): void {
    this.#disposed = true
  }

  public updateModuleSource(source: string): void {
    const editor = this.#model.value.moduleEditor
    if (editor == null || editor.source == source) return
    const pending = this.#moduleDrafts.get(editor.moduleId)
    const base = pending?.base ?? this.#model.value.draft?.content.modules[editor.moduleId]
    if (base == null) return
    this.#moduleDrafts.set(editor.moduleId, { base, editor: { ...editor, phase: undefined, source } })
    this.#publishEditor()
  }

  public discardModuleChanges(): void {
    const editor = this.#model.value.moduleEditor
    if (this.#disposed || editor == null || this.#moduleSave != null) return
    this.#moduleDrafts.delete(editor.moduleId)
    const module = this.#model.value.draft?.content.modules[editor.moduleId]
    this.#model.set(this.state(module == null ? undefined : { moduleId: editor.moduleId, source: module.source }))
  }

  public get hasUnsavedCode(): boolean {
    return this.#moduleDrafts.size > 0
  }

  public async saveModuleEditor(): Promise<boolean> {
    if (this.#disposed) return false
    for (const pending of this.#moduleDrafts.values()) {
      if (pending.editor.phase == 'failed') pending.editor = { ...pending.editor, phase: undefined }
    }
    this.#publishEditor()
    return await this.flush()
  }

  public flush(): Promise<boolean> {
    if (this.#moduleSave != null) return this.#moduleSave
    if (this.#disposed) return Promise.resolve(false)
    if (![...this.#moduleDrafts.values()].some((pending) => pending.editor.phase != 'failed')) return Promise.resolve(this.#moduleDrafts.size == 0)
    const current = this.#draftSession.capture()
    this.#moduleSave = this.#saveModules(current).finally(() => {
      this.#moduleSave = undefined
    })
    return this.#moduleSave
  }

  async #saveModules(current: () => boolean): Promise<boolean> {
    while (!this.#disposed && current()) {
      const entry = [...this.#moduleDrafts.entries()].find(([, pending]) => pending.editor.phase != 'failed')
      if (entry == null) return this.#moduleDrafts.size == 0
      const [moduleId, pending] = entry
      const source = pending.editor.source
      pending.editor = { ...pending.editor, phase: 'saving' }
      this.#publishEditor()
      try {
        const imports = await moduleImports(source)
        if (this.#disposed || !current()) return false
        const module = this.#model.value.draft?.content.modules[moduleId]
        if (module == null || module.source != pending.base.source || JSON.stringify(module.imports) != JSON.stringify(pending.base.imports)) {
          throw new Error(this.#i18n.t('notice.moduleUpdated'))
        }
        const changed =
          source == module.source && JSON.stringify(imports) == JSON.stringify(module.imports)
            ? this.#model.value.draft
            : await this.changeDraft(replaceModuleSource(moduleId, pending.base.source, pending.base.imports, source, imports))
        if (this.#disposed || !current()) return false
        const latest = this.#moduleDrafts.get(moduleId)
        if (latest == null) continue
        if (changed == null) {
          latest.editor = { ...latest.editor, phase: 'failed' }
        } else if (latest.editor.source == source) {
          this.#moduleDrafts.delete(moduleId)
          if (this.#model.value.moduleEditor?.moduleId == moduleId) this.#model.set(this.state({ moduleId, source }))
        } else {
          latest.base = { ...pending.base, source, imports }
          latest.editor = { ...latest.editor, phase: undefined }
        }
      } catch (error) {
        if (this.#disposed || !current()) return false
        const latest = this.#moduleDrafts.get(moduleId)
        if (latest != null) latest.editor = { ...latest.editor, phase: 'failed' }
        this.#setNotice(errorNotice(error, this.#i18n.t))
      }
      this.#publishEditor()
    }
    return false
  }

  public state(editor: ModuleEditorDraft | undefined): Pick<WorkspaceState, 'moduleEditor' | 'moduleSaveStatus'> {
    const moduleEditor = editor == null ? undefined : (this.#moduleDrafts.get(editor.moduleId)?.editor ?? editor)
    let moduleSaveStatus: WorkspaceState['moduleSaveStatus']
    if ([...this.#moduleDrafts.values()].some((pending) => pending.editor.phase == 'failed')) moduleSaveStatus = 'failed'
    else if (this.#moduleDrafts.size > 0) moduleSaveStatus = 'saving'
    return { moduleEditor, moduleSaveStatus }
  }

  #publishEditor(): void {
    if (!this.#disposed) this.#model.set(this.state(this.#model.value.moduleEditor))
  }
}
