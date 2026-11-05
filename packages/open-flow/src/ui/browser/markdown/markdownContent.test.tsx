// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server'
import { I18n } from 'val-i18n'
import { I18nProvider } from 'val-i18n-react'
import { expect, it } from 'vitest'
import { uiLocales } from '../locales.ts'
import MarkdownContent from './markdownContent.tsx'

function renderMarkdown(text: string): HTMLDivElement {
  const i18n = new I18n('en', uiLocales)
  const container = document.createElement('div')
  try {
    container.innerHTML = renderToStaticMarkup(
      <I18nProvider i18n={i18n}>
        <MarkdownContent dark={false} text={text} />
      </I18nProvider>,
    )
  } finally {
    i18n.dispose()
  }
  return container
}

const videos = [
  {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    src: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    title: 'YouTube video player',
  },
  {
    url: 'https://www.bilibili.com/video/BV1GJ411x7h7',
    src: 'https://player.bilibili.com/player.html?bvid=BV1GJ411x7h7&autoplay=0',
    title: 'Bilibili video player',
  },
]

it.each(videos)('keeps bare and autolinked video URLs as ordinary links: $url', ({ url }) => {
  const container = renderMarkdown(`${url}\n\n<${url}>`)
  expect(container.querySelector('iframe')).toBeNull()
  const links = [...container.querySelectorAll('a')]
  expect(links).toHaveLength(2)
  expect(links.map((link) => link.href)).toEqual([url, url])
})

it.each(videos)('embeds thumbnail video links with accessible player controls for $url', ({ url, src, title }) => {
  const container = renderMarkdown(`[![Play video](thumbnail.jpg)](${url})`)
  const player = container.querySelector('iframe')!
  expect(player).not.toBeNull()
  expect(player.src).toBe(src)
  expect(player.title).toBe(title)
  expect(player.hasAttribute('allowfullscreen')).toBe(true)
  expect(player.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin')
  expect(container.querySelector('a')).toBeNull()
  expect(container.querySelector('img')).toBeNull()
})

it.each(['https://youtube.com/watch?feature=shared&v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ?si=shared'])(
  'embeds thumbnail links for shared YouTube URLs: %s',
  (url) => {
    expect(renderMarkdown(`[![Play video](thumbnail.jpg)](${url})`).querySelector('iframe')?.src).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ')
  },
)

it('preserves the BV prefix in Bilibili URLs with a trailing slash and sharing parameters', () => {
  const container = renderMarkdown('[![Play video](thumbnail.jpg)](https://www.bilibili.com/video/BV1GJ411x7h7/?spm_id_from=333.1007)')
  const src = new URL(container.querySelector('iframe')!.src)
  expect(src.searchParams.get('bvid')).toBe('BV1GJ411x7h7')
  expect(src.searchParams.get('autoplay')).toBe('0')
})

it.each(videos)('preserves labeled links and code examples for $url', ({ url }) => {
  const container = renderMarkdown(`[Watch video](${url})\n\n\`${url}\`\n\n\`\`\`text\n${url}\n\`\`\``)
  expect(container.querySelector('a')?.textContent).toBe('Watch video')
  expect(container.querySelector('a')?.href).toBe(url)
  expect(container.querySelector('iframe')).toBeNull()
  expect(container.querySelectorAll('code')).toHaveLength(2)
})

it.each([
  'https://example.com/?redirect=https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://www.youtube.com.example.com/watch?v=dQw4w9WgXcQ',
  'https://www.bilibili.com.example.com/video/BV1GJ411x7h7',
  'https://www.youtube.com/watch?list=playlist',
  'https://www.bilibili.com/video/',
])('keeps unsupported video image links as ordinary links: %s', (url) => {
  const container = renderMarkdown(`[![Play video](thumbnail.jpg)](${url})`)
  expect(container.querySelector('iframe')).toBeNull()
  expect(container.querySelector('a')?.href).toBe(url)
})
