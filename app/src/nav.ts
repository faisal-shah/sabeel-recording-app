/** Routes reachable once signed in and active. Gate screens are not routes —
 *  they replace the whole navigator, so a gated account cannot be deep-linked
 *  past. */
export type RootStackParamList = {
  Home: undefined;
  Staff: undefined;
  Students: undefined;
  Tokens: undefined;
};
