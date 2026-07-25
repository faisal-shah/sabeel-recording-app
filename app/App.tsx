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
import { CoursesScreen } from './src/screens/CoursesScreen';
import { CourseDetailScreen } from './src/screens/CourseDetailScreen';
import { CourseAttendanceScreen } from './src/screens/CourseAttendanceScreen';
import { SessionsScreen } from './src/screens/SessionsScreen';
import { SessionDetailScreen } from './src/screens/SessionDetailScreen';
import { RecordingLedgerScreen } from './src/screens/RecordingLedgerScreen';
import { StudentLedgerScreen } from './src/screens/StudentLedgerScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { ZoomImportScreen } from './src/screens/ZoomImportScreen';
import { AuditScreen } from './src/screens/AuditScreen';
import { MyRecordingsScreen } from './src/screens/MyRecordingsScreen';
import { StudentHomeScreen } from './src/screens/StudentHomeScreen';
import { PlayerScreen } from './src/screens/PlayerScreen';
import { MyCoursesScreen } from './src/screens/MyCoursesScreen';
import { TokensScreen } from './src/screens/TokensScreen';
import type { RootStackParamList } from './src/nav';
import { loadSession } from './src/sessions';
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
              {() => <Landing name={profile.doc.displayName} role={role} uid={user.uid} />}
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
            <Stack.Screen name="Courses" options={{ title: 'Courses' }}>
              {() => <Courses />}
            </Stack.Screen>
            <Stack.Screen name="CourseDetail" options={{ title: 'Course' }}>
              {() => <CourseDetail isAdmin={isAdmin} />}
            </Stack.Screen>
            <Stack.Screen name="CourseAttendance" options={{ title: 'Attendance' }}>
              {() => <CourseAttendance />}
            </Stack.Screen>
            <Stack.Screen name="Sessions" options={{ title: 'Sessions' }}>
              {() => <Sessions />}
            </Stack.Screen>
            <Stack.Screen name="SessionDetail" options={{ title: 'Session' }}>
              {() => <SessionDetail isAdmin={isAdmin} />}
            </Stack.Screen>
            <Stack.Screen name="RecordingLedger" options={{ title: 'Listening progress' }}>
              {() => <RecordingLedger />}
            </Stack.Screen>
            <Stack.Screen name="StudentLedger" options={{ title: 'Student progress' }}>
              {() => <StudentLedger />}
            </Stack.Screen>
            <Stack.Screen name="Library" options={{ title: 'Library' }}>
              {() => <Library uid={user.uid} isAdmin={isAdmin} />}
            </Stack.Screen>
            <Stack.Screen name="ZoomImport" options={{ title: 'Import from Zoom' }}>
              {() => <ZoomImport />}
            </Stack.Screen>
            <Stack.Screen name="Audit" options={{ title: 'Audit' }}>
              {() => <Audit />}
            </Stack.Screen>
            <Stack.Screen name="MyCourses" options={{ title: 'My courses' }}>
              {() => <MyCourses uid={user.uid} />}
            </Stack.Screen>
            <Stack.Screen name="MyRecordings" options={{ title: 'Recordings' }}>
              {() => <MyRecordings uid={user.uid} />}
            </Stack.Screen>
            <Stack.Screen name="Player" options={{ title: 'Listen' }}>
              {() => <Play studentUid={role === 'student' ? user.uid : null} />}
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

function Landing({ name, role, uid }: { name: string; role: Role; uid: string }) {
  const navigation = useNavigation<Nav>();
  // A student's home IS their task list; staff get the management hub.
  if (role === 'student') {
    return (
      <StudentHomeScreen
        uid={uid}
        onOpen={(recording, cls) => navigation.navigate('Player', { recording, cls })}
        onBrowse={() => navigation.navigate('MyRecordings')}
      />
    );
  }
  return (
    <HomeScreen
      name={name}
      role={role}
      onOpen={(route) => navigation.navigate(route)}
      onOpenAudit={() => navigation.navigate('Audit', { courseId: null, title: 'All courses' })}
    />
  );
}

function Cohorts() {
  const navigation = useNavigation<Nav>();
  return <CohortsScreen onOpen={(cohort) => navigation.navigate('Courses', { cohort })} />;
}

function Courses() {
  const navigation = useNavigation<Nav>();
  const { cohort } = useRoute<RouteProp<RootStackParamList, 'Courses'>>().params;
  return (
    <CoursesScreen
      cohortId={cohort.id}
      cohortName={cohort.name}
      cohortArchived={cohort.archived}
      onOpen={(cls) => navigation.navigate('CourseDetail', { cls })}
    />
  );
}

