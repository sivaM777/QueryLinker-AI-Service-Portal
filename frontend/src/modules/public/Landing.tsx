import React from "react";
import { Link as RouterLink, Navigate, useNavigate } from "react-router-dom";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import {
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Grid,
  Paper,
  Stack,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  ArrowOutwardRounded,
  AutoAwesomeRounded,
  BoltRounded,
  CheckCircleRounded,
  HubRounded,
  InsightsRounded,
  PlayArrowRounded,
  ShieldRounded,
  ViewKanbanRounded,
} from "@mui/icons-material";
import { useAuth } from "../../services/auth";

const MotionBox = motion(Box);
const MotionPaper = motion(Paper);
const MotionCard = motion(Card);

const productShots = {
  dashboard: "/assets/showcase/dashboard-snapshot.svg?v=20260428-1",
  tickets: "/assets/showcase/tickets-snapshot.svg?v=20260428-1",
  boards: "/assets/showcase/boards-snapshot.svg?v=20260428-1",
};

const headlinePoints = [
  "AI-guided intake",
  "Realtime routing",
  "Visual boards",
  "Workflow automation",
];

const featureCards = [
  {
    icon: <HubRounded fontSize="small" />,
    title: "One operational surface",
    body: "Tickets, boards, approvals, schedules, audit logs, and knowledge stay connected instead of living in separate tools.",
  },
  {
    icon: <AutoAwesomeRounded fontSize="small" />,
    title: "Smarter from first touch",
    body: "Collect better issue context, suggest next steps, and create cleaner tickets before they hit the queue.",
  },
  {
    icon: <ShieldRounded fontSize="small" />,
    title: "Governed at scale",
    body: "Role-based access, approvals, escalation paths, and audit visibility make the platform enterprise-ready.",
  },
  {
    icon: <ViewKanbanRounded fontSize="small" />,
    title: "Visual work control",
    body: "Move from list-heavy support to drag-and-drop operational boards without losing ticket integrity.",
  },
];

const roleCards = [
  {
    title: "Employees",
    body: "Raise incidents quickly, upload proof, use the knowledge base, and watch progress live without chasing updates.",
    accent: "#2563eb",
  },
  {
    title: "Agents",
    body: "Work from a fast queue with inline edits, AI support, clearer ticket communication, and better workflow visibility.",
    accent: "#0f766e",
  },
  {
    title: "Managers",
    body: "See workload pressure, approvals, time-off, escalations, and service health before small issues become backlog risk.",
    accent: "#f59e0b",
  },
  {
    title: "Admins",
    body: "Control organizations, workflows, boards, automation, audit trails, and governance from one command layer.",
    accent: "#7c3aed",
  },
];

const workflowSteps = [
  {
    step: "01",
    title: "Capture",
    body: "Employees submit requests through a guided portal or AI-assisted conversation.",
  },
  {
    step: "02",
    title: "Understand",
    body: "The platform structures the issue, classifies intent, and enriches the request context.",
  },
  {
    step: "03",
    title: "Route",
    body: "Tickets move to the right queue, team, or board lane with realtime visibility.",
  },
  {
    step: "04",
    title: "Resolve",
    body: "Agents, managers, and workflows act in one governed workspace until the issue is closed.",
  },
];

const statItems = [
  { value: "4", label: "role-based workspaces" },
  { value: "Live", label: "status and queue updates" },
  { value: "1", label: "connected service portal" },
];

type ShotFrameProps = {
  src: string;
  alt: string;
  width?: number | string;
  rotate?: number;
  y?: any;
  x?: any;
  delay?: number;
  bordered?: boolean;
};

const ShotFrame: React.FC<ShotFrameProps> = ({
  src,
  alt,
  width = "100%",
  rotate = 0,
  y,
  x,
  delay = 0,
  bordered = true,
}) => (
  <MotionPaper
    elevation={0}
    initial={{ opacity: 0, y: 32, scale: 0.96 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay }}
    whileHover={{ y: -6, scale: 1.01 }}
    style={{ y, x, rotate }}
    sx={{
      width,
      overflow: "hidden",
      borderRadius: 6,
      border: bordered ? "1px solid rgba(148,163,184,0.24)" : "none",
      bgcolor: "rgba(255,255,255,0.84)",
      boxShadow: "0 32px 90px rgba(15,23,42,0.18)",
      backdropFilter: "blur(18px)",
    }}
  >
    <Box
      component="img"
      src={src}
      alt={alt}
      sx={{
        display: "block",
        width: "100%",
        height: "auto",
      }}
    />
  </MotionPaper>
);

