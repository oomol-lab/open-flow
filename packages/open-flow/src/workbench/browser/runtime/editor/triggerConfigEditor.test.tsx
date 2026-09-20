import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it, vi } from 'vitest'
import { inputValues } from '../../../../flow/common/inputValue.ts'
import { createI18n } from '../i18n.ts'
import { TriggerConfigEditor } from './triggerConfigEditor.tsx'

describe('Trigger configuration editor', () => {
  it('uses input defaults without saving them or offering source selection', () => {
    const onChange = vi.fn()
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <TriggerConfigEditor
          inputs={[
            { handle: 'owner', nullable: false, jsonSchema: { type: 'string' }, value: 'example' },
            { handle: 'limit', nullable: false, jsonSchema: { type: 'integer' }, value: 10 },
            { handle: 'required', nullable: false, jsonSchema: { type: 'string' } },
            { group: 'Optional' },
            { handle: 'note', nullable: true, jsonSchema: { type: 'string' } },
          ]}
          config={{}}
          disabled={false}
          onChange={onChange}
        />
      </I18nProvider>,
    )
    expect(markup).toContain('value="example"')
    expect(markup).toContain('value="10"')
    expect(markup).toContain('Optional')
    expect(markup).not.toContain('Select source')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders provider-specific editors inside the shared input table', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <TriggerConfigEditor
          inputs={[{ handle: 'teamId', nullable: false, jsonSchema: { type: 'string' } }]}
          config={inputValues({ teamId: 'team-1' })}
          disabled={false}
          onChange={() => {}}
          renderEditor={() => <button aria-label="Choose team">Team one</button>}
        />
      </I18nProvider>,
    )
    expect(markup).toContain('Team one')
    expect(markup).toContain('Choose team')
    expect(markup).toContain('teamId')
  })
})

it.each([false, true])('offers form reset only while values are editable (disabled=%s)', (disabled) => {
  const onReset = vi.fn()
  const markup = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <TriggerConfigEditor
        inputs={[{ handle: 'limit', nullable: false, jsonSchema: { type: 'integer' }, value: 10 }]}
        config={inputValues({ limit: 25 })}
        disabled={disabled}
        onReset={onReset}
        onChange={vi.fn()}
      />
    </I18nProvider>,
  )
  expect(markup.includes('aria-label="Reset to defaults"')).toBe(!disabled)
  expect(onReset).not.toHaveBeenCalled()
})
