export function normalizeBaseUrl(input: string): string {
  return input.replace(/\/+$/, '');
}
