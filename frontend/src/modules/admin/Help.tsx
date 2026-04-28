import React from "react";
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardActionArea,
  TextField,
  InputAdornment,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Divider,
  Button,
  Chip,
  Stack,
} from "@mui/material";
import {
  Search as SearchIcon,
  Description as ArticleIcon,
  QuestionAnswer as FaqIcon,
  SupportAgent as ContactIcon,
  Book as GuideIcon,
  OpenInNew as ExternalLinkIcon,
  DashboardCustomize as BoardsIcon,
  Schedule as ScheduleIcon,
  FactCheck as ApprovalIcon,
  Assessment as ReportsIcon,
  Speed as SlaIcon,
  Security as AuditIcon,
  AccountTree as WorkflowIcon,
  KeyboardCommandKey as ShortcutIcon,
  ConfirmationNumber as TicketIcon,
  AddCircleOutline as CreateTicketIcon,
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../services/auth";

type HelpItem = {
  title: string;
  description?: string;
  icon: React.ReactNode;
  path?: string;
  href?: string;
  external?: boolean;
};

const HelpCategoryCard: React.FC<HelpItem> = ({ icon, title, description, path, href, external }) => {
  const navigate = useNavigate();

  const handleClick = () => {
    if (external && href) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    if (path) navigate(path);
  };

  return (
    <Card sx={{ height: "100%", borderRadius: 4, border: "1px solid rgba(15,23,42,0.08)" }}>
      <CardActionArea sx={{ height: "100%", p: 3.5 }} onClick={handleClick}>
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 2 }}>
          <Box
            sx={{
              p: 2.2,
              borderRadius: "50%",
              bgcolor: "primary.light",
              color: "primary.main",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {icon}
          </Box>
          <Box>
            <Typography variant="h6" gutterBottom fontWeight={800}>
              {title}
            </Typography>
            {description ? (
              <Typography variant="body2" color="text.secondary">
                {description}
              </Typography>
            ) : null}
          </Box>
        </Box>
      </CardActionArea>
    </Card>
  );
};

const filterItems = (items: HelpItem[], query: string) => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return items;
  return items.filter((item) =>
    [item.title, item.description || ""].some((value) => value.toLowerCase().includes(normalized))
  );
};

