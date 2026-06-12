import { Pressable, Text, View } from "react-native";
import { Heart } from "@expo/vector-icons/Feather";

export default function HomeScreen() {
  return (
    <View style={{ flex: 1, padding: 24, justifyContent: "center", gap: 16 }}>
      <Text style={{ fontSize: 32, fontWeight: "800" }}>Daily Streak</Text>
      <Text style={{ fontSize: 48, fontWeight: "900" }}>17</Text>
      <Pressable style={{ width: 64, height: 64, alignItems: "center", justifyContent: "center" }}>
        <Heart size={32} color="#E84A7A" />
      </Pressable>
    </View>
  );
}
