import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { usePosServices, useSyncState } from '../app/PosContext';
import { cents, formatMoney } from '../domain/money';
import { colors, radius, space } from './theme';

function timeAgo(ms: number | null, now: number): string {
  if (ms === null) return 'never';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)} min ago`;
}

/** The current time, refreshed every `ms` so relative labels stay current. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function SyncPanel() {
  const { engine, network, backendLabel } = usePosServices();
  const state = useSyncState();
  const [online, setOnline] = useState(network.online);
  const now = useNow(5_000);

  const pending = state.outbox.filter((e) => e.status === 'pending');
  const failed = state.outbox.filter((e) => e.status === 'failed');
  const status = !online ? 'Offline' : state.syncing ? 'Syncing…' : pending.length > 0 ? 'Waiting to retry' : 'All synced';
  const tone = !online ? colors.offline : pending.length > 0 ? colors.warn : colors.ok;

  const toggle = (next: boolean) => {
    network.setOnline(next);
    setOnline(next);
    if (next) void engine.syncNow();
  };

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <View style={[styles.dot, { backgroundColor: tone }]} />
        <Text style={styles.status} accessibilityRole="header" accessibilityLiveRegion="polite" testID="sync-status">
          {status}
        </Text>
      </View>
      <Text style={styles.muted} testID="sync-counts">
        {pending.length} pending · {failed.length} failed · last sync {timeAgo(state.lastSyncAt, Math.max(now, state.lastSyncAt ?? 0))}
      </Text>
      <Text style={styles.muted}>Backend: {backendLabel}</Text>
      {state.lastError && online && pending.length > 0 && <Text style={styles.error}>Last error: {state.lastError}</Text>}

      <View style={styles.row}>
        <Text style={styles.label}>Network</Text>
        <Switch
          accessibilityLabel="Network connection"
          value={online}
          onValueChange={toggle}
          trackColor={{ true: colors.accent, false: colors.border }}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={!online || pending.length === 0}
        accessibilityState={{ disabled: !online || pending.length === 0 }}
        onPress={() => void engine.syncNow()}
        style={[styles.button, (!online || pending.length === 0) && styles.off]}
      >
        <Text style={styles.buttonText}>Sync now</Text>
      </Pressable>

      {failed.length > 0 && (
        <View style={styles.failed} accessibilityRole="list" accessibilityLabel="Rejected sales">
          <Text style={styles.failedTitle}>Rejected by the server</Text>
          {failed.map((e) => (
            <View key={e.sale.id} style={styles.failedRow}>
              <Text style={styles.failedText}>
                {formatMoney(cents(e.sale.total))} · {e.lastError}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => void engine.retryFailed(e.sale.id)}>
                <Text style={styles.link}>Retry</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => void engine.discardFailed(e.sale.id)}>
                <Text style={[styles.link, { color: colors.danger }]}>Discard</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: space(4), gap: space(2) },
  header: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  dot: { width: 10, height: 10, borderRadius: 5 },
  status: { fontSize: 16, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted, fontSize: 13 },
  error: { color: colors.warn, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space(1) },
  label: { color: colors.text, fontWeight: '600' },
  button: { borderWidth: 1, borderColor: colors.accent, borderRadius: radius, paddingVertical: space(2.5), alignItems: 'center' },
  off: { opacity: 0.4 },
  buttonText: { color: colors.accent, fontWeight: '700' },
  failed: { marginTop: space(2), gap: space(1.5) },
  failedTitle: { color: colors.danger, fontWeight: '700' },
  failedRow: { flexDirection: 'row', gap: space(3), alignItems: 'center' },
  failedText: { flex: 1, color: colors.text, fontSize: 13 },
  link: { color: colors.accent, fontWeight: '600' },
});
