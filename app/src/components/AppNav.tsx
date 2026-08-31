import { useState, type ComponentProps } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PRIVACY_URL, type Role } from '@sabeel/shared';
import { Sheet, SheetOption, SheetSection } from './Sheet';
import { signOut } from '../session';
import { sendMyPasswordReset } from '../students';
import { NAV_VARIANT, VARIANT_NAME } from '../design/variant';
import { BUILD_LABEL } from '../buildInfo';
import { IS_DEV } from '../env';
import { RAIL_WIDTH, getTheme, spacing } from '../theme';
import type { RootStackParamList } from '../nav';

const t = getTheme();
type IconName = ComponentProps<typeof MaterialIcons>['name'];
type RouteName = keyof RootStackParamList;

export type Tab = {
  key: string;
  label: string;
  icon: IconName;
  /** Where the tab goes. Resolved per role — an admin's "Courses" is the cohort
   *  list, a manager's is the courses they were assigned. */
  route: RouteName;
  /** Routes that show this tab as the active one. A session is "under" Courses. */
  activeFor: RouteName[];
};

/**
 * THE TAB SETS — the whole of what separates the three proposals.
 *
 * Everything else in this shell (the rail, the sheet, the mini-player, the
 * wide-layout primitives) is shared, because those are settled. What is being
 * decided is which handful of destinations earn a permanent slot, and that is
 * this table.
 *
 * The set does NOT change with role. An admin and a manager see the same five
 * words; what differs is where each one lands. A bar that grows a tab when an
 * admin signs in makes the manager's app read as a stripped-down copy of a
 * fuller one, and it moves every other tab sideways on a shared device.
 */
const STUDENT_TABS: Tab[] = [
  {
    key: 'listening',
    label: 'Listening',
    icon: 'headset',
    route: 'Home',
    activeFor: ['Home'],
  },
  {
    key: 'classes',
    label: 'Classes',
    icon: 'school',
    route: 'MyClasses',
    activeFor: ['MyClasses', 'MyClassRecord'],
  },
];

function staffTabs(isAdmin: boolean): Tab[] {
  const queueLeads = NAV_VARIANT === 'b';
  const drilldown: RouteName[] = [
    'Cohorts',
    'MyCourses',
    'Courses',
    'CourseDetail',
    'CourseAttendance',
    'Sessions',
    'SessionDetail',
    'ZoomImport',
    'StudentLedger',
  ];
  const courses: Tab = {
    key: 'courses',
    label: 'Courses',
    icon: 'menu-book',
    // `Home` IS the first tab, whichever design is running: it is the route the
    // bare URL resolves to and the one the app opens on, so pointing the first
    // tab anywhere else would leave the landing screen belonging to no tab.
    // What `Home` renders differs by role — an admin has a cohort list, a
    // manager has no unconstrained course query at all and gets the courses
    // they were assigned.
    route: queueLeads ? (isAdmin ? 'Cohorts' : 'MyCourses') : 'Home',
    activeFor: queueLeads ? drilldown : ['Home', ...drilldown],
  };
  const library: Tab = {
    key: 'library',
    label: 'Library',
    icon: 'library-music',
    route: 'Library',
    activeFor: ['Library', 'RecordingLedger'],
  };
  const people: Tab = {
    key: 'people',
    label: 'People',
    icon: 'people',
    route: 'Students',
    activeFor: ['Students', 'StudentDetail', 'Staff'],
  };
  const today: Tab = {
    key: 'today',
    label: 'Today',
    icon: 'checklist',
    route: 'Home',
    activeFor: ['Home', 'Today'],
  };
  return queueLeads ? [today, courses, library, people] : [courses, library, people];
}

function tabsFor(role: Role): Tab[] {
  return role === 'student' ? STUDENT_TABS : staffTabs(role === 'admin');
}

/**
 * The app's persistent navigation chrome.
 *
 * `bar` on a phone, `rail` on a wide screen — chosen by WIDTH, never platform.
 * The rail persists on every screen because a 76px vertical strip costs
 * horizontal space, which a wide layout has to spare; the bar shows on the tab
 * roots only, because vertical space on a phone is exactly what a list of
 * recordings needs.
 */
