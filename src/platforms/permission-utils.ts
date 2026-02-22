import { AppError } from '../utils/errors.ts';

export type PermissionAction = 'grant' | 'deny' | 'reset';

export function parsePermissionAction(action: string): PermissionAction {
  const normalized = action.trim().toLowerCase();
  if (normalized === 'grant') return 'grant';
  if (normalized === 'deny') return 'deny';
  if (normalized === 'reset') return 'reset';
  throw new AppError('INVALID_ARGS', `Invalid permission action: ${action}. Use grant|deny|reset.`);
}
