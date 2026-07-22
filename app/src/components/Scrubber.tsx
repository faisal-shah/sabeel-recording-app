import { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { getTheme } from '../theme';

const t = getTheme();

/**
 * Drag-to-seek bar.
 *
 * Built by hand because React Native has no slider primitive, and because a
 * two-hour lecture is unusable without one — skip buttons alone mean forty taps
 * to reach the middle.
 *
 * While dragging, the bar shows the FINGER's position and stops following the
 * player: otherwise incoming progress events fight the gesture and the thumb
 * stutters backwards under the touch. The seek is committed once, on release,
 * rather than continuously — seeking on every pixel would thrash the media
 * element and, on native, re-issue a range request per frame.
 */
export function Scrubber({
  positionMs,
  durationMs,
  disabled,
  onSeek,
  testID,
}: {
  positionMs: number;
  durationMs: number;
  disabled?: boolean;
  onSeek: (ms: number) => void;
  testID?: string;
}) {
  const [width, setWidth] = useState(0);
  const [dragFraction, setDragFraction] = useState<number | null>(null);

  // Refs, because the PanResponder is built once and would otherwise close over
  // the first render's values forever.
  const widthRef = useRef(0);
  const durationRef = useRef(durationMs);
  const disabledRef = useRef(disabled);
  widthRef.current = width;
  durationRef.current = durationMs;
  disabledRef.current = disabled;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabledRef.current && widthRef.current > 0,
        onMoveShouldSetPanResponder: () => !disabledRef.current && widthRef.current > 0,
        onPanResponderGrant: (e) => {
          setDragFraction(clamp(e.nativeEvent.locationX / widthRef.current));
        },
        onPanResponderMove: (e, gesture) => {
          // locationX is unreliable once the finger leaves the element, so track
          // from the start point plus the accumulated delta instead.
          const startX = (e.nativeEvent.locationX ?? 0) - gesture.dx;
          setDragFraction(clamp((startX + gesture.dx) / widthRef.current));
        },
        onPanResponderRelease: (e, gesture) => {
          const startX = (e.nativeEvent.locationX ?? 0) - gesture.dx;
          const f = clamp((startX + gesture.dx) / widthRef.current);
          setDragFraction(null);
          if (durationRef.current > 0) onSeek(Math.round(f * durationRef.current));
        },
        onPanResponderTerminate: () => setDragFraction(null),
      }),
    [onSeek],
  );

  const playedFraction =
    dragFraction ?? (durationMs > 0 ? clamp(positionMs / durationMs) : 0);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View
      testID={testID}
      accessibilityRole="adjustable"
      accessibilityLabel="Playback position"
      accessibilityValue={{ min: 0, max: Math.round(durationMs / 1000), now: Math.round(positionMs / 1000) }}
      onLayout={onLayout}
      // Generous vertical padding: the visible track is thin, but the touch
      // target has to be finger-sized.
      style={styles.hit}
      {...responder.panHandlers}
    >
      <View style={styles.track}>
        <View style={[styles.played, { width: `${playedFraction * 100}%` }]} />
      </View>
      <View
        style={[
          styles.thumb,
          dragFraction !== null ? styles.thumbActive : null,
          { left: `${playedFraction * 100}%` },
          disabled ? styles.thumbDisabled : null,
        ]}
      />
    </View>
  );
}

const clamp = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

const THUMB = 16;

const styles = StyleSheet.create({
  hit: { paddingVertical: 14, justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, backgroundColor: t.bg.inset, overflow: 'hidden' },
  played: { height: 6, backgroundColor: t.accent.base },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: t.accent.base,
    marginLeft: -THUMB / 2,
  },
  // Grows under the finger so the thumb is not hidden by it.
  thumbActive: { transform: [{ scale: 1.4 }] },
  thumbDisabled: { backgroundColor: t.border.strong },
});
