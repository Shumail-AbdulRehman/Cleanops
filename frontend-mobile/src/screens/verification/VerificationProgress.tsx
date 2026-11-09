import { useState, type ReactNode } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { Icon, type LucideIconName } from "../../components/ui/icon";
import { useLanguage } from "../../i18n/LanguageProvider";
import { translateText } from "../../i18n/translations";
import { NameLine, StaffText, isolate } from "../../design/StaffText";
import { Pill } from "../../design/Pill";
import { colors, gutterFor, radius, space } from "../../design/tokens";
import { photoStatuses } from "../../verification/presentation";
import { requiredPhotoIds, photoCorrection } from "../../verification/feedback";
import { photoRow, photoSummary, type PhotoRowIcon } from "../../verification/photoRowState";
import type { LocalSession, Manifest, QueueRow } from "../../verification/types";

const pillIcons: Readonly<Record<PhotoRowIcon, LucideIconName>> = {
  spinner: "LoaderCircle",
  cloudUpload: "CloudUpload",
  hourglass: "Hourglass",
  tick: "Check",
  minus: "Minus",
  camera: "Camera",
  droplet: "Droplet",
};

const fixtureIcons: Readonly<Record<string, LucideIconName>> = {
  TOILET: "Toilet",
  INDIAN_TOILET: "Toilet",
  WESTERN_TOILET: "Toilet",
  SINK: "Bath",
  MIRROR: "RectangleVertical",
  BIN: "Trash2",
  FLOOR: "Grid2X2",
};

const contextViews: Readonly<Record<string, string>> = {
  ENTRANCE: "Show the entrance and nearby room.",
  LAYOUT: "Show the room and its items.",
};

/** The text column never gets narrower than this, so a title or view line breaks only between words. */
export const PHOTO_TEXT_MIN_WIDTH = 100;

/** The status pill sits at the row end; when it cannot fit beside the minimum text width it drops under the text, at the text column's start. */
function RowPill({ children, rtl }: { children: ReactNode; rtl: boolean }) {
  const [wrapped, setWrapped] = useState(false);
  return (
    <View
      onLayout={(e) => setWrapped(e.nativeEvent.layout.y >= space.tileSize)}
      style={
        wrapped
          ? { alignSelf: "flex-start", [rtl ? "marginRight" : "marginLeft"]: space.tileSize + space.rowGap }
          : {}
      }
    >
      {children}
    </View>
  );
}

