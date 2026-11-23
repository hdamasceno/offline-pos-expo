import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CartAction, CartTotals } from '../domain/cart';
import { type BasisPoints, bp, formatMoney } from '../domain/money';
import { colors, radius, space } from './theme';

interface Props {
  totals: CartTotals;
  orderDiscount: BasisPoints;
  dispatch: (a: CartAction) => void;
  onCharge: () => void;
  charging: boolean;
}

const DISCOUNTS = [0, 500, 1000] as const;

export function CartPanel({ totals, orderDiscount, dispatch, onCharge, charging }: Props) {
  const empty = totals.lines.length === 0;
  return (
    <View style={styles.panel}>
      <Text style={styles.title} accessibilityRole="header">
        Current sale
      </Text>

      {empty ? (
        <Text style={styles.empty}>Tap a product to start a sale.</Text>
      ) : (
        <View accessibilityRole="list" accessibilityLabel="Cart">
          {totals.lines.map((l) => (
            <View key={l.sku} style={styles.line} testID={`cart-line-${l.sku}`}>
              <View style={styles.lineMain}>
                <Text style={styles.lineName}>{l.name}</Text>
                <Text style={styles.muted}>
                  {formatMoney(l.unitPrice)} × {l.qty}
                  {l.discount > 0 ? `  −${formatMoney(l.discount)}` : ''}
                </Text>
              </View>
              <View style={styles.stepper}>
                <StepButton label="−" a11y={`Remove one ${l.name}`} onPress={() => dispatch({ type: 'decrement', sku: l.sku })} />
                <Text style={styles.qty}>{l.qty}</Text>
                <StepButton label="+" a11y={`Add one ${l.name}`} onPress={() => dispatch({ type: 'add', sku: l.sku })} />
              </View>
              <Text style={styles.amount}>{formatMoney(l.net)}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.discounts} accessibilityRole="radiogroup" accessibilityLabel="Order discount">
        {DISCOUNTS.map((d) => {
          const selected = orderDiscount === d;
          return (
            <Pressable
              key={d}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => dispatch({ type: 'orderDiscount', discount: bp(d) })}
              style={[styles.chip, selected && styles.chipOn]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextOn]}>{d === 0 ? 'No discount' : `${d / 100}% off`}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.totals}>
        <Row label="Subtotal" value={formatMoney(totals.subtotal)} />
        {totals.discount > 0 && <Row label="Discount" value={`−${formatMoney(totals.discount)}`} />}
        <Row label="Tax" value={formatMoney(totals.tax)} />
        <Row label="Total" value={formatMoney(totals.total)} strong testID="cart-total" />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Charge ${formatMoney(totals.total)}`}
        accessibilityState={{ disabled: empty || charging, busy: charging }}
        disabled={empty || charging}
        onPress={onCharge}
        style={({ pressed }) => [styles.charge, (empty || charging) && styles.chargeOff, pressed && styles.pressed]}
      >
        <Text style={styles.chargeText}>{charging ? 'Saving…' : `Charge ${formatMoney(totals.total)}`}</Text>
      </Pressable>
      {!empty && (
        <Pressable accessibilityRole="button" onPress={() => dispatch({ type: 'clear' })} style={styles.clear}>
          <Text style={styles.clearText}>Clear sale</Text>
        </Pressable>
      )}
    </View>
  );
}

function StepButton({ label, a11y, onPress }: { label: string; a11y: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress} style={styles.step} hitSlop={6}>
      <Text style={styles.stepText}>{label}</Text>
    </Pressable>
  );
}

function Row({ label, value, strong, testID }: { label: string; value: string; strong?: boolean; testID?: string }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.strong]} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: space(4), gap: space(3) },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  empty: { color: colors.muted, paddingVertical: space(4) },
  muted: { color: colors.muted, fontSize: 13, fontVariant: ['tabular-nums'] },
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.border, gap: space(2) },
  lineMain: { flex: 1, gap: 2 },
  lineName: { fontWeight: '600', color: colors.text },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  step: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 18, color: colors.text },
  qty: { minWidth: 20, textAlign: 'center', fontVariant: ['tabular-nums'], color: colors.text },
  amount: { minWidth: 72, textAlign: 'right', fontVariant: ['tabular-nums'], color: colors.text },
  discounts: { flexDirection: 'row', gap: space(2), flexWrap: 'wrap' },
  chip: { paddingHorizontal: space(3), paddingVertical: space(1.5), borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { color: colors.text, fontSize: 13 },
  chipTextOn: { color: colors.surface },
  totals: { gap: space(1) },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { color: colors.muted },
  rowValue: { color: colors.text, fontVariant: ['tabular-nums'] },
  strong: { color: colors.text, fontWeight: '700', fontSize: 18 },
  charge: { backgroundColor: colors.accent, borderRadius: radius, paddingVertical: space(4), alignItems: 'center' },
  chargeOff: { opacity: 0.4 },
  chargeText: { color: colors.accentText, fontWeight: '700', fontSize: 17 },
  pressed: { opacity: 0.85 },
  clear: { alignItems: 'center', paddingVertical: space(1) },
  clearText: { color: colors.muted, textDecorationLine: 'underline' },
});
