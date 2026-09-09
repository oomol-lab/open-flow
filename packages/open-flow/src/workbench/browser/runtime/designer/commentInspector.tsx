import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Label } from '../../../../ui/browser/label.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'

const MarkdownContent = lazy(() => import('../../../../ui/browser/markdown/markdownContent.tsx'))

/** A comment is presentation data; editing it does not require the canvas store. */
export function CommentInspector({
  title,
  content,
  disabled,
  dark,
  onSave,
  onDuplicate,
  onDelete,
}: {
  readonly title: string
  readonly content: string
  readonly disabled: boolean
  readonly dark: boolean
  readonly onSave: (comment: { title: string; content: string }) => void
  readonly onDuplicate: () => void
  readonly onDelete: () => void
}) {
  const t = useTranslate()
  const [draftTitle, setDraftTitle] = useState(title)
  const [draftContent, setDraftContent] = useState(content)
  const [source, setSource] = useState(false)
  useEffect(() => setDraftTitle(title), [title])
  useEffect(() => setDraftContent(content), [content])
  const save = () => {
    if (!disabled && (draftTitle !== title || draftContent !== content)) onSave({ title: draftTitle, content: draftContent })
  }
  return (
    <section className="flex min-w-0 flex-col gap-3 p-3">
      <Label>
        {t('inspector.node.name')}
        <Input
          aria-label={t('inspector.node.name')}
          value={draftTitle}
          disabled={disabled}
          onChange={(event) => setDraftTitle(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key == 'Enter') {
              event.preventDefault()
              save()
            }
          }}
        />
      </Label>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setSource(!source)}>
          {t(source ? 'inspector.comment.preview' : 'inspector.comment.source')}
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onDuplicate}>
          {t('inspector.comment.duplicate')}
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onDelete}>
          {t('inspector.comment.delete')}
        </Button>
      </div>
      {source ? (
        <Textarea
          aria-label={t('inspector.comment.source')}
          autoFocus
          className="min-h-40"
          disabled={disabled}
          value={draftContent}
          onChange={(event) => setDraftContent(event.target.value)}
          onBlur={save}
        />
      ) : (
        <div className="markdown-body min-w-0" onDoubleClick={() => setSource(true)}>
          <Suspense fallback={null}>
            <MarkdownContent dark={dark} text={draftContent} mermaid />
          </Suspense>
        </div>
      )}
    </section>
  )
}
