// @vitest-environment node
// The fixture is a synthetic workbook (invented rows) encrypted with
// msoffcrypto-tool, the reference implementation. It holds no real data.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { read, utils } from 'xlsx'
import { parseCashStatement } from './cash-statement.ts'
import { decryptOfficeFile, isEncryptedOfficeFile, WrongPasswordError } from './office-crypto.ts'

const fixture = new Uint8Array(readFileSync(new URL('./__fixtures__/synthetic-cash.encrypted.bin', import.meta.url)))
const PASSWORD = 'synthetic-test-password'

describe('decryptOfficeFile', () => {
  it('recognises an encrypted file', () => {
    expect(isEncryptedOfficeFile(fixture)).toBe(true)
    expect(isEncryptedOfficeFile(new TextEncoder().encode('PK\u0003\u0004 plain zip'))).toBe(false)
  })

  it('decrypts to a readable workbook', async () => {
    const plain = await decryptOfficeFile(fixture, PASSWORD)
    expect(plain[0]).toBe(0x50) // "PK", a zip
    expect(plain[1]).toBe(0x4b)
    const wb = read(plain, { type: 'array' })
    expect(wb.SheetNames).toEqual(['September'])
    const rows = utils.sheet_to_json<unknown[]>(wb.Sheets.September, { header: 1, blankrows: false })
    expect(rows.some((r) => r.includes('Package of 12 session POS 450$'))).toBe(true)
  }, 20_000)

  it('parses a statement whose used range does not start at A1', async () => {
    // The fixture's first cell is E3; rows must still be read from row 7.
    const wb = read(await decryptOfficeFile(fixture, PASSWORD), { type: 'array', cellDates: true })
    const { rows } = parseCashStatement(wb)
    expect(rows.map((r) => [r.voucher, r.kind])).toEqual([
      ['rc1', 'session'],
      ['rc2', 'package'],
      ['pv1', 'expense'],
    ])
  }, 20_000)

  it('rejects a wrong password clearly', async () => {
    await expect(decryptOfficeFile(fixture, 'not-the-password')).rejects.toBeInstanceOf(WrongPasswordError)
  }, 20_000)
})
