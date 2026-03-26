export function successText(message?: string): { message?: string } {
  return message ? { message } : {};
}

export function withSuccessText<T extends Record<string, unknown>>(
  data: T,
  message?: string,
): T & { message?: string } {
  return message ? { ...data, message } : data;
}
