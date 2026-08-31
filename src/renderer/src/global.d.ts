import type { ClarityDeskApi } from '../../shared/types'

declare global {
  interface Window {
    clarity: ClarityDeskApi
  }
}

export {}
