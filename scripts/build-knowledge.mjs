import { buildKnowledgeFiles, writeKnowledgeFiles } from './knowledge-lib.mjs';

const files = await buildKnowledgeFiles();
await writeKnowledgeFiles(files);
console.log(`Generated ${files.size} knowledge files.`);
