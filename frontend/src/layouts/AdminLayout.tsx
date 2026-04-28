import React from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  AppBar,
  Box,
  Button,
  Chip,
  CssBaseline,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import {
  Assessment as ReportsIcon,
  AutoAwesome as KbSuggestionsIcon,
  Build as AutoFixIcon,
  Dashboard as DashboardIcon,
  FactCheck as ApprovalsIcon,
  Groups as TeamsIcon,
  HelpOutline as HelpIcon,
  Insights as CommandCenterIcon,
  KeyboardArrowDownRounded as ArrowDownIcon,
  KeyboardCommandKeyRounded as ShortcutsIcon,
  MenuRounded as MenuIcon,
  People as UsersIcon,
  Schedule as ScheduleIcon,
  SearchOffRounded as EmptyIcon,
  Security as AuditIcon,
  Settings as SettingsIcon,
  Speed as SlaIcon,
  SupportAgent as TicketsIcon,
  ViewKanbanRounded as BoardsIcon,
  AccountTree as WorkflowBuilderIcon,
} from "@mui/icons-material";
import { useAuth } from "../services/auth";
import { api } from "../services/api";
import { ChatWidget } from "../components/chatbot/ChatWidget";
import { CommandMenu } from "../components/CommandMenu";
import { UserMenu } from "../components/UserMenu";
import { OfflineIndicator } from "../components/OfflineIndicator";
import { NotificationCenter } from "../components/notifications/NotificationCenter";
import { DemoRoleSwitcher } from "../components/DemoRoleSwitcher";

const shellTopBarHeight = 86;
const mobileDrawerWidth = 310;

type NavItem = {
  text: string;
  path: string;
  icon: React.ReactNode;
  roles?: Array<"ADMIN" | "MANAGER" | "AGENT">;
};

type NavGroup = {
  key: string;
  label: string;
  items: NavItem[];
};

const allGroups: NavGroup[] = [
  {
    key: "overview",
    label: "Overview",
    items: [
      { text: "Dashboard", path: "/admin/dashboard", icon: <DashboardIcon />, roles: ["ADMIN"] },
      { text: "Manager View", path: "/admin/manager", icon: <DashboardIcon />, roles: ["MANAGER"] },
      { text: "Agent View", path: "/admin/agent-dashboard", icon: <DashboardIcon />, roles: ["AGENT"] },
      { text: "Reports", path: "/admin/reports", icon: <ReportsIcon />, roles: ["ADMIN", "MANAGER", "AGENT"] },
    ],
  },
  {
    key: "service-desk",
    label: "Service Desk",
    items: [
      { text: "Tickets", path: "/admin/tickets", icon: <TicketsIcon />, roles: ["ADMIN", "AGENT"] },
      { text: "Approvals", path: "/admin/approvals", icon: <ApprovalsIcon />, roles: ["MANAGER"] },
      { text: "SLA Monitor", path: "/admin/sla", icon: <SlaIcon />, roles: ["ADMIN", "MANAGER"] },
      { text: "Schedule", path: "/admin/schedule", icon: <ScheduleIcon />, roles: ["ADMIN", "MANAGER", "AGENT"] },
    ],
  },
  {
    key: "workspaces",
    label: "Workspaces",
    items: [
      { text: "Boards", path: "/admin/boards", icon: <BoardsIcon />, roles: ["ADMIN", "MANAGER", "AGENT"] },
      { text: "Workflow Builder", path: "/admin/workflow", icon: <WorkflowBuilderIcon />, roles: ["ADMIN"] },
      { text: "Command Center", path: "/admin/command-center", icon: <CommandCenterIcon />, roles: ["ADMIN"] },
    ],
  },
  {
    key: "governance",
    label: "Governance",
    items: [
      { text: "Audit Logs", path: "/admin/audit", icon: <AuditIcon />, roles: ["ADMIN"] },
      { text: "AI KB Suggestions", path: "/admin/kb-suggestions", icon: <KbSuggestionsIcon />, roles: ["ADMIN"] },
      { text: "AutoFix Catalog", path: "/admin/autofix", icon: <AutoFixIcon />, roles: ["ADMIN"] },
    ],
  },
  {
    key: "organization",
    label: "Organization",
    items: [
      { text: "Users", path: "/admin/users", icon: <UsersIcon />, roles: ["ADMIN", "MANAGER"] },
      { text: "Teams", path: "/admin/teams", icon: <TeamsIcon />, roles: ["ADMIN", "MANAGER"] },
      { text: "Settings", path: "/admin/settings", icon: <SettingsIcon />, roles: ["ADMIN"] },
    ],
  },
  {
    key: "resources",
    label: "Resources",
    items: [
      { text: "Help", path: "/admin/help", icon: <HelpIcon />, roles: ["ADMIN", "MANAGER", "AGENT"] },
      { text: "Shortcuts", path: "/admin/shortcuts", icon: <ShortcutsIcon />, roles: ["ADMIN", "MANAGER", "AGENT"] },
    ],
  },
];

