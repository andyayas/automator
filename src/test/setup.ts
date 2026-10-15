import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// The full suite runs files in parallel; give async queries more than the 1s default.
configure({ asyncUtilTimeout: 3000 })

afterEach(() => cleanup())
