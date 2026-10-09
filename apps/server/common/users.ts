export interface User {
  readonly userId: string
  readonly email: string
  readonly role: 'admin' | 'user'
  readonly enabled: boolean
  readonly revision: number
  readonly createdAt: number
}

export interface SessionUser {
  readonly userId: string
  readonly email: string | null
  readonly role: 'admin' | 'user'
}

export interface UserToken {
  readonly tokenId: string
  readonly name: string
  readonly createdAt: number
}
