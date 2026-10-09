import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useLanguage } from '../i18n/LanguageProvider';
import { colors } from '../design/tokens';

type Outline = 'toilet' | 'sink' | 'mirror' | 'bin' | 'floor' | 'any';

const outlines: Readonly<Record<string, Outline>> = {
  TOILET: 'toilet',
  INDIAN_TOILET: 'toilet',
  WESTERN_TOILET: 'toilet',
  SINK: 'sink',
  MIRROR: 'mirror',
  BIN: 'bin',
  FLOOR: 'floor',
};

const SIZE = 220;
const stroke = { stroke: colors.surface, strokeOpacity: 0.5, strokeWidth: 3, strokeDasharray: '9 8', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

/** Simple shapes on a 200 grid; a hint of where the fixture should sit, never an exact match. */
function Shape({ outline }: { outline: Outline }) {
  switch (outline) {
    case 'toilet':
      return <>
        <Rect x={56} y={26} width={88} height={42} rx={9} {...stroke} />
        <Path d="M40 84 H160 C160 122 140 148 100 148 C60 148 40 122 40 84 Z" {...stroke} />
        <Path d="M76 148 L70 176 H130 L124 148" {...stroke} />
      </>;
    case 'sink':
      return <>
        <Path d="M28 94 H172 L158 136 C154 148 146 154 134 154 H66 C54 154 46 148 42 136 Z" {...stroke} />
        <Path d="M104 94 V60 C104 50 112 44 120 44 C128 44 134 50 134 58" {...stroke} />
        <Circle cx={100} cy={124} r={6} {...stroke} />
      </>;
    case 'mirror':
      return <>
        <Rect x={46} y={20} width={108} height={160} rx={14} {...stroke} />
        <Path d="M72 62 L98 36 M84 96 L134 46" {...stroke} />
      </>;
    case 'bin':
      return <>
        <Path d="M48 64 H152 L142 172 C141 178 136 182 130 182 H70 C64 182 59 178 58 172 Z" {...stroke} />
        <Path d="M38 64 H162 M80 64 V42 H120 V64" {...stroke} />
      </>;
    case 'floor':
      return <>
        <Path d="M62 42 H138 L182 168 H18 Z" {...stroke} />
        <Path d="M100 42 V168 M36 108 H164" {...stroke} />
      </>;
    default:
      return <Rect x={34} y={34} width={132} height={132} rx={18} {...stroke} />;
  }
}

/**
 * Faint dashed outline of the fixture in the middle of the camera. Illustration only;
 * the instruction stays the snapshotted text and is read to screen readers here.
 */
export function PhotoGuide({ fixture, instruction }: { fixture?: string; instruction: string }) {
  const { t } = useLanguage();
  return <View pointerEvents="none" style={styles.box} accessible accessibilityRole="image" accessibilityLabel={t(instruction)} testID="photo-guide">
    <Svg width={SIZE} height={SIZE} viewBox="0 0 200 200">
      <Shape outline={outlines[fixture ?? ''] ?? 'any'} />
    </Svg>
  </View>;
}

const styles = StyleSheet.create({
  box: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