const SectionReveal: React.FC<{ children: React.ReactNode; delay?: number }> = ({ children, delay = 0 }) => (
  <MotionBox
    initial={{ opacity: 0, y: 36 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, amount: 0.22 }}
    transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay }}
  >
    {children}
  </MotionBox>
);

export const Landing: React.FC = () => {
  const { isAuthenticated, user, demoLogin } = useAuth();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const prefersReducedMotion = useReducedMotion();
  const [demoLaunching, setDemoLaunching] = React.useState(false);
  const heroRef = React.useRef<HTMLDivElement | null>(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });

  const dashboardY = useTransform(scrollYProgress, [0, 1], [0, prefersReducedMotion ? 0 : -42]);
  const ticketY = useTransform(scrollYProgress, [0, 1], [0, prefersReducedMotion ? 0 : 36]);
  const boardY = useTransform(scrollYProgress, [0, 1], [0, prefersReducedMotion ? 0 : -18]);
  const boardX = useTransform(scrollYProgress, [0, 1], [0, prefersReducedMotion ? 0 : 16]);

  if (isAuthenticated && user) {
    switch (user.role) {
      case "ADMIN":
        return <Navigate to="/admin/dashboard" replace />;
      case "MANAGER":
        return <Navigate to="/admin/manager" replace />;
      case "AGENT":
        return <Navigate to="/admin/agent-dashboard" replace />;
      case "EMPLOYEE":
        return <Navigate to="/app" replace />;
      default:
        return <Navigate to="/login" replace />;
    }
  }

  const launchDemo = async () => {
    if (demoLaunching) return;
    setDemoLaunching(true);
    try {
      await demoLogin("ADMIN");
      navigate("/admin/dashboard", { replace: true });
    } catch {
      navigate("/login");
    } finally {
      setDemoLaunching(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        color: "#0f172a",
        background:
          "radial-gradient(880px 520px at 6% 10%, rgba(37,99,235,0.16), transparent 58%), radial-gradient(760px 420px at 100% 8%, rgba(15,118,110,0.16), transparent 54%), linear-gradient(180deg, #f8fbff 0%, #edf5ff 50%, #f8fafc 100%)",
        position: "relative",
        overflowX: "clip",
      }}
    >
      <Box
        sx={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.5,
          backgroundImage:
            "linear-gradient(rgba(15,23,42,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.05) 1px, transparent 1px)",
          backgroundSize: { xs: "36px 36px", md: "54px 54px" },
          maskImage: "linear-gradient(180deg, rgba(0,0,0,0.36) 0%, rgba(0,0,0,0.08) 58%, rgba(0,0,0,0) 100%)",
        }}
      />

      <MotionBox
        aria-hidden
        animate={
          prefersReducedMotion
            ? {}
            : {
                y: [0, -24, 0],
                x: [0, 18, 0],
              }
        }
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        sx={{
          position: "fixed",
          top: -120,
          left: -120,
          width: { xs: 260, md: 480 },
          height: { xs: 260, md: 480 },
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(37,99,235,0.22) 0%, rgba(37,99,235,0) 70%)",
          filter: "blur(16px)",
          pointerEvents: "none",
        }}
      />
      <MotionBox
        aria-hidden
        animate={prefersReducedMotion ? {} : { y: [0, 22, 0], x: [0, -16, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
        sx={{
          position: "fixed",
          right: -140,
          top: 40,
          width: { xs: 280, md: 520 },
          height: { xs: 280, md: 520 },
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(45,212,191,0.2) 0%, rgba(45,212,191,0) 72%)",
          filter: "blur(18px)",
          pointerEvents: "none",
        }}
      />

      <AppBar
        position="sticky"
        color="transparent"
        elevation={0}
        sx={{
          backdropFilter: "blur(20px)",
          backgroundColor: "rgba(248,251,255,0.74)",
          borderBottom: "1px solid rgba(15,23,42,0.08)",
        }}
      >
        <Toolbar
          sx={{
            minHeight: { xs: 74, md: 84 },
            justifyContent: "space-between",
            gap: 2,
            px: { xs: 1.5, sm: 2.5, md: 3.5 },
          }}
        >
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
            <Box
              component="img"
              src="/assets/branding/querylinker-logo.png"
              alt="QueryLinker"
              sx={{
                width: { xs: 46, sm: 58 },
                height: { xs: 46, sm: 58 },
                objectFit: "contain",
                filter: "drop-shadow(0 14px 32px rgba(15,118,110,0.18))",
              }}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontWeight: 900, letterSpacing: -0.4 }}>
                QueryLinker
              </Typography>
              <Typography variant="body2" noWrap sx={{ color: "rgba(15,23,42,0.58)" }}>
                Enterprise Helpdesk Platform
              </Typography>
            </Box>
          </Stack>

          <Stack direction="row" spacing={1.2} alignItems="center">
            {!isMobile && (
              <Chip
                icon={<ShieldRounded sx={{ color: "inherit !important" }} />}
                label="Secure demo workspace"
                sx={{
                  bgcolor: "rgba(255,255,255,0.76)",
                  border: "1px solid rgba(15,23,42,0.08)",
                  fontWeight: 700,
                }}
              />
            )}
            <Button component={RouterLink} to="/login" color="inherit" sx={{ fontWeight: 700 }}>
              Sign in
            </Button>
            <Button
              variant="contained"
              onClick={launchDemo}
              disabled={demoLaunching}
              sx={{
                borderRadius: 999,
                px: { xs: 2.2, md: 2.8 },
                fontWeight: 800,
                textTransform: "none",
                background: "linear-gradient(90deg, #2563eb 0%, #0f766e 100%)",
                boxShadow: "0 16px 36px rgba(37,99,235,0.22)",
              }}
            >
              {demoLaunching ? "Preparing demo..." : "Try demo"}
            </Button>
          </Stack>
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ py: { xs: 5, md: 8 } }}>
        <Box ref={heroRef}>
          <Grid container spacing={{ xs: 5, md: 6 }} alignItems="center">
            <Grid item xs={12} lg={5.2}>
              <SectionReveal>
                <Stack spacing={3}>
                  <Chip
                    label="AI-driven service management for real operations"
                    sx={{
                      alignSelf: "flex-start",
                      borderRadius: 999,
                      height: 38,
                      px: 1.2,
                      fontWeight: 800,
                      color: "#1d4ed8",
                      bgcolor: "rgba(37,99,235,0.1)",
                      border: "1px solid rgba(37,99,235,0.14)",
                    }}
                  />

                  <Typography
                    sx={{
                      fontSize: { xs: "2.8rem", sm: "3.8rem", md: "5rem" },
                      lineHeight: { xs: 1.02, md: 0.94 },
                      letterSpacing: { xs: -1.8, md: -3.2 },
                      fontWeight: 900,
                      maxWidth: 760,
                    }}
                  >
                    A helpdesk that looks premium and moves like a real SaaS product.
                  </Typography>

                  <Typography
                    sx={{
                      maxWidth: 640,
                      fontSize: { xs: "1rem", md: "1.08rem" },
                      lineHeight: 1.86,
                      color: "rgba(15,23,42,0.68)",
                    }}
                  >
                    QueryLinker brings together intelligent ticket intake, realtime routing, approvals, workflow
                    automation, visual boards, knowledge guidance, and operational governance in one clean enterprise
                    workspace.
                  </Typography>

                  <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1.1}>
                    {headlinePoints.map((item, index) => (
                      <MotionBox
                        key={item}
                        initial={{ opacity: 0, y: 18 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.15 + index * 0.08, duration: 0.5 }}
                      >
                        <Chip
                          icon={<CheckCircleRounded sx={{ color: "inherit !important" }} />}
                          label={item}
                          sx={{
                            bgcolor: "rgba(255,255,255,0.84)",
                            border: "1px solid rgba(15,23,42,0.08)",
                            fontWeight: 700,
                            boxShadow: "0 12px 28px rgba(15,23,42,0.06)",
                          }}
                        />
                      </MotionBox>
                    ))}
                  </Stack>

                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.4}>
                    <Button
                      variant="contained"
                      size="large"
                      endIcon={<PlayArrowRounded />}
                      onClick={launchDemo}
                      disabled={demoLaunching}
                      sx={{
                        minWidth: 220,
                        borderRadius: 999,
                        px: 3.4,
                        py: 1.55,
                        fontWeight: 800,
                        textTransform: "none",
                        background: "linear-gradient(90deg, #2563eb 0%, #0f766e 100%)",
                        boxShadow: "0 20px 44px rgba(37,99,235,0.24)",
                      }}
                    >
                      {demoLaunching ? "Preparing demo..." : "Launch live demo"}
                    </Button>
                    <Button
                      component={RouterLink}
                      to="/register-organization"
                      variant="outlined"
                      size="large"
                      endIcon={<ArrowOutwardRounded />}
                      sx={{
                        minWidth: 220,
                        borderRadius: 999,
                        px: 3.2,
                        py: 1.5,
                        textTransform: "none",
                        fontWeight: 800,
                        borderColor: "rgba(15,23,42,0.14)",
                        bgcolor: "rgba(255,255,255,0.65)",
                      }}
                    >
                      Register organization
                    </Button>
                  </Stack>

                  <Stack direction="row" spacing={4} useFlexGap flexWrap="wrap" sx={{ pt: 1 }}>
                    {statItems.map((item) => (
                      <Box key={item.label}>
                        <Typography sx={{ fontWeight: 900, fontSize: "1.5rem", letterSpacing: -0.6 }}>
                          {item.value}
                        </Typography>
                        <Typography variant="body2" sx={{ color: "rgba(15,23,42,0.58)" }}>
                          {item.label}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                </Stack>
              </SectionReveal>
            </Grid>

            <Grid item xs={12} lg={6.8}>
              <MotionBox
                initial={{ opacity: 0, y: 42 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.16 }}
                sx={{
                  position: "relative",
                  minHeight: { xs: 420, md: 720 },
                }}
              >
                <ShotFrame
                  src={productShots.dashboard}
                  alt="Dashboard product view"
                  y={dashboardY}
                  width="100%"
                  delay={0.18}
                />

                <Box
                  sx={{
                    position: "absolute",
                    width: { xs: "72%", md: "58%" },
                    left: { xs: -6, md: -36 },
                    bottom: { xs: -28, md: -46 },
                    zIndex: 3,
                  }}
                >
                  <ShotFrame
                    src={productShots.tickets}
                    alt="Ticket workspace product view"
                    rotate={isMobile ? -2 : -5}
                    y={ticketY}
                    delay={0.3}
                  />
                </Box>

                <Box
                  sx={{
                    position: "absolute",
                    width: { xs: "62%", md: "48%" },
                    right: { xs: -4, md: -24 },
                    top: { xs: -16, md: 58 },
                    zIndex: 4,
                  }}
                >
                  <ShotFrame
                    src={productShots.boards}
                    alt="Boards workspace product view"
                    rotate={isMobile ? 2 : 6}
                    y={boardY}
                    x={boardX}
                    delay={0.38}
                  />
                </Box>

                <MotionPaper
                  elevation={0}
                  animate={
                    prefersReducedMotion
                      ? {}
                      : { y: [0, -8, 0], rotate: [0, 1.2, 0] }
                  }
                  transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                  sx={{
                    position: "absolute",
                    left: { xs: 20, md: 110 },
                    top: { xs: -24, md: -32 },
                    px: 2.2,
                    py: 1.5,
                    borderRadius: 4,
                    bgcolor: "rgba(255,255,255,0.92)",
                    border: "1px solid rgba(15,23,42,0.08)",
                    boxShadow: "0 22px 44px rgba(15,23,42,0.12)",
                    zIndex: 5,
                  }}
                >
                  <Stack direction="row" spacing={1.2} alignItems="center">
                    <Box
                      sx={{
                        width: 38,
                        height: 38,
                        borderRadius: 2.5,
                        display: "grid",
                        placeItems: "center",
                        bgcolor: "rgba(37,99,235,0.12)",
                        color: "#2563eb",
                      }}
                    >
                      <InsightsRounded fontSize="small" />
                    </Box>
                    <Box>
                      <Typography sx={{ fontWeight: 800, lineHeight: 1.1 }}>Realtime service ops</Typography>
                      <Typography variant="body2" sx={{ color: "rgba(15,23,42,0.58)" }}>
                        Updates without refresh
                      </Typography>
                    </Box>
                  </Stack>
                </MotionPaper>
              </MotionBox>
            </Grid>
          </Grid>
        </Box>

        <SectionReveal delay={0.05}>
          <Grid container spacing={2.2} sx={{ pt: { xs: 6, md: 8 } }}>
            {featureCards.map((card, index) => (
              <Grid item xs={12} md={6} lg={3} key={card.title}>
                <MotionCard
                  elevation={0}
                  initial={{ opacity: 0, y: 28 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.25 }}
                  transition={{ duration: 0.65, delay: index * 0.08 }}
                  whileHover={{ y: -8 }}
                  sx={{
                    height: "100%",
                    borderRadius: 5,
                    border: "1px solid rgba(15,23,42,0.08)",
                    bgcolor: "rgba(255,255,255,0.82)",
                    backdropFilter: "blur(14px)",
                    boxShadow: "0 20px 44px rgba(15,23,42,0.06)",
                  }}
                >
                  <CardContent sx={{ p: 3 }}>
                    <Stack spacing={1.5}>
                      <Box
                        sx={{
                          width: 48,
                          height: 48,
                          borderRadius: 3,
                          display: "grid",
                          placeItems: "center",
                          bgcolor: "rgba(37,99,235,0.1)",
                          color: "#2563eb",
                        }}
                      >
                        {card.icon}
                      </Box>
                      <Typography sx={{ fontWeight: 850, fontSize: "1.08rem" }}>{card.title}</Typography>
                      <Typography sx={{ color: "rgba(15,23,42,0.66)", lineHeight: 1.8 }}>{card.body}</Typography>
                    </Stack>
                  </CardContent>
                </MotionCard>
              </Grid>
            ))}
          </Grid>
        </SectionReveal>

        <Box sx={{ pt: { xs: 6, md: 9 } }}>
          <Grid container spacing={{ xs: 4, md: 5 }} alignItems="center">
            <Grid item xs={12} md={6}>
              <SectionReveal>
                <Stack spacing={2.2}>
                  <Chip
                    label="Screen one"
                    sx={{
                      alignSelf: "flex-start",
                      fontWeight: 800,
                      bgcolor: "rgba(15,118,110,0.12)",
                      color: "#0f766e",
                    }}
                  />
                  <Typography
                    sx={{
                      fontSize: { xs: "2rem", md: "2.8rem" },
                      lineHeight: 1.02,
                      letterSpacing: -1.4,
                      fontWeight: 900,
                    }}
                  >
                    Smart ticket lists that feel fast even when the queue gets heavy.
                  </Typography>
                  <Typography sx={{ color: "rgba(15,23,42,0.66)", lineHeight: 1.85 }}>
                    Saved views, inline edits, filters, tag-aware search, and chart actions let your support team move
                    through work without drowning in clicks.
                  </Typography>
                  <Stack spacing={1.2}>
                    {[
                      "Inline ticket updates directly from the queue",
                      "Filter and chart the current visible dataset instantly",
                      "Assignment, priority, and status controls built for volume",
                    ].map((point) => (
                      <Stack key={point} direction="row" spacing={1.2} alignItems="flex-start">
                        <CheckCircleRounded sx={{ color: "#0f766e", mt: 0.1 }} />
                        <Typography sx={{ color: "rgba(15,23,42,0.7)", lineHeight: 1.72 }}>{point}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                </Stack>
              </SectionReveal>
            </Grid>
            <Grid item xs={12} md={6}>
              <SectionReveal delay={0.12}>
                <ShotFrame src={productShots.tickets} alt="Ticket smart workspace screenshot" />
              </SectionReveal>
            </Grid>
          </Grid>
        </Box>

        <Box sx={{ pt: { xs: 6, md: 9 } }}>
          <Grid container spacing={{ xs: 4, md: 5 }} alignItems="center">
            <Grid item xs={12} md={6} order={{ xs: 2, md: 1 }}>
              <SectionReveal delay={0.12}>
                <ShotFrame src={productShots.boards} alt="Boards workspace screenshot" />
              </SectionReveal>
            </Grid>
            <Grid item xs={12} md={6} order={{ xs: 1, md: 2 }}>
              <SectionReveal>
                <Stack spacing={2.2}>
                  <Chip
                    label="Screen two"
                    sx={{
                      alignSelf: "flex-start",
                      fontWeight: 800,
                      bgcolor: "rgba(124,58,237,0.12)",
                      color: "#6d28d9",
                    }}
                  />
                  <Typography
                    sx={{
                      fontSize: { xs: "2rem", md: "2.8rem" },
                      lineHeight: 1.02,
                      letterSpacing: -1.4,
                      fontWeight: 900,
                    }}
                  >
                    Visual boards that turn ticket movement into something the whole team can read instantly.
                  </Typography>
                  <Typography sx={{ color: "rgba(15,23,42,0.66)", lineHeight: 1.85 }}>
                    Use ticket-backed operational boards and manual freeform planning surfaces together, with drag-and-drop,
                    swimlanes, embedded activity, and realtime movement across the workspace.
                  </Typography>
                  <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1}>
                    {["Guided boards", "Realtime drag and drop", "Embedded history", "Swimlanes"].map((item) => (
                      <Chip
                        key={item}
                        icon={<BoltRounded sx={{ color: "inherit !important" }} />}
                        label={item}
                        sx={{
                          bgcolor: "rgba(255,255,255,0.84)",
                          border: "1px solid rgba(15,23,42,0.08)",
                          fontWeight: 700,
                        }}
                      />
                    ))}
                  </Stack>
                </Stack>
              </SectionReveal>
            </Grid>
          </Grid>
        </Box>

        <Box sx={{ pt: { xs: 6, md: 9 } }}>
          <SectionReveal>
            <Paper
              elevation={0}
              sx={{
                p: { xs: 3, md: 4 },
                borderRadius: 6,
                border: "1px solid rgba(15,23,42,0.08)",
                bgcolor: "rgba(255,255,255,0.78)",
                backdropFilter: "blur(14px)",
              }}
            >
              <Stack spacing={3}>
                <Box>
                  <Typography
                    sx={{
                      fontSize: { xs: "2rem", md: "2.8rem" },
                      lineHeight: 1.02,
                      letterSpacing: -1.4,
                      fontWeight: 900,
                    }}
                  >
                    Designed around the people actually using the service desk.
                  </Typography>
                  <Typography sx={{ mt: 1.2, color: "rgba(15,23,42,0.66)", lineHeight: 1.85, maxWidth: 780 }}>
                    Employees, agents, managers, and administrators all see the same platform through the lens of the
                    work they need to get done.
                  </Typography>
                </Box>

                <Grid container spacing={2.2}>
                  {roleCards.map((card, index) => (
                    <Grid item xs={12} sm={6} md={3} key={card.title}>
                      <MotionPaper
                        elevation={0}
                        initial={{ opacity: 0, y: 24 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, amount: 0.25 }}
                        transition={{ duration: 0.65, delay: index * 0.08 }}
                        whileHover={{ y: -8 }}
                        sx={{
                          height: "100%",
                          p: 2.4,
                          borderRadius: 4,
                          border: "1px solid rgba(15,23,42,0.08)",
                          backgroundColor: "rgba(255,255,255,0.9)",
                          position: "relative",
                          overflow: "hidden",
                        }}
                      >
                        <Box
                          sx={{
                            position: "absolute",
                            insetInline: 0,
                            top: 0,
                            height: 4,
                            bgcolor: card.accent,
                          }}
                        />
                        <Typography sx={{ fontWeight: 850, fontSize: "1.08rem", mb: 1.1 }}>{card.title}</Typography>
                        <Typography sx={{ color: "rgba(15,23,42,0.66)", lineHeight: 1.74 }}>{card.body}</Typography>
                      </MotionPaper>
                    </Grid>
                  ))}
                </Grid>
              </Stack>
            </Paper>
          </SectionReveal>
        </Box>

        <Box sx={{ pt: { xs: 6, md: 9 } }}>
          <SectionReveal>
            <Stack spacing={3}>
              <Box>
                <Chip
                  label="Flow"
                  sx={{
                    mb: 1.5,
                    fontWeight: 800,
                    bgcolor: "rgba(37,99,235,0.1)",
                    color: "#1d4ed8",
                  }}
                />
                <Typography
                  sx={{
                    fontSize: { xs: "2rem", md: "2.8rem" },
                    lineHeight: 1.02,
                    letterSpacing: -1.4,
                    fontWeight: 900,
                  }}
                >
                  From request to resolution without losing the operational thread.
                </Typography>
              </Box>
              <Grid container spacing={2.2}>
                {workflowSteps.map((item, index) => (
                  <Grid item xs={12} md={3} key={item.step}>
                    <MotionPaper
                      elevation={0}
                      initial={{ opacity: 0, y: 24 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, amount: 0.25 }}
                      transition={{ duration: 0.65, delay: index * 0.08 }}
                      sx={{
                        height: "100%",
                        p: 2.6,
                        borderRadius: 4,
                        border: "1px solid rgba(15,23,42,0.08)",
                        bgcolor: "rgba(255,255,255,0.84)",
                      }}
                    >
                      <Typography sx={{ color: "#2563eb", fontWeight: 900, fontSize: "0.96rem", mb: 1.4 }}>
                        {item.step}
                      </Typography>
                      <Typography sx={{ fontWeight: 850, fontSize: "1.08rem", mb: 1 }}>{item.title}</Typography>
                      <Typography sx={{ color: "rgba(15,23,42,0.66)", lineHeight: 1.78 }}>{item.body}</Typography>
                    </MotionPaper>
                  </Grid>
                ))}
              </Grid>
            </Stack>
          </SectionReveal>
        </Box>

        <SectionReveal delay={0.06}>
          <Paper
            elevation={0}
            sx={{
              mt: { xs: 6, md: 8 },
              p: { xs: 3, md: 4.5 },
              borderRadius: 6,
              border: "1px solid rgba(15,23,42,0.08)",
              background:
                "linear-gradient(135deg, rgba(15,23,42,0.98) 0%, rgba(30,64,175,0.98) 54%, rgba(15,118,110,0.96) 100%)",
              color: "white",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <MotionBox
              aria-hidden
              animate={prefersReducedMotion ? {} : { scale: [1, 1.06, 1], opacity: [0.28, 0.42, 0.28] }}
              transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
              sx={{
                position: "absolute",
                top: -120,
                right: -80,
                width: 360,
                height: 360,
                borderRadius: "50%",
                background: "radial-gradient(circle, rgba(255,255,255,0.18), rgba(255,255,255,0))",
              }}
            />

            <Grid container spacing={3} alignItems="center" sx={{ position: "relative", zIndex: 1 }}>
              <Grid item xs={12} md={8}>
                <Typography
                  sx={{
                    fontSize: { xs: "2rem", md: "3rem" },
                    lineHeight: 0.98,
                    letterSpacing: -1.6,
                    fontWeight: 900,
                    maxWidth: 780,
                  }}
                >
                  Ready to show a helpdesk that feels modern before the first ticket is even raised?
                </Typography>
                <Typography sx={{ mt: 1.4, color: "rgba(255,255,255,0.8)", lineHeight: 1.82, maxWidth: 780 }}>
                  Launch the demo workspace for your college presentation, or register an organization to show the full
                  SaaS onboarding path from setup to service operations.
                </Typography>
                <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1} sx={{ mt: 2.2 }}>
                  {["AI-assisted intake", "Visual boards", "Realtime status", "Audit-ready governance"].map((item) => (
                    <Chip
                      key={item}
                      label={item}
                      sx={{
                        color: "white",
                        bgcolor: "rgba(255,255,255,0.12)",
                        border: "1px solid rgba(255,255,255,0.16)",
                        fontWeight: 700,
                      }}
                    />
                  ))}
                </Stack>
              </Grid>
              <Grid item xs={12} md={4}>
                <Stack spacing={1.2}>
                  <Button
                    fullWidth
                    variant="contained"
                    onClick={launchDemo}
                    disabled={demoLaunching}
                    sx={{
                      borderRadius: 999,
                      py: 1.45,
                      fontWeight: 800,
                      textTransform: "none",
                      bgcolor: "white",
                      color: "#0f172a",
                      boxShadow: "0 18px 36px rgba(15,23,42,0.22)",
                      "&:hover": { bgcolor: "#e2e8f0" },
                    }}
                  >
                    {demoLaunching ? "Preparing demo..." : "Launch demo workspace"}
                  </Button>
                  <Button
                    component={RouterLink}
                    to="/register-organization"
                    fullWidth
                    variant="outlined"
                    endIcon={<ArrowOutwardRounded />}
                    sx={{
                      borderRadius: 999,
                      py: 1.35,
                      fontWeight: 800,
                      textTransform: "none",
                      color: "white",
                      borderColor: "rgba(255,255,255,0.22)",
                    }}
                  >
                    Register organization
                  </Button>
                </Stack>
              </Grid>
            </Grid>
          </Paper>
        </SectionReveal>

        <Box sx={{ pt: 4, pb: 1.5 }}>
          <Typography variant="body2" sx={{ color: "rgba(15,23,42,0.54)" }}>
            Copyright {new Date().getFullYear()} QueryLinker. Built for modern internal IT operations.
          </Typography>
        </Box>
      </Container>
    </Box>
  );
};