function CourseDetail({ isAdmin }: { isAdmin: boolean }) {
  const navigation = useNavigation<Nav>();
  const { cls } = useRoute<RouteProp<RootStackParamList, 'CourseDetail'>>().params;
  return (
    <CourseDetailScreen
      cls={cls}
      isAdmin={isAdmin}
      onOpenSessions={() => navigation.navigate('Sessions', { cls })}
      onOpenAttendance={() => navigation.navigate('CourseAttendance', { cls })}
      onOpenStudent={(studentUid, studentName) =>
        navigation.navigate('StudentLedger', { studentUid, studentName, cls })
      }
      onOpenAudit={() => navigation.navigate('Audit', { courseId: cls.id, title: cls.name })}
    />
  );
}

function CourseAttendance() {
  const navigation = useNavigation<Nav>();
  const { cls } = useRoute<RouteProp<RootStackParamList, 'CourseAttendance'>>().params;
  return (
    <CourseAttendanceScreen
      cls={cls}
      onOpenSession={(sessionId) => navigation.navigate('SessionDetail', { sessionId, cls })}
      onOpenStudent={(studentUid, studentName) =>
        navigation.navigate('StudentLedger', { studentUid, studentName, cls })
      }
    />
  );
}

function Sessions() {
  const navigation = useNavigation<Nav>();
  const { cls } = useRoute<RouteProp<RootStackParamList, 'Sessions'>>().params;
  return (
    <SessionsScreen
      courseId={cls.id}
      courseName={cls.name}
      onOpenSession={(session) => navigation.navigate('SessionDetail', { sessionId: session.id, cls })}
    />
  );
}

function SessionDetail({ isAdmin }: { isAdmin: boolean }) {
  const navigation = useNavigation<Nav>();
  const { sessionId, cls } = useRoute<RouteProp<RootStackParamList, 'SessionDetail'>>().params;
  return (
    <SessionDetailScreen
      sessionId={sessionId}
      cls={cls}
      isAdmin={isAdmin}
      onOpenLedger={(recording, s) => navigation.navigate('RecordingLedger', { recording, session: s, cls })}
      onPlay={(recording, s) => navigation.navigate('Player', { recording, cls, dueDate: s.dueDate })}
      onImportZoom={(s) => navigation.navigate('ZoomImport', { session: s, cls })}
    />
  );
}

function MyRecordings({ uid }: { uid: string }) {
  const navigation = useNavigation<Nav>();
  return (
    <MyRecordingsScreen
      uid={uid}
      onOpen={(recording, cls) => navigation.navigate('Player', { recording, cls })}
    />
  );
}

function Play({ studentUid }: { studentUid: string | null }) {
  const { recording, cls, dueDate } = useRoute<RouteProp<RootStackParamList, 'Player'>>().params;
  return (
    <PlayerScreen recording={recording} cls={cls} studentUid={studentUid} dueDate={dueDate ?? null} />
  );
}

function RecordingLedger() {
  const { recording, session, cls } = useRoute<RouteProp<RootStackParamList, 'RecordingLedger'>>().params;
  return <RecordingLedgerScreen recording={recording} session={session} cls={cls} />;
}
function StudentLedger() {
  const { studentUid, studentName, cls } = useRoute<RouteProp<RootStackParamList, 'StudentLedger'>>().params;
  return <StudentLedgerScreen studentUid={studentUid} studentName={studentName} cls={cls} />;
}
function ZoomImport() {
  const navigation = useNavigation<Nav>();
  const { session, cls } = useRoute<RouteProp<RootStackParamList, 'ZoomImport'>>().params;
  return (
    <ZoomImportScreen
      session={session}
      cls={cls}
      // After importing into this session, return to it (the draft is now there).
      onImported={() => navigation.navigate('SessionDetail', { sessionId: session.id, cls })}
    />
  );
}

function Library({ uid, isAdmin }: { uid: string; isAdmin: boolean }) {
  const navigation = useNavigation<Nav>();
  return (
    <LibraryScreen
      uid={uid}
      isAdmin={isAdmin}
      onOpenProgress={(recording, cls) => {
        void (async () => {
          const session = await loadSession(recording.sessionId);
          if (session) navigation.navigate('RecordingLedger', { recording, session, cls });
        })();
      }}
      onPlay={(recording, cls) => navigation.navigate('Player', { recording, cls })}
    />
  );
}
function Audit() {
  const { courseId, title } = useRoute<RouteProp<RootStackParamList, 'Audit'>>().params;
  return <AuditScreen courseId={courseId} title={title} />;
}

function MyCourses({ uid }: { uid: string }) {
  const navigation = useNavigation<Nav>();
  return (
    <MyCoursesScreen uid={uid} onOpen={(cls) => navigation.navigate('CourseDetail', { cls })} />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg.canvas },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
