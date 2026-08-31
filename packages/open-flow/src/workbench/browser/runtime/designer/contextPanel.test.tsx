import type { AddNodeOption } from './addNodeOptions.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it } from 'vitest'
import { createI18n } from '../i18n.ts'
import { indexAddNodeOptions } from './addNodeOptions.ts'
import { BlockLibrary, ContextPanel } from './contextPanel.tsx'

const connector: AddNodeOption = {
  connector: {
    actionId: 'create-issue',
    authenticated: true,
    description: 'Create an issue.',
    inputs: {},
    name: 'Create issue',
    outputs: {},
    serviceId: 'github',
    serviceName: 'GitHub',
  },
  description: 'Create a GitHub issue.',
  group: 'Connectors',
  id: 'connector:github:create-issue',
  inputs: [],
  kind: 'connector',
  label: 'Create issue',
  outputs: [],
}

const group: AddNodeOption = {
  choices: [{ label: 'Create issue', option: connector }],
  description: 'GitHub actions.',
  group: 'Connectors',
  id: 'connector:github',
  inputs: [],
  kind: 'connector-group',
  label: 'GitHub',
  outputs: [],
  serviceId: 'github',
}

describe('Context Panel', () => {
  it('indexes nested choices by their session item IDs', () => {
    expect(indexAddNodeOptions([group]).get(connector.id)).toBe(connector)
  })

  it('renders one panel shell and a browsable list with descriptions and choices', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <ContextPanel focusOnOpen={false} icon="plus" onClose={() => undefined} theme="dark" title="Blocks">
          <BlockLibrary
            browseOptions={async () => []}
            disabled={false}
            focusRequest={0}
            onAdd={async () => undefined}
            onRegisterDragOption={() => undefined}
            options={[group]}
            provideChoices={async () => []}
          />
        </ContextPanel>
      </I18nProvider>,
    )

    expect(markup.match(/class="context-panel"/g)).toHaveLength(1)
    expect(markup).toContain('class="block-library-list-content"')
    expect(markup).toContain('class="block-library-group"')
    expect(markup).toContain('data-slot="separator"')
    expect(markup).toContain('aria-hidden="true" class="context-panel-backdrop"')
    expect(markup).toContain('data-theme="dark"')
    expect(markup).toContain('Search blocks')
    expect(markup).toContain('mx-3.5')
    expect(markup).toContain('GitHub actions.')
    expect(markup).toContain('Create issue')
    expect(markup).toContain('<details')
  })
})
