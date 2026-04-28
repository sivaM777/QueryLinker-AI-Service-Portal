import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import { api } from "../api/client";
import type { Ticket } from "../types";
import { useAuth } from "../state/auth";
import { AppText, Button, Card, Chip, Screen, TextField } from "../ui/components";
import { theme } from "../ui/theme";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

export const EmployeeHomeScreen: React.FC<Props> = ({ navigation }) => {
  const { logout } = useAuth();
  const [text, setText] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<Ticket | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    const msg = text.trim();
    if (!msg) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const title = msg.length > 80 ? `${msg.slice(0, 77)}...` : msg;
      const created = await api.post<Ticket>("/tickets", { title, description: msg });
      setResult(created);
      setText("");
    } catch (e: any) {
      setError(e?.message || "Failed to create ticket");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll>
      <View style={styles.topRow}>
        <Pressable style={styles.topAction} onPress={() => navigation.navigate("MyTickets")}>
          <AppText variant="caption" style={styles.topActionText}>
            My tickets
          </AppText>
        </Pressable>
        <Pressable style={styles.topAction} onPress={() => void logout()}>
          <AppText variant="caption" style={styles.topActionText}>
            Logout
          </AppText>
        </Pressable>
      </View>

      <AppText variant="h1">Create a ticket</AppText>
      <AppText variant="caption" style={styles.subtitle}>
        Describe the issue. We’ll auto-classify and route it.
      </AppText>

      {error ? (
        <AppText variant="caption" style={styles.error}>
          {error}
        </AppText>
      ) : null}

      <Card style={styles.formCard}>
        <TextField
          label="Issue description"
          placeholder="Example: VPN disconnects every 5 minutes"
          multiline
          value={text}
          onChangeText={setText}
          style={styles.textArea}
        />
        <View style={styles.primaryRow}>
          <Button title={loading ? "Submitting..." : "Create ticket"} onPress={() => void submit()} loading={loading} disabled={!text.trim()} />
        </View>
      </Card>

      {loading && !result ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : null}

      {result ? (
        <Card style={styles.resultCard}>
          <View style={styles.resultHeader}>
            <AppText variant="h2">Ticket created</AppText>
            <Chip label={result.status} tone="primary" />
          </View>
          <AppText variant="caption" style={styles.meta}>ID: {result.id}</AppText>
          {result.category ? (
            <AppText variant="caption" style={styles.meta}>
              AI: {result.category}
              {typeof result.ai_confidence === "number" ? ` (${Math.round(result.ai_confidence * 100)}%)` : ""}
            </AppText>
          ) : null}
          <View style={styles.resultActions}>
            <Button
              title="View ticket"
              variant="secondary"
              onPress={() => navigation.navigate("TicketDetail", { ticketId: result.id })}
            />
          </View>
        </Card>
      ) : null}
    </Screen>
  );
};

const styles = StyleSheet.create({
  topRow: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginBottom: 10 },
  topAction: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  topActionText: { color: theme.colors.muted, fontWeight: "800" },

  subtitle: { marginTop: 10 },
  error: { marginTop: 10, color: theme.colors.danger, fontWeight: "700" },

  formCard: { marginTop: 16 },
  textArea: { minHeight: 140, textAlignVertical: "top" },
  primaryRow: { marginTop: 14 },

  loadingRow: { marginTop: 14 },

  resultCard: { marginTop: 16 },
  resultHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  meta: { marginTop: 8, color: theme.colors.muted },
  resultActions: { marginTop: 14 },
});
