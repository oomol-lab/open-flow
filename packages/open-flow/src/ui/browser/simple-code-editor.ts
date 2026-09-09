import EditorModule from 'react-simple-code-editor'

interface EditorModuleWrapper {
  readonly default?: typeof EditorModule
}

const wrapper: EditorModuleWrapper = EditorModule as unknown as EditorModuleWrapper

export const SimpleCodeEditor: typeof EditorModule = wrapper.default ?? EditorModule
