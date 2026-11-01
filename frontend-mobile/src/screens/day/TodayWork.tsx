import * as React from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Icon } from '../../components/ui/icon';
import { Skeleton } from '../../design/Feedback';
import { StaffText } from '../../design/StaffText';
import { TaskRow } from '../../design/TaskRow';
import { compareByStart, displayFor, position, taskDisplay, type TaskDisplayKind } from '../../design/taskState';
import { colors, gutterFor, radius, space } from '../../design/tokens';
import { useLanguage } from '../../i18n/LanguageProvider';
import type { TaskInstance } from '../../types';

export interface TodayWorkProps {
  /** Today's feed. */
  tasks: TaskInstance[];
  /** Whole-day counts from the feed; the feed is paged, so these win when present. */
  counts?: { total: number; submitted: number } | undefined;
  /** My day after check-in. */
  compact?: boolean;
  onOpenTask: (task: TaskInstance) => void;
  onSeeAll: () => void;
  loading?: boolean;
}

type Tone = 'green' | 'blue' | 'yellow' | 'half' | 'plain';

const MAX_SEGMENTS = 12;
const SKELETON_ROWS = 4;

const toneOf = (kind: TaskDisplayKind): Tone => {
  switch (kind) {
    case 'verified':
    case 'acceptedWithExceptions':
      return 'green';
    case 'submitted':
    case 'waitingForReview':
      return 'blue';
    case 'retake':
    case 'overdue':
    case 'photosNeeded':
      return 'yellow';
    case 'inProgress':
      return 'half';
    default:
      return 'plain';
  }
};

/** When a bucket holds several tasks, the one that still needs attention shows. */
const WEIGHT: Record<Tone, number> = { yellow: 4, half: 3, plain: 2, blue: 1, green: 0 };

/** One tone per segment: one per task up to 12, then proportional buckets of the day. */
export function segmentTones(kinds: readonly TaskDisplayKind[]): Tone[] {
  const tones = kinds.map(toneOf);
  if (tones.length <= MAX_SEGMENTS) return tones;
  const out: Tone[] = [];
  for (let i = 0; i < MAX_SEGMENTS; i += 1) {
    const from = Math.floor((i * tones.length) / MAX_SEGMENTS);
    const to = Math.floor(((i + 1) * tones.length) / MAX_SEGMENTS);
    out.push(tones.slice(from, to).reduce((a, b) => (WEIGHT[b] > WEIGHT[a] ? b : a)));
  }
  return out;
}

const FILL = { green: colors.ok, blue: colors.blue, yellow: colors.yellow, plain: colors.line } as const;

function Segment({ tone, isRTL }: { tone: Tone; isRTL: boolean }) {
  if (tone === 'half') {
    return (
      <View style={[styles.segment, { flexDirection: isRTL ? 'row-reverse' : 'row', backgroundColor: colors.line }]}>
        <View style={{ flex: 1, backgroundColor: colors.blue }} />
        <View style={{ flex: 1 }} />
      </View>
    );
  }
  return <View style={[styles.segment, { backgroundColor: FILL[tone] }]} />;
}

function SkeletonRow({ gutter, isRTL }: { gutter: number; isRTL: boolean }) {
  return (
    <View
      style={{
        minHeight: space.rowMinHeight,
        paddingHorizontal: gutter,
        paddingVertical: space.rowPadV,
        gap: space.rowGap,
        flexDirection: isRTL ? 'row-reverse' : 'row',
        alignItems: 'center',
      }}
    >
      <Skeleton width={space.markerSize} height={space.markerSize} radius={space.markerSize / 2} />
      <View style={{ flex: 1, gap: 9 }}>
        <Skeleton width="62%" height={15} />
        <Skeleton width="40%" height={12} />
      </View>
    </View>
  );
}

/** The white sheet under My day's top area: today's progress ticks and the next few tasks. */
export function TodayWork({ tasks, counts, compact = false, onOpenTask, onSeeAll, loading = false }: TodayWorkProps) {
  const { isRTL, t } = useLanguage();
  const { width } = useWindowDimensions();
  const gutter = gutterFor(width);
  const sheet = [
    styles.sheet,
    { paddingTop: compact ? 12 : 20, marginTop: -space.workSheetOverlap, borderTopLeftRadius: radius.workSheetRadius, borderTopRightRadius: radius.workSheetRadius },
  ];

  if (loading) {
    return (
      <View style={sheet}>
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <SkeletonRow key={i} gutter={gutter} isRTL={isRTL} />
        ))}
      </View>
    );
  }
  if (tasks.length === 0) return <View style={[sheet, { minHeight: 40 }]} />;

  const ordered = [...tasks].sort(compareByStart);
  const kinds = ordered.map(taskDisplay);
  const doneCount = kinds.filter(kind => !displayFor(kind).open).length;
  const submitted = counts?.submitted ?? doneCount;
  const total = counts?.total ?? tasks.length;
  const anyOpen = kinds.some(kind => displayFor(kind).open);
  const shown = (anyOpen ? ordered.filter((_, i) => displayFor(kinds[i]!).open) : ordered).slice(0, 3);
  const tones = segmentTones(kinds);
  const side = isRTL ? 'row-reverse' : 'row';

  return (
    <View style={sheet}>
      <View style={[styles.head, { paddingHorizontal: gutter, flexDirection: side }]}>
        <StaffText role="sectionTitle">Today's work</StaffText>
        <StaffText role="meta" color="muted" numberOfLines={1} translate={false} style={styles.count}>
          {t('{n} of {t} submitted', { n: submitted, t: total })}
        </StaffText>
      </View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.ticks, { paddingHorizontal: gutter, flexDirection: side }, compact ? styles.ticksCompact : null]}>
        {tones.map((tone, i) => (
          <Segment key={i} tone={tone} isRTL={isRTL} />
        ))}
      </View>
      {shown.map((task, i) => (
        <TaskRow
          key={task.id}
          name={task.areaNameSnapshot ?? task.title}
          kind={taskDisplay(task)}
          position={position(task, tasks)}
          start={task.shiftStart}
          end={task.shiftEnd}
          timeZone={task.location?.timezone ?? task.template?.location?.timezone}
          compact={compact}
          separator={i > 0}
          onPress={() => onOpenTask(task)}
        />
      ))}
      <SeeAll onPress={onSeeAll} isRTL={isRTL} />
    </View>
  );
}

function SeeAll({ onPress, isRTL }: { onPress: () => void; isRTL: boolean }) {
  const { t } = useLanguage();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('See all tasks')}
      onPress={onPress}
      style={[styles.more, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
    >
      <StaffText role="groupTitle" color="blueDeep">See all tasks</StaffText>
      <Icon name={isRTL ? 'ArrowLeft' : 'ArrowRight'} size={18} color={colors.blueDeep} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: colors.surface, paddingBottom: 24, position: 'relative' },
  head: { alignItems: 'baseline', justifyContent: 'space-between', gap: 12, paddingBottom: 6 },
  count: { flexShrink: 1 },
  ticks: { gap: 5, paddingTop: 4, paddingBottom: 8 },
  ticksCompact: { paddingTop: 2, paddingBottom: 6 },
  segment: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  more: { minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 6 },
});