export const Help: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = React.useState("");

  const role = user?.role ?? "EMPLOYEE";
  const isEmployee = role === "EMPLOYEE";
  const isAdmin = role === "ADMIN";
  const isManager = role === "MANAGER";

  const categoryCards = React.useMemo<HelpItem[]>(() => {
    if (isEmployee) {
      return [
        {
          icon: <GuideIcon fontSize="large" />,
          title: "Getting Started",
          description: "Learn the basics of submitting requests, following updates, and using the portal.",
          path: "/app/kb",
        },
        {
          icon: <TicketIcon fontSize="large" />,
          title: "My Tickets",
          description: "Track current requests, replies, status changes, and resolution history.",
          path: "/app/tickets",
        },
        {
          icon: <CreateTicketIcon fontSize="large" />,
          title: "Create a Request",
          description: "Start a new ticket with the right priority, attachments, and category.",
          path: "/app/create-ticket",
        },
      ];
    }

    return [
      {
        icon: <BoardsIcon fontSize="large" />,
        title: "Boards & Queues",
        description: "Manage operational work with ticket queues and visual task boards.",
        path: "/admin/boards",
      },
      {
        icon: <WorkflowIcon fontSize="large" />,
        title: "Workflow Studio",
        description: isAdmin
          ? "Design and automate approval, routing, and operational workflows."
          : "Review automation flows and understand how work is routed through the portal.",
        path: isAdmin ? "/admin/workflow" : "/admin/inbox",
      },
      {
        icon: <ShortcutIcon fontSize="large" />,
        title: "Guides & Shortcuts",
        description: "Quick navigation help, keyboard shortcuts, and operational best practices.",
        path: "/admin/shortcuts",
      },
    ];
  }, [isAdmin, isEmployee]);

  const faqItems = React.useMemo<HelpItem[]>(() => {
    if (isEmployee) {
      return [
        { title: "How do I reset my password?", path: "/app/kb", icon: <FaqIcon color="primary" /> },
        { title: "How do I attach screenshots to a request?", path: "/app/create-ticket", icon: <FaqIcon color="primary" /> },
        { title: "Where can I track my current request status?", path: "/app/tickets", icon: <FaqIcon color="primary" /> },
        { title: "How do I update my profile details?", path: "/app/profile", icon: <FaqIcon color="primary" /> },
      ];
    }

    if (isManager) {
      return [
        { title: "How do I approve or decline requests?", path: "/admin/approvals", icon: <FaqIcon color="primary" /> },
        { title: "Where can I review team workload and board movement?", path: "/admin/boards", icon: <FaqIcon color="primary" /> },
        { title: "How do I manage team schedules and time-off?", path: "/admin/schedule", icon: <FaqIcon color="primary" /> },
        { title: "Where can I review SLA exposure?", path: "/admin/sla", icon: <FaqIcon color="primary" /> },
      ];
    }

    if (role === "AGENT") {
      return [
        { title: "How do I move work across the board?", path: "/admin/boards", icon: <FaqIcon color="primary" /> },
        { title: "Where do I manage my assigned queue?", path: "/admin/tickets", icon: <FaqIcon color="primary" /> },
        { title: "How do I request time off?", path: "/admin/schedule", icon: <FaqIcon color="primary" /> },
        { title: "Where can I review reporting and trends?", path: "/admin/reports", icon: <FaqIcon color="primary" /> },
      ];
    }

    return [
      { title: "How do I review system audit activity?", path: "/admin/audit", icon: <FaqIcon color="primary" /> },
      { title: "Where can I build or update workflows?", path: "/admin/workflow", icon: <FaqIcon color="primary" /> },
      { title: "How do I manage boards and operational queues?", path: "/admin/boards", icon: <FaqIcon color="primary" /> },
      { title: "Where do I review SLA risk and command insights?", path: "/admin/sla", icon: <FaqIcon color="primary" /> },
    ];
  }, [isEmployee, isManager, role]);

  const resourceItems = React.useMemo<HelpItem[]>(() => {
    if (isEmployee) {
      return [
        { title: "Knowledge Base", path: "/app/kb", icon: <ArticleIcon fontSize="small" /> },
        { title: "Privacy Policy", path: "/privacy", icon: <ExternalLinkIcon fontSize="small" /> },
      ];
    }

    return [
      {
        title: "Keyboard Shortcuts",
        path: "/admin/shortcuts",
        icon: <ShortcutIcon fontSize="small" />,
      },
      {
        title: isAdmin ? "Audit Logs" : "Reports Workspace",
        path: isAdmin ? "/admin/audit" : "/admin/reports",
        icon: isAdmin ? <AuditIcon fontSize="small" /> : <ReportsIcon fontSize="small" />,
      },
      {
        title: "Terms of Service",
        path: "/terms",
        icon: <ExternalLinkIcon fontSize="small" />,
      },
    ];
  }, [isAdmin, isEmployee]);

  const filteredCards = React.useMemo(() => filterItems(categoryCards, searchQuery), [categoryCards, searchQuery]);
  const filteredFaqs = React.useMemo(() => filterItems(faqItems, searchQuery), [faqItems, searchQuery]);
  const filteredResources = React.useMemo(() => filterItems(resourceItems, searchQuery), [resourceItems, searchQuery]);

  const heroLabel = isEmployee
    ? "Search the knowledge base or jump straight into the actions you use every day."
    : "Open the right workspace quickly, review operational guides, or jump to the tools your role uses most.";

  const ctaTitle = isEmployee ? "Still need help?" : isManager ? "Need to take action?" : isAdmin ? "Open the operations flow" : "Continue your queue work";
  const ctaBody = isEmployee
    ? "Can't find what you're looking for? Raise a support request directly from the portal."
    : isManager
      ? "Go straight to approvals, schedules, and team operations without hunting through menus."
      : isAdmin
        ? "Move directly into boards, workflows, and oversight tools for the service desk."
        : "Open the active queue and continue work on tickets, boards, and responses.";
  const ctaPath = isEmployee
    ? "/app/create-ticket"
    : isManager
      ? "/admin/approvals"
      : isAdmin
        ? "/admin/boards"
        : "/admin/tickets";
  const ctaLabel = isEmployee ? "Create Support Request" : isManager ? "Review Approvals" : isAdmin ? "Open Boards" : "Open Ticket Queue";

  return (
    <Box sx={{ p: 3, maxWidth: 1280, margin: "0 auto" }}>
      <Box sx={{ textAlign: "center", mb: 6 }}>
        <Stack direction="row" spacing={1} justifyContent="center" sx={{ mb: 1.5 }}>
          <Chip label={role} color="primary" variant="outlined" />
          <Chip label={isEmployee ? "End-User Help" : "Operations Help"} variant="outlined" />
        </Stack>
        <Typography variant="h3" sx={{ fontWeight: 800, mb: 2 }}>
          How can we help you?
        </Typography>
        <Typography variant="h6" color="text.secondary" sx={{ mb: 4 }}>
          {heroLabel}
        </Typography>
        <TextField
          fullWidth
          placeholder={
            isEmployee
              ? "Search for tickets, account help, and request guidance..."
              : "Search for boards, approvals, workflows, reports, and more..."
          }
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          sx={{ maxWidth: 760 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon color="action" />
              </InputAdornment>
            ),
            sx: { borderRadius: 4, bgcolor: "background.paper" },
          }}
        />
      </Box>

      <Grid container spacing={3} sx={{ mb: 6 }}>
        {filteredCards.map((item) => (
          <Grid item xs={12} sm={6} md={4} key={item.title}>
            <HelpCategoryCard {...item} />
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={4}>
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3, borderRadius: 4, border: "1px solid rgba(15,23,42,0.08)" }}>
            <Typography variant="h5" sx={{ mb: 2, fontWeight: 800 }}>
              Frequently Asked Questions
            </Typography>
            <List>
              {filteredFaqs.map((faq, index) => (
                <React.Fragment key={faq.title}>
                  <ListItem disablePadding>
                    <ListItemButton onClick={() => faq.path && navigate(faq.path)}>
                      <ListItemIcon>{faq.icon}</ListItemIcon>
                      <ListItemText primary={faq.title} />
                    </ListItemButton>
                  </ListItem>
                  {index < filteredFaqs.length - 1 ? <Divider variant="inset" component="li" /> : null}
                </React.Fragment>
              ))}
            </List>
            <Box sx={{ mt: 2, textAlign: "center" }}>
              <Button variant="outlined" onClick={() => navigate(isEmployee ? "/app/kb" : "/admin/shortcuts")}>
                {isEmployee ? "Open Knowledge Base" : "Open Help Shortcuts"}
              </Button>
            </Box>
          </Paper>
        </Grid>

        <Grid item xs={12} md={4}>
          <Paper
            sx={{
              p: 3.5,
              borderRadius: 4,
              bgcolor: "primary.main",
              color: "primary.contrastText",
              boxShadow: "0 24px 48px rgba(37,99,235,0.22)",
            }}
          >
            <Typography variant="h5" sx={{ mb: 2, fontWeight: 800 }}>
              {ctaTitle}
            </Typography>
            <Typography variant="body1" sx={{ mb: 3, opacity: 0.92 }}>
              {ctaBody}
            </Typography>
            <Button
              variant="contained"
              color="secondary"
              fullWidth
              startIcon={<ContactIcon />}
              onClick={() => navigate(ctaPath)}
              sx={{ py: 1.4, fontWeight: 700 }}
            >
              {ctaLabel}
            </Button>
          </Paper>

          <Paper sx={{ p: 3, mt: 3, borderRadius: 4, border: "1px solid rgba(15,23,42,0.08)" }}>
            <Typography variant="h5" sx={{ mb: 2, fontWeight: 800 }}>
              Useful Links
            </Typography>
            <List dense>
              {filteredResources.map((resource) => (
                <ListItem disablePadding key={resource.title}>
                  <ListItemButton
                    onClick={() => {
                      if (resource.external && resource.href) {
                        window.open(resource.href, "_blank", "noopener,noreferrer");
                        return;
                      }
                      if (resource.path) navigate(resource.path);
                    }}
                  >
                    <ListItemIcon>{resource.icon}</ListItemIcon>
                    <ListItemText primary={resource.title} />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </Paper>

          {!isEmployee ? (
            <Paper sx={{ p: 3, mt: 3, borderRadius: 4, border: "1px solid rgba(15,23,42,0.08)" }}>
              <Typography variant="h6" sx={{ fontWeight: 800, mb: 1.5 }}>
                Quick access
              </Typography>
              <Stack spacing={1.25}>
                <Button startIcon={<BoardsIcon />} variant="outlined" onClick={() => navigate("/admin/boards")}>
                  Boards
                </Button>
                <Button startIcon={isManager ? <ApprovalIcon /> : isAdmin ? <WorkflowIcon /> : <ScheduleIcon />} variant="outlined" onClick={() => navigate(isManager ? "/admin/approvals" : isAdmin ? "/admin/workflow" : "/admin/schedule")}>
                  {isManager ? "Approvals" : isAdmin ? "Workflow Builder" : "Schedule"}
                </Button>
                <Button startIcon={isAdmin ? <SlaIcon /> : <ReportsIcon />} variant="outlined" onClick={() => navigate(isAdmin ? "/admin/sla" : "/admin/reports")}>
                  {isAdmin ? "SLA Monitor" : "Reports"}
                </Button>
              </Stack>
            </Paper>
          ) : null}
        </Grid>
      </Grid>
    </Box>
  );
};
