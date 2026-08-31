import { Platform } from 'react-native';

/**
 * WHICH NAVIGATION DESIGN IS RUNNING — a prototype switch, not a product
 * setting.
 *
 * Three competing proposals share one build so they can be compared against the
 * same seeded data in the same browser. It is read once, at module load, from
 * `?nav=a|b|c` on web; native always gets the default. When one design is
 * chosen this module and every `NAV_VARIANT` test go away — nothing here is
 * meant to survive the decision.
 *
 *   a  Sections   navigate by object type: Courses · Library · People
 *   b  Today      navigate by task: a dated work queue leads
 *   c  Workbench  navigate by place: a persistent navigator on wide screens
 */
export type NavVariant = 'a' | 'b' | 'c';

function read(): NavVariant {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return 'a';
  const v = new URLSearchParams(window.location.search).get('nav');
  return v === 'b' || v === 'c' ? v : 'a';
}

export const NAV_VARIANT: NavVariant = read();

export const VARIANT_NAME: Record<NavVariant, string> = {
  a: 'Sections',
  b: 'Today',
  c: 'Workbench',
};
