// android/src/screens/PlayerScreen.tsx — In-app video player for the analyzed video

import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Video from "react-native-video";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../App";
import { downloadUrl, getApiBase } from "../api";
import { colors, spacing, font } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Player">;

export default function PlayerScreen({ route, navigation }: Props) {
  const { jobId } = route.params;
  const [uri, setUri] = React.useState("");

  React.useEffect(() => {
    getApiBase().then((base) => setUri(downloadUrl(base, jobId)));
  }, [jobId]);

  if (!uri) return null;

  return (
    <SafeAreaView style={s.safe}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
        <Text style={s.backTxt}>← Back</Text>
      </TouchableOpacity>
      <Text style={s.title}>Analyzed Video</Text>
      <Video
        source={{ uri }}
        style={s.video}
        controls={true}
        resizeMode="contain"
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  back: { padding: spacing.md },
  backTxt: { color: colors.accent, fontSize: font.sm, fontWeight: "600" },
  title: {
    fontSize: font.sm,
    color: colors.textSoft,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  video: { flex: 1, width: "100%" },
});
