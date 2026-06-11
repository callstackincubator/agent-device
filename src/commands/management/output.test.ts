import { describe, expect, test } from 'vitest';
import { openCliOutput } from './output.ts';

describe('openCliOutput', () => {
  test('prints session state directory on a second line', () => {
    const output = openCliOutput({
      session: 'default',
      sessionStateDir: '/tmp/agent-device/sessions/cwd_123_default',
      identifiers: { session: 'default' },
    });

    expect(output.text).toBe(
      ['Opened: default', 'Session state: /tmp/agent-device/sessions/cwd_123_default'].join('\n'),
    );
    expect(output.data).toMatchObject({
      session: 'default',
      sessionStateDir: '/tmp/agent-device/sessions/cwd_123_default',
    });
  });
});
