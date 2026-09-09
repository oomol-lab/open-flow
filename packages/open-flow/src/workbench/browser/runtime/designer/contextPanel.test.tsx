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

  it.each(['Connector actions', 'Integration triggers'])('keeps %s collapsed so common nodes remain visible', (label) => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <BlockLibrary
          browseOptions={async () => []}
          searchOptions={async () => []}
          disabled={false}
          focusRequest={0}
          onAdd={async () => undefined}
          onRegisterDragOption={() => undefined}
          options={[
            { ...group, group: label },
            {
              id: 'manual',
              description: 'Start manually.',
              kind: 'trigger',
              trigger: { kind: 'manual' },
              group: 'Triggers',
              label: 'Manual trigger',
              inputs: [],
              outputs: [],
            },
            { id: 'code', description: 'Run JavaScript.', kind: 'new-task', group: 'Blocks', label: 'Code task', inputs: [], outputs: [] },
          ]}
          provideChoices={async () => []}
        />
      </I18nProvider>,
    )
    expect(markup).toContain(label)
    expect(markup).toContain('Manual trigger')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('GitHub')
    expect(markup).toContain('Code task')
    if (label == 'Integration triggers') {
      expect(markup.indexOf('Manual trigger')).toBeLessThan(markup.indexOf(label))
      expect(markup.indexOf(label)).toBeLessThan(markup.indexOf('Code task'))
    }
  })

  it('shows the final connector group before the scroll viewport is initialized', () => {
    const nodes: AddNodeOption[] = Array.from({ length: 16 }, (_, index) => ({
      id: `code-${index}`,
      description: 'Run code.',
      kind: 'new-task',
      group: 'Blocks',
      label: `Code ${index}`,
      inputs: [],
      outputs: [],
    }))
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <BlockLibrary
          browseOptions={async () => []}
          searchOptions={async () => []}
          disabled={false}
          focusRequest={0}
          onAdd={async () => undefined}
          onRegisterDragOption={() => undefined}
          options={[...nodes, { ...group, group: 'Connector actions' }]}
          provideChoices={async () => []}
        />
      </I18nProvider>,
    )
    expect(markup).toContain('Code 15')
    expect(markup).toContain('Connector actions')
    expect(markup).toContain('aria-expanded="false"')
  })

  it('shows the connector entry and its loading state before the catalog arrives', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <BlockLibrary
          browseOptions={async () => []}
          searchOptions={async () => []}
          disabled={false}
          focusRequest={0}
          onAdd={async () => undefined}
          onRegisterDragOption={() => undefined}
          options={[]}
          provideChoices={async () => []}
        />
      </I18nProvider>,
    )
    expect(markup).toContain('Connector actions')
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('Loading catalog blocks')
  })

  it('renders one panel shell and a browsable list with descriptions and choices', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <ContextPanel focusOnOpen={false} icon="plus" onClose={() => undefined} theme="dark" title="Blocks">
          <BlockLibrary
            browseOptions={async () => []}
            searchOptions={async () => []}
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
    expect(markup).toContain('aria-hidden="true" class="context-panel-backdrop"')
    expect(markup).toContain('data-theme="dark"')
    expect(markup).toContain('Search blocks')
    expect(markup).toContain('mx-3.5')
    expect(markup).toContain('GitHub actions.')
    expect(markup).toContain('Create issue')
    expect(markup).toContain('<details')
  })
})
