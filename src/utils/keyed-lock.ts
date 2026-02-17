export async function withKeyedLock<T>(
  locks: Map<string, Promise<unknown>>,
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  locks.set(key, current);
  return current.finally(() => {
    if (locks.get(key) === current) {
      locks.delete(key);
    }
  });
}
