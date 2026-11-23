import { createInventory } from '../server/inventory';
import { FakeClock, MemoryStorage, makeSale, seeded } from '../test/fakes';
import { STORAGE_KEY, SyncEngine, projectStock } from './engine';
import { createInProcessTransport, withNetworkSwitch } from './transports';
import { type Transport, PermanentError } from './types';

function setup(stock: Record<string, number> = { A: 10, B: 10 }) {
  const inventory = createInventory({ initialStock: stock });
  const net = withNetworkSwitch(createInProcessTransport(inventory));
  const storage = new MemoryStorage();
  const clock = new FakeClock();
  const make = () => new SyncEngine({ storage, transport: net, clock, random: () => 0.5 });
  return { inventory, net, storage, clock, engine: make(), make };
}

describe('SyncEngine', () => {
  it('writes a sale to storage before enqueue resolves', async () => {
    const { engine, storage } = setup();
    await engine.load();
    await engine.enqueue(makeSale([['A', 1]]));
    const saved = JSON.parse(storage.data.get(STORAGE_KEY)!);
    expect(saved.outbox).toHaveLength(1);
  });

  it('ignores a sale that is already queued', async () => {
    const { engine } = setup();
    const s = makeSale([['A', 1]]);
    await engine.enqueue(s);
    await engine.enqueue(s);
    expect(engine.getState().outbox).toHaveLength(1);
  });

  it('sends pending sales oldest first and applies server stock', async () => {
    const { engine, inventory } = setup();
    const a = makeSale([['A', 2]]);
    const b = makeSale([['B', 1]]);
    await engine.enqueue(a);
    await engine.enqueue(b);
    expect(await engine.flush()).toEqual({ sent: 2, failed: 0, remaining: 0 });
    expect(inventory.sales().map((s) => s.id)).toEqual([a.id, b.id]);
    expect(engine.getState()).toMatchObject({ outbox: [], serverStock: { A: 8, B: 9 }, lastError: null });
  });

  it('keeps order while offline and retries with backoff', async () => {
    const { engine, net, clock, inventory } = setup();
    net.setOnline(false);
    await engine.enqueue(makeSale([['A', 1]]));
    await engine.enqueue(makeSale([['A', 1]]));

    expect(await engine.flush()).toEqual({ sent: 0, failed: 0, remaining: 2 });
    const [head, second] = engine.getState().outbox;
    expect(head).toMatchObject({ attempts: 1, lastError: 'Offline' });
    expect(second?.attempts).toBe(0); // never tried: it waits behind the head
    expect(engine.nextDueIn()).toBe(750); // attempt 1 with random 0.5 -> 500 + 250

    net.setOnline(true);
    expect(await engine.flush()).toMatchObject({ sent: 0 }); // not due yet
    clock.advance(750);
    expect(await engine.flush()).toEqual({ sent: 2, failed: 0, remaining: 0 });
    expect(inventory.stockOf('A')).toBe(8);
  });

  it('skips the backoff wait on syncNow', async () => {
    const { engine, net } = setup();
    net.setOnline(false);
    await engine.enqueue(makeSale([['A', 1]]));
    await engine.flush();
    expect(engine.nextDueIn()).toBeGreaterThan(0);
    net.setOnline(true);
    expect(await engine.syncNow()).toEqual({ sent: 1, failed: 0, remaining: 0 });
  });

  it('grows the delay with each failed attempt and honours Retry-After', async () => {
    const { engine, net, clock, inventory } = setup();
    net.setOnline(false);
    await engine.enqueue(makeSale([['A', 1]]));
    const delays: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      await engine.flush();
      const d = engine.nextDueIn()!;
      delays.push(d);
      clock.advance(d);
    }
    expect(delays).toEqual([750, 1500, 3000, 6000]);

    net.setOnline(true);
    inventory.setFailureRates({ failureRate: 1 }); // 503 with Retry-After: 1
    clock.advance(10_000);
    await engine.flush();
    expect(engine.nextDueIn()).toBe(12_000); // attempt 5: 16 s window -> 12 s, above the 1 s Retry-After
  });

  it('does not double-count a sale whose response was lost', async () => {
    const { engine, inventory, clock } = setup();
    inventory.setFailureRates({ lostResponseRate: 1 });
    await engine.enqueue(makeSale([['A', 3]]));
    await engine.flush();
    expect(engine.getState().outbox).toHaveLength(1);
    expect(inventory.stockOf('A')).toBe(7);

    inventory.setFailureRates({ lostResponseRate: 0 });
    clock.advance(60_000);
    await engine.flush();
    expect(engine.getState().outbox).toHaveLength(0);
    expect(inventory.sales()).toHaveLength(1);
    expect(inventory.stockOf('A')).toBe(7);
    expect(engine.getState().serverStock.A).toBe(7);
  });

  it('sets a rejected sale aside and carries on with the rest', async () => {
    const { engine } = setup();
    const bad = makeSale([['UNKNOWN', 1]]);
    const good = makeSale([['A', 1]]);
    await engine.enqueue(bad);
    await engine.enqueue(good);
    expect(await engine.flush()).toEqual({ sent: 1, failed: 1, remaining: 0 });
    expect(engine.getState().outbox).toEqual([expect.objectContaining({ status: 'failed', lastError: 'unknown_sku' })]);

    await engine.retryFailed(bad.id);
    expect(engine.getState().outbox[0]).toMatchObject({ status: 'pending', attempts: 0 });
    await engine.flush();
    await engine.discardFailed(bad.id);
    expect(engine.getState().outbox).toEqual([]);
  });

  it('runs one flush at a time', async () => {
    let calls = 0;
    const slow: Transport = {
      submitSale: async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 5));
        return { stock: {}, version: 1, duplicate: false, oversold: [] };
      },
      fetchStock: async () => ({ stock: {}, version: 1 }),
    };
    const engine = new SyncEngine({ storage: new MemoryStorage(), transport: slow, clock: new FakeClock() });
    await engine.enqueue(makeSale([['A', 1]]));
    const [r1, r2] = await Promise.all([engine.flush(), engine.flush()]);
    expect(r1).toBe(r2);
    expect(calls).toBe(1);
  });

  it('treats unexpected errors as transient', async () => {
    const broken: Transport = {
      submitSale: () => Promise.reject(new Error('boom')),
      fetchStock: () => Promise.reject(new PermanentError('nope')),
    };
    const engine = new SyncEngine({ storage: new MemoryStorage(), transport: broken, clock: new FakeClock() });
    await engine.enqueue(makeSale([['A', 1]]));
    await engine.flush();
    expect(engine.getState()).toMatchObject({ lastError: 'boom', outbox: [expect.objectContaining({ status: 'pending' })] });
    expect(await engine.refreshStock()).toBe(false);
  });

  it('survives a restart: a new engine resumes from storage', async () => {
    const { engine, net, make, inventory } = setup();
    net.setOnline(false);
    await engine.enqueue(makeSale([['B', 4]]));
    await engine.flush();

    const restarted = make();
    await restarted.load();
    expect(restarted.getState().outbox).toHaveLength(1);
    net.setOnline(true);
    restarted.getState().outbox[0]!.nextAttemptAt = 0;
    await restarted.flush();
    expect(inventory.stockOf('B')).toBe(6);
  });

  it('resets unreadable saved data instead of crashing', async () => {
    const storage = new MemoryStorage();
    storage.data.set(STORAGE_KEY, '{not json');
    const engine = new SyncEngine({ storage, transport: setup().net });
    await engine.load();
    expect(engine.getState()).toMatchObject({ loaded: true, outbox: [] });
    expect(engine.getState().lastError).toMatch(/unreadable/);
  });

  it('ignores a stock snapshot older than the one it has', async () => {
    const { engine, inventory } = setup();
    await engine.enqueue(makeSale([['A', 1]]));
    await engine.flush(); // version 2
    const stale = { stock: { A: 999 }, version: 1 };
    const t = { submitSale: jest.fn(), fetchStock: async () => stale };
    const other = new SyncEngine({ storage: new MemoryStorage(), transport: t, initialStock: { stock: { A: 9 }, version: 2 } });
    await other.refreshStock();
    expect(other.getState().serverStock.A).toBe(9);
    expect(await engine.refreshStock()).toBe(true);
    expect(engine.getState().serverStock).toEqual({ A: 9, B: 10 });
    expect(inventory.stockOf('A')).toBe(9);
  });

  it('notifies subscribers and stops after unsubscribe', async () => {
    const { engine } = setup();
    const listener = jest.fn();
    const off = engine.subscribe(listener);
    await engine.enqueue(makeSale([['A', 1]]));
    expect(listener).toHaveBeenCalled();
    off();
    listener.mockClear();
    await engine.flush();
    expect(listener).not.toHaveBeenCalled();
  });

  it('never loses or duplicates a sale under random chaos', async () => {
    const random = seeded(2026);
    const inventory = createInventory({ initialStock: { A: 1000, B: 1000 }, random });
    const net = withNetworkSwitch(createInProcessTransport(inventory));
    const storage = new MemoryStorage();
    const clock = new FakeClock();
    let engine = new SyncEngine({ storage, transport: net, clock, random });
    await engine.load();
    const queued: string[] = [];
    let soldA = 0;

    for (let step = 0; step < 400; step += 1) {
      const r = random();
      if (r < 0.35) {
        const qty = 1 + Math.floor(random() * 3);
        const s = makeSale([['A', qty]]);
        soldA += qty;
        queued.push(s.id);
        await engine.enqueue(s);
      } else if (r < 0.5) {
        net.setOnline(!net.online);
      } else if (r < 0.6) {
        inventory.setFailureRates({ failureRate: random() * 0.5, lostResponseRate: random() * 0.5 });
      } else if (r < 0.65) {
        engine = new SyncEngine({ storage, transport: net, clock, random }); // app restart
        await engine.load();
      } else {
        clock.advance(Math.floor(random() * 20_000));
        await engine.flush();
      }
    }

    // Recover: online, healthy server, enough time for any backoff.
    net.setOnline(true);
    inventory.setFailureRates({ failureRate: 0, lostResponseRate: 0 });
    for (let i = 0; i < 5 && engine.getState().outbox.length > 0; i += 1) {
      clock.advance(120_000);
      await engine.flush();
    }

    expect(engine.getState().outbox).toEqual([]);
    expect(inventory.sales().map((s) => s.id)).toEqual(queued); // all of them, once, in order
    expect(inventory.stockOf('A')).toBe(1000 - soldA);
  });
});

describe('projectStock', () => {
  it('subtracts pending sales only', () => {
    const pending = { sale: makeSale([['A', 2], ['B', 1]]), status: 'pending' as const, attempts: 0, nextAttemptAt: 0, enqueuedAt: 0 };
    const failed = { ...pending, sale: makeSale([['A', 5]]), status: 'failed' as const };
    expect(projectStock({ A: 10, B: 3 }, [pending, failed])).toEqual({ A: 8, B: 2 });
    expect(projectStock({}, [pending])).toEqual({ A: -2, B: -1 });
  });
});
