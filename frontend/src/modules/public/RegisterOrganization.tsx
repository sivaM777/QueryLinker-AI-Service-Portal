import { type FormEvent, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import BusinessIcon from "@mui/icons-material/Business";
import DomainIcon from "@mui/icons-material/Domain";
import EmailIcon from "@mui/icons-material/Email";
import LockIcon from "@mui/icons-material/Lock";
import PersonIcon from "@mui/icons-material/Person";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../services/auth";

const normalizeDomain = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");

export const RegisterOrganization = () => {
  const { registerOrganization } = useAuth();
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState("");
  const [domain, setDomain] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const cleanDomain = useMemo(() => normalizeDomain(domain), [domain]);
  const canSubmit =
    companyName.trim().length >= 2 &&
    cleanDomain.length >= 3 &&
    adminName.trim().length >= 2 &&
    /\S+@\S+\.\S+/.test(adminEmail) &&
    password.length >= 8;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await registerOrganization({
        companyName: companyName.trim(),
        domain: cleanDomain,
        adminName: adminName.trim(),
        adminEmail: adminEmail.trim(),
        password,
      });
      navigate("/admin/dashboard", { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || "Organization setup failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        px: { xs: 2, md: 5 },
        py: { xs: 3, md: 6 },
        background:
          "radial-gradient(circle at 15% 15%, rgba(37,99,235,0.18), transparent 30%), radial-gradient(circle at 85% 5%, rgba(20,184,166,0.16), transparent 26%), linear-gradient(135deg, #f8fbff 0%, #eef5ff 48%, #f9fafb 100%)",
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 5 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box
            sx={{
              width: 42,
              height: 42,
              borderRadius: 2,
              display: "grid",
              placeItems: "center",
              color: "#fff",
              fontWeight: 900,
              background: "linear-gradient(135deg, #2563eb, #0f766e)",
              boxShadow: "0 18px 35px rgba(37,99,235,0.24)",
            }}
          >
            PG
          </Box>
          <Box>
            <Typography variant="h6" fontWeight={900}>
              PG-IT Service Portal
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Tenant onboarding console
            </Typography>
          </Box>
        </Stack>
        <Button component={RouterLink} to="/login" variant="outlined" sx={{ borderRadius: 999 }}>
          Sign in
        </Button>
      </Stack>

      <Grid container spacing={4} alignItems="stretch" justifyContent="center">
        <Grid item xs={12} lg={5}>
          <Stack spacing={3} sx={{ height: "100%", justifyContent: "center" }}>
            <Chip
              icon={<VerifiedUserIcon />}
              label="Enterprise-ready setup"
              sx={{ alignSelf: "flex-start", bgcolor: "#e0f2fe", color: "#075985", fontWeight: 800 }}
            />
            <Typography variant="h2" sx={{ fontWeight: 950, letterSpacing: "-0.06em", lineHeight: 0.95 }}>
              Create a secure IT workspace for your organization.
            </Typography>
            <Typography variant="h6" color="text.secondary" sx={{ maxWidth: 620, lineHeight: 1.7 }}>
              This onboarding flow creates an isolated tenant, a first administrator, default L1/L2/L3
              support teams, and the base routing structure needed to run the portal like a real SaaS
              helpdesk.
            </Typography>

            <Grid container spacing={2}>
              {[
                ["Tenant isolation", "Company data is separated by organization."],
                ["Default teams", "L1, L2, and L3 queues are created automatically."],
                ["Admin launch", "The first admin is signed in after setup."],
                ["Demo friendly", "Perfect for college showcase and enterprise walkthroughs."],
              ].map(([title, body]) => (
                <Grid item xs={12} sm={6} key={title}>
                  <Paper
                    elevation={0}
                    sx={{
                      p: 2.2,
                      borderRadius: 4,
                      border: "1px solid rgba(15,23,42,0.08)",
                      background: "rgba(255,255,255,0.72)",
                      backdropFilter: "blur(14px)",
                    }}
                  >
                    <Typography fontWeight={900}>{title}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                      {body}
                    </Typography>
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </Stack>
        </Grid>

        <Grid item xs={12} lg={5}>
          <Paper
            component="form"
            onSubmit={submit}
            elevation={0}
            sx={{
              p: { xs: 3, md: 4 },
              borderRadius: 6,
              border: "1px solid rgba(15,23,42,0.08)",
              boxShadow: "0 35px 90px rgba(15,23,42,0.16)",
              background: "rgba(255,255,255,0.88)",
              backdropFilter: "blur(18px)",
            }}
          >
            <Stack spacing={2.5}>
              <Box>
                <Typography variant="h4" fontWeight={950} letterSpacing="-0.04em">
                  Register Organization
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                  Enter the company details and first administrator account.
                </Typography>
              </Box>

              {error ? <Alert severity="error">{error}</Alert> : null}

              <TextField
                label="Company name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
                fullWidth
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <BusinessIcon />
                    </InputAdornment>
                  ),
                }}
              />
              <TextField
                label="Company domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                helperText={cleanDomain ? `Workspace domain: ${cleanDomain}` : "Example: company.com"}
                required
                fullWidth
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <DomainIcon />
                    </InputAdornment>
                  ),
                }}
              />

              <Divider />

              <TextField
                label="Admin full name"
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                required
                fullWidth
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <PersonIcon />
                    </InputAdornment>
                  ),
                }}
              />
              <TextField
                label="Admin email"
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                required
                fullWidth
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <EmailIcon />
                    </InputAdornment>
                  ),
                }}
              />
              <TextField
                label="Temporary password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                helperText="Minimum 8 characters. The admin can change it later."
                required
                fullWidth
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <LockIcon />
                    </InputAdornment>
                  ),
                }}
              />

              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={!canSubmit || submitting}
                endIcon={submitting ? <CircularProgress size={18} color="inherit" /> : <RocketLaunchIcon />}
                sx={{
                  py: 1.55,
                  borderRadius: 999,
                  fontWeight: 900,
                  background: "linear-gradient(135deg, #2563eb, #0f766e)",
                  boxShadow: "0 18px 38px rgba(37,99,235,0.28)",
                }}
              >
                Create Workspace
              </Button>

              <Alert severity="info" sx={{ borderRadius: 3 }}>
                After setup, use the admin account to invite users, configure routing, and manage the
                organization workspace.
              </Alert>
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};