export const AdminLayout: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [menuAnchorEl, setMenuAnchorEl] = React.useState<HTMLElement | null>(null);
  const [activeGroupKey, setActiveGroupKey] = React.useState<string | null>(null);
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const role = user?.role as "ADMIN" | "MANAGER" | "AGENT" | undefined;
  const roleLabel = role === "ADMIN" ? "Admin" : role === "MANAGER" ? "Manager" : "Agent";
  const isWorkflowRoute = location.pathname.startsWith("/admin/workflow");

  React.useEffect(() => {
    const prefetch = () => {
      const loads: Array<Promise<unknown>> = [];
      if (role === "ADMIN") {
        loads.push(
          api.get("/tickets", { params: { limit: 200, offset: 0 }, headers: { "x-cache-ttl": "60000" } }),
          api.get("/analytics/sla-risk", { headers: { "x-cache-ttl": "60000" } }),
          api.get("/analytics/trends", { headers: { "x-cache-ttl": "60000" } }),
          api.get("/analytics/root-causes", { headers: { "x-cache-ttl": "60000" } }),
          api.get("/analytics/agent-workload", { headers: { "x-cache-ttl": "60000" } }),
          api.get("/approvals", { params: { limit: 25, offset: 0 }, headers: { "x-cache-ttl": "60000" } }),
        );
      } else if (role === "MANAGER") {
        loads.push(
          api.get("/tickets", { params: { limit: 200, offset: 0 }, headers: { "x-cache-ttl": "60000" } }),
          api.get("/analytics/sla-risk", { headers: { "x-cache-ttl": "60000" } }),
          api.get("/analytics/trends", { headers: { "x-cache-ttl": "60000" } }),
          api.get("/analytics/agent-workload", { headers: { "x-cache-ttl": "60000" } }),
          api.get("/approvals", { params: { limit: 25, offset: 0 }, headers: { "x-cache-ttl": "60000" } }),
        );
      } else if (role === "AGENT") {
        loads.push(api.get("/tickets", { params: { limit: 100, offset: 0 }, headers: { "x-cache-ttl": "60000" } }));
      }
      if (loads.length) void Promise.allSettled(loads);
    };

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(prefetch);
    } else {
      setTimeout(prefetch, 500);
    }
  }, [role]);

  const navGroups = React.useMemo(() => {
    return allGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.roles || (role ? item.roles.includes(role) : false)),
      }))
      .filter((group) => group.items.length > 0);
  }, [role]);

  const activeMenuGroup = React.useMemo(
    () => navGroups.find((group) => group.key === activeGroupKey) || null,
    [activeGroupKey, navGroups]
  );

  const isRouteActive = React.useCallback(
    (path: string) => {
      if (path === "/admin/dashboard") return location.pathname === "/admin/dashboard";
      if (path === "/admin/manager") return location.pathname === "/admin/manager";
      if (path === "/admin/agent-dashboard") return location.pathname === "/admin/agent-dashboard";
      return location.pathname.startsWith(path);
    },
    [location.pathname]
  );

  const isGroupActive = React.useCallback(
    (group: NavGroup) => group.items.some((item) => isRouteActive(item.path)),
    [isRouteActive]
  );

  const openGroupMenu = (groupKey: string, anchor: HTMLElement) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setActiveGroupKey(groupKey);
    setMenuAnchorEl(anchor);
  };

  const scheduleCloseGroupMenu = React.useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = setTimeout(() => {
      setActiveGroupKey(null);
      setMenuAnchorEl(null);
      closeTimerRef.current = null;
    }, 120);
  }, []);

  const cancelScheduledClose = React.useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const closeGroupMenu = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setActiveGroupKey(null);
    setMenuAnchorEl(null);
  };

  React.useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const renderMobileNavigation = () => (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "rgba(255,255,255,0.82)", backdropFilter: "blur(20px)" }}>
      <Toolbar sx={{ minHeight: shellTopBarHeight }} />
      <Box sx={{ px: 2, pb: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800, color: "text.secondary" }}>
          Navigation
        </Typography>
      </Box>
      <Divider />
      <Box sx={{ overflowY: "auto", flex: 1, py: 1 }}>
        {navGroups.map((group) => (
          <Box key={group.key} sx={{ mb: 1.5 }}>
            <Typography variant="overline" sx={{ px: 2, color: "text.secondary", fontWeight: 800 }}>
              {group.label}
            </Typography>
            <List dense sx={{ py: 0.5 }}>
              {group.items.map((item) => (
                <ListItemButton
                  key={item.path}
                  selected={isRouteActive(item.path)}
                  onClick={() => {
                    navigate(item.path);
                    setMobileOpen(false);
                  }}
                  sx={{
                    mx: 1.25,
                    mb: 0.5,
                    borderRadius: 2.5,
                    minHeight: 48,
                    color: isRouteActive(item.path) ? "primary.main" : "text.primary",
                    "&.Mui-selected": {
                      bgcolor: alpha("#2563EB", 0.12),
                      "&:hover": { bgcolor: alpha("#2563EB", 0.16) },
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}>{item.icon}</ListItemIcon>
                  <ListItemText primary={item.text} primaryTypographyProps={{ fontWeight: 700 }} />
                </ListItemButton>
              ))}
            </List>
          </Box>
        ))}
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", bgcolor: "#f8fafc", minHeight: "100vh" }}>
      <CssBaseline />

      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          zIndex: (theme) => theme.zIndex.drawer + 1,
          bgcolor: isWorkflowRoute ? "rgba(255,255,255,0.56)" : "rgba(255,255,255,0.68)",
          color: "text.primary",
          borderBottom: "1px solid",
          borderColor: alpha("#CBD5E1", 0.48),
          backdropFilter: "blur(20px) saturate(180%)",
          boxShadow: "0 16px 40px rgba(15, 23, 42, 0.08)",
        }}
      >
        <Toolbar sx={{ minHeight: shellTopBarHeight, gap: 2 }}>
          <IconButton
            color="inherit"
            edge="start"
            onClick={() => setMobileOpen(true)}
            sx={{
              bgcolor: "rgba(255,255,255,0.52)",
              borderRadius: 1.5,
              backdropFilter: "blur(12px)",
              display: { xs: "inline-flex", lg: "none" },
            }}
          >
            <MenuIcon />
          </IconButton>

          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0, flexShrink: 0 }}>
            <Box
              component="img"
              src="/assets/branding/querylinker-logo.png"
              alt="QueryLinker"
              sx={{
                height: { xs: 42, sm: 52 },
                width: "auto",
                objectFit: "contain",
                display: "block",
                filter: "drop-shadow(0 10px 18px rgba(37, 99, 235, 0.08))",
              }}
            />
            <Chip
              size="small"
              label={roleLabel}
              sx={{
                ml: 0.25,
                bgcolor: "rgba(255,255,255,0.62)",
                color: "text.primary",
                fontWeight: 700,
                backdropFilter: "blur(12px)",
              }}
            />
          </Box>

          <Box
            sx={{
              display: { xs: "none", lg: "flex" },
              alignItems: "center",
              gap: 0.75,
              minWidth: 0,
              flex: 1,
              overflowX: "auto",
              px: 1,
              "&::-webkit-scrollbar": { display: "none" },
              scrollbarWidth: "none",
            }}
          >
            {navGroups.map((group) => (
              <Box
                key={group.key}
                onMouseEnter={(event) => openGroupMenu(group.key, event.currentTarget as HTMLElement)}
                onMouseLeave={scheduleCloseGroupMenu}
                sx={{ display: "flex", alignItems: "center" }}
              >
                <Button
                  onClick={(event) => openGroupMenu(group.key, event.currentTarget)}
                  endIcon={<ArrowDownIcon sx={{ fontSize: 18 }} />}
                  sx={{
                    borderRadius: 999,
                    px: 1.75,
                    py: 0.9,
                    textTransform: "none",
                    whiteSpace: "nowrap",
                    fontWeight: 700,
                    color: isGroupActive(group) ? "primary.main" : "text.primary",
                    bgcolor: isGroupActive(group) ? alpha("#2563EB", 0.12) : "transparent",
                    "&:hover": {
                      bgcolor: isGroupActive(group) ? alpha("#2563EB", 0.16) : alpha("#0F172A", 0.04),
                    },
                  }}
                >
                  {group.label}
                </Button>
              </Box>
            ))}
          </Box>

          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
            <DemoRoleSwitcher />
            <NotificationCenter />
            <UserMenu />
          </Box>
        </Toolbar>
      </AppBar>

      <Menu
        anchorEl={menuAnchorEl}
        open={Boolean(menuAnchorEl && activeMenuGroup)}
        onClose={closeGroupMenu}
        keepMounted
        disableAutoFocusItem
        disableScrollLock
        transitionDuration={120}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        sx={{ pointerEvents: "none" }}
        MenuListProps={{
          onMouseEnter: cancelScheduledClose,
          onMouseLeave: scheduleCloseGroupMenu,
        }}
        PaperProps={{
          onMouseEnter: cancelScheduledClose,
          onMouseLeave: scheduleCloseGroupMenu,
          sx: {
            mt: 1.25,
            minWidth: 260,
            borderRadius: 3,
            border: "1px solid",
            borderColor: alpha("#CBD5E1", 0.42),
            bgcolor: "rgba(255,255,255,0.88)",
            backdropFilter: "blur(20px)",
            boxShadow: "0 28px 60px rgba(15, 23, 42, 0.14)",
            overflow: "hidden",
            pointerEvents: "auto",
          },
        }}
      >
        {activeMenuGroup ? (
          <Box>
            <Box sx={{ px: 2, py: 1.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                {activeMenuGroup.label}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Open the right workspace without giving up canvas space.
              </Typography>
            </Box>
            <Divider />
            {activeMenuGroup.items.map((item) => (
              <MenuItem
                key={item.path}
                selected={isRouteActive(item.path)}
                onClick={() => {
                  navigate(item.path);
                  closeGroupMenu();
                }}
                sx={{
                  gap: 1.25,
                  py: 1.2,
                  color: isRouteActive(item.path) ? "primary.main" : "text.primary",
                  "&.Mui-selected": {
                    bgcolor: alpha("#2563EB", 0.1),
                  },
                }}
              >
                <Box sx={{ display: "grid", placeItems: "center", color: "inherit" }}>{item.icon}</Box>
                <ListItemText
                  primary={item.text}
                  primaryTypographyProps={{ fontWeight: 700, fontSize: 14 }}
                />
              </MenuItem>
            ))}
          </Box>
        ) : (
          <MenuItem disabled>
            <ListItemIcon>
              <EmptyIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="No menu available" />
          </MenuItem>
        )}
      </Menu>

      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: "block", lg: "none" },
          [`& .MuiDrawer-paper`]: {
            width: mobileDrawerWidth,
            borderRight: "1px solid",
            borderColor: alpha("#CBD5E1", 0.42),
            bgcolor: "transparent",
            boxShadow: "none",
          },
        }}
      >
        {renderMobileNavigation()}
      </Drawer>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: "100%",
          p: location.pathname.startsWith("/admin/workflow/studio") ? { xs: 1, sm: 1.5 } : { xs: 2, sm: 3 },
          overflowX: "hidden",
        }}
      >
        <Box sx={{ height: shellTopBarHeight }} />
        <Outlet />
        <ChatWidget audienceRole={user?.role} />
        <CommandMenu />
        <OfflineIndicator />
      </Box>
    </Box>
  );
};
