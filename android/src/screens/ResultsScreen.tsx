// android/src/screens/ResultsScreen.tsx

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../App";
import { downloadUrl, getApiBase } from "../api";
import type { AnalysisResult, Shot } from "../api";
import { colors, spacing, font, radius } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Results">;
type Tab = "shots" | "summary" | "download";

const RATING_COLORS: Record<string, string> = {
  Elite: colors.gold,
  Advanced: colors.green,
  Intermediate: colors.orange,
  Developing: colors.orange,
  Beginner: colors.red,
};

const RESULT_COLORS: Record<string, string> = {
  made: colors.green,
  goal: colors.green,
  missed: colors.red,
  saved: colors.orange,
  blocked: colors.orange,
};

export default function ResultsScreen({ route, navigation }: Props) {
  const { jobId, result } = route.params;
  const data = result as AnalysisResult;
  const summary = data.session_summary || ({} as any);
  const shots = data.shots || [];
  const sport = data.sport || "Unknown";
  const sportEmoji =
    { basketball: "🏀", football: "⚽", cricket: "🏏" }[sport] || "🎯";

  const [tab, setTab] = useState<Tab>("shots");
  const [apiBase, setBase] = useState("");

  React.useEffect(() => {
    getApiBase().then(setBase);
  }, []);

  const ratingColor = RATING_COLORS[summary.overall_rating] || colors.textSoft;

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Back */}
        <TouchableOpacity
          onPress={() => navigation.navigate("Home")}
          style={s.back}
        >
          <Text style={s.backTxt}>← New Analysis</Text>
        </TouchableOpacity>

        {/* Title */}
        <Text style={s.title}>
          {sportEmoji} {sport.charAt(0).toUpperCase() + sport.slice(1)} Analysis
        </Text>

        {/* Summary cards */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.cardsRow}
        >
          <View style={s.summCard}>
            <Text style={[s.summVal, { color: ratingColor }]}>
              {summary.overall_rating || "N/A"}
            </Text>
            <Text style={s.summLbl}>Rating</Text>
          </View>
          <View style={s.summCard}>
            <Text style={s.summVal}>{shots.length}</Text>
            <Text style={s.summLbl}>Events</Text>
          </View>
          <View style={s.summCard}>
            <Text style={s.summVal}>
              {(summary.success_rate_percent ?? 0).toFixed(0)}%
            </Text>
            <Text style={s.summLbl}>Success</Text>
          </View>
          <View style={s.summCard}>
            <Text style={s.summVal}>
              {(summary.average_form_score ?? 0).toFixed(1)}
            </Text>
            <Text style={s.summLbl}>Avg Form</Text>
          </View>
        </ScrollView>

        {/* Tabs */}
        <View style={s.tabs}>
          {(["shots", "summary", "download"] as Tab[]).map((t) => (
            <TouchableOpacity
              key={t}
              style={[s.tab, tab === t && s.tabActive]}
              onPress={() => setTab(t)}
            >
              <Text style={[s.tabTxt, tab === t && s.tabTxtActive]}>
                {t === "shots"
                  ? "📋 Shots"
                  : t === "summary"
                    ? "📊 Summary"
                    : "📥 Download"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Shots tab */}
        {tab === "shots" &&
          shots.map((shot: Shot) => {
            const rc =
              RESULT_COLORS[shot.result?.toLowerCase()] || colors.textSoft;
            const sc = shot.form_score ?? null;
            const scoreCls =
              sc !== null
                ? sc >= 8
                  ? colors.green
                  : sc >= 5
                    ? colors.orange
                    : colors.red
                : colors.textMuted;
            const bd = Object.entries(shot.form_breakdown || {}).filter(
              ([, v]) => v && v !== "N/A",
            );

            return (
              <View key={shot.event_index} style={s.shotCard}>
                <View style={s.shotTop}>
                  <View
                    style={[
                      s.shotBadge,
                      { backgroundColor: rc + "22", borderColor: rc },
                    ]}
                  >
                    <Text style={[s.shotBadgeTxt, { color: rc }]}>
                      {shot.event_index}
                    </Text>
                  </View>
                  <View style={s.shotMeta}>
                    <View style={s.shotHeader}>
                      <Text style={s.shotType}>{shot.shot_type}</Text>
                      <View
                        style={[s.resultChip, { backgroundColor: rc + "22" }]}
                      >
                        <Text style={[s.resultChipTxt, { color: rc }]}>
                          {shot.result?.toUpperCase()}
                        </Text>
                      </View>
                    </View>
                    <Text style={s.shotTs}>⏱ {shot.timestamp_of_shot}</Text>
                  </View>
                  {sc !== null && (
                    <View style={[s.scoreCircle, { borderColor: scoreCls }]}>
                      <Text style={[s.scoreVal, { color: scoreCls }]}>
                        {sc}
                      </Text>
                      <Text style={s.scoreLbl}>FORM</Text>
                    </View>
                  )}
                </View>
                <Text style={s.feedback}>{shot.feedback}</Text>
                {bd.length > 0 && (
                  <View style={s.chips}>
                    {bd.map(([k, v]) => {
                      const cc =
                        v === "good"
                          ? colors.green
                          : v === "needs_work"
                            ? colors.orange
                            : colors.red;
                      return (
                        <View
                          key={k}
                          style={[s.chip, { backgroundColor: cc + "20" }]}
                        >
                          <Text style={[s.chipTxt, { color: cc }]}>
                            {k.replace(/_/g, " ")}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}

        {/* Summary tab */}
        {tab === "summary" && (
          <View style={s.summaryPanel}>
            <View style={s.summBlock}>
              <Text style={[s.summBlockTitle, { color: colors.green }]}>
                💪 Strengths
              </Text>
              {(summary.strengths || []).map((s: string, i: number) => (
                <Text key={i} style={s.summItem}>
                  ▸ {s}
                </Text>
              ))}
            </View>
            <View style={s.summBlock}>
              <Text style={[s.summBlockTitle, { color: colors.red }]}>
                ⚠️ Top Issues
              </Text>
              {(summary.top_issues?.length
                ? summary.top_issues
                : ["None identified"]
              ).map((s: string, i: number) => (
                <Text key={i} style={s.summItem}>
                  ▸ {s}
                </Text>
              ))}
            </View>
            <View style={s.summBlock}>
              <Text style={[s.summBlockTitle, { color: colors.accent }]}>
                🎯 Next Focus
              </Text>
              <Text style={s.drillText}>{summary.priority_drill || "—"}</Text>
            </View>
          </View>
        )}

        {/* Download tab */}
        {tab === "download" && (
          <View style={s.downloadPanel}>
            <Text style={s.dlIcon}>🎬</Text>
            <Text style={s.dlTitle}>Your Analyzed Video is Ready</Text>
            <Text style={s.dlSub}>
              Complete with form overlays, coaching feedback, and session
              summary screen.
            </Text>
            <TouchableOpacity
              style={s.dlBtn}
              onPress={() => Linking.openURL(downloadUrl(apiBase, jobId))}
            >
              <Text style={s.dlBtnTxt}>⬇️ Open / Download Video</Text>
            </TouchableOpacity>
            <Text style={s.dlHint}>
              Opens in your browser — tap the ⋮ menu to save to device
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: 60 },
  back: { marginBottom: spacing.md },
  backTxt: { color: colors.accent, fontSize: font.sm, fontWeight: "600" },
  title: {
    fontSize: font.xl,
    fontWeight: "900",
    color: colors.text,
    marginBottom: spacing.lg,
  },

  cardsRow: { marginBottom: spacing.lg },
  summCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginRight: spacing.sm,
    alignItems: "center",
    minWidth: 90,
  },
  summVal: { fontSize: font.lg, fontWeight: "900", color: colors.text },
  summLbl: {
    fontSize: font.xs,
    color: colors.textMuted,
    fontWeight: "500",
    marginTop: 3,
  },

  tabs: {
    flexDirection: "row",
    backgroundColor: colors.card2,
    borderRadius: 10,
    padding: 4,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tab: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 7 },
  tabActive: { backgroundColor: colors.card },
  tabTxt: { fontSize: font.xs, fontWeight: "600", color: colors.textMuted },
  tabTxtActive: { color: colors.text },

  shotCard: {
    backgroundColor: colors.card2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  shotTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  shotBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  shotBadgeTxt: { fontSize: font.sm, fontWeight: "800" },
  shotMeta: { flex: 1 },
  shotHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
    marginBottom: 3,
  },
  shotType: {
    fontSize: font.sm,
    fontWeight: "700",
    color: colors.text,
    textTransform: "capitalize",
  },
  resultChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  resultChipTxt: { fontSize: font.xs, fontWeight: "800", letterSpacing: 0.6 },
  shotTs: { fontSize: font.xs, color: colors.textMuted },
  scoreCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreVal: { fontSize: font.sm, fontWeight: "900", lineHeight: 16 },
  scoreLbl: { fontSize: 8, color: colors.textMuted, fontWeight: "700" },
  feedback: {
    fontSize: font.sm,
    color: colors.textSoft,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  chipTxt: { fontSize: 11, fontWeight: "600" },

  summaryPanel: { gap: spacing.sm },
  summBlock: {
    backgroundColor: colors.card2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  summBlockTitle: {
    fontSize: font.sm,
    fontWeight: "700",
    marginBottom: spacing.sm,
    letterSpacing: 0.5,
  },
  summItem: {
    fontSize: font.sm,
    color: colors.textSoft,
    lineHeight: 20,
    marginBottom: 4,
  },
  drillText: { fontSize: font.sm, color: colors.textSoft, lineHeight: 20 },

  downloadPanel: { alignItems: "center", paddingVertical: spacing.xl },
  dlIcon: { fontSize: 64, marginBottom: spacing.md },
  dlTitle: {
    fontSize: font.lg,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  dlSub: {
    fontSize: font.sm,
    color: colors.textSoft,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: spacing.xl,
  },
  dlBtn: {
    backgroundColor: colors.green,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  dlBtnTxt: { fontSize: font.md, fontWeight: "800", color: "#fff" },
  dlHint: {
    fontSize: font.xs,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.md,
  },
});
