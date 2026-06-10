import crypto from 'node:crypto';

/**
 * Compares two secret strings in constant time. Hashing both inputs first
 * keeps the comparison length-independent, so unequal-length tokens neither
 * throw nor leak length via timing.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}
