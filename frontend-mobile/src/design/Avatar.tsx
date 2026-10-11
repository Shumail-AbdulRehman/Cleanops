import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon } from '../components/ui/icon';
import { colors, space } from './tokens';

export type AvatarSize = typeof space.avatar | typeof space.avatarCompact | typeof space.avatarProfile;

export interface AvatarProps {
  /** 44 (default), 38 (My day compact) or 76 (Profile). */
  size?: AvatarSize;
}

/** Default figure on a tint. Never initials, never a photo. */
export function Avatar({ size = space.avatar }: AvatarProps) {
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <Icon name="UserRound" size={Math.round(size * 0.56)} color={colors.tintFg} />
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { backgroundColor: colors.tintBg, alignItems: 'center', justifyContent: 'center' },
});
