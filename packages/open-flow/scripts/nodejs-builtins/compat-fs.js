import { Volume, createFsFromVolume } from 'memfs'

export default createFsFromVolume(Volume.fromJSON({ '/tmp': null }))
