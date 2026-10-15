// Decrypts password-protected Office files (ECMA-376 Agile encryption), the
// format Excel uses for the cash statement. Runs in the browser and in Node
// using Web Crypto, so the file never has to leave the device.
//
// Reference implementation: msoffcrypto-tool (Python).

import { CFB } from 'xlsx'

export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong password for this file.')
    this.name = 'WrongPasswordError'
  }
}

export class UnsupportedEncryptionError extends Error {
  constructor(detail: string) {
    super(`This file uses an encryption format the app can't open (${detail}).`)
    this.name = 'UnsupportedEncryptionError'
  }
}

const BLOCK_KEY = {
  verifierHashInput: hex('fea7d2763b4b9e79'),
  verifierHashValue: hex('d7aa0f6d3061344e'),
  encryptedKeyValue: hex('146e0be7abacd0d6'),
}

const HASHES: Record<string, string> = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA384: 'SHA-384', SHA512: 'SHA-512' }
const SEGMENT = 4096

/** True when the bytes are an OLE container, which is how encrypted .xlsx files are stored. */
export function isEncryptedOfficeFile(bytes: Uint8Array): boolean {
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
  return bytes.length > 8 && magic.every((b, i) => bytes[i] === b)
}

/** Returns the plain .xlsx bytes. Throws WrongPasswordError for a wrong password. */
export async function decryptOfficeFile(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const container = CFB.read(bytes, { type: 'array' })
  const info = streamBytes(container, 'EncryptionInfo')
  const pkg = streamBytes(container, 'EncryptedPackage')

  const major = info[0] | (info[1] << 8)
  const minor = info[2] | (info[3] << 8)
  if (major !== 4 || minor !== 4) throw new UnsupportedEncryptionError(`version ${major}.${minor}, expected Agile 4.4`)

  const xml = new TextDecoder().decode(info.subarray(8))
  const keyData = attributes(xml, 'keyData')
  const keyEnc = attributes(xml, 'encryptedKey')
  for (const params of [keyData, keyEnc]) {
    if (params.cipherAlgorithm !== 'AES' || params.cipherChaining !== 'ChainingModeCBC') {
      throw new UnsupportedEncryptionError(`${params.cipherAlgorithm} ${params.cipherChaining}`)
    }
    if (!HASHES[params.hashAlgorithm]) throw new UnsupportedEncryptionError(params.hashAlgorithm)
  }

  // Password key: H0 = H(salt + password), then spinCount rounds of H(i + H).
  const hash = HASHES[keyEnc.hashAlgorithm]
  const salt = base64(keyEnc.saltValue)
  let h = await digest(hash, concat(salt, utf16le(password)))
  const spinCount = Number(keyEnc.spinCount)
  const counter = new Uint8Array(4)
  const view = new DataView(counter.buffer)
  for (let i = 0; i < spinCount; i++) {
    view.setUint32(0, i, true)
    h = await digest(hash, concat(counter, h))
  }

  const keyBytes = Number(keyEnc.keyBits) / 8
  const derive = async (blockKey: Uint8Array) =>
    aesKey(fit(await digest(hash, concat(h, blockKey)), keyBytes, 0x36))

  const verifierInput = (
    await aesCbcDecrypt(await derive(BLOCK_KEY.verifierHashInput), salt, base64(keyEnc.encryptedVerifierHashInput))
  ).subarray(0, Number(keyEnc.saltSize))
  const verifierHash = (
    await aesCbcDecrypt(await derive(BLOCK_KEY.verifierHashValue), salt, base64(keyEnc.encryptedVerifierHashValue))
  ).subarray(0, Number(keyEnc.hashSize))
  if (!equal(await digest(hash, verifierInput), verifierHash)) throw new WrongPasswordError()

  const packageKeyBytes = (
    await aesCbcDecrypt(await derive(BLOCK_KEY.encryptedKeyValue), salt, base64(keyEnc.encryptedKeyValue))
  ).subarray(0, keyBytes)

  // Package: uint64LE plaintext size, then 4096-byte segments, each with
  // IV = H(keyData salt + uint32LE(segment index)).
  const dataHash = HASHES[keyData.hashAlgorithm]
  const dataSalt = base64(keyData.saltValue)
  const blockSize = Number(keyData.blockSize)
  const packageKey = await aesKey(packageKeyBytes)
  const size = Number(new DataView(pkg.buffer, pkg.byteOffset, 8).getBigUint64(0, true))
  const out = new Uint8Array(pkg.length - 8)
  for (let offset = 8, n = 0; offset < pkg.length; offset += SEGMENT, n++) {
    view.setUint32(0, n, true)
    const iv = fit(await digest(dataHash, concat(dataSalt, counter)), blockSize, 0x36)
    const segment = pkg.subarray(offset, Math.min(offset + SEGMENT, pkg.length))
    out.set(await aesCbcDecrypt(packageKey, iv, segment), offset - 8)
  }
  return out.subarray(0, size)
}

// ---------------------------------------------------------------------------

function streamBytes(container: unknown, name: string): Uint8Array {
  const entry = CFB.find(container, name) as { content?: ArrayLike<number> } | null
  if (!entry?.content) throw new UnsupportedEncryptionError(`missing ${name} stream`)
  return entry.content instanceof Uint8Array ? entry.content : Uint8Array.from(entry.content)
}

/** Attributes of the first element with this local name (namespace prefix optional). */
function attributes(xml: string, localName: string): Record<string, string> {
  const tag = new RegExp(`<(?:\\w+:)?${localName}\\b([^>]*)>`).exec(xml)
  if (!tag) throw new UnsupportedEncryptionError(`missing ${localName}`)
  const result: Record<string, string> = {}
  for (const [, key, value] of tag[1].matchAll(/([\w:]+)="([^"]*)"/g)) result[key] = value
  return result
}

async function digest(algorithm: string, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(algorithm, data as BufferSource))
}

function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-CBC', false, ['encrypt', 'decrypt'])
}

/**
 * AES-CBC decryption of whole blocks with no padding. Web Crypto insists on
 * PKCS#7, so append one block that decrypts to a full padding block: the
 * encryption of 16×0x10 chained from the last ciphertext block.
 */
async function aesCbcDecrypt(key: CryptoKey, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const last = data.subarray(data.length - 16)
  const padding = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-CBC', iv: last as BufferSource }, key, new Uint8Array(16).fill(16)),
  ).subarray(0, 16)
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv as BufferSource }, key, concat(data, padding) as BufferSource),
  )
}

/** Truncate, or pad with `fill`, to exactly `length` bytes (ECMA-376 2.3.4.12). */
function fit(bytes: Uint8Array, length: number, fill: number): Uint8Array {
  if (bytes.length >= length) return bytes.subarray(0, length)
  const out = new Uint8Array(length).fill(fill)
  out.set(bytes)
  return out
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function utf16le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    out[i * 2] = code & 0xff
    out[i * 2 + 1] = code >> 8
  }
  return out
}

function base64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
}

function hex(text: string): Uint8Array {
  return Uint8Array.from(text.match(/../g)!, (b) => parseInt(b, 16))
}
