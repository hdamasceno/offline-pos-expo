import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { PosProvider } from './src/app/PosContext';
import { createPosServices } from './src/app/services';
import { DEMO_PRODUCTS } from './src/domain/catalog';
import { PosScreen } from './src/ui/PosScreen';
import { colors } from './src/ui/theme';

export default function App() {
  // Created once per app run. EXPO_PUBLIC_API_URL points at server/ when set.
  const [services] = useState(() =>
    createPosServices({
      storage: AsyncStorage,
      newId: () => Crypto.randomUUID(),
      apiUrl: process.env.EXPO_PUBLIC_API_URL,
    }),
  );
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <PosProvider services={services}>
          <PosScreen products={DEMO_PRODUCTS} />
        </PosProvider>
        <StatusBar style="dark" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
