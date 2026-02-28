// android/src/screens/SettingsScreen.tsx

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../App";
import { getApiBase, setApiBase, checkHealth } from "../api";
import { colors, spacing, font, radius } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Settings">;

export default function SettingsScreen({ navigation }: Props) {
  const [url, setUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<null | boolean>(null);

  useEffect(() => {
    getApiBase().then(setUrl);
  }, []);

  async function test() {
    setTesting(true);
    setStatus(null);
    const ok = await checkHealth(url.trim());
    setStatus(ok);
    setTesting(false);
  }

  async function save() {
    const trimmed = url.trim();
    if (!trimmed.startsWith("http")) {
      Alert.alert("Invalid URL", "Must start with http:// or https://");
      return;
    }
    await setApiBase(trimmed);
    Alert.alert("Saved", "API URL updated.", [
      { text: "OK", onPress: () => navigation.goBack() },
    ]);
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
          <Text style={s.backTxt}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>⚙️ Settings</Text>
        <Text style={s.sub}>
          Configure how the app connects to the CoachAI backend server.
        </Text>

        <View style={s.card}>
          <Text style={s.label}>Backend API URL</Text>
          <Text style={s.hint}>
            For Android emulator use 10.0.2.2:8000.{"\n"}
            For a real device, use the server's LAN IP (e.g. 192.168.1.x:8000).
          </Text>
          <TextInput
            style={s.input}
            value={url}
            onChangeText={setUrl}
            placeholder="http://10.0.2.2:8000"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <View style={s.btnRow}>
            <TouchableOpacity
              style={s.testBtn}
              onPress={test}
              disabled={testing}
            >
              {testing ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : (
                <Text style={s.testBtnTxt}>Test Connection</Text>
              )}
            </TouchableOpacity>
            {status !== null && (
              <View style={[s.statusBadge, status ? s.statusOk : s.statusErr]}>
                <Text
                  style={[s.statusTxt, status ? s.statusTxtOk : s.statusTxtErr]}
                >
                  {status ? "✅ Connected" : "❌ Unreachable"}
                </Text>
              </View>
            )}
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.label}>How to start the server</Text>
          <View style={s.codeBlock}>
            <Text style={s.code}># In the project root:</Text>
            <Text style={s.code}>pip install -r requirements.txt</Text>
            <Text style={s.code}>pip install -r backend/requirements.txt</Text>
            <Text style={s.code}>{""}uvicorn backend.main:app \</Text>
            <Text style={s.code}>{"  "}--host 0.0.0.0 --port 8000</Text>
          </View>
        </View>

        <TouchableOpacity style={s.saveBtn} onPress={save}>
          <Text style={s.saveBtnTxt}>Save Settings</Text>
        </TouchableOpacity>
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
    marginBottom: 6,
  },
  sub: {
    fontSize: font.sm,
    color: colors.textMuted,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },

  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  label: {
    fontSize: font.sm,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 6,
  },
  hint: {
    fontSize: font.xs,
    color: colors.textMuted,
    lineHeight: 17,
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: colors.card2,
    borderWidth: 1,
    borderColor: colors.borderLt,
    borderRadius: radius.sm,
    padding: spacing.sm,
    color: colors.text,
    fontSize: font.sm,
    fontFamily: "monospace",
    marginBottom: spacing.sm,
  },
  btnRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  testBtn: {
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: radius.sm,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  testBtnTxt: { color: colors.accent, fontSize: font.sm, fontWeight: "600" },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  statusOk: { backgroundColor: "rgba(0,201,122,.15)" },
  statusErr: { backgroundColor: "rgba(255,79,96,.15)" },
  statusTxt: { fontSize: font.xs, fontWeight: "700" },
  statusTxtOk: { color: colors.green },
  statusTxtErr: { color: colors.red },

  codeBlock: {
    backgroundColor: "#000",
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: 4,
  },
  code: { fontFamily: "monospace", fontSize: font.xs, color: "#aaffaa" },

  saveBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  saveBtnTxt: { fontSize: font.md, fontWeight: "800", color: "#fff" },
});
