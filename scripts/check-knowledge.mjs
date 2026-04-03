import { buildKnowledgeFiles, checkKnowledgeFiles } from './knowledge-lib.mjs';

const files = await buildKnowledgeFiles();
const result = await checkKnowledgeFiles(files);

if (result.ok) {
  console.log(`knowledge/ is up to date (${files.size} files checked).`);
  process.exit(0);
}

if (result.missing.length > 0) {
  console.error(`Missing files:\n${result.missing.map((entry) => `- ${entry}`).join('\n')}`);
}
if (result.extra.length > 0) {
  console.error(`Unexpected files:\n${result.extra.map((entry) => `- ${entry}`).join('\n')}`);
}
if (result.changed.length > 0) {
  console.error(`Stale files:\n${result.changed.map((entry) => `- ${entry}`).join('\n')}`);
}

console.error('Run `pnpm kb:build` to refresh the generated knowledge layer.');
process.exit(1);
