import { type ReactNode, createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import type { SyncState } from '../sync/engine';
import type { PosServices } from './services';

const Ctx = createContext<PosServices | null>(null);

export function usePosServices(): PosServices {
  const s = useContext(Ctx);
  if (!s) throw new Error('usePosServices must be used inside <PosProvider>');
  return s;
}

export function useSyncState(): SyncState {
  const { engine } = usePosServices();
  return useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
}

export interface PosProviderProps {
  services: PosServices;
  /** Background syncing: flush when due, refresh stock periodically. Off in some tests. */
  autoSync?: boolean;
  stockRefreshMs?: number;
  children: ReactNode;
}

export function PosProvider({ services, autoSync = true, stockRefreshMs = 30_000, children }: PosProviderProps) {
  const { engine } = services;
  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);

  // Load the persisted outbox once.
  useEffect(() => {
    void engine.load().then(() => (autoSync ? engine.flush() : undefined));
  }, [engine, autoSync]);

  // Flush when the head of the queue becomes due. Re-armed on every state change,
  // so a new sale or a finished retry schedules the next attempt.
  useEffect(() => {
    if (!autoSync || !state.loaded || state.syncing) return;
    const due = engine.nextDueIn();
    if (due === null) return;
    const t = setTimeout(() => void engine.flush(), due);
    return () => clearTimeout(t);
  }, [engine, autoSync, state]);

  // Refresh stock now and then, and sync as soon as the app comes to the foreground.
  useEffect(() => {
    if (!autoSync) return;
    const timer = setInterval(() => void engine.refreshStock(), stockRefreshMs);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void engine.flush();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [engine, autoSync, stockRefreshMs]);

  return <Ctx.Provider value={services}>{children}</Ctx.Provider>;
}
