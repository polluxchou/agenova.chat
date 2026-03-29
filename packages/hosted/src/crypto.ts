// ---------------------------------------------------------------------------
// Hosted API — Crypto utilities
//
// Only needs verification (not signing). The hosted server never holds
// private keys — it only verifies Ed25519 signatures from local agents.
// ---------------------------------------------------------------------------

import { createHash, createPublicKey, verify as cryptoVerify, randomUUID } from 'node:crypto'

/**
 * Verify an Ed25519 signature.
 * @param publicKeyField - "ed25519:<base64>" or raw base64
 * @param message - the signed plaintext
 * @param signatureBase64 - the signature as base64
 */
export function verifySignature(publicKeyField: string, message: string, signatureBase64: string): boolean {
  try {
    const rawBase64 = publicKeyField.startsWith('ed25519:')
      ? publicKeyField.slice('ed25519:'.length)
      : publicKeyField

    const pubKeyObj = createPublicKey({
      key: {
        kty: 'OKP',
        crv: 'Ed25519',
        x: rawBase64,
      },
      format: 'jwk',
    })

    return cryptoVerify(
      null,
      Buffer.from(message, 'utf-8'),
      pubKeyObj,
      Buffer.from(signatureBase64, 'base64'),
    )
  } catch {
    return false
  }
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf-8').digest('hex')
}

export function randomUuid(): string {
  return randomUUID()
}
