export function hasKnownReactNativeOverlayText(text: string): boolean {
  return /\b(logbox|redbox|reload js|copy stack|component stack|call stack|runtime error|open debugger to view warnings)\b/.test(
    text,
  );
}

export function isReactNativeStackFrame(text: string): boolean {
  return (
    /\b[\w.$<>/-]+\.(?:tsx?|jsx?):\d+(?::\d+)?\b/.test(text) ||
    /\b[\w.$<>/-]+\.(?:tsx?|jsx?)\s+\(\d+:\d+\)/.test(text)
  );
}

export function isReactNativeCollapsedWarningLabel(rawLabel: string | undefined): boolean {
  const label = rawLabel?.trim().toLowerCase();
  if (!label) return false;
  return (
    label.includes('open debugger to view warnings') ||
    /^!,\s+/.test(label) ||
    /^(warn|warning|error):\s+/.test(label) ||
    /\b(?:possible\s+)?unhandled (?:promise )?rejection\b/.test(label) ||
    label.includes('getsnapshot should be cached to avoid an infinite loop') ||
    label.includes('unique "key" prop') ||
    label.includes("unique 'key' prop") ||
    label.includes('virtualizedlists should never be nested') ||
    label.includes('failed prop type')
  );
}

export function isReactNativeOpenDebuggerWarningLabel(label: string): boolean {
  return label.includes('open debugger to view warnings') || /^!,\s+open debugger\b/.test(label);
}
