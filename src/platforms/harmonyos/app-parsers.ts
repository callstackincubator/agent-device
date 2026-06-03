export function parseHarmonyBundleList(rawOutput: string): string[] {
  const bundles: string[] = [];
  for (const line of rawOutput.split('\n')) {
    const trimmed = line.trim();
    // Match "Bundle Name: com.example.app" or just lines with bundle patterns
    const match = trimmed.match(/Bundle\s+Name\s*[:=]\s*(\S+)/i);
    if (match) {
      bundles.push(match[1] ?? '');
    } else if (trimmed.includes('.') && !trimmed.startsWith('#') && trimmed.length > 0) {
      // Fallback: if line contains dots (like a bundle ID) and isn't a comment
      bundles.push(trimmed);
    }
  }
  return bundles;
}

export function parseHarmonyForegroundAbility(rawOutput: string): {
  bundleName: string;
  abilityName: string;
} | null {
  const lines = rawOutput.split('\n');
  let currentBundle: string | null = null;
  let currentAbility: string | null = null;
  let currentAppState: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Look for "app name [bundleName]" pattern
    const appMatch = trimmed.match(/app\s+name\s+\[(\S+)\]/i);
    if (appMatch) {
      currentBundle = appMatch[1] ?? null;
    }

    // Look for "bundle name [bundleName]" pattern
    const bundleMatch = trimmed.match(/bundle\s+name\s+\[(\S+)\]/i);
    if (bundleMatch) {
      currentBundle = bundleMatch[1] ?? null;
    }

    // Look for "main name [abilityName]" pattern
    const abilityMatch = trimmed.match(/main\s+name\s+\[(\S+)\]/i);
    if (abilityMatch) {
      currentAbility = abilityMatch[1] ?? null;
    }

    // Look for "app state #FOREGROUND" pattern
    const stateMatch = trimmed.match(/app\s+state\s+#(\S+)/i);
    if (stateMatch) {
      currentAppState = stateMatch[1] ?? null;
    }

    // When we find a complete entry, check if it's foreground
    if (currentBundle && currentAbility && currentAppState) {
      if (currentAppState === 'FOREGROUND') {
        return { bundleName: currentBundle, abilityName: currentAbility };
      }
      // Reset for next entry
      currentBundle = null;
      currentAbility = null;
      currentAppState = null;
    }
  }

  return null;
}

/** Parse `hdc shell wukong appinfo` bundle → launch ability pairs. */
export function parseWukongAppInfo(rawOutput: string): Map<string, string> {
  const abilities = new Map<string, string>();
  let pendingBundle: string | null = null;

  for (const line of rawOutput.split('\n')) {
    const trimmed = line.trim();
    const bundleMatch = trimmed.match(/^BundleName:\s+(\S+)/i);
    if (bundleMatch) {
      pendingBundle = bundleMatch[1] ?? null;
      continue;
    }

    const abilityMatch = trimmed.match(/^AbilityName:\s+(\S+)/i);
    if (abilityMatch && pendingBundle && !abilities.has(pendingBundle)) {
      abilities.set(pendingBundle, abilityMatch[1] ?? '');
      pendingBundle = null;
    }
  }

  return abilities;
}

export function lookupWukongLaunchAbility(rawOutput: string, bundleName: string): string | null {
  return parseWukongAppInfo(rawOutput).get(bundleName) ?? null;
}

export function parseHarmonyRunningAbilities(rawOutput: string): Array<{
  bundleName: string;
  abilityName: string;
}> {
  const abilities: Array<{ bundleName: string; abilityName: string }> = [];
  const lines = rawOutput.split('\n');
  let currentBundle = '';

  for (const line of lines) {
    const trimmed = line.trim();
    const bundleMatch = trimmed.match(/bundle\s*[:=]\s*(\S+)/i);
    if (bundleMatch) {
      currentBundle = bundleMatch[1] ?? '';
    }
    const abilityMatch = trimmed.match(/ability\s*[:=]\s*(\S+)/i);
    if (abilityMatch && currentBundle) {
      abilities.push({
        bundleName: currentBundle,
        abilityName: abilityMatch[1] ?? '',
      });
    }
  }

  return abilities;
}
