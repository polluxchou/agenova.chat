// ---------------------------------------------------------------------------
// Agenova v1 — crypto helpers
//
// Ed25519  : signature verify (re-uses nit conventions)
// AES-256-GCM : at-rest encryption for memory items and model keys
// HKDF     : key derivation from master secret
// ---------------------------------------------------------------------------

import {
  createPublicKey,
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  type KeyObject,
} from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// ---------------------------------------------------------------------------
// base64url ↔ standard base64 helpers (matches nit conventions)
// ---------------------------------------------------------------------------

function base64urlToBase64(b64url: string): string {
  let s = b64url.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4 !== 0) s += '='
  return s
}

function base64ToBase64url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ---------------------------------------------------------------------------
// Ed25519 key helpers
// ---------------------------------------------------------------------------

/**
 * Generate a fresh Ed25519 keypair.
 * Returns raw base64-encoded public key and private seed.
 */
export function generateEd25519Keypair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')

  const pubJwk = publicKey.export({ format: 'jwk' })
  const privJwk = privateKey.export({ format: 'jwk' })

  return {
    publicKey: base64urlToBase64(pubJwk.x!),
    privateKey: base64urlToBase64(privJwk.d!),
  }
}

/**
 * Build a Node.js KeyObject from raw base64 Ed25519 keys.
 */
export function buildPrivateKeyObject(pubBase64: string, privBase64: string): KeyObject {
  return createPrivateKey({
    key: {
      kty: 'OKP',
      crv: 'Ed25519',
      x: base64ToBase64url(pubBase64),
      d: base64ToBase64url(privBase64),
    },
    format: 'jwk',
  })
}

export function buildPublicKeyObject(pubBase64: string): KeyObject {
  return createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: base64ToBase64url(pubBase64) },
    format: 'jwk',
  })
}

/**
 * Sign a message string. Returns base64 signature.
 */
export function signMessage(message: string, privBase64: string, pubBase64: string): string {
  const key = buildPrivateKeyObject(pubBase64, privBase64)
  const sig = nodeSign(null, Buffer.from(message, 'utf-8'), key)
  return sig.toString('base64')
}

/**
 * Verify an Ed25519 signature.
 * pubKeyField: "ed25519:<base64>" format (nit convention) OR raw base64.
 */
