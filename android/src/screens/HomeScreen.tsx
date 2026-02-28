// android/src/screens/HomeScreen.tsx

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  StatusBar,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../App";
import { checkHealth, getApiBase } from "../api";
import { colors, spacing, font, radius } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

const SPORTS = [
  { emoji: "🏀", label: "Basketball" },
  { emoji: "⚽", label: "Football" },
  { emoji: "🏏", label: "Cricket" },
];

export default function HomeScreen({ navigation }: Props) {
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const pulse = new Animated.Value(1);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.06,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1800,
          useNativeDriver: true,
        }),
      ]),
    ).start();

    (async () => {
      const base = await getApiBase();
      setApiOnline(await checkHealth(base));
    })();
    const t = setInterval(async () => {
      const base = await getApiBase();
      setApiOnline(await checkHealth(base));
    }, 15000);
    return () => clearInterval(t);
  }, []);

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Header bar */}
        <View style={s.header}>
          <Text style={s.brand}>⚡ CoachAI</Text>
          <View
            style={[
              s.badge,
              apiOnline === true && s.badgeOn,
              apiOnline === false && s.badgeOff,
            ]}
          >
            <View
              style={[
                s.dot,
                apiOnline === true && s.dotOn,
                apiOnline === false && s.dotOff,
              ]}
            />
            <Text
              style={[
                s.badgeTxt,
                apiOnline === true && s.badgeTxtOn,
                apiOnline === false && s.badgeTxtOff,
              ]}
            >
              {apiOnline === null
                ? "Connecting"
                : apiOnline
                  ? "API Online"
                  : "API Offline"}
            </Text>
          </View>
        </View>

        {/* Hero */}
        <View style={s.hero}>
          <Animated.Text
            style={[s.heroEmoji, { transform: [{ scale: pulse }] }]}
          >
            🏀
          </Animated.Text>
          <Text style={s.heroTitle}>AI Sports Coach</Text>
          <Text style={s.heroSub}>
            Upload a video · Get instant form scores, shot-by-shot feedback, and
            an annotated video
          </Text>
          <View style={s.sportRow}>
            {SPORTS.map((sp) => (
              <View key={sp.label} style={s.sportTag}>
                <Text style={s.sportTagTxt}>
                  {sp.emoji} {sp.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* CTA */}
        <TouchableOpacity
          style={[s.cta, !apiOnline && s.ctaDisabled]}
          onPress={() => navigation.navigate("Upload")}
          activeOpacity={0.85}
        >
          <Text style={s.ctaTxt}>Analyze a Video →</Text>
        </TouchableOpacity>

        {!apiOnline && (
          <View style={s.offlineNote}>
            <Text style={s.offlineNoteTxt}>
              ⚠️ Backend server not reachable.{"\n"}
              Start it with:{"\n"}
              <Text style={s.code}>
                uvicorn backend.main:app --host 0.0.0.0 --port 8000
              </Text>
            </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate("Settings")}
              style={s.settingsLink}
            >
              <Text style={s.settingsLinkTxt}>⚙️ Change API URL</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Feature cards */}
        <Text style={s.featLabel}>WHY COACHAI</Text>
        {[
          {
            icon: "🎯",
            title: "Form Scoring",
            desc: "Every shot gets a 1–10 biomechanics score.",
          },
          {
            icon: "⏱️",
            title: "Precise Timestamps",
            desc: "Jump to any moment in your video instantly.",
          },
          {
            icon: "🎬",
            title: "Annotated Video",
            desc: "Download a professionally overlaid analysis.",
          },
          {
            icon: "💬",
            title: "Honest Feedback",
            desc: "Specific coaching cues, not generic tips.",
          },
        ].map((f) => (
          <View key={f.title} style={s.featureCard}>
            <Text style={s.featureIcon}>{f.icon}</Text>
            <View style={s.featureBody}>
              <Text style={s.featureTitle}>{f.title}</Text>
              <Text style={s.featureDesc}>{f.desc}</Text>
            </View>
          </View>
        ))}

        <TouchableOpacity
          style={s.settingsRow}
          onPress={() => navigation.navigate("Settings")}
        >
          <Text style={s.settingsRowTxt}>⚙️ Settings</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  brand: { fontSize: font.lg, fontWeight: "800", color: colors.text },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeOn: { borderColor: "rgba(0,201,122,.3)" },
  badgeOff: { borderColor: "rgba(255,79,96,.3)" },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: colors.textMuted,
  },
  dotOn: { backgroundColor: colors.green },
  dotOff: { backgroundColor: colors.red },
  badgeTxt: { fontSize: font.xs, fontWeight: "600", color: colors.textMuted },
  badgeTxtOn: { color: colors.green },
  badgeTxtOff: { color: colors.red },

  hero: { alignItems: "center", paddingVertical: spacing.xl },
  heroEmoji: { fontSize: 72, marginBottom: spacing.md },
  heroTitle: {
    fontSize: font.xxl,
    fontWeight: "900",
    color: colors.text,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  heroSub: {
    fontSize: font.sm,
    color: colors.textSoft,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  sportRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
  },
  sportTag: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderLt,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  sportTagTxt: { fontSize: font.xs, fontWeight: "500", color: colors.text },

  cta: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  ctaDisabled: { opacity: 0.5 },
  ctaTxt: { fontSize: font.md, fontWeight: "800", color: "#fff" },

  offlineNote: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: "rgba(255,79,96,.3)",
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  offlineNoteTxt: { fontSize: font.sm, color: colors.textSoft, lineHeight: 20 },
  code: { fontFamily: "monospace", color: colors.accent2 },
  settingsLink: { marginTop: spacing.sm },
  settingsLinkTxt: {
    fontSize: font.sm,
    color: colors.accent,
    fontWeight: "600",
  },

  featLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: colors.accent,
    marginBottom: spacing.md,
  },
  featureCard: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  featureIcon: { fontSize: 28 },
  featureBody: { flex: 1 },
  featureTitle: {
    fontSize: font.md,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 4,
  },
  featureDesc: { fontSize: font.sm, color: colors.textSoft, lineHeight: 18 },

  settingsRow: { paddingVertical: spacing.lg, alignItems: "center" },
  settingsRowTxt: { fontSize: font.sm, color: colors.textMuted },
});
