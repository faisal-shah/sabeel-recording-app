import { useWindowDimensions } from 'react-native';
import { CONTENT_MAX_WIDTH, WIDE_BREAKPOINT } from './theme';

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

/**
 * Is there room for a control to size to its own content?
 *
 * A LOWER BAR THAN `useWide`, and a different question. `useWide` asks whether
 * the navigation becomes a rail — a layout decision at 900px. This asks whether
 * a standalone button should still span its container, and it should stop doing
 * that as soon as the container stops being phone-shaped. Between the two, a
 * 720px window was getting full-width 645px button slabs because the only
 * breakpoint on offer was about something else.
 */
export function useRoomy(): boolean {
  const { width } = useWindowDimensions();
  return width >= CONTENT_MAX_WIDTH;
}
