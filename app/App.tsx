import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { NavigationContainer, type NavigationProp, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { Role } from '@sabeel/shared';
import { useSession } from './src/session';
import { SignInScreen } from './src/screens/SignInScreen';
import { DisabledScreen, PendingScreen, ProvisioningScreen } from './src/screens/GateScreens';
import { HomeScreen } from './src/screens/HomeScreen';
import { StaffScreen } from './src/screens/StaffScreen';
import { StudentsScreen } from './src/screens/StudentsScreen';
import { TokensScreen } from './src/screens/TokensScreen';
import type { RootStackParamList } from './src/nav';
import { getTheme } from './src/theme';

const t = getTheme();
const Stack = createNativeStackNavigator<RootStackParamList>();

// Chrome is ivory with a dark title, deliberately not a raspberry app bar —
// a brand-coloured header on every screen puts raspberry far past its share.
const navTheme = {
  dark: false,
  colors: {
    primary: t.accent.base,
    background: t.bg.canvas,
    card: t.bg.canvas,
    text: t.text.primary,
    border: t.border.subtle,
    notification: t.feedback.danger,
  },
  fonts: {
    regular: { fontFamily: 'System', fontWeight: '400' as const },
    medium: { fontFamily: 'System', fontWeight: '500' as const },
    bold: { fontFamily: 'System', fontWeight: '700' as const },
    heavy: { fontFamily: 'System', fontWeight: '900' as const },
  },
};

export default function App() {
  const session = useSession();

  let content;
  let headerless = true;
  if (session.phase === 'loading') {
    content = (
      <View style={styles.centre}>
        <ActivityIndicator size="large" color={t.accent.base} />
      </View>
    );
  } else if (session.phase === 'signedOut') {
    content = <SignInScreen />;
  } else {
    const { user, profile, claims } = session;
    const email = user.email ?? '';
    if (!profile || !claims.role) {
      content = <ProvisioningScreen />;
    } else if (claims.status === 'disabled') {
      content = <DisabledScreen email={email} />;
    } else if (claims.status !== 'active') {
      content = <PendingScreen email={email} />;
    } else {
      headerless = false;
      content = (
        <NavigationContainer theme={navTheme}>
          <Stack.Navigator screenOptions={{ headerTintColor: t.text.primary }}>
            {/* Every screen inside the navigator keeps its header: it carries the
                back affordance on pushed screens, and on Home it is what provides
                the status-bar inset. Hiding it here put the title under the clock. */}
            <Stack.Screen name="Home" options={{ title: 'Class Recordings' }}>
              {() => <Landing name={profile.doc.displayName} role={claims.role as Role} />}
            </Stack.Screen>
            <Stack.Screen name="Staff" options={{ title: 'Staff' }}>
              {() => <StaffScreen selfUid={user.uid} />}
            </Stack.Screen>
            <Stack.Screen name="Students" options={{ title: 'Students' }}>
              {() => <StudentsScreen canManageAccess={claims.role === 'admin'} />}
            </Stack.Screen>
            <Stack.Screen name="Tokens" component={TokensScreen} options={{ title: 'Design tokens' }} />
          </Stack.Navigator>
        </NavigationContainer>
      );
    }
  }

  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <StatusBar style="dark" />
        {headerless ? (
          <SafeAreaView style={styles.root}>{content}</SafeAreaView>
        ) : (
          <View style={styles.root}>{content}</View>
        )}
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

function Landing({ name, role }: { name: string; role: Role }) {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  return <HomeScreen name={name} role={role} onOpen={(route) => navigation.navigate(route)} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg.canvas },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
