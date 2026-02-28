// android/src/screens/UploadScreen.tsx

import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Switch,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DocumentPicker from "react-native-document-picker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../App";
import { getApiBase, uploadVideo } from "../api";
import { colors, spacing, font, radius } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Upload">;

const MODELS = [
  { label: "Gemini 2.5 Flash (fastest)", value: "gemini-2.5-flash" },
  { label: "Gemini 2.0 Flash", value: "gemini-2.0-flash" },
  { label: "Gemini 1.5 Pro (most accurate)", value: "gemini-1.5-pro" },
];

export default function UploadScreen({ navigation }: Props) {
  const [file, setFile] = useState<{
    uri: string;
    name: string;
    size: number;
  } | null>(null);
  const [render, setRender] = useState(true);
  const [modelIdx, setModelIdx] = useState(0);
  const [uploading, setUploading] = useState(false);

  async function pickVideo() {
    try {
      const result = await DocumentPicker.pickSingle({
        type: DocumentPicker.types.video,
      });
      setFile({
        uri: result.uri,
        name: result.name || "video.mp4",
        size: result.size || 0,
      });
    } catch (e) {
      if (!DocumentPicker.isCancel(e)) Alert.alert("Error", String(e));
    }
  }

  async function submit() {
    if (!file) {
      Alert.alert("No file", "Please pick a video first.");
      return;
    }
    setUploading(true);
    try {
      const base = await getApiBase();
      const job = await uploadVideo(
        base,
        file.uri,
        file.name,
        MODELS[modelIdx].value,
        render,
      );
      navigation.replace("Progress", { jobId: job.job_id });
    } catch (e: any) {
      Alert.alert("Upload failed", e.message || String(e));
    } finally {
      setUploading(false);
    }
  }

  const sizeMB = file ? (file.size / 1024 / 1024).toFixed(1) : null;

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Back + title */}
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
          <Text style={s.backTxt}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Upload Video</Text>
        <Text style={s.sub}>Supports MP4, MOV, AVI, MKV · Max 500 MB</Text>

        {/* Picker zone */}
        <TouchableOpacity
          style={[s.zone, file && s.zoneSelected]}
          onPress={pickVideo}
          activeOpacity={0.8}
        >
          {file ? (
            <View style={s.fileInfo}>
              <Text style={s.fileEmoji}>🎬</Text>
              <Text style={s.fileName} numberOfLines={2}>
                {file.name}
              </Text>
              <Text style={s.fileMeta}>{sizeMB} MB</Text>
              <Text style={s.changeTxt}>Tap to change</Text>
            </View>
          ) : (
            <View style={s.filePlaceholder}>
              <Text style={s.zoneEmoji}>📂</Text>
              <Text style={s.zoneTitle}>Tap to choose a video</Text>
              <Text style={s.zoneSub}>Your gallery or files</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Options */}
        <View style={s.optionCard}>
          <View style={s.optionRow}>
            <View style={s.optionText}>
              <Text style={s.optionLabel}>🎬 Render overlay video</Text>
              <Text style={s.optionHint}>
                Adds AI annotations onto your video
              </Text>
            </View>
            <Switch
              value={render}
              onValueChange={setRender}
              trackColor={{ false: colors.textMuted, true: colors.accent }}
              thumbColor="#fff"
            />
          </View>
        </View>

        <View style={s.optionCard}>
          <Text style={s.optionLabel}>🤖 AI Model</Text>
          <View style={s.modelList}>
            {MODELS.map((m, i) => (
              <TouchableOpacity
                key={m.value}
                style={[s.modelItem, i === modelIdx && s.modelItemSel]}
                onPress={() => setModelIdx(i)}
              >
                <View style={[s.radio, i === modelIdx && s.radioSel]} />
                <Text style={[s.modelLabel, i === modelIdx && s.modelLabelSel]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Submit */}
        <TouchableOpacity
          style={[s.submitBtn, (!file || uploading) && s.submitBtnDisabled]}
          onPress={submit}
          disabled={!file || uploading}
          activeOpacity={0.85}
        >
          {uploading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.submitTxt}>Start AI Analysis →</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg },
  back: { marginBottom: spacing.md },
  backTxt: { color: colors.accent, fontSize: font.sm, fontWeight: "600" },
  title: {
    fontSize: font.xl,
    fontWeight: "900",
    color: colors.text,
    marginBottom: 6,
  },
  sub: { fontSize: font.xs, color: colors.textMuted, marginBottom: spacing.lg },

  zone: {
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: colors.borderLt,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    marginBottom: spacing.lg,
    backgroundColor: colors.card2,
  },
  zoneSelected: {
    borderColor: colors.accent,
    borderStyle: "solid",
    backgroundColor: "rgba(108,99,255,.06)",
  },
  fileInfo: { alignItems: "center" },
  fileEmoji: { fontSize: 40, marginBottom: spacing.sm },
  fileName: {
    fontSize: font.sm,
    color: colors.text,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 4,
  },
  fileMeta: { fontSize: font.xs, color: colors.textMuted },
  changeTxt: { fontSize: font.xs, color: colors.accent, marginTop: spacing.sm },
  filePlaceholder: { alignItems: "center" },
  zoneEmoji: { fontSize: 48, marginBottom: spacing.md },
  zoneTitle: {
    fontSize: font.md,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 4,
  },
  zoneSub: { fontSize: font.sm, color: colors.textMuted },

  optionCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  optionText: { flex: 1, marginRight: spacing.md },
  optionLabel: {
    fontSize: font.sm,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 3,
  },
  optionHint: { fontSize: font.xs, color: colors.textMuted },

  modelList: { marginTop: spacing.sm, gap: 8 },
  modelItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  modelItemSel: {},
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.textMuted,
  },
  radioSel: { borderColor: colors.accent, backgroundColor: colors.accent },
  modelLabel: { fontSize: font.sm, color: colors.textSoft },
  modelLabelSel: { color: colors.text, fontWeight: "600" },

  submitBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  submitBtnDisabled: { opacity: 0.45 },
  submitTxt: { fontSize: font.md, fontWeight: "800", color: "#fff" },
});
