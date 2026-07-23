import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { ScrollView } from 'react-native';

/**
 * Web side of the scroll seam (native sibling: KbScroll.tsx). Browsers already
 * scroll a focused input into view, so a plain ScrollView is all web needs — and
 * react-native-keyboard-controller has no web implementation, so it must not
 * reach the web bundle.
 */
interface KbScrollProps {
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

export function KbScroll({ style, contentContainerStyle, children }: KbScrollProps) {
  return (
    <ScrollView style={style} contentContainerStyle={contentContainerStyle} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}
