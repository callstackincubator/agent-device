import type { SessionState } from './types.ts';

export type SessionRecoveryContext = 'device-in-use' | 'selector-conflict';

export function describeSessionDevice(session: SessionState): string {
  const platform = session.device.platform;
  const name = session.device.name.trim();
  const id = session.device.id;
  return `${platform} device "${name}" (${id})`;
}

export function buildSessionRecoveryHint(
  session: SessionState,
  context: SessionRecoveryContext,
): string {
  if (session.recording) {
    return buildRecordingSessionRecoveryHint(session, context);
  }
  return buildOpenSessionRecoveryHint(session, context);
}

function buildRecordingSessionRecoveryHint(
  session: SessionState,
  context: SessionRecoveryContext,
): string {
  const closeCommand = `agent-device close --session ${session.name}`;
  const reuseText =
    context === 'selector-conflict'
      ? `To keep using this device, rerun the command with --session ${session.name} and remove conflicting device selectors.`
      : `To keep using this device, reuse --session ${session.name} for commands that should attach to the recording session.`;

  return (
    `Recording session "${session.name}" owns this device. ` +
    `Run agent-device record stop --session ${session.name}; if the session still appears in agent-device session list, run ${closeCommand}. ` +
    `${reuseText} ` +
    `Run agent-device session list to inspect active sessions.`
  );
}

function buildOpenSessionRecoveryHint(
  session: SessionState,
  context: SessionRecoveryContext,
): string {
  const closeCommand = `agent-device close --session ${session.name}`;
  if (context === 'selector-conflict') {
    return (
      `Run agent-device session list to inspect active sessions. ` +
      `To reuse this device, rerun the command with --session ${session.name} and remove conflicting device selectors. ` +
      `To switch devices, first run ${closeCommand}, then open the desired device with a different --session name.`
    );
  }

  return (
    `Run agent-device session list to inspect active sessions. ` +
    `To reuse this device, rerun the command with --session ${session.name}. ` +
    `To open a new session on this device, first run ${closeCommand}.`
  );
}
