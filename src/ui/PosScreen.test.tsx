import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { PosProvider } from '../app/PosContext';
import type { PosServices } from '../app/services';
import { DEMO_PRODUCTS, DEMO_STOCK } from '../domain/catalog';
import { createInventory } from '../server/inventory';
import { SyncEngine } from '../sync/engine';
import { createInProcessTransport, withNetworkSwitch } from '../sync/transports';
import { MemoryStorage } from '../test/fakes';
import { PosScreen } from './PosScreen';

async function setup(stock: Record<string, number> = { ...DEMO_STOCK }) {
  const inventory = createInventory({ initialStock: stock });
  const network = withNetworkSwitch(createInProcessTransport(inventory));
  const storage = new MemoryStorage();
  const engine = new SyncEngine({ storage, transport: network, initialStock: { stock, version: 0 } });
  let id = 0;
  const services: PosServices = {
    engine,
    network,
    newId: () => `test-sale-${++id}`,
    now: () => new Date('2026-05-04T10:00:00Z'),
    backendLabel: 'test',
  };
  await render(
    <PosProvider services={services} autoSync={false}>
      <PosScreen products={DEMO_PRODUCTS} />
    </PosProvider>,
  );
  return { inventory, engine, network, storage };
}

const press = (label: RegExp | string) => fireEvent.press(screen.getByRole('button', { name: label }));

describe('<PosScreen>', () => {
  it('builds a sale from product taps and shows correct totals', async () => {
    await setup();
    await press(/^Add Espresso/);
    await press(/^Add Espresso/);
    await press(/^Add Logo mug/);
    expect(screen.getByTestId('cart-line-COF-ESP')).toHaveTextContent(/\$3\.00 × 2/);
    // 600 + 1499 + tax 124 = 2223
    expect(screen.getByTestId('cart-total')).toHaveTextContent('$22.23');
    await press('Remove one Espresso');
    expect(screen.getByTestId('cart-total')).toHaveTextContent('$19.23');
  });

  it('applies the order discount', async () => {
    await setup();
    await press(/^Add Butter croissant/);
    await fireEvent.press(screen.getByRole('radio', { name: '10% off' }));
    expect(screen.getByRole('radio', { name: '10% off' })).toBeChecked();
    expect(screen.getByTestId('cart-total')).toHaveTextContent('$3.15');
  });

  it('charges, clears the cart and syncs the sale', async () => {
    const { inventory } = await setup();
    await press(/^Add Oat latte/);
    await press('Charge $4.75');
    await waitFor(() => expect(screen.getByTestId('sync-status')).toHaveTextContent('All synced'));
    expect(screen.getByTestId('receipt')).toHaveTextContent('Sale saved · $4.75');
    expect(screen.getByText('Tap a product to start a sale.')).toBeOnTheScreen();
    expect(inventory.sales()).toEqual([expect.objectContaining({ id: 'test-sale-1', total: 475 })]);
  });

  it('keeps selling offline and shows the projected stock', async () => {
    const { inventory, storage } = await setup({ ...DEMO_STOCK, 'BEV-OJ': 2 });
    await fireEvent(screen.getByLabelText('Network connection'), 'valueChange', false);
    await press(/^Add Orange juice, \$3\.99, 2 left/);
    await press(/^Charge/);
    await waitFor(() => expect(screen.getByTestId('sync-counts')).toHaveTextContent(/1 pending/));
    expect(screen.getByTestId('sync-status')).toHaveTextContent('Offline');
    expect(inventory.sales()).toHaveLength(0);
    expect(storage.writes).toBeGreaterThan(0);
    // Stock shown on the tile already counts the unsynced sale.
    expect(screen.getByRole('button', { name: /^Add Orange juice, \$3\.99, 1 left/ })).toBeOnTheScreen();

    await fireEvent(screen.getByLabelText('Network connection'), 'valueChange', true);
    await waitFor(() => expect(screen.getByTestId('sync-counts')).toHaveTextContent(/0 pending/));
    expect(inventory.stockOf('BEV-OJ')).toBe(1);
  });

  it('disables sold-out products, counting what is already in the cart', async () => {
    await setup({ ...DEMO_STOCK, 'MER-MUG': 1 });
    await press(/^Add Logo mug/);
    const tile = screen.getByTestId('product-MER-MUG');
    expect(tile).toBeDisabled();
    expect(within(tile).getByText('Sold out')).toBeOnTheScreen();
  });

  it('lists a rejected sale and lets the cashier discard it', async () => {
    const { engine } = await setup();
    await act(() =>
      engine.enqueue({
        id: 'bad-sale-0001',
        createdAt: '2026-05-04T10:00:00.000Z',
        lines: [{ sku: 'GONE', qty: 1, unitPrice: 100, net: 100, tax: 0 }],
        total: 100,
        tax: 0,
      }),
    );
    await press('Sync now');
    const list = await screen.findByLabelText('Rejected sales');
    expect(within(list).getByText(/unknown_sku/)).toBeOnTheScreen();
    await fireEvent.press(within(list).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByLabelText('Rejected sales')).toBeNull());
  });
});