export function verifySignature(pubKeyField: string, message: string, signatureBase64: string): boolean {
  try {
    const raw = pubKeyField.startsWith('ed25519:') ? pubKeyField.slice(8) : pubKeyField
    const keyObj = buildPublicKeyObject(raw)
    return nodeVerify(null, Buffer.from(message, 'utf-8'), keyObj, Buffer.from(signatureBase64, 'base64'))
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Agent ID derivation (mirrors nit exactly)
// ---------------------------------------------------------------------------

const NIT_NAMESPACE = '801ba518-f326-47e5-97c9-d1efd1865a19'

function parseUuid(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex')
}

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-')
}

/**
 * Derive a deterministic agent ID (UUIDv5) from the public key field.
 * @param publicKeyField  "ed25519:<base64>"
 */
export function deriveAgentId(publicKeyField: string): string {
  const namespaceBytes = parseUuid(NIT_NAMESPACE)
  const nameBytes = Buffer.from(publicKeyField, 'utf-8')
  const data = Buffer.concat([namespaceBytes, nameBytes])
  const hash = createHash('sha1').update(data).digest()

  const uuid = Buffer.from(hash.subarray(0, 16))
  uuid[6] = (uuid[6] & 0x0f) | 0x50  // version 5
  uuid[8] = (uuid[8] & 0x3f) | 0x80  // variant RFC 4122

  return formatUuid(uuid)
}

// ---------------------------------------------------------------------------
// Master key — loaded once at startup from ~/.agenova/master.key
// ---------------------------------------------------------------------------

let _masterKey: Buffer | null = null

/**
 * Test reset hook — clears the cached master key so the next call to
 * loadOrCreateMasterKey() will re-read or re-generate it.
 * Pass a buffer to inject a known key for deterministic tests.
 */
export function _resetMasterKey(inject?: Buffer): void {
  _masterKey = inject ?? null
}

export function loadOrCreateMasterKey(): Buffer {
  if (_masterKey) return _masterKey

  const dir = join(homedir(), '.agenova')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const keyPath = join(dir, 'master.key')

  if (existsSync(keyPath)) {
    _masterKey = Buffer.from(readFileSync(keyPath, 'utf-8').trim(), 'base64')
  } else {
    _masterKey = randomBytes(32)
    writeFileSync(keyPath, _masterKey.toString('base64') + '\n', { mode: 0o600, encoding: 'utf-8' })
  }

  return _masterKey
}

// ---------------------------------------------------------------------------
// AES-256-GCM helpers
// ---------------------------------------------------------------------------

const GCM_IV_LENGTH = 12
const GCM_TAG_LENGTH = 16

/**
 * Derive a 32-byte purpose-specific key from the master secret using HKDF.
 */
function deriveKey(purpose: string, salt: string): Buffer {
  const master = loadOrCreateMasterKey()
  return Buffer.from(
    hkdfSync('sha256', master, Buffer.from(salt, 'utf-8'), Buffer.from(purpose, 'utf-8'), 32),
  )
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Returns base64(iv + ciphertext + authTag).
 */
export function encrypt(plaintext: string, purpose: string, salt: string): string {
  const key = deriveKey(purpose, salt)
  const iv = randomBytes(GCM_IV_LENGTH)

  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()

  const result = Buffer.concat([iv, encrypted, tag])
  return result.toString('base64')
}

/**
 * Decrypt AES-256-GCM ciphertext produced by `encrypt`.
 */
export function decrypt(ciphertextBase64: string, purpose: string, salt: string): string {
  const key = deriveKey(purpose, salt)
  const buf = Buffer.from(ciphertextBase64, 'base64')

  const iv = buf.subarray(0, GCM_IV_LENGTH)
  const tag = buf.subarray(buf.length - GCM_TAG_LENGTH)
  const ciphertext = buf.subarray(GCM_IV_LENGTH, buf.length - GCM_TAG_LENGTH)

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8')
}

/**
 * Encrypt with a passphrase-derived key (for recovery export).
 * Uses HKDF(SHA-256, passphrase, salt=random, info="recovery").
 * Returns base64(salt + iv + ciphertext + tag).
 */
export function encryptWithPassphrase(plaintext: string, passphrase: string): string {
  const salt = randomBytes(16)
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(passphrase, 'utf-8'), salt, Buffer.from('recovery', 'utf-8'), 32))
  const iv = randomBytes(GCM_IV_LENGTH)

  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return Buffer.concat([salt, iv, encrypted, tag]).toString('base64')
}

export function decryptWithPassphrase(ciphertextBase64: string, passphrase: string): string {
  const buf = Buffer.from(ciphertextBase64, 'base64')

  const salt = buf.subarray(0, 16)
  const iv = buf.subarray(16, 16 + GCM_IV_LENGTH)
  const tag = buf.subarray(buf.length - GCM_TAG_LENGTH)
  const ciphertext = buf.subarray(16 + GCM_IV_LENGTH, buf.length - GCM_TAG_LENGTH)

  const key = Buffer.from(hkdfSync('sha256', Buffer.from(passphrase, 'utf-8'), salt, Buffer.from('recovery', 'utf-8'), 32))

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8')
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf-8').digest('hex')
}

export function randomUuid(): string {
  return crypto.randomUUID()
}

export function randomNumericCode(digits = 6): string {
  const max = Math.pow(10, digits)
  const n = randomBytes(4).readUInt32BE(0) % max
  return String(n).padStart(digits, '0')
}
