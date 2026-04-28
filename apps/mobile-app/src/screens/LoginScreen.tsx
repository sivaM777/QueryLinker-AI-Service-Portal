import React from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useAuth } from "../state/auth";
import { AppText, Button, Card, Chip, Screen, TextField } from "../ui/components";
import { theme } from "../ui/theme";
import { getApiBaseUrl, setApiBaseUrl } from "../state/appConfig";

export const LoginScreen: React.FC = () => {
  const { login } = useAuth();
  const [email, setEmail] = React.useState("employee@company.com");
  const [password, setPassword] = React.useState("employee123");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [apiUrl, setApiUrl] = React.useState<string>("");
  const [apiUrlLoaded, setApiUrlLoaded] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      const current = await getApiBaseUrl();
      setApiUrl(current);
      setApiUrlLoaded(true);
    })();
  }, []);

  const onSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (e: any) {
      setError(e?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen keyboardAvoiding scroll contentContainerStyle={styles.center}>
      <View style={styles.hero}>
        <View style={styles.logoCircle} />
        <AppText variant="h1" style={styles.heroTitle}>
          IT Helpdesk
        </AppText>
        <AppText variant="caption" style={styles.heroSubtitle}>
          Secure sign-in to raise and track support tickets
        </AppText>
      </View>

      <Card>
        <View style={styles.brandRow}>
          <AppText variant="h2" style={styles.brandTitle}>
            PG-IT Service Portal
          </AppText>
          <Chip label="Enterprise" tone="primary" />
        </View>
        <AppText variant="caption" style={styles.subtitle}>
          Sign in to continue
        </AppText>

        {error ? (
          <View style={styles.errorBox}>
            <AppText variant="caption" style={styles.errorTitle}>
              Sign-in failed
            </AppText>
            <AppText variant="caption" style={styles.errorText}>
              {error}
            </AppText>
            {error.toLowerCase().includes("network") ? (
              <Pressable style={styles.settingsLink} onPress={() => setSettingsOpen(true)}>
                <AppText variant="caption" style={styles.settingsLinkText}>
                  Check server settings
                </AppText>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <TextField
          label="Email"
          placeholder="employee@company.com"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextField
          label="Password"
          placeholder="••••••••"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <View style={styles.actions}>
          <Button title={loading ? "Signing in..." : "Sign in"} onPress={() => void onSubmit()} loading={loading} />
        </View>

        <View style={styles.footerRow}>
          <Pressable onPress={() => setSettingsOpen(true)}>
            <AppText variant="caption" style={styles.footerLink}>
              Server settings
            </AppText>
          </Pressable>
          <AppText variant="caption" style={styles.footerText}>
            v1.0
          </AppText>
        </View>
      </Card>

      <Modal visible={settingsOpen} transparent animationType="fade" onRequestClose={() => setSettingsOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <AppText variant="h2">Server settings</AppText>
            <AppText variant="caption" style={styles.modalHelp}>
              Use your PC LAN IP (same Wi-Fi). Example: http://192.168.1.2:3000/api/v1
            </AppText>

            <TextField
              label="API Base URL"
              value={apiUrl}
              editable={apiUrlLoaded}
              onChangeText={setApiUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="http://192.168.1.2:3000/api/v1"
            />

            <View style={styles.modalActions}>
              <Button title="Cancel" variant="secondary" onPress={() => setSettingsOpen(false)} />
              <Button
                title="Save"
                onPress={() => {
                  void setApiBaseUrl(apiUrl);
                  setSettingsOpen(false);
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
};

const styles = StyleSheet.create({
  center: { flexGrow: 1, justifyContent: "center" },
  hero: { alignItems: "center", marginBottom: 14 },
  logoCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "rgba(37, 99, 235, 0.22)",
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.35)",
  },
  heroTitle: { marginTop: 12, textAlign: "center" },
  heroSubtitle: { marginTop: 8, textAlign: "center", color: theme.colors.muted, maxWidth: 320 },
  brandRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  brandTitle: { flexShrink: 1 },
  subtitle: { marginTop: 10 },
  actions: { marginTop: 16 },

  errorBox: {
    marginTop: 12,
    backgroundColor: "rgba(255, 107, 107, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 107, 107, 0.30)",
    borderRadius: 14,
    padding: 12,
  },
  errorTitle: { color: theme.colors.danger, fontWeight: "800" },
  errorText: { marginTop: 6, color: theme.colors.muted },
  settingsLink: { marginTop: 10 },
  settingsLinkText: { color: theme.colors.text, fontWeight: "800" },

  footerRow: { marginTop: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  footerLink: { color: theme.colors.subtle, fontWeight: "800" },
  footerText: { color: theme.colors.subtle },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 18 },
  modalCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 16,
  },
  modalHelp: { marginTop: 10, color: theme.colors.muted },
  modalActions: { marginTop: 16, flexDirection: "row", gap: 10 },
});
