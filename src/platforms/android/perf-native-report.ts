import { splitNonEmptyTrimmedLines } from '../../utils/parsing.ts';
import { roundPercent } from '../perf-utils.ts';

export function parseSimpleperfReportEntries(stdout: string): Array<Record<string, unknown>> {
  const entries: Array<Record<string, unknown>> = [];
  for (const line of splitNonEmptyTrimmedLines(stdout)) {
    const match = line.match(/^([0-9]+(?:\.[0-9]+)?)%\s+(.+)$/);
    if (!match) continue;
    const percentage = Number(match[1]);
    const rest = match[2]?.trim();
    if (!Number.isFinite(percentage) || !rest) continue;
    const columns = rest.split(/\s{2,}/).filter(Boolean);
    entries.push({
      percentage: roundPercent(percentage),
      command: columns[0],
      dso: columns[1],
      symbol: columns.slice(2).join(' ') || undefined,
    });
    if (entries.length >= 50) break;
  }
  return entries;
}
