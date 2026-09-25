function sheet(color: string) {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="104" height="52"><path fill="${color}" d="M2 2h48v48H2z"/><circle fill="${color}" cx="78" cy="26" r="24"/><path fill="#111" d="m68 26 7 7 14-14" stroke="#111" stroke-width="4" fill-rule="evenodd"/></svg>`)}`
}
export const sampleSprite = {
  version: 'lab-v1',
  pixelRatio: 2,
  iconSize: 48,
  bleed: 2,
  width: 104,
  height: 52,
  lightUrl: sheet('#3278cf'),
  darkUrl: sheet('#8fbcff'),
}