/** The task's photo list: one row per required photo with its real state. Props unchanged; `onSelect` makes rows pressable. */
export function VerificationProgress({
  manifest,
  local,
  rows,
  online,
  lastUpdated,
  onSelect,
}: {
  manifest: Manifest;
  local: LocalSession | null;
  rows: QueueRow[];
  online: boolean;
  lastUpdated: number | null;
  onSelect?: (index: number) => void;
}) {
  const { t, language, isRTL } = useLanguage();
  const { width } = useWindowDimensions();
  const dir = isRTL ? "row-reverse" : "row";
  const area = manifest.task.areaNameSnapshot ?? manifest.area?.name ?? manifest.task.title;
  const finished =
    manifest.task.status === "COMPLETED" ||
    !!manifest.staffSubmittedAt ||
    !!manifest.task.completionOutcome;

  if (finished) {
    return (
      <View style={{ backgroundColor: colors.surface, padding: space.gutter, gap: 4 }}>
        <NameLine role="headline" name={area} />
        <StaffText role="rowTitle" accessibilityLiveRegion="polite">
          Work submitted
        </StaffText>
      </View>
    );
  }

  const required = requiredPhotoIds(manifest);
  const photos = photoStatuses(manifest, local, rows).filter(
    (p) => required.has(p.key) || p.key === "ENTRANCE" || p.key === "LAYOUT",
  );
  const summary = photoSummary(photos);
  const ratio = summary.total > 0 ? Math.min(1, summary.done / summary.total) : 0;
  const time = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <View style={{ gap: 12 }}>
      <View style={{ backgroundColor: colors.surface, padding: space.gutter, gap: 8 }}>
        <NameLine role="headline" name={area} />
        <StaffText role="body" color="muted" accessibilityLiveRegion="polite" translate={false}>
          {t("{n} of {t} photos done", { n: summary.done, t: summary.total })}
        </StaffText>
        <View
          accessible={false}
          style={{
            height: 8,
            borderRadius: 4,
            backgroundColor: colors.canvas,
            flexDirection: dir,
            overflow: "hidden",
          }}
        >
          <View style={{ width: `${Math.round(ratio * 100)}%`, backgroundColor: colors.blue, borderRadius: 4 }} />
        </View>
      </View>
      {!online ? (
        <View style={{ backgroundColor: colors.warnWash, borderRadius: radius.cardRadius, padding: 14, marginHorizontal: space.gutter }}>
          <StaffText role="body" color="warn">
            Internet needed to upload. Reconnect, then tap Upload again.
          </StaffText>
        </View>
      ) : null}
      <View style={{ backgroundColor: colors.surface }}>
        {photos.map((photo, index) => {
          const row = photoRow(photo.state);
          const item = manifest.items.find((i) => i.requirements.some((r) => r.id === photo.key));
          const requirement = item?.requirements.find((r) => r.id === photo.key);
          const title = translateText(photo.title, language);
          const view = requirement
            ? requirement.instructionsSnapshot
            : contextViews[photo.key] ?? "";
          const correction = row.needsYou && photo.detail ? photoCorrection(photo.detail, t) : null;
          const body = (
            <>
              <View style={{ flexDirection: dir, flexWrap: "wrap", alignItems: "center", columnGap: space.rowGap, rowGap: 8 }}>
                <View
                  accessible={false}
                  style={{
                    width: space.tileSize,
                    height: space.tileSize,
                    borderRadius: 12,
                    backgroundColor: colors.blueWash,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name={fixtureIcons[item?.typeSnapshot ?? ""] ?? "ScanLine"} size={22} color={colors.blue} />
                </View>
                <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: PHOTO_TEXT_MIN_WIDTH, minWidth: PHOTO_TEXT_MIN_WIDTH, gap: 2 }}>
                  <StaffText role="rowTitle" translate={false}>
                    {isolate(title)}
                  </StaffText>
                  {view ? (
                    <StaffText role="meta" color="muted">
                      {view}
                    </StaffText>
                  ) : null}
                </View>
                <RowPill rtl={isRTL}>
                  <Pill
                    tone={row.tone}
                    label={row.label}
                    icon={row.icon ? pillIcons[row.icon] : undefined}
                    spinning={row.spinning}
                  />
                </RowPill>
              </View>
              {correction ? (
                <View style={{ paddingTop: 8 }}>
                  <StaffText role="body" translate={false}>
                    {correction}
                  </StaffText>
                </View>
              ) : null}
            </>
          );
          const rowStyle = {
            paddingVertical: space.rowPadV,
            paddingHorizontal: gutterFor(width),
            minHeight: space.rowMinHeight,
            justifyContent: "center" as const,
            borderTopWidth: index ? 1 : 0,
            borderColor: colors.line,
          };
          return onSelect ? (
            <Pressable
              key={photo.key}
              accessibilityRole="button"
              accessibilityLabel={`${title}, ${t(row.label)}`}
              onPress={() => onSelect(index)}
              style={rowStyle}
            >
              {body}
            </Pressable>
          ) : (
            <View key={photo.key} style={rowStyle}>
              {body}
            </View>
          );
        })}
      </View>
      {time ? (
        <View style={{ paddingHorizontal: space.gutter }}>
          <StaffText role="meta" color="muted" translate={false}>
            {`${t("Results updated")} · ${isolate(time)}`}
          </StaffText>
        </View>
      ) : null}
    </View>
  );
}
