import { useMemo, useReducer, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { usePosServices, useSyncState } from '../app/PosContext';
import { EMPTY_CART, cartReducer, catalogMap, priceCart } from '../domain/cart';
import type { Product } from '../domain/catalog';
import { formatMoney } from '../domain/money';
import { buildSale } from '../domain/sale';
import { projectStock } from '../sync/engine';
import { CartPanel } from './CartPanel';
import { ProductGrid } from './ProductGrid';
import { SyncPanel } from './SyncPanel';
import { colors, space } from './theme';

export const WIDE_BREAKPOINT = 768;

export function PosScreen({ products }: { products: readonly Product[] }) {
  const { engine, newId, now } = usePosServices();
  const sync = useSyncState();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;

  const catalog = useMemo(() => catalogMap(products), [products]);
  const [cart, dispatch] = useReducer(cartReducer, EMPTY_CART);
  const [charging, setCharging] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);

  const totals = useMemo(() => priceCart(cart, catalog), [cart, catalog]);
  const stock = useMemo(() => projectStock(sync.serverStock, sync.outbox), [sync.serverStock, sync.outbox]);
  const inCart = useMemo(() => Object.fromEntries(cart.lines.map((l) => [l.sku, l.qty])), [cart]);

  const charge = async () => {
    setCharging(true);
    try {
      const sale = buildSale(totals, newId(), now());
      // Durable first: once this resolves the sale survives an app kill.
      await engine.enqueue(sale);
      dispatch({ type: 'clear' });
      setReceipt(`Sale saved · ${formatMoney(totals.total)}`);
      void engine.flush();
    } finally {
      setCharging(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Corner Café · Till 1
        </Text>
        <Text style={styles.subtitle}>Demo store · invented data</Text>
      </View>
      {receipt && (
        <Text style={styles.receipt} accessibilityLiveRegion="polite" testID="receipt">
          {receipt}
        </Text>
      )}
      <View style={[styles.body, wide && styles.bodyWide]}>
        <View style={wide ? styles.main : undefined}>
          <ProductGrid
            products={products}
            stock={stock}
            inCart={inCart}
            onAdd={(sku) => {
              setReceipt(null);
              dispatch({ type: 'add', sku });
            }}
            columns={wide ? 4 : 2}
          />
        </View>
        <View style={[styles.side, wide && styles.sideWide]}>
          <CartPanel totals={totals} orderDiscount={cart.orderDiscount} dispatch={dispatch} onCharge={charge} charging={charging} />
          <SyncPanel />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), gap: space(4), maxWidth: 1280, width: '100%', alignSelf: 'center' },
  header: { gap: space(1) },
  title: { fontSize: 24, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted },
  receipt: { backgroundColor: '#e3f1e8', color: colors.ok, padding: space(3), borderRadius: 8, fontWeight: '600' },
  body: { gap: space(4) },
  bodyWide: { flexDirection: 'row', alignItems: 'flex-start' },
  main: { flex: 3 },
  side: { gap: space(4) },
  sideWide: { flex: 2, minWidth: 320 },
});
