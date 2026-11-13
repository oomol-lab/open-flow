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

export const largeSprite = {
  ...sampleSprite,
  version: 'lab-large-v1',
  lightUrl: 'https://provider-sprites.lab.invalid/large/light.svg',
  darkUrl: 'https://provider-sprites.lab.invalid/large/dark.svg',
}

export function largeSpriteBlob(dark: boolean): Blob {
  const source = dark ? sampleSprite.darkUrl : sampleSprite.lightUrl
  // Match the payload of a real catalog sheet without a multi-megabyte fixture file.
  return new Blob([decodeURIComponent(source.slice(source.indexOf(',') + 1)), '<!--', ' '.repeat(3 * 1024 * 1024), '-->'], { type: 'image/svg+xml' })
}

// Public catalog snapshot, including the original image for a missing remote sprite.
const remoteSpriteVersion = '6c09b9866c4ca60f8f86018668a0ef1e3908f43de202044febf34ad59afb12e1'
export const remoteGithubArtwork = {
  serviceId: 'github',
  serviceName: 'GitHub',
  icon: 'https://static.oomol.com/logo/third-party/github.png',
  iconSprite: {
    version: remoteSpriteVersion,
    pixelRatio: 2,
    iconSize: 48,
    bleed: 1,
    width: 2050,
    height: 2050,
    lightUrl: `https://static.oomol.com/logo/provider-sprites/${remoteSpriteVersion}/light.png`,
    darkUrl: `https://static.oomol.com/logo/provider-sprites/${remoteSpriteVersion}/dark.png`,
  },
  iconSpritePosition: { x: 451, y: 701 },
}
