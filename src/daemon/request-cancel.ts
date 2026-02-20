const canceledRequestIds = new Set<string>();

export function markRequestCanceled(requestId: string | undefined): void {
  if (!requestId) return;
  canceledRequestIds.add(requestId);
}

export function clearRequestCanceled(requestId: string | undefined): void {
  if (!requestId) return;
  canceledRequestIds.delete(requestId);
}

export function isRequestCanceled(requestId: string | undefined): boolean {
  if (!requestId) return false;
  return canceledRequestIds.has(requestId);
}
