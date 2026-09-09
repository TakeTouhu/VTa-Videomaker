/** Stable, collision-resistant ids. Deterministic enough for tests via seedIds. */

let counter = 0;

function randomPart(): string {
  const globalCrypto = globalThis.crypto as Crypto | undefined;
  if (globalCrypto?.randomUUID) return globalCrypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

export function createId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${randomPart()}`;
}

/** Test hook: resets the monotonic part so ids are reproducible per test. */
export function resetIdCounter(): void {
  counter = 0;
}
