export function feishuResourceKind(events: readonly string[]): 'document' | 'calendar' | 'approval' | undefined {
  if (events.length == 0) return
  if (events.every((event) => event.startsWith('drive.file.'))) return 'document'
  if (events.every((event) => event == 'calendar.calendar.event.changed_v4')) return 'calendar'
  if (events.every((event) => ['approval_instance', 'approval_task', 'approval_cc', 'approval'].includes(event))) return 'approval'
}

export function supportsFeishuChatFilter(events: readonly string[]): boolean {
  return events.length > 0 && events.every((event) => ['im.message.receive_v1', 'im.chat.member.bot.added_v1'].includes(event))
}
