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
 *
 * The finger position is the grant point plus the gesture's accumulated `dx`,
 * NOT the live `locationX`: once the finger leaves the element (which it does
 * the moment you drag past the thin track), `locationX` reports garbage and the
 * thumb jumps all over. `dx` is measured in screen space from the touch-down and
 * stays reliable for the whole drag. `onScrub` reports the previewed position so
 * the caller's time readout can follow the thumb instead of the live playhead.
 */
export function Scrubber({
  positionMs,
  durationMs,
  disabled,
  onSeek,
  onScrub,
  testID,
}: {
  positionMs: number;
  durationMs: number;
  disabled?: boolean;
  onSeek: (ms: number) => void;
  onScrub?: (ms: number | null) => void;
  testID?: string;
}) {
  const [width, setWidth] = useState(0);
  const [dragFraction, setDragFraction] = useState<number | null>(null);

  // Refs, because the PanResponder is built once and would otherwise close over
  // the first render's values forever.
  const widthRef = useRef(0);
  const durationRef = useRef(durationMs);
  const disabledRef = useRef(disabled);
  const onScrubRef = useRef(onScrub);
  const grantXRef = useRef(0);
  widthRef.current = width;
  durationRef.current = durationMs;
  disabledRef.current = disabled;
  onScrubRef.current = onScrub;

  const responder = useMemo(() => {
    // Show the thumb at `fraction` and preview that position to the caller.
    const drag = (fraction: number) => {
      setDragFraction(fraction);
      onScrubRef.current?.(durationRef.current > 0 ? Math.round(fraction * durationRef.current) : 0);
    };
    const end = () => {
      setDragFraction(null);
      onScrubRef.current?.(null);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current && widthRef.current > 0,
      onMoveShouldSetPanResponder: () => !disabledRef.current && widthRef.current > 0,
      onPanResponderGrant: (e) => {
        grantXRef.current = e.nativeEvent.locationX ?? 0;
        drag(clamp(grantXRef.current / widthRef.current));
      },
      onPanResponderMove: (_e, gesture) => {
        drag(clamp((grantXRef.current + gesture.dx) / widthRef.current));
      },
      onPanResponderRelease: (_e, gesture) => {
        const f = clamp((grantXRef.current + gesture.dx) / widthRef.current);
        end();
        if (durationRef.current > 0) onSeek(Math.round(f * durationRef.current));
      },
      onPanResponderTerminate: end,
    });
  }, [onSeek]);

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
