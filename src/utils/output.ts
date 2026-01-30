import { AppError } from './errors.ts';

export type JsonResult =
  | { success: true; data?: Record<string, unknown> }
  | { success: false; error: { code: string; message: string; details?: Record<string, unknown> } };

export function printJson(result: JsonResult): void {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function printHumanError(err: AppError): void {
  const details = err.details ? `\n${JSON.stringify(err.details, null, 2)}` : '';
  process.stderr.write(`Error (${err.code}): ${err.message}${details}\n`);
}
