import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Product } from '../domain/catalog';
import { formatMoney } from '../domain/money';
import { colors, radius, space } from './theme';

export const LOW_STOCK = 5;

interface Props {
  products: readonly Product[];
  /** Stock the till believes it has (server stock minus unsynced sales). */
  stock: Readonly<Record<string, number>>;
  /** Quantity already in the cart, per SKU. */
  inCart: Readonly<Record<string, number>>;
  onAdd: (sku: string) => void;
  columns: number;
}

export function ProductGrid({ products, stock, inCart, onAdd, columns }: Props) {
  return (
    <View style={styles.grid} accessibilityRole="list" accessibilityLabel="Products">
      {products.map((p) => (
        <ProductTile
          key={p.sku}
          product={p}
          available={(stock[p.sku] ?? 0) - (inCart[p.sku] ?? 0)}
          onAdd={onAdd}
          width={`${100 / columns}%`}
        />
      ))}
    </View>
  );
}

interface TileProps {
  product: Product;
  available: number;
  onAdd: (sku: string) => void;
  width: `${number}%`;
}

const ProductTile = memo(function ProductTile({ product, available, onAdd, width }: TileProps) {
  const soldOut = available <= 0;
  const low = !soldOut && available <= LOW_STOCK;
  const stockText = soldOut ? 'Sold out' : `${available} left`;
  return (
    <View style={[styles.cell, { width }]}>
      <Pressable
        testID={`product-${product.sku}`}
        accessibilityRole="button"
        accessibilityLabel={`Add ${product.name}, ${formatMoney(product.price)}, ${stockText}`}
        accessibilityState={{ disabled: soldOut }}
        disabled={soldOut}
        onPress={() => onAdd(product.sku)}
        style={({ pressed }) => [styles.tile, pressed && styles.pressed, soldOut && styles.disabled]}
      >
        <Text style={styles.emoji} importantForAccessibility="no">
          {product.emoji}
        </Text>
        <Text style={styles.name} numberOfLines={2}>
          {product.name}
        </Text>
        <Text style={styles.price}>{formatMoney(product.price)}</Text>
        <Text style={[styles.stock, low && styles.low, soldOut && styles.out]}>{stockText}</Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', margin: -space(1.5) },
  cell: { padding: space(1.5) },
  tile: {
    backgroundColor: colors.surface,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(3),
    minHeight: 132,
    gap: space(1),
  },
  pressed: { transform: [{ scale: 0.97 }], borderColor: colors.accent },
  disabled: { opacity: 0.45 },
  emoji: { fontSize: 28 },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  price: { fontSize: 15, color: colors.text, fontVariant: ['tabular-nums'] },
  stock: { fontSize: 12, color: colors.muted },
  low: { color: colors.warn, fontWeight: '600' },
  out: { color: colors.danger, fontWeight: '700' },
});