export function AppNav({
  role,
  email,
  variant,
  active,
  onNavigate,
}: {
  role: Role;
  email: string;
  variant: 'bar' | 'rail';
  active: RouteName;
  onNavigate: (route: RouteName, mode: 'tab' | 'push') => void;
}) {
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const rail = variant === 'rail';
  const isStudent = role === 'student';
  const isAdmin = role === 'admin';

  const items = tabsFor(role).map((tab) => (
    <NavItem
      key={tab.key}
      icon={tab.icon}
      label={tab.label}
      rail={rail}
      active={tab.activeFor.includes(active)}
      testID={`tab-${tab.key}`}
      onPress={() => onNavigate(tab.route, 'tab')}
    />
  ));

  const more = (
    <NavItem
      icon="more-horiz"
      label="More"
      rail={rail}
      testID="tab-more"
      active={active === 'Notifications' || active === 'Audit' || active === 'Tokens'}
      onPress={() => setMenuOpen(true)}
    />
  );

  const menu = (
    <Sheet visible={menuOpen} title="More" onClose={() => setMenuOpen(false)}>
      {isAdmin ? (
        <>
          <SheetSection label="Institute" />
          <SheetOption
            label="Audit history"
            detail="Every change, who made it and when"
            testID="more-audit"
            onPress={() => {
              setMenuOpen(false);
              onNavigate('Audit', 'push');
            }}
          />
        </>
      ) : null}

      <SheetSection label="You" />
      <SheetOption
        label="Notifications"
        detail="Choose which messages this device receives"
        testID="more-notifications"
        onPress={() => {
          setMenuOpen(false);
          onNavigate('Notifications', 'push');
        }}
      />
      {/* STUDENTS ONLY, and it is a first-party reset — an emailed link, no
          third-party login service involved, so it triggers nothing under
          Guideline 4.8. Staff have no password to change: their credential is
          the institute's Google account, and offering to reset it here would be
          offering to change something this app does not own. */}
      {isStudent ? (
        <SheetOption
          label={sent ? 'Reset link sent' : 'Change password'}
          detail={sent ? `Check ${email}` : 'We email you a link to set a new one'}
          testID="more-password"
          onPress={() => {
            void sendMyPasswordReset(email).catch(() => undefined);
            setSent(true);
          }}
        />
      ) : null}
      {/* Required to be reachable INSIDE the app, not just in store metadata —
          Apple 5.1.1(i). Absolute URL so it opens from a phone as well as a
          browser. */}
      <SheetOption
        label="Privacy policy"
        testID="more-privacy"
        onPress={() => {
          setMenuOpen(false);
          void Linking.openURL(PRIVACY_URL).catch(() => undefined);
        }}
      />
      {IS_DEV ? (
        <SheetOption
          label="Design tokens"
          onPress={() => {
            setMenuOpen(false);
            onNavigate('Tokens', 'push');
          }}
        />
      ) : null}
      <SheetOption
        label="Sign out"
        tone="danger"
        testID="more-sign-out"
        onPress={() => {
          setMenuOpen(false);
          void signOut();
        }}
      />

      {/* The running build, in the app rather than only on the sign-in screen.
          "Is that fixed for you?" is unanswerable once you are signed in if the
          only place the version appears is the screen you have already left. */}
      <View style={styles.build}>
        <Text style={styles.buildText}>
          Class Recordings · {BUILD_LABEL}
          {IS_DEV ? ` · design ${NAV_VARIANT.toUpperCase()} ${VARIANT_NAME[NAV_VARIANT]}` : ''}
        </Text>
      </View>
    </Sheet>
  );

  if (rail) {
    return (
      <View
        style={[
          styles.rail,
          {
            paddingTop: Math.max(insets.top, spacing(3)),
            paddingBottom: Math.max(insets.bottom, spacing(3)),
            paddingLeft: insets.left,
          },
        ]}
      >
        <View style={styles.railMark}>
          <MaterialIcons name="graphic-eq" size={22} color={t.accent.base} />
        </View>
        <View style={styles.railTabs}>{items}</View>
        {more}
        {menu}
      </View>
    );
  }

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing(2)) }]}>
      {items}
      {more}
      {menu}
    </View>
  );
}

function NavItem({
  icon,
  label,
  active,
  onPress,
  rail,
  testID,
}: {
  icon: IconName;
  label: string;
  active: boolean;
  onPress: () => void;
  rail: boolean;
  testID?: string;
}) {
  // Raspberry is the identity accent, spent on the active destination and
  // nothing else in this bar; everything quiet is taupe (docs/BRAND.md).
  const tint = active ? t.accent.base : t.text.secondary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.item,
        rail ? styles.itemRail : styles.itemBar,
        active ? styles.itemActive : null,
        pressed ? styles.itemPressed : null,
      ]}
    >
      <MaterialIcons name={icon} size={24} color={tint} />
      <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-start',
    backgroundColor: t.bg.raised,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.border.strong,
    paddingTop: spacing(2),
  },
  rail: {
    width: RAIL_WIDTH,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: spacing(1),
    backgroundColor: t.bg.raised,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: t.border.strong,
  },
  railMark: { height: 40, justifyContent: 'center', marginBottom: spacing(2) },
  railTabs: { alignItems: 'center', gap: spacing(1), flex: 1 },
  item: { alignItems: 'center', gap: 2, borderRadius: 10, paddingVertical: spacing(2) },
  itemBar: { flex: 1, paddingHorizontal: spacing(1) },
  itemRail: { width: 62, paddingHorizontal: spacing(1) },
  itemActive: { backgroundColor: t.bg.accentSoft },
  itemPressed: { opacity: 0.6 },
  label: { fontSize: 11, fontWeight: '600' },
  build: { alignItems: 'center', paddingTop: spacing(3) },
  buildText: { fontSize: 11, color: t.text.muted },
});
