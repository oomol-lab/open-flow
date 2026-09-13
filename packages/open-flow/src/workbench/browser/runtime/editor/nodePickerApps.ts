const collator = new Intl.Collator(['zh-CN', 'en'], { numeric: true, sensitivity: 'base' })
const han = /\p{Script=Han}/u

export function comparePickerApps(left: { label: string; connected?: boolean }, right: { label: string; connected?: boolean }): number {
  return (
    Number(right.connected === true) - Number(left.connected === true) ||
    Number(han.test(right.label)) - Number(han.test(left.label)) ||
    collator.compare(left.label, right.label)
  )
}
