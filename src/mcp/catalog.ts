import { listSemanticCommandTools } from './semantic-tools.ts';

export const MCP_SERVER_NAME = 'agent-device';

export function listTools(): unknown[] {
  return listSemanticCommandTools();
}
