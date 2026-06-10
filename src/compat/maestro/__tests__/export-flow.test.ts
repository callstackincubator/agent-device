import { parseAllDocuments } from 'yaml';
import { describe, expect, test } from 'vitest';
import { AppError } from '../../../utils/errors.ts';
import { exportReplayScriptToMaestro } from '../export-flow.ts';

describe('exportReplayScriptToMaestro', () => {
  test('exports app launch, selectors, input, keyboard, assertions, and screenshots', () => {
    const result = exportReplayScriptToMaestro(`env USER="Ada"
context platform=ios target=mobile
open com.example.app --relaunch
click id="email"
fill id="email" "ada@example.com"
keyboard dismiss
find text "Continue" exists
screenshot "./artifacts/checkout"
`);

    const docs = parseYamlDocs(result.yaml);
    expect(docs).toEqual([
      { appId: 'com.example.app', env: { USER: 'Ada' } },
      [
        { launchApp: { appId: 'com.example.app', stopApp: true } },
        { tapOn: { id: 'email' } },
        { tapOn: { id: 'email' } },
        { inputText: 'ada@example.com' },
        'hideKeyboard',
        { assertVisible: 'Continue' },
        { takeScreenshot: './artifacts/checkout' },
      ],
    ]);
    expect(result.warnings).toEqual([
      {
        line: 5,
        action: 'fill id="email" ada@example.com',
        message:
          'fill exports as tapOn + inputText; Maestro may append text instead of replacing existing field contents',
      },
    ]);
  });

  test('exports coordinate gestures and sleep waits with warnings', () => {
    const result = exportReplayScriptToMaestro(`open com.example.app
click 120 240
swipe 200 700 200 200 300 --count 2
wait 500
`);

    expect(parseYamlDocs(result.yaml)).toEqual([
      { appId: 'com.example.app' },
      [
        'launchApp',
        { tapOn: { point: '120,240' } },
        { swipe: { start: '200,700', end: '200,200', duration: 300 } },
        { swipe: { start: '200,700', end: '200,200', duration: 300 } },
        { waitForAnimationToEnd: { timeout: 500 } },
      ],
    ]);
    expect(result.warnings).toEqual([
      {
        line: 4,
        action: 'wait 500',
        message:
          'wait <ms> exports as waitForAnimationToEnd and may return before the full duration',
      },
    ]);
  });

  test('rejects native-only replay actions', () => {
    expect(() =>
      exportReplayScriptToMaestro(`open com.example.app
snapshot -i
get text id="status"
`),
    ).toThrowError(AppError);
    try {
      exportReplayScriptToMaestro(`open com.example.app
snapshot -i
get text id="status"
`);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).message).toContain('line 2 (snapshot)');
      expect((error as AppError).message).toContain('line 3 (get text id="status")');
    }
  });
});

function parseYamlDocs(script: string): unknown[] {
  return parseAllDocuments(script).map((doc) => doc.toJSON());
}
