import type { ClassRow, CohortRow } from './structure';

/** Routes reachable once signed in and active. Gate screens are not routes —
 *  they replace the whole navigator, so a gated account cannot be deep-linked
 *  past. */
export type RootStackParamList = {
  Home: undefined;
  Staff: undefined;
  Students: undefined;
  Cohorts: undefined;
  Classes: { cohort: CohortRow };
  ClassDetail: { cls: ClassRow };
  MyClasses: undefined;
  Tokens: undefined;
};
