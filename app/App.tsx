import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native';
import { getTheme } from './src/theme';
import { TokensScreen } from './src/screens/TokensScreen';

const t = getTheme();

/**
 * Phase 0 shell: one screen, no navigation, no auth.
 *
 * Navigation arrives in Phase 1 with the second screen — adding it now would
 * mean an unused dependency, which the knip audit rejects, and a stack with one
 * route proves nothing.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="dark" />
        <TokensScreen />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg.canvas },
});
