// android/src/screens/ProgressScreen.tsx

import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../App";
import { getApiBase, getJob, type Job } from "../api";
import { colors, spacing, font, radius } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Progress">;

const STATUS_ICONS: Record<string, string> = {
  queued: "⏳",
  analyzing: "🤖",
  rendering: "🎬",
  done: "✅",
  error: "❌",
};

export default function ProgressScreen({ route, navigation }: Props) {
  const { jobId } = route.params;
  const [job, setJob] = useState<Job | null>(null);
  const barAnim = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.15,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    ).start();

    const timer = setInterval(async () => {
      try {
        const base = await getApiBase();
        const j = await getJob(base, jobId);
        setJob(j);

        Animated.timing(barAnim, {
          toValue: j.progress / 100,
          duration: 600,
          useNativeDriver: false,
        }).start();

        if (j.status === "done") {
          clearInterval(timer);
          navigation.replace("Results", { jobId, result: j.result as object });
        }
        if (j.status === "error") {
          clearInterval(timer);
          Alert.alert("Analysis Failed", j.error || "Unknown error", [
            { text: "OK", onPress: () => navigation.goBack() },
          ]);
        }
      } catch {
        /* retry next tick */
      }
    }, 2500);

    return () => clearInterval(timer);
  }, [jobId]);

  const icon = STATUS_ICONS[job?.status || "queued"];
  const pct = job?.progress ?? 0;
  const msg = job?.message ?? "Starting…";

  const barWidth = barAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.center}>
        <Animated.Text style={[s.icon, { transform: [{ scale: pulse }] }]}>
          {icon}
        </Animated.Text>
        <Text style={s.title}>
          {pct === 100
            ? "Complete!"
            : job?.status === "analyzing"
              ? "AI Analyzing…"
              : "Processing…"}
        </Text>
        <Text style={s.msg}>{msg}</Text>

        <View style={s.barWrap}>
          <Animated.View style={[s.bar, { width: barWidth }]} />
        </View>
        <Text style={s.pct}>{pct}%</Text>

        <View style={s.stepsWrap}>
          {(
            [
              ["🤖", "Gemini Analysis", ["queued", "analyzing"]],
              ["🎬", "Overlay Render", ["rendering"]],
              ["✅", "Done", ["done"]],
            ] as [string, string, string[]][]
          ).map(([ico, label, statuses]) => {
            const active = statuses.includes(job?.status || "");
            const complete = pct === 100 || job?.status === "done";
            return (
              <View key={label} style={s.stepRow}>
                <Text style={[s.stepIco, active && s.stepIcoActive]}>
                  {ico}
                </Text>
                <Text style={[s.stepLbl, active && s.stepLblActive]}>
                  {label}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
  },
  icon: { fontSize: 72, marginBottom: spacing.lg },
  title: {
    fontSize: font.xl,
    fontWeight: "900",
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  msg: {
    fontSize: font.sm,
    color: colors.textSoft,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: spacing.xl,
  },
  barWrap: {
    width: "100%",
    height: 8,
    backgroundColor: colors.card,
    borderRadius: 999,
    overflow: "hidden",
    marginBottom: spacing.sm,
  },
  bar: { height: "100%", backgroundColor: colors.accent, borderRadius: 999 },
  pct: {
    fontSize: font.xs,
    color: colors.textMuted,
    fontWeight: "600",
    marginBottom: spacing.xl,
  },
  stepsWrap: { gap: 14, width: "100%" },
  stepRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepIco: { fontSize: 20, opacity: 0.4 },
  stepIcoActive: { opacity: 1 },
  stepLbl: { fontSize: font.sm, color: colors.textMuted },
  stepLblActive: { color: colors.text, fontWeight: "600" },
});
