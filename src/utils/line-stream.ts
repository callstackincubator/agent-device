export function consumeTextLines(
  currentBuffer: string,
  chunk: string | Buffer,
): { lines: string[]; buffer: string } {
  const lines: string[] = [];
  let buffer = currentBuffer + chunk.toString();
  let idx = buffer.indexOf('\n');
  while (idx !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) lines.push(line);
    idx = buffer.indexOf('\n');
  }
  return { lines, buffer };
}
