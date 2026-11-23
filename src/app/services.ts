import { DEMO_STOCK } from '../domain/catalog';
import { createInventory } from '../server/inventory';
import { SyncEngine } from '../sync/engine';
import {
  type NetworkSwitch,
  createHttpTransport,
  createInProcessTransport,
  withNetworkSwitch,
} from '../sync/transports';
import type { KeyValueStorage } from '../sync/types';

export interface PosServices {
  engine: SyncEngine;
  /** "Airplane mode" for the demo; wraps whichever transport is in use. */
  network: NetworkSwitch;
  newId: () => string;
  now: () => Date;
  /** Where sales go, shown in the UI. */
  backendLabel: string;
}

export interface CreateServicesOptions {
  storage: KeyValueStorage;
  newId: () => string;
  apiUrl?: string | undefined;
  latencyMs?: number;
}

/**
 * Uses the HTTP API when `apiUrl` is set (see server/), otherwise an in-process
 * copy of the same API so the app runs anywhere with no setup.
 */
export function createPosServices(opts: CreateServicesOptions): PosServices {
  const transport = opts.apiUrl
    ? createHttpTransport(opts.apiUrl)
    : createInProcessTransport(createInventory({ initialStock: { ...DEMO_STOCK } }), {
        latencyMs: opts.latencyMs ?? 250,
      });
  const network = withNetworkSwitch(transport);
  const engine = new SyncEngine({
    storage: opts.storage,
    transport: network,
    initialStock: { stock: { ...DEMO_STOCK }, version: 0 },
  });
  return {
    engine,
    network,
    newId: opts.newId,
    now: () => new Date(),
    backendLabel: opts.apiUrl ? new URL(opts.apiUrl).host : 'in-app demo server',
  };
}
