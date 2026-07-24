import Slider from '@react-native-community/slider';
import { StyleSheet, View } from 'react-native';
import { getTheme } from '../theme';

const t = getTheme();

/**
 * Drag-to-seek bar.
 *
 * A NATIVE slider (@react-native-community/slider), not a hand-rolled
 * PanResponder. The custom version fought the gesture system on device — a real
 * finger-drag (which always has a vertical component) had its touch stolen and
 * the thumb froze while the finger kept moving. A native slider consumes touch
 * at the platform level, so it tracks the finger correctly and needs no gesture
 * negotiation with the surrounding ScrollView.
 *
 * `value` is the shown position (the caller previews the drag target via
 * `onScrub`, so it already reflects the finger). `onValueChange` previews as the
 * thumb moves; the seek is committed once, on `onSlidingComplete`, so we don't
 * thrash the media element with a seek per pixel.
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
  return (
    <View style={styles.wrap}>
      <Slider
        testID={testID}
        style={styles.slider}
        minimumValue={0}
        // Guard against 0 before the duration is known — a [0,0] range is invalid.
        maximumValue={durationMs > 0 ? durationMs : 1}
        value={positionMs}
        disabled={disabled}
        minimumTrackTintColor={t.accent.base}
        maximumTrackTintColor={t.bg.inset}
        thumbTintColor={disabled ? t.border.strong : t.accent.base}
        onValueChange={(v) => onScrub?.(Math.round(v))}
        onSlidingComplete={(v) => {
          onScrub?.(null);
          if (durationMs > 0) onSeek(Math.round(v));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Match the old bar's vertical footprint so the layout below it is unchanged;
  // the native thumb needs the height to render without clipping.
  wrap: { justifyContent: 'center', height: 44, marginHorizontal: -8 },
  slider: { width: '100%', height: 44 },
});
