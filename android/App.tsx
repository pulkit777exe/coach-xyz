// android/App.tsx — Root navigator for the CoachAI React Native app

import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";

import HomeScreen from "./src/screens/HomeScreen";
import UploadScreen from "./src/screens/UploadScreen";
import ProgressScreen from "./src/screens/ProgressScreen";
import ResultsScreen from "./src/screens/ResultsScreen";
import PlayerScreen from "./src/screens/PlayerScreen";
import SettingsScreen from "./src/screens/SettingsScreen";

export type RootStackParamList = {
  Home: undefined;
  Upload: undefined;
  Progress: { jobId: string };
  Results: { jobId: string; result: object };
  Player: { jobId: string };
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Home"
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "#080c14" },
            animation: "slide_from_right",
          }}
        >
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Upload" component={UploadScreen} />
          <Stack.Screen name="Progress" component={ProgressScreen} />
          <Stack.Screen name="Results" component={ResultsScreen} />
          <Stack.Screen name="Player" component={PlayerScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
