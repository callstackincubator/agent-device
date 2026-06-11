import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppColors } from '../src/theme';

/**
 * AX stress fixture (issue #701). Two distinct failure shapes:
 * - adlab://stress?depth=80 reproduces the bulk-snapshot rejection XCTest hits on deep
 *   React Native trees (kAXErrorIllegalArgument once requested depth crosses a
 *   tree-size-dependent limit, observed between 56 and 64).
 * - adlab://stress?collapse=1 reproduces the accessible-container collapse: marking a
 *   container accessible makes UIKit fold the whole subtree into one merged leaf — not a
 *   bug, but the shape agents most often misread as one.
 *
 * Params:
 * - depth: nesting depth of plain Views above each row (default 80).
 * - rows: number of nested row stacks (default 40).
 * - accessible: "0" drops the per-row labels (control case; default on).
 * - collapse: "1" marks the list container itself accessible (merged-leaf shape).
 */
export default function StressScreen() {
  const colors = useAppColors();
  const params = useLocalSearchParams<{
    accessible?: string;
    depth?: string;
    rows?: string;
    collapse?: string;
  }>();
  const accessible = params.accessible !== '0';
  const collapse = params.collapse === '1';
  const depth = clampInt(params.depth, 80, 1, 200);
  const rows = clampInt(params.rows, 40, 1, 200);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.surface }]} testID="stressScreen">
      <Text style={[styles.title, { color: colors.text }]} testID="stressTitle">
        AX stress: depth {depth} · rows {rows} · accessible {accessible ? 'on' : 'off'}
        {collapse ? ' · collapsed container' : ''}
      </Text>
      <ScrollView testID="stressList" accessible={collapse}>
        {Array.from({ length: rows }, (_, row) => (
          <NestedRow key={row} row={row} depth={depth} accessible={accessible} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function NestedRow({
  row,
  depth,
  accessible,
}: {
  row: number;
  depth: number;
  accessible: boolean;
}) {
  let node = (
    <Text
      accessible={accessible}
      accessibilityLabel={accessible ? `stress row ${row}` : undefined}
      testID={`stressRow-${row}`}
      style={styles.row}
    >
      stress row {row}
    </Text>
  );
  for (let level = 0; level < depth; level += 1) {
    node = <View collapsable={false}>{node}</View>;
  }
  return node;
}

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    padding: 12,
  },
  row: {
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 2,
  },
});
