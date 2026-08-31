import { useWindowDimensions } from 'react-native';
import { WIDE_BREAKPOINT } from './theme';

/**
 * Layout branch point for the whole app.
 *
 * ON WIDTH, NOT PLATFORM. `Platform.OS === 'web'` is the wrong test twice over:
 * a phone browser is narrow and a tablet is wide, and both are cases this app
 * actually has. `useWindowDimensions` re-renders on rotation and on a browser
 * resize, so a window dragged across the breakpoint reflows rather than needing
 * a reload.
 */
export function useWide(): boolean {
  const { width } = useWindowDimensions();
  return width >= WIDE_BREAKPOINT;
}
