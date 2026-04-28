import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import { api } from "../api/client";
import type { Ticket } from "../types";
import { AppText, Card, Chip, Divider, Screen } from "../ui/components";
import { theme } from "../ui/theme";

type Props = NativeStackScreenProps<RootStackParamList, "TicketDetail">;

export const TicketDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const { ticketId } = route.params;
  const [ticket, setTicket] = React.useState<Ticket | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const load = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await api.get<Ticket>(`/tickets/${ticketId}`);
      setTicket(res);
    } catch (e: any) {
      setError(e?.message || "Failed to load ticket");
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    void load();
  }, [ticketId]);

  return (
    <Screen scroll>
      <Pressable style={styles.back} onPress={() => navigation.goBack()}>
        <AppText variant="caption" style={styles.backText}>Back</AppText>
      </Pressable>

      {error ? (
        <AppText variant="caption" style={styles.error}>
          {error}
        </AppText>
      ) : null}

      {loading && !ticket ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : null}

      {ticket ? (
        <Card>
          <AppText variant="h1" style={styles.title}>
            {ticket.title}
          </AppText>

          <View style={styles.chipRow}>
            <Chip label={ticket.status} tone="primary" />
            <Chip label={ticket.priority} tone={ticket.priority === "HIGH" ? "danger" : ticket.priority === "MEDIUM" ? "warning" : "neutral"} />
            {ticket.category ? <Chip label={ticket.category} tone="success" /> : null}
          </View>

          <AppText variant="caption" style={styles.meta}>ID: {ticket.id}</AppText>
          {ticket.category && typeof ticket.ai_confidence === "number" ? (
            <AppText variant="caption" style={styles.meta}>
              AI confidence: {Math.round(ticket.ai_confidence * 100)}%
            </AppText>
          ) : null}

          <Divider style={styles.divider} />

          <AppText variant="h2">Description</AppText>
          <AppText style={styles.desc}>{ticket.description}</AppText>
          <AppText variant="caption" style={styles.meta}>Updated: {new Date(ticket.updated_at).toLocaleString()}</AppText>
        </Card>
      ) : null}
    </Screen>
  );
};

const styles = StyleSheet.create({
  back: { alignSelf: "flex-start", marginBottom: 10 },
  backText: { color: theme.colors.muted, fontWeight: "800" },
  error: { marginBottom: 10, color: theme.colors.danger, fontWeight: "700" },
  loadingRow: { marginTop: 14 },
  title: { marginBottom: 12 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  meta: { marginTop: 8, color: theme.colors.subtle },
  divider: { marginTop: 16, marginBottom: 16 },
  desc: { marginTop: 10, color: theme.colors.muted, lineHeight: 20 },
});
