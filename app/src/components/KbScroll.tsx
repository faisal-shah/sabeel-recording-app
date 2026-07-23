import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

/**
 * Native side of the scroll seam (web sibling: KbScroll.web.tsx).
 *
 * Under edge-to-edge Android the keyboard OVERLAYS content and React Native's
 * own Keyboard events do not fire, so the plain fix (listen + pad) is inert.
 * `react-native-keyboard-controller` tracks the IME through WindowInsets, the
 * only mechanism that survives edge-to-edge, and scrolls the focused field clear
 * of the keyboard. It is native-only (no web build) — hence the seam. See the
 * expo-firebase-stack skill, "The keyboard covers the field you are typing into".
 *
 * `keyboardShouldPersistTaps="handled"` so a tap on a button while the keyboard
 * is up fires the button instead of only dismissing the keyboard.
 */
interface KbScrollProps {
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

export function KbScroll({ style, contentContainerStyle, children }: KbScrollProps) {
  return (
    <KeyboardAwareScrollView
      style={style}
      contentContainerStyle={contentContainerStyle}
      keyboardShouldPersistTaps="handled"
      bottomOffset={96}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}
