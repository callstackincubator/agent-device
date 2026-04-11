import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionStore } from '../../daemon/session-store.ts';

export function makeSessionStore(prefix = 'agent-device-test-'): SessionStore {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return new SessionStore(path.join(tempRoot, 'sessions'));
}
