import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import {
  NavigationContainer,
  createNavigationContainerRef,
  type LinkingOptions,
  type PathConfigMap,
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
import { StaffScreen } from './src/screens/StaffScreen';
import { StudentsScreen } from './src/screens/StudentsScreen';
import { StudentDetailScreen } from './src/screens/StudentDetailScreen';
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
import { NotificationsScreen } from './src/screens/NotificationsScreen';
import { StudentAttendanceScreen } from './src/screens/StudentAttendanceScreen';
import { StudentCoursesScreen } from './src/screens/StudentCoursesScreen';
import { StudentHomeScreen } from './src/screens/StudentHomeScreen';
import { PlayerScreen } from './src/screens/PlayerScreen';
import { MyCoursesScreen } from './src/screens/MyCoursesScreen';
import { TokensScreen } from './src/screens/TokensScreen';
import { TodayScreen } from './src/screens/TodayScreen';
import { AppNav } from './src/components/AppNav';
import { MiniPlayer } from './src/components/MiniPlayer';
import { useWide } from './src/useWidth';
import type { RootStackParamList } from './src/nav';
// Note the two senses of "session" in this file: `useSession` above is the AUTH
// session; these resolve the documents a route names.
import { useSessionState } from './src/sessions';
import { useRecordingState } from './src/recordings';
import { useStudent } from './src/students';
import { useCourse, useCourseState } from './src/structure';
import { useStaffQueue, type TodayQueue } from './src/today';
import { Empty, Screen, ScreenOwnsTopInset, Segmented } from './src/components/ui';
import { getTheme } from './src/theme';

const t = getTheme();
const Stack = createNativeStackNavigator<RootStackParamList>();
type Nav = NavigationProp<RootStackParamList>;

/**
 * The handle the persistent chrome navigates through.
 *
 * The rail and the bar live OUTSIDE `NavigationContainer` — they have to, since
 * on a wide screen the rail is a sibling of the whole navigator, not something
 * drawn inside a screen — so they cannot use `useNavigation`. A container ref is
 * React Navigation's own answer to exactly this case.
 */
const navRef = createNavigationContainerRef<RootStackParamList>();

/**
 * What makes the browser's Back button work.
 *
 * React Navigation only touches browser history when a `linking` config is
 * present — with none, the whole app lives in one history entry and Back leaves
 * the site. Every screen therefore needs a path: a screen without one
 * contributes nothing to the URL, so navigating to it adds no history entry and
 * Back skips straight past it.
 *
 * WEB ONLY, deliberately. Native already has a working back gesture through the
 * stack, and enabling it there would mean an `expo-linking` dependency and a
 * scheme to register for no benefit.
 */
const SHARED_PATHS = {
  Home: '',
  // Staff listen too — from the library and from a session's recording.
  Player: 'play/:recordingId',
  // Both populations get notifications, so both get the screen that turns them
  // off. The switches it shows are role-dependent; the route is not.
  Notifications: 'notifications',
} as const;

/** Everything only staff may reach. "My courses" is one of them: it is the
 *  courses a MANAGER is assigned, not anything a student has. */
const STAFF_PATHS = {
  ...SHARED_PATHS,
  Students: 'students',
  StudentDetail: 'students/:studentUid',
  Cohorts: 'cohorts',
  Courses: 'cohorts/:cohortId',
  CourseDetail: 'courses/:courseId',
  CourseAttendance: 'courses/:courseId/attendance',
  Sessions: 'courses/:courseId/sessions',
  SessionDetail: 'courses/:courseId/sessions/:sessionId',
  StudentLedger: 'courses/:courseId/students/:studentUid',
  RecordingLedger: 'recordings/:recordingId/progress',
  ZoomImport: 'sessions/:sessionId/import',
  Library: 'library',
  Audit: 'audit',
  MyCourses: 'my-courses',
  Tokens: 'tokens',
} as const;

const STUDENT_PATHS = {
  ...SHARED_PATHS,
  MyClasses: 'my-classes',
  MyClassRecord: 'my-classes/:courseId',
} as const;

/**
 * A URL is an ADDRESS, so the two populations cannot share one route table.
 *
 * Before any of these had paths, registering every screen for every role was
 * harmless: a screen was reachable only if the UI offered it, and neither home
 * offers the other's. Giving each screen a path made all of them reachable by
 * anyone signed in — and a browser tab remembers where it was, so the ordinary
 * way to arrive is not a typed URL but a SHARED DEVICE: staff finish on a
 * session page, sign out, a student signs in, and React Navigation restores the
 * path. The student got the staff screen fully rendered — the roster form, the
 * controls — with every query denied underneath, and vice versa a manager landed
 * on the student's "Your recordings". Rules held, so nothing leaked; what
 * shipped was a screen nobody should see and a permission denial per listener on
 * it (Sentry: `myAssignments`, `session`).
 *
 * Registering only what the role may use is what makes that unreachable. A path
 * belonging to the other population then matches no screen, and the container
 * falls back to the initial route — their own home, which is the right answer.
 */
function buildLinking(
  screens: PathConfigMap<RootStackParamList>,
): LinkingOptions<RootStackParamList> {
  return {
    enabled: Platform.OS === 'web',
    prefixes:
      Platform.OS === 'web' && typeof window !== 'undefined' ? [window.location.origin] : [],
    // Nested under the resource they belong to, so a URL reads as a place:
    // /courses/<id>/sessions/<id> rather than a flat list of screen names.
    config: { screens },
  };
}

// Built once, not per render: NavigationContainer treats `linking` as an input
// to its history effects, and a fresh object every render re-runs them.
const STAFF_LINKING = buildLinking(STAFF_PATHS);
const STUDENT_LINKING = buildLinking(STUDENT_PATHS);

/** Otherwise the browser tab reads the route name — "CourseDetail". */
const documentTitle = {
  formatter: (options?: { title?: string }, route?: { name?: string }) =>
    `${options?.title ?? route?.name ?? ''} · Class Recordings`,
};

/** Shown while a screen's documents are still resolving from their ids. */
function Loading() {
  return (
    <Screen>
      <Empty>Loading…</Empty>
    </Screen>
  );
}

/**
 * The route's subject does not exist, or the viewer may not read it.
 *
 * Reachable in ordinary use, not just from a stale bookmark: unpublishing a
 * recording revokes a student's access to it, so one sitting on the player is
 * told it is gone rather than left on a spinner.
 */
function NotFound({ what }: { what: string }) {
  return (
    <Screen>
      <Empty>That {what} is not available. It may have been removed.</Empty>
    </Screen>
  );
}

/**
 * Every screen below is KEYED ON ITS SUBJECT.
 *
 * `navigate` to a route already on top updates its params in place rather than
 * pushing, so without a key a screen would carry state belonging to the previous
 * subject: the rename field still holding the old course's name, attendance
 * marks from another session, "password link sent to …" naming someone else. No
 * path does that today — but making every route addressable by URL is what makes
 * same-route-different-subject navigation possible, and this is precisely the
 * class of bug the rest of this work has been about.
 */

/** value ?? still-loading ?? gone — the shape every id-resolving wrapper uses. */
function resolve<T>(state: { value: T | null; resolved: boolean }, what: string) {
  if (state.value) return null;
  return state.resolved ? <NotFound what={what} /> : <Loading />;
}

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
      const isStudent = role === 'student';
      content = (
        <Shell role={role} uid={user.uid} email={email} isAdmin={isAdmin}>
        <Navigator
          linking={isStudent ? STUDENT_LINKING : STAFF_LINKING}
        >
          <Stack.Navigator screenOptions={{ headerTintColor: t.text.primary }}>
            {/* Every screen inside the navigator keeps its header: it carries the
                back affordance on pushed screens, and on Home it is what provides
                the status-bar inset. Hiding it here put the title under the clock. */}
            <Stack.Screen name="Home" options={{ title: 'Class Recordings', headerShown: false }}>
              {() => <Landing role={role} uid={user.uid} />}
            </Stack.Screen>
            <Stack.Screen name="Notifications" options={{ title: 'Notifications' }}>
              {() => <NotificationsScreen uid={user.uid} isStudent={isStudent} />}
            </Stack.Screen>
            {/* THE ROLE SPLIT IS THE BOUNDARY, not a tidy-up. A screen registered
                here is addressable by URL, and a browser tab outlives the person
                signed into it — see the note on the path tables above. Adding a
                screen to both arms puts it back within reach of both populations. */}
            {isStudent ? (
              <>
                <Stack.Screen name="MyClasses" options={{ title: 'Your classes', headerShown: false }}>
                  {() => <MyClasses uid={user.uid} />}
                </Stack.Screen>
                <Stack.Screen name="MyClassRecord" options={{ title: 'Attendance' }}>
                  {() => <MyClassRecord uid={user.uid} />}
                </Stack.Screen>
              </>
            ) : (
              <>
                <Stack.Screen name="Students" options={{ title: 'People', headerShown: false }}>
                  {() => <People isAdmin={isAdmin} uid={user.uid} />}
                </Stack.Screen>
                <Stack.Screen name="StudentDetail" options={{ title: 'Student' }}>
                  {() => <StudentDetail isAdmin={isAdmin} uid={user.uid} />}
                </Stack.Screen>
                <Stack.Screen name="Cohorts" options={{ title: 'Cohorts', headerShown: false }}>
                  {() => <Cohorts />}
                </Stack.Screen>
                {/* Titled for what the screen IS — one cohort: its settings and the
                    courses inside it. The route keeps its name until the id-param
                    conversion renames routes wholesale. */}
                <Stack.Screen name="Courses" options={{ title: 'Cohort' }}>
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
                <Stack.Screen name="Library" options={{ title: 'Library', headerShown: false }}>
                  {() => <Library uid={user.uid} isAdmin={isAdmin} />}
                </Stack.Screen>
                <Stack.Screen name="ZoomImport" options={{ title: 'Import from Zoom' }}>
                  {() => <ZoomImport />}
                </Stack.Screen>
                <Stack.Screen name="Audit" options={{ title: 'Audit' }}>
                  {() => <Audit />}
                </Stack.Screen>
                {/* The courses a MANAGER is assigned — staff, despite the name. */}
                <Stack.Screen name="MyCourses" options={{ title: 'My courses', headerShown: false }}>
                  {() => <MyCourses uid={user.uid} />}
                </Stack.Screen>
                <Stack.Screen
                  name="Tokens"
                  component={TokensScreen}
                  options={{ title: 'Design tokens' }}
                />
              </>
            )}
            {/* Both: staff open the player from the library and from a session. */}
            <Stack.Screen name="Player" options={{ title: 'Listen' }}>
              {() => <Play studentUid={isStudent ? user.uid : null} />}
            </Stack.Screen>
          </Stack.Navigator>
        </Navigator>
        </Shell>
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

/**
 * THE PERSISTENT CHROME — everything that stays put while screens come and go.
 *
 * Composition, deliberately, rather than React Navigation's own tab navigator.
 * A tab navigator draws its bar inside each screen, so it can never become a
 * left column — and the rail has to be a SIBLING of the whole stack. The
 * mini-player has the same requirement for a different reason: it outlives
 * every screen, the player included. One layout component that owns the frame
 * and hands the stack a box to render into does both and stays readable.
 *
 * The route name comes from a container-ref listener rather than a hook, because
 * this component is outside the container it is describing.
 */
function Shell({
  role,
  uid,
  email,
  isAdmin,
  children,
}: {
  role: Role;
  uid: string;
  email: string;
  isAdmin: boolean;
  children: ReactNode;
}) {
  const wide = useWide();
  /*
   * THE WORK QUEUE IS SUBSCRIBED HERE, not on the screen that shows it.
   *
   * The Today tab carries a count of the sessions blocking access, and a badge
   * that disagrees with the screen behind it is worse than no badge. One
   * subscription, held above both, makes them the same fact rather than two
   * queries that happen to match. A student subscribes to nothing — see
   * `useStaffQueue`.
   */
  const queue = useStaffQueue(role !== 'student', isAdmin, uid);
  // The NAME only. The chrome needs to know which tab to light and whether the
  // screen owns its own top inset; it has no business knowing a route's subject.
  const [routeName, setRouteName] = useState<keyof RootStackParamList>('Home');
  const onStateChange = useCallback(() => {
    const current = navRef.getCurrentRoute();
    if (current) setRouteName(current.name as keyof RootStackParamList);
  }, []);

  /**
   * TABS RESET, MENU ITEMS PUSH — and the difference is not a detail.
   *
   * A tab is a root: switching sections must REPLACE the stack, or Back from
   * Library walks down through every tab visited before it. A More-menu
   * destination is the opposite — it is somewhere you go and come back from, so
   * it has to be pushed or it arrives with no Back and no way home but the bar.
   * Resetting for both was the first version, and the sweep caught it as three
   * screens reporting "no Back in the header".
   */
  const go = useCallback((name: keyof RootStackParamList, mode: 'tab' | 'push') => {
    if (!navRef.isReady()) return;
    if (mode === 'push') {
      // `{}` rather than nothing: Audit reads `params.courseId` and destructures
      // it, so an undefined params object is a crash rather than an admin-wide
      // view. Every route here takes only optional params.
      (navRef.navigate as (n: string, p: object) => void)(name, {});
      return;
    }
    navRef.reset({ index: 0, routes: [{ name } as never] });
  }, []);

  const openPlayer = useCallback((recordingId: string) => {
    if (navRef.isReady()) navRef.navigate('Player', { recordingId });
  }, []);

  const nav = (variant: 'bar' | 'rail') => (
    <AppNav
      role={role}
      email={email}
      variant={variant}
      active={routeName}
      blocking={queue.blocking}
      onNavigate={go}
    />
  );

  // The mini-player is redundant on the screen that IS the player — showing a
  // one-line summary of what fills the screen behind it is noise.
  const mini = routeName === 'Player' ? null : <MiniPlayer onOpen={openPlayer} />;

  return (
    <NavStateContext.Provider value={onStateChange}>
      <QueueContext.Provider value={queue}>
      <ScreenOwnsTopInset.Provider value={HEADERLESS.has(routeName)}>
      <View style={[styles.shell, wide ? styles.shellWide : null]}>
        {wide ? nav('rail') : null}
        <View style={styles.stack}>
          {children}
          {mini}
          {/* ON EVERY SCREEN, not only the tab roots.
              The sibling kanban app hides its bar on the immersive board, and
              the reflex is to copy that. It is wrong here: this app is navigated
              WHILE SOMETHING IS PLAYING, and hiding the bar on the player makes
              the one screen people spend the most time on a cul-de-sac they can
              only leave through Back. Every audio app on either store keeps the
              bar and the now-playing strip together, and this is why.
              The cost is real and it is the right trade: on a tab root the bar
              and the strip take about 112px of a small phone, and on a pushed
              screen the header takes 56px more. */}
          {!wide ? nav('bar') : null}
        </View>
      </View>
      </ScreenOwnsTopInset.Provider>
      </QueueContext.Provider>
    </NavStateContext.Provider>
  );
}

/**
 * The work queue, reaching the screens inside the navigator.
 *
 * A prop would have to be threaded through the navigator's render callbacks,
 * which are written where the queue is not in scope. This is the same shape as
 * `ScreenOwnsTopInset` next door and for the same reason: one fact the shell
 * knows and one screen inside it needs.
 */
const QueueContext = createContext<TodayQueue>({
  items: [],
  blocking: 0,
  loading: true,
  truncated: false,
});

/**
 * THE TAB ROOTS RUN WITHOUT A STACK HEADER.
 *
 * A header exists to carry Back and to name where you are. A tab root is never
 * pushed, so it has no Back, and it already names itself in its own heading —
 * so the header was drawing "Your classes" in a 56px bar directly above a
 * screen whose first line said "Your classes". On a phone that is a tenth of
 * the viewport spent on a duplicate.
 *
 * The header was ALSO providing the status-bar inset, which is why hiding it
 * naively put the title under the clock. `Screen` takes that over through the
 * context above, on exactly the screens that lose the header.
 *
 * Pushed screens keep theirs: there the header is the only thing carrying Back.
 */
const HEADERLESS = new Set<keyof RootStackParamList>([
  'Home',
  'Cohorts',
  'MyCourses',
  'Students',
  'Library',
  'MyClasses',
]);

/** Lets the NavigationContainer report state changes up to the Shell above it. */
const NavStateContext = createContext<() => void>(() => {});

/**
 * The container, split out only so it can read the Shell's callback out of
 * context — a provider cannot consume its own value.
 */
function Navigator({
  linking,
  children,
}: {
  linking: LinkingOptions<RootStackParamList>;
  children: ReactNode;
}) {
  const onStateChange = useContext(NavStateContext);
  return (
    <NavigationContainer
      ref={navRef}
      theme={navTheme}
      linking={linking}
      documentTitle={documentTitle}
      onReady={onStateChange}
      onStateChange={onStateChange}
    >
      {children}
    </NavigationContainer>
  );
}

function Today({ uid, queue }: { uid: string; queue: TodayQueue }) {
  const navigation = useNavigation<Nav>();
  return (
    <TodayScreen
      uid={uid}
      queue={queue}
      onOpenSession={(sessionId, courseId) =>
        navigation.navigate('SessionDetail', { sessionId, courseId })
      }
      onOpenLedger={(recordingId) => navigation.navigate('RecordingLedger', { recordingId })}
    />
  );
}

/**
 * What the bare URL resolves to, per population and per design.
 *
 * There is no hub screen any more. The old one was a page of buttons whose only
 * job was to reach the other screens, which is precisely the job the persistent
 * bar now does — keeping both would mean two competing menus and a landing
 * screen that says nothing about the work.
 *
 * So `Home` is simply THE FIRST TAB: their own listening for a student, and the
 * work queue for staff.
 */
function Landing({ role, uid }: { role: Role; uid: string }) {
  const navigation = useNavigation<Nav>();
  const queue = useContext(QueueContext);
  if (role === 'student') {
    return (
      <StudentHomeScreen
        uid={uid}
        // The student's OWN deadline, not the session's: it is the day their
        // access closes, so the player has to be able to say so.
        onOpen={(recording, _cls, dueDate) =>
          navigation.navigate('Player', { recordingId: recording.id, dueDate })
        }
      />
    );
  }
  return <Today uid={uid} queue={queue} />;
}

function Cohorts() {
  const navigation = useNavigation<Nav>();
  return (
    <CohortsScreen onOpen={(cohort) => navigation.navigate('Courses', { cohortId: cohort.id })} />
  );
}

/**
 * THE PEOPLE TAB — one destination, two lists.
 *
 * Students and staff are the same job (who is in this institute, and what may
 * they reach) done for two populations, and an admin visits either a handful of
 * times a term. Two permanent tabs for that would push a daily destination off
 * the bar; a segmented switch costs nothing and keeps both one tap away.
 *
 * A manager sees no switch at all: they have no staff arm in the rules, so for
 * them People simply IS the student list, with no control implying otherwise.
 */
function People({ isAdmin, uid }: { isAdmin: boolean; uid: string }) {
  const navigation = useNavigation<Nav>();
  const [side, setSide] = useState<'students' | 'staff'>('students');
  const header = isAdmin ? (
    <Segmented
      value={side}
      options={[
        { value: 'students' as const, label: 'Students' },
        { value: 'staff' as const, label: 'Staff' },
      ]}
      onChange={setSide}
    />
  ) : null;
  if (isAdmin && side === 'staff') return <StaffScreen selfUid={uid} header={header} />;
  return (
    <StudentsScreen
      isAdmin={isAdmin}
      uid={uid}
      header={header}
      onOpenStudent={(studentUid) => navigation.navigate('StudentDetail', { studentUid })}
    />
  );
}

function StudentDetail({ isAdmin, uid }: { isAdmin: boolean; uid: string }) {
  const navigation = useNavigation<Nav>();
  const { studentUid } = useRoute<RouteProp<RootStackParamList, 'StudentDetail'>>().params;
  return (
    <StudentDetailScreen
      key={studentUid}
      studentUid={studentUid}
      isAdmin={isAdmin}
      uid={uid}
      onOpenCourse={(cls) => navigation.navigate('StudentLedger', { studentUid, courseId: cls.id })}
    />
  );
}

function Courses() {
  const navigation = useNavigation<Nav>();
  const { cohortId } = useRoute<RouteProp<RootStackParamList, 'Courses'>>().params;
  return (
    <CoursesScreen
      key={cohortId}
      cohortId={cohortId}
      onOpen={(cls) => navigation.navigate('CourseDetail', { courseId: cls.id })}
    />
  );
}

function CourseDetail({ isAdmin }: { isAdmin: boolean }) {
  const navigation = useNavigation<Nav>();
  const { courseId } = useRoute<RouteProp<RootStackParamList, 'CourseDetail'>>().params;
  const cls = useCourseState(courseId);
  if (!cls.value) return resolve(cls, 'course');
  return (
    <CourseDetailScreen
      key={courseId}
      cls={cls.value}
      isAdmin={isAdmin}
      onOpenSessions={() => navigation.navigate('Sessions', { courseId })}
      onOpenAttendance={() => navigation.navigate('CourseAttendance', { courseId })}
      onOpenStudent={(studentUid) => navigation.navigate('StudentLedger', { studentUid, courseId })}
      onOpenAudit={() => navigation.navigate('Audit', { courseId })}
    />
  );
}

function CourseAttendance() {
  const navigation = useNavigation<Nav>();
  const { courseId } = useRoute<RouteProp<RootStackParamList, 'CourseAttendance'>>().params;
  const cls = useCourseState(courseId);
  if (!cls.value) return resolve(cls, 'course');
  return (
    <CourseAttendanceScreen
      key={courseId}
      cls={cls.value}
      // navigate, not goBack: a screen opened straight from its URL has nothing
      // beneath it, and the course is a destination in its own right either way.
      onOpenCourse={() => navigation.navigate('CourseDetail', { courseId })}
      onOpenSession={(sessionId) => navigation.navigate('SessionDetail', { sessionId, courseId })}
      onOpenStudent={(studentUid) => navigation.navigate('StudentLedger', { studentUid, courseId })}
    />
  );
}

function Sessions() {
  const navigation = useNavigation<Nav>();
  const { courseId } = useRoute<RouteProp<RootStackParamList, 'Sessions'>>().params;
  const cls = useCourseState(courseId);
  if (!cls.value) return resolve(cls, 'course');
  return (
    <SessionsScreen
      key={courseId}
      courseId={courseId}
      courseName={cls.value.name}
      onOpenCourse={() => navigation.navigate('CourseDetail', { courseId })}
      onOpenSession={(session) =>
        navigation.navigate('SessionDetail', { sessionId: session.id, courseId })
      }
    />
  );
}

function SessionDetail({ isAdmin }: { isAdmin: boolean }) {
  const navigation = useNavigation<Nav>();
  const { sessionId, courseId } = useRoute<RouteProp<RootStackParamList, 'SessionDetail'>>().params;
  const cls = useCourseState(courseId);
  if (!cls.value) return resolve(cls, 'course');
  return (
    <SessionDetailScreen
      key={sessionId}
      sessionId={sessionId}
      cls={cls.value}
      isAdmin={isAdmin}
      onOpenCourse={() => navigation.navigate('CourseDetail', { courseId })}
      onOpenLedger={(recording) =>
        navigation.navigate('RecordingLedger', { recordingId: recording.id })
      }
      onPlay={(recording, s) =>
        navigation.navigate('Player', { recordingId: recording.id, dueDate: s.dueDate })
      }
      onImportZoom={(s) => navigation.navigate('ZoomImport', { sessionId: s.id })}
    />
  );
}

function MyClasses({ uid }: { uid: string }) {
  const navigation = useNavigation<Nav>();
  return (
    <StudentCoursesScreen
      uid={uid}
      onOpen={(courseId) => navigation.navigate('MyClassRecord', { courseId })}
    />
  );
}

function MyClassRecord({ uid }: { uid: string }) {
  const { courseId } = useRoute<RouteProp<RootStackParamList, 'MyClassRecord'>>().params;
  const cls = useCourseState(courseId);
  const gate = resolve(cls, 'course');
  if (gate || !cls.value) return gate;
  return <StudentAttendanceScreen uid={uid} cls={cls.value} />;
}

function Play({ studentUid }: { studentUid: string | null }) {
  const { recordingId, dueDate } = useRoute<RouteProp<RootStackParamList, 'Player'>>().params;
  // Chained: the recording names its own course, so the course resolves only
  // once the recording has. Both are live, so an unpublish or an archive lands
  // on screen rather than waiting for the listener to be torn down.
  const recording = useRecordingState(recordingId);
  const cls = useCourseState(recording.value?.courseId ?? null);
  const gate = resolve(recording, 'recording') ?? resolve(cls, 'course');
  if (gate || !recording.value || !cls.value) return gate;
  return (
    <PlayerScreen
      key={recordingId}
      recording={recording.value}
      cls={cls.value}
      studentUid={studentUid}
      dueDate={dueDate ?? null}
    />
  );
}

function RecordingLedger() {
  const { recordingId } = useRoute<RouteProp<RootStackParamList, 'RecordingLedger'>>().params;
  const recording = useRecordingState(recordingId);
  const session = useSessionState(recording.value?.sessionId ?? null);
  const cls = useCourseState(recording.value?.courseId ?? null);
  const gate =
    resolve(recording, 'recording') ?? resolve(session, 'session') ?? resolve(cls, 'course');
  if (gate || !recording.value || !session.value || !cls.value) return gate;
  return (
    <RecordingLedgerScreen
      key={recordingId}
      recording={recording.value}
      session={session.value}
      cls={cls.value}
    />
  );
}

function StudentLedger() {
  const { studentUid, courseId } = useRoute<RouteProp<RootStackParamList, 'StudentLedger'>>().params;
  const cls = useCourseState(courseId);
  const student = useStudent(studentUid);
  if (!cls.value) return resolve(cls, 'course');
  return (
    <StudentLedgerScreen
      key={`${studentUid}_${courseId}`}
      studentUid={studentUid}
      // The directory is readable by all staff, so a missing student here means
      // the account is gone rather than out of scope.
      studentName={student?.displayName ?? ''}
      cls={cls.value}
    />
  );
}

function ZoomImport() {
  const navigation = useNavigation<Nav>();
  const { sessionId } = useRoute<RouteProp<RootStackParamList, 'ZoomImport'>>().params;
  const session = useSessionState(sessionId);
  const cls = useCourseState(session.value?.courseId ?? null);
  const gate = resolve(session, 'session') ?? resolve(cls, 'course');
  // Locals so the callback below closes over a narrowed value, not a field.
  const sessionDoc = session.value;
  const course = cls.value;
  if (gate || !sessionDoc || !course) return gate;
  return (
    <ZoomImportScreen
      key={sessionId}
      session={sessionDoc}
      cls={course}
      // After importing into this session, return to it (the draft is now there).
      onImported={() =>
        navigation.navigate('SessionDetail', { sessionId, courseId: sessionDoc.courseId })
      }
    />
  );
}

function Library({ uid, isAdmin }: { uid: string; isAdmin: boolean }) {
  const navigation = useNavigation<Nav>();
  return (
    <LibraryScreen
      uid={uid}
      isAdmin={isAdmin}
      // The ledger route takes the recording id alone and resolves the session
      // itself, so the library no longer has to fetch one just to navigate.
      onOpenProgress={(recording) =>
        navigation.navigate('RecordingLedger', { recordingId: recording.id })
      }
      onPlay={(recording) => navigation.navigate('Player', { recordingId: recording.id })}
    />
  );
}
function Audit() {
  const { courseId } = useRoute<RouteProp<RootStackParamList, 'Audit'>>().params;
  // The heading is derived rather than passed: a title in the params would ride
  // in the URL's query string, and would be a stale copy of the course's name.
  const cls = useCourse(courseId ?? null);
  return (
    <AuditScreen
      courseId={courseId ?? null}
      title={courseId ? (cls?.name ?? '') : 'All courses'}
    />
  );
}

function MyCourses({ uid }: { uid: string }) {
  const navigation = useNavigation<Nav>();
  return (
    <MyCoursesScreen
      uid={uid}
      onOpen={(cls) => navigation.navigate('CourseDetail', { courseId: cls.id })}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg.canvas },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  shell: { flex: 1, flexDirection: 'column', backgroundColor: t.bg.canvas },
  shellWide: { flexDirection: 'row' },
  stack: { flex: 1 },
});
