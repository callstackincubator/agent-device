import { applyXctestRunnerAppIconFromDerivedPath } from '../src/platforms/ios/runner-icon.ts';

const [derivedPath] = process.argv.slice(2);

if (!derivedPath) {
  console.error('Usage: patch-xcuitest-runner-icon.ts <derived>');
  process.exit(1);
}

await applyXctestRunnerAppIconFromDerivedPath(derivedPath);
