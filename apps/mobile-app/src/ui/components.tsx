import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { theme } from "./theme";

type TextVariant = "h1" | "h2" | "body" | "caption";

export const AppText: React.FC<{
  children: React.ReactNode;
  variant?: TextVariant;
  style?: TextStyle;
  numberOfLines?: number;
}> = ({ children, variant = "body", style, numberOfLines }) => {
  return (
    <Text numberOfLines={numberOfLines} style={[textStyles[variant], style]}>
      {children}
    </Text>
  );
};

export const Screen: React.FC<{
  children: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
  contentContainerStyle?: ViewStyle;
  keyboardAvoiding?: boolean;
}> = ({ children, scroll, style, contentContainerStyle, keyboardAvoiding }) => {
  const body = scroll ? (
    <ScrollView contentContainerStyle={[styles.scrollBody, contentContainerStyle]} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.body, contentContainerStyle]}>{children}</View>
  );

  if (!keyboardAvoiding) {
    return (
      <SafeAreaView style={[styles.container, style]} edges={["top", "bottom"]}>
        {body}
      </SafeAreaView>
    );
  }

  return (
    <KeyboardAvoidingView style={[styles.container, style]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        {body}
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
};

export const Card: React.FC<{ children: React.ReactNode; style?: ViewStyle }> = ({ children, style }) => {
  return <View style={[styles.card, style]}>{children}</View>;
};

export const Divider: React.FC<{ style?: ViewStyle }> = ({ style }) => <View style={[styles.divider, style]} />;

export const Chip: React.FC<{
  label: string;
  tone?: "neutral" | "primary" | "success" | "danger" | "warning";
  style?: ViewStyle;
}> = ({ label, tone = "neutral", style }) => {
  const toneStyle = chipTones[tone];
  return (
    <View style={[styles.chip, toneStyle, style]}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
};

export const Button: React.FC<{
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost";
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}> = ({ title, onPress, variant = "primary", loading, disabled, style }) => {
  const base = [styles.button, buttonVariants[variant], (disabled || loading) ? styles.buttonDisabled : null, style];

  return (
    <Pressable onPress={onPress} style={base} disabled={disabled || loading}>
      {loading ? <ActivityIndicator color={variant === "secondary" ? theme.colors.text : "#fff"} /> : <Text style={styles.buttonText}>{title}</Text>}
    </Pressable>
  );
};

export const TextField: React.FC<{
  label?: string;
  error?: string | null;
  containerStyle?: ViewStyle;
} & TextInputProps> = ({ label, error, containerStyle, style, ...props }) => {
  return (
    <View style={[styles.fieldWrap, containerStyle]}>
      {label ? <AppText variant="caption" style={styles.fieldLabel}>{label}</AppText> : null}
      <TextInput
        placeholderTextColor={theme.colors.subtle}
        style={[styles.input, style, error ? styles.inputError : null]}
        {...props}
      />
      {error ? <AppText variant="caption" style={styles.fieldError}>{error}</AppText> : null}
    </View>
  );
};

const textStyles = StyleSheet.create({
  h1: { fontSize: theme.font.h1, fontWeight: "800", color: theme.colors.text, letterSpacing: -0.3 },
  h2: { fontSize: theme.font.h2, fontWeight: "700", color: theme.colors.text },
  body: { fontSize: theme.font.body, color: theme.colors.text },
  caption: { fontSize: theme.font.caption, color: theme.colors.muted },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  body: { flex: 1, paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.xl },
  scrollBody: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.xl },

  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
  },

  divider: { height: 1, backgroundColor: theme.colors.border },

  chip: {
    alignSelf: "flex-start",
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
  },
  chipText: { color: theme.colors.text, fontSize: 12, fontWeight: "700" },

  button: {
    height: 48,
    borderRadius: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  buttonDisabled: { opacity: 0.65 },
  buttonText: { color: "#fff", fontWeight: "800" },

  fieldWrap: { marginTop: 12 },
  fieldLabel: { marginBottom: 6, color: theme.colors.muted, fontWeight: "700" },
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.colors.text,
  },
  inputError: { borderColor: theme.colors.danger },
  fieldError: { marginTop: 6, color: theme.colors.danger, fontWeight: "700" },
});

const buttonVariants = StyleSheet.create({
  primary: { backgroundColor: theme.colors.primary },
  secondary: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  ghost: { backgroundColor: "rgba(255,255,255,0.06)" },
});

const chipTones = StyleSheet.create({
  neutral: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: theme.colors.border },
  primary: { backgroundColor: "rgba(37, 99, 235, 0.20)", borderColor: "rgba(37, 99, 235, 0.35)" },
  success: { backgroundColor: "rgba(34, 197, 94, 0.16)", borderColor: "rgba(34, 197, 94, 0.35)" },
  danger: { backgroundColor: "rgba(255, 107, 107, 0.16)", borderColor: "rgba(255, 107, 107, 0.35)" },
  warning: { backgroundColor: "rgba(245, 158, 11, 0.16)", borderColor: "rgba(245, 158, 11, 0.35)" },
});
