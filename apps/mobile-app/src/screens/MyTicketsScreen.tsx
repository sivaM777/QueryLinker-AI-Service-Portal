import React from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import { api } from "../api/client";
import type { Ticket } from "../types";
import { AppText, Card, Chip, Screen } from "../ui/components";
import { theme } from "../ui/theme";

type Props = NativeStackScreenProps<RootStackParamList, "MyTickets">;

export const MyTicketsScreen: React.FC<Props> = ({ navigation }) => {
  const [items, setItems] = React.useState<Ticket[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<Ticket[]>("/tickets/my");
      setItems(res);
    } catch (e: any) {
      setError(e?.message || "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    void load();
  }, []);

  return (
    <Screen>
      {error ? (
        <AppText variant="caption" style={styles.error}>
          {error}
        </AppText>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(t) => t.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.colors.primary} />}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate("TicketDetail", { ticketId: item.id })}>
            <Card style={styles.ticketCard}>
              <View style={styles.row}>
                <AppText variant="h2" numberOfLines={1} style={styles.title}>
                  {item.title}
                </AppText>
                <Chip label={item.status} tone="primary" />
              </View>
              <AppText variant="caption" numberOfLines={2} style={styles.desc}>
                {item.description}
              </AppText>
              {item.category ? (
                <AppText variant="caption" style={styles.meta}>
                  AI: {item.category}
                  {typeof item.ai_confidence === "number" ? ` (${Math.round(item.ai_confidence * 100)}%)` : ""}
                </AppText>
              ) : null}
              <AppText variant="caption" style={styles.meta}>
                Updated: {new Date(item.updated_at).toLocaleString()}
              </AppText>
            </Card>
          </Pressable>
        )}
        ListEmptyComponent={!loading ? <AppText variant="caption" style={styles.empty}>No tickets yet.</AppText> : null}
      />
    </Screen>
  );
};

const styles = StyleSheet.create({
  ticketCard: { marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  title: { flex: 1 },
  desc: { marginTop: 8, color: theme.colors.muted },
  meta: { marginTop: 8, color: theme.colors.subtle },
  empty: { marginTop: 24, textAlign: "center", color: theme.colors.muted },
  error: { marginBottom: 10, color: theme.colors.danger, fontWeight: "700" },
});
