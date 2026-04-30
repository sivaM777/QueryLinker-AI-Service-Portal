import React from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import {
  Avatar,
  Box,
  Stack,
  TextField,
  Button,
  Typography,
  Alert,
  Divider,
  Paper,
  Checkbox,
  FormControlLabel,
  Link,
  InputAdornment,
  IconButton,
} from "@mui/material";
import { ArrowForward, Visibility, VisibilityOff } from "@mui/icons-material";
import { useAuth } from "../../services/auth";
import { getApiErrorMessage } from "../../services/api";

export const Login: React.FC = () => {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [keepSignedIn, setKeepSignedIn] = React.useState(true);
  const [error, setError] = React.useState("");
  const [emailError, setEmailError] = React.useState<string | null>(null);
  const [passwordError, setPasswordError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const formRef = React.useRef<HTMLFormElement | null>(null);

  type LocationState = { from?: { pathname?: string } };
  const state = location.state as LocationState | null;
  const from = state?.from?.pathname || "/";
  const azureError = searchParams.get("azure_error");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setEmailError(null);
    setPasswordError(null);

    const trimmedEmail = email.trim();
    const nextEmailError = !trimmedEmail
      ? "Email is required"
      : /^\S+@\S+\.\S+$/.test(trimmedEmail)
        ? null
        : "Enter a valid email";
    const nextPasswordError = password ? null : "Password is required";
    if (nextEmailError || nextPasswordError) {
      setEmailError(nextEmailError);
      setPasswordError(nextPasswordError);
      return;
    }

    setSubmitting(true);
    try {
      const u = await login(trimmedEmail, password);
      
      // Determine the best redirect target.
      // If 'from' is just the root or a generic dashboard path, redirect to the user's role-specific dashboard.
      // This prevents "cached" route state where an Admin logs in and is sent to an Agent dashboard
      // because they were previously logged in as an Agent or redirected from an expired Agent session.
      const dashboardPaths = ["/", "/admin", "/admin/", "/admin/dashboard", "/admin/agent-dashboard", "/admin/manager"];
      const isGenericPath = dashboardPaths.includes(from);
      
      let target = from;
      if (isGenericPath) {
        if (u.role === "ADMIN") target = "/admin/dashboard";
        else if (u.role === "MANAGER") target = "/admin/manager";
        else if (u.role === "AGENT") target = "/admin/agent-dashboard";
        else target = "/app";
      } else {
        // For specific resource paths (e.g., /admin/tickets/123), validate role access
        const isAdminPath = from.startsWith("/admin");
        const isEmployeePath = from.startsWith("/app");
        const isAdminOnlyPath = from.startsWith("/admin/users") || from.startsWith("/admin/teams");
        
        if (isAdminPath && u.role === "EMPLOYEE") {
          target = "/app";
        } else if (isAdminOnlyPath && (u.role === "AGENT" || u.role === "MANAGER")) {
          target = u.role === "AGENT" ? "/admin/agent-dashboard" : "/admin/manager";
        } else if (isEmployeePath && u.role !== "EMPLOYEE") {
          // If an admin/agent is trying to access an employee path, send them to their admin dashboard instead
          if (u.role === "ADMIN") target = "/admin/dashboard";
          else if (u.role === "MANAGER") target = "/admin/manager";
          else if (u.role === "AGENT") target = "/admin/agent-dashboard";
        }
      }

      navigate(target, { replace: true });
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, "Invalid email or password");
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleMicrosoftSignIn = () => {
    const tabId =
      window.sessionStorage.getItem("tab_id") ||
      (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()));
    window.sessionStorage.setItem("tab_id", tabId);

    const params = new URLSearchParams({
      tab_id: tabId,
      current_url: from && from !== "/login" ? from : "/",
    });

    const apiBaseUrl = (import.meta.env.VITE_API_URL || "/api/v1").replace(/\/+$/, "");
    window.location.assign(`${apiBaseUrl}/auth/azure/start?${params.toString()}`);
  };

  const handleJumpToEmail = () => {
    if (!formRef.current) return;
    formRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    // Focus after scroll so it feels intentional.
    window.setTimeout(() => {
      const el = formRef.current?.querySelector<HTMLInputElement>('input[type="email"]');
      el?.focus();
    }, 200);
  };

  const MicrosoftMark = () => (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 9px)",
        gridTemplateRows: "repeat(2, 9px)",
        gap: "2px",
      }}
    >
      <Box sx={{ width: 9, height: 9, bgcolor: "#f25022" }} />
      <Box sx={{ width: 9, height: 9, bgcolor: "#7fba00" }} />
      <Box sx={{ width: 9, height: 9, bgcolor: "#00a4ef" }} />
      <Box sx={{ width: 9, height: 9, bgcolor: "#ffb900" }} />
    </Box>
  );

  return (
    <Box
      sx={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        px: 2.5,
        py: 5,
        background:
          "radial-gradient(1200px 600px at 18% 12%, rgba(59,130,246,0.14), transparent 60%), radial-gradient(900px 520px at 88% 18%, rgba(16,185,129,0.12), transparent 60%), linear-gradient(180deg, #f7f9ff 0%, #f4f6fb 55%, #eef2ff 100%)",
        "&:before": {
          content: '""',
          position: "absolute",
          inset: 0,
          background:
            "repeating-linear-gradient(90deg, rgba(15,23,42,0.035) 0px, rgba(15,23,42,0.035) 1px, transparent 1px, transparent 52px), repeating-linear-gradient(180deg, rgba(15,23,42,0.03) 0px, rgba(15,23,42,0.03) 1px, transparent 1px, transparent 52px)",
          pointerEvents: "none",
          opacity: 0.4,
        },
        position: "relative",
      }}
    >
      <Paper
        elevation={0}
        sx={{
          width: "100%",
          maxWidth: 520,
          borderRadius: 5,
          overflow: "hidden",
          border: "1px solid rgba(15,23,42,0.08)",
          boxShadow: "0 30px 70px rgba(15,23,42,0.14)",
          background: "rgba(255,255,255,0.94)",
          backdropFilter: "blur(10px)",
          position: "relative",
          zIndex: 1,
        }}
      >
        <Box
          sx={{
            px: { xs: 3, sm: 4 },
            pt: { xs: 3, sm: 4 },
            pb: 2.5,
            background:
              "radial-gradient(700px 260px at 30% 0%, rgba(59,130,246,0.16), transparent 60%), radial-gradient(560px 260px at 90% 0%, rgba(16,185,129,0.16), transparent 60%), linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(248,250,252,0.92) 100%)",
            borderBottom: "1px solid rgba(15,23,42,0.06)",
          }}
        >
          <Stack spacing={2.2}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Avatar
                sx={{
                  width: 42,
                  height: 42,
                  fontWeight: 900,
                  bgcolor: "rgba(37,99,235,0.12)",
                  color: "#1e3a8a",
                  border: "1px solid rgba(37,99,235,0.18)",
                }}
              >
                PG
              </Avatar>
              <Box>
                <Typography sx={{ fontWeight: 900, letterSpacing: -0.3, lineHeight: 1.1 }}>
                  PG‑IT Service Portal
                </Typography>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  Service Desk Console
                </Typography>
              </Box>
            </Stack>

            <Box>
              <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: -0.8 }}>
                Welcome back
              </Typography>
              <Typography sx={{ mt: 0.8, color: "text.secondary", lineHeight: 1.6 }}>
                Sign in to manage and track IT requests. Use Microsoft for secure SSO, or sign in with your work email.
              </Typography>
            </Box>

            {(error || azureError) && (
              <Alert severity="error" sx={{ borderRadius: 3 }}>
                {error || azureError}
              </Alert>
            )}

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <Button
                fullWidth
                size="large"
                variant="outlined"
                onClick={handleMicrosoftSignIn}
                sx={{
                  borderRadius: 3,
                  py: 1.4,
                  justifyContent: "center",
                  borderColor: "rgba(15,23,42,0.14)",
                  color: "text.primary",
                  backgroundColor: "rgba(255,255,255,0.8)",
                  "&:hover": {
                    borderColor: "primary.main",
                    backgroundColor: "rgba(37,99,235,0.05)",
                  },
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1.3}>
                  <MicrosoftMark />
                  <Typography sx={{ fontWeight: 800 }}>Microsoft</Typography>
                </Stack>
              </Button>

              <Button
                fullWidth
                size="large"
                variant="outlined"
                onClick={handleJumpToEmail}
                sx={{
                  borderRadius: 3,
                  py: 1.4,
                  justifyContent: "center",
                  borderColor: "rgba(15,23,42,0.14)",
                  color: "text.primary",
                  backgroundColor: "rgba(255,255,255,0.8)",
                  "&:hover": {
                    borderColor: "rgba(124,58,237,0.55)",
                    backgroundColor: "rgba(124,58,237,0.04)",
                  },
                }}
              >
                <Typography sx={{ fontWeight: 800 }}>Email</Typography>
              </Button>
            </Stack>

            <Stack direction="row" alignItems="center" spacing={2}>
              <Divider sx={{ flex: 1 }} />
              <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 0.8 }}>
                OR WITH EMAIL
              </Typography>
              <Divider sx={{ flex: 1 }} />
            </Stack>
          </Stack>
        </Box>

        <Box sx={{ px: { xs: 3, sm: 4 }, pb: { xs: 3, sm: 4 }, pt: 2.5 }}>
          <Box component="form" ref={formRef} onSubmit={handleSubmit} noValidate>
            <Stack spacing={2.1}>
              <TextField
                required
                fullWidth
                label="Work email"
                type="email"
                autoComplete="email"
                value={email}
                error={!!emailError}
                helperText={emailError ?? ""}
                onChange={(e) => setEmail(e.target.value)}
              />

              <Box>
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.8 }}>
                  <Box />
                  <Link
                    href="mailto:support@company.com?subject=Password%20reset%20request%20%E2%80%93%20PG-IT%20Service%20Portal"
                    underline="hover"
                    sx={{ fontWeight: 700, fontSize: 13 }}
                  >
                    Forgot password?
                  </Link>
                </Stack>
                <TextField
                  required
                  fullWidth
                  label="Password"
                  placeholder="••••••••"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  error={!!passwordError}
                  helperText={passwordError ?? ""}
                  onChange={(e) => setPassword(e.target.value)}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          aria-label={showPassword ? "Hide password" : "Show password"}
                          onClick={() => setShowPassword((v) => !v)}
                          edge="end"
                        >
                          {showPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
              </Box>

              <FormControlLabel
                control={
                  <Checkbox
                    checked={keepSignedIn}
                    onChange={(e) => setKeepSignedIn(e.target.checked)}
                  />
                }
                label={
                  <Typography variant="body2" color="text.secondary">
                    Keep me signed in on this device
                  </Typography>
                }
              />

              <Button
                type="submit"
                fullWidth
                size="large"
                disabled={submitting}
                endIcon={<ArrowForward />}
                sx={{
                  py: 1.5,
                  borderRadius: 3,
                  fontWeight: 900,
                  letterSpacing: -0.2,
                  color: "white",
                  background:
                    "linear-gradient(90deg, rgba(37,99,235,1) 0%, rgba(124,58,237,1) 55%, rgba(217,70,239,0.95) 100%)",
                  boxShadow: "0 18px 40px rgba(59,130,246,0.25)",
                  "&:hover": {
                    filter: "brightness(0.98)",
                    boxShadow: "0 22px 55px rgba(124,58,237,0.25)",
                    background:
                      "linear-gradient(90deg, rgba(29,78,216,1) 0%, rgba(109,40,217,1) 55%, rgba(192,38,211,0.95) 100%)",
                  },
                }}
              >
                {submitting ? "Signing in..." : "Sign in to dashboard"}
              </Button>

              <Divider sx={{ my: 1.5 }} />

              <Stack spacing={1}>
                <Typography variant="caption" color="text.secondary">
                  Demo credentials
                </Typography>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => {
                      setEmail("admin@company.com");
                      setPassword("admin123");
                    }}
                  >
                    Use Admin
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => {
                      setEmail("agent@company.com");
                      setPassword("agent123");
                    }}
                  >
                    Use Agent
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => {
                      setEmail("employee@company.com");
                      setPassword("employee123");
                    }}
                  >
                    Use Employee
                  </Button>
                </Stack>
              </Stack>

              <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center", mt: 0.5 }}>
                By signing in, you agree to your organization’s IT usage policies.
              </Typography>
            </Stack>
          </Box>
        </Box>
      </Paper>
    </Box>
  );
};
