import React from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Divider,
  Stack,
  Toolbar,
  Typography,
} from "@mui/material";
import { ArrowBack, Gavel, Policy, VerifiedUser } from "@mui/icons-material";

type LegalPageProps = {
  title: string;
  subtitle: string;
  icon: "terms" | "privacy";
  updatedOn: string;
  sections: Array<{
    heading: string;
    body: string[];
  }>;
};

const pageIcon = {
  terms: <Gavel fontSize="large" />,
  privacy: <Policy fontSize="large" />,
};

export const LegalPage: React.FC<LegalPageProps> = ({
  title,
  subtitle,
  icon,
  updatedOn,
  sections,
}) => {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#f6f9fc" }}>
      <AppBar
        position="static"
        elevation={0}
        sx={{
          bgcolor: "background.paper",
          borderBottom: 1,
          borderColor: "divider",
          color: "text.primary",
        }}
      >
        <Toolbar sx={{ justifyContent: "space-between" }}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Box
              component="img"
              src="/icons/icon-192.svg"
              alt="PG-IT"
              sx={{ width: 28, height: 28 }}
            />
            <Typography variant="subtitle1" sx={{ fontWeight: 700, letterSpacing: 0.2 }}>
              PG-IT Service Portal
            </Typography>
            <Chip size="small" label="Enterprise" color="primary" variant="outlined" />
          </Stack>

          <Stack direction="row" spacing={1}>
            <Button component={RouterLink} to="/" color="inherit">
              Home
            </Button>
            <Button component={RouterLink} to="/login" variant="contained">
              Sign in
            </Button>
          </Stack>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: { xs: 5, md: 8 } }}>
        <Button
          component={RouterLink}
          to="/"
          startIcon={<ArrowBack />}
          sx={{ mb: 3, borderRadius: 2 }}
        >
          Back to Portal
        </Button>

        <Card
          elevation={0}
          sx={{
            borderRadius: 5,
            overflow: "hidden",
            border: "1px solid rgba(15, 23, 42, 0.08)",
            background:
              "linear-gradient(135deg, rgba(15,23,42,0.98) 0%, rgba(37,99,235,0.92) 55%, rgba(16,185,129,0.88) 100%)",
            color: "white",
            mb: 4,
          }}
        >
          <CardContent sx={{ px: { xs: 3, md: 5 }, py: { xs: 4, md: 5 } }}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={3} justifyContent="space-between">
              <Stack spacing={2} maxWidth={760}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Box
                    sx={{
                      width: 56,
                      height: 56,
                      borderRadius: 3,
                      display: "grid",
                      placeItems: "center",
                      bgcolor: "rgba(255,255,255,0.14)",
                    }}
                  >
                    {pageIcon[icon]}
                  </Box>
                  <Chip
                    icon={<VerifiedUser fontSize="small" />}
                    label="Policy Document"
                    sx={{ bgcolor: "rgba(255,255,255,0.12)", color: "white" }}
                  />
                </Stack>
                <Typography variant="h3" sx={{ fontWeight: 800, letterSpacing: -0.8 }}>
                  {title}
                </Typography>
                <Typography sx={{ color: "rgba(255,255,255,0.82)", fontSize: "1.05rem", maxWidth: 720 }}>
                  {subtitle}
                </Typography>
              </Stack>

              <Card
                elevation={0}
                sx={{
                  minWidth: { xs: "100%", md: 240 },
                  alignSelf: "flex-start",
                  borderRadius: 4,
                  bgcolor: "rgba(255,255,255,0.1)",
                  color: "white",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              >
                <CardContent>
                  <Typography variant="overline" sx={{ color: "rgba(255,255,255,0.72)" }}>
                    Last Updated
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    {updatedOn}
                  </Typography>
                  <Divider sx={{ my: 2, borderColor: "rgba(255,255,255,0.16)" }} />
                  <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.8)" }}>
                    This page is intended for enterprise users, employees, support teams, and administrators
                    accessing PG-IT Service Portal services.
                  </Typography>
                </CardContent>
              </Card>
            </Stack>
          </CardContent>
        </Card>

        <Stack spacing={3}>
          {sections.map((section) => (
            <Card
              key={section.heading}
              elevation={0}
              sx={{
                borderRadius: 4,
                border: "1px solid rgba(15, 23, 42, 0.08)",
                boxShadow: "0 18px 40px rgba(15,23,42,0.05)",
              }}
            >
              <CardContent sx={{ p: { xs: 3, md: 4 } }}>
                <Typography variant="h5" sx={{ fontWeight: 750, mb: 2 }}>
                  {section.heading}
                </Typography>
                <Stack spacing={1.4}>
                  {section.body.map((paragraph, index) => (
                    <Typography key={index} color="text.secondary" sx={{ lineHeight: 1.8 }}>
                      {paragraph}
                    </Typography>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      </Container>
    </Box>
  );
};
