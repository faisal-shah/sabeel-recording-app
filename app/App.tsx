import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import {
  NavigationContainer,
  type NavigationProp,
  type RouteProp,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { Role } from '@sabeel/shared';
import { useSession } from './src/session';
import { SignInScreen } from './src/screens/SignInScreen';
import { DisabledScreen, PendingScreen, ProvisioningScreen } from './src/screens/GateScreens';
import { HomeScreen } from './src/screens/HomeScreen';
import { StaffScreen } from './src/screens/StaffScreen';
import { StudentsScreen } from './src/screens/StudentsScreen';
import { CohortsScreen } from './src/screens/CohortsScreen';
import { ClassesScreen } from './src/screens/ClassesScreen';
import { ClassDetailScreen } from './src/screens/ClassDetailScreen';
import { MyClassesScreen } from './src/screens/MyClassesScreen';
import { TokensScreen } from './src/screens/TokensScreen';
import type { RootStackParamList } from './src/nav';
import { getTheme } from './src/theme';

const t = getTheme();
const Stack = createNativeStackNavigator<RootStackParamList>();
type Nav = NavigationProp<RootStackParamList>;

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
      const role = claims.role as Role;
      const isAdmin = role === 'admin';
      content = (
        <NavigationContainer theme={navTheme}>
          <Stack.Navigator screenOptions={{ headerTintColor: t.text.primary }}>
            {/* Every screen inside the navigator keeps its header: it carries the
                back affordance on pushed screens, and on Home it is what provides
                the status-bar inset. Hiding it here put the title under the clock. */}
            <Stack.Screen name="Home" options={{ title: 'Class Recordings' }}>
              {() => <Landing name={profile.doc.displayName} role={role} />}
            </Stack.Screen>
            <Stack.Screen name="Staff" options={{ title: 'Staff' }}>
              {() => <StaffScreen selfUid={user.uid} />}
            </Stack.Screen>
            <Stack.Screen name="Students" options={{ title: 'Students' }}>
              {() => <StudentsScreen isAdmin={isAdmin} uid={user.uid} />}
            </Stack.Screen>
            <Stack.Screen name="Cohorts" options={{ title: 'Cohorts' }}>
              {() => <Cohorts />}
            </Stack.Screen>
            <Stack.Screen name="Classes" options={{ title: 'Classes' }}>
              {() => <Classes />}
            </Stack.Screen>
            <Stack.Screen name="ClassDetail" options={{ title: 'Class' }}>
              {() => <ClassDetail isAdmin={isAdmin} />}
            </Stack.Screen>
            <Stack.Screen name="MyClasses" options={{ title: 'My classes' }}>
              {() => <MyClasses uid={user.uid} />}
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
  const navigation = useNavigation<Nav>();
  return <HomeScreen name={name} role={role} onOpen={(route) => navigation.navigate(route)} />;
}

function Cohorts() {
  const navigation = useNavigation<Nav>();
  return <CohortsScreen onOpen={(cohort) => navigation.navigate('Classes', { cohort })} />;
}

function Classes() {
  const navigation = useNavigation<Nav>();
  const { cohort } = useRoute<RouteProp<RootStackParamList, 'Classes'>>().params;
  return (
    <ClassesScreen
      cohortId={cohort.id}
      cohortName={cohort.name}
      cohortArchived={cohort.archived}
      onOpen={(cls) => navigation.navigate('ClassDetail', { cls })}
    />
  );
}

function ClassDetail({ isAdmin }: { isAdmin: boolean }) {
  const { cls } = useRoute<RouteProp<RootStackParamList, 'ClassDetail'>>().params;
  return <ClassDetailScreen cls={cls} isAdmin={isAdmin} />;
}

function MyClasses({ uid }: { uid: string }) {
  const navigation = useNavigation<Nav>();
  return (
    <MyClassesScreen uid={uid} onOpen={(cls) => navigation.navigate('ClassDetail', { cls })} />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg.canvas },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
