import { type BasisPoints, type Cents, bp, cents } from './money';

export interface Product {
  sku: string;
  name: string;
  price: Cents;
  /** Sales tax rate for this product. */
  taxRate: BasisPoints;
  emoji: string;
}

const FOOD = bp(0);
const GENERAL = bp(825); // 8.25%, an invented "general merchandise" rate

/** Invented demo catalogue for a small corner café. */
export const DEMO_PRODUCTS: readonly Product[] = [
  { sku: 'COF-ESP', name: 'Espresso', price: cents(300), taxRate: FOOD, emoji: '☕' },
  { sku: 'COF-LAT', name: 'Oat latte', price: cents(475), taxRate: FOOD, emoji: '🥛' },
  { sku: 'BAK-CRO', name: 'Butter croissant', price: cents(350), taxRate: FOOD, emoji: '🥐' },
  { sku: 'BAK-BAG', name: 'Sesame bagel', price: cents(295), taxRate: FOOD, emoji: '🥯' },
  { sku: 'SNK-CKE', name: 'Choc chip cookie', price: cents(225), taxRate: FOOD, emoji: '🍪' },
  { sku: 'BEV-OJ', name: 'Orange juice', price: cents(399), taxRate: FOOD, emoji: '🍊' },
  { sku: 'MER-MUG', name: 'Logo mug', price: cents(1499), taxRate: GENERAL, emoji: '🫖' },
  { sku: 'MER-BAG', name: 'Coffee beans 250g', price: cents(1250), taxRate: GENERAL, emoji: '🫘' },
];

export { DEMO_STOCK } from '../server/demoStock';
