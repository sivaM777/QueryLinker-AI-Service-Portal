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
  Dashboard as DashboardIcon,
  HelpOutline as HelpIcon,
  KeyboardArrowDownRounded as ArrowDownIcon,
  KeyboardCommandKeyRounded as ShortcutsIcon,
  MenuRounded as MenuIcon,
  PersonOutlineRounded as ProfileIcon,
  Search as KnowledgeIcon,
  SupportAgent as TicketsIcon,
  AddTaskRounded as CreateTicketIcon,
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
const mobileDrawerWidth = 300;

type NavItem = {
  text: string;
  path: string;
  icon: React.ReactNode;
};

type NavGroup = {
  key: string;
  label: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    key: "overview",
    label: "Overview",
    items: [
      { text: "Dashboard", path: "/app", icon: <DashboardIcon /> },
      { text: "Reports", path: "/app/reports", icon: <ReportsIcon /> },
    ],
  },
  {
    key: "tickets",
    label: "Tickets",
    items: [
      { text: "Create Ticket", path: "/app/create-ticket", icon: <CreateTicketIcon /> },
      { text: "My Tickets", path: "/app/tickets", icon: <TicketsIcon /> },
    ],
  },
  {
    key: "knowledge",
    label: "Knowledge",
    items: [
      { text: "Knowledge Base", path: "/app/kb", icon: <KnowledgeIcon /> },
      { text: "Help", path: "/app/help", icon: <HelpIcon /> },
      { text: "Shortcuts", path: "/app/shortcuts", icon: <ShortcutsIcon /> },
    ],
  },
  {
    key: "account",
    label: "Account",
    items: [{ text: "Profile", path: "/app/profile", icon: <ProfileIcon /> }],
  },
];

export const EmployeeLayout: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [menuAnchorEl, setMenuAnchorEl] = React.useState<HTMLElement | null>(null);
  const [activeGroupKey, setActiveGroupKey] = React.useState<string | null>(null);
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const prefetch = () => {
      void Promise.allSettled([
        api.get("/tickets/my", { params: { limit: 50, offset: 0 }, headers: { "x-cache-ttl": "60000" } }),
        api.get("/kb/featured", { params: { limit: 12 }, headers: { "x-cache-ttl": "60000" } }),
        api.get("/kb/most-viewed", { params: { limit: 12 }, headers: { "x-cache-ttl": "60000" } }),
      ]);
    };
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(prefetch);
    } else {
      setTimeout(prefetch, 500);
    }
  }, []);

  const activeMenuGroup = React.useMemo(
    () => navGroups.find((group) => group.key === activeGroupKey) || null,
    [activeGroupKey]
  );

  const isRouteActive = React.useCallback(
    (path: string) => {
      if (path === "/app") return location.pathname === "/app";
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
          bgcolor: "rgba(255,255,255,0.68)",
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

          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, flexShrink: 0, minWidth: 0 }}>
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
              label="Employee"
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
            minWidth: 250,
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
        {activeMenuGroup?.items.map((item) => (
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
              "&.Mui-selected": { bgcolor: alpha("#2563EB", 0.1) },
            }}
          >
            <Box sx={{ display: "grid", placeItems: "center", color: "inherit" }}>{item.icon}</Box>
            <ListItemText primary={item.text} primaryTypographyProps={{ fontWeight: 700, fontSize: 14 }} />
          </MenuItem>
        ))}
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

      <Box component="main" sx={{ flexGrow: 1, width: "100%", p: { xs: 2, sm: 3 }, overflowX: "hidden" }}>
        <Box sx={{ height: shellTopBarHeight }} />
        <Outlet />
        <ChatWidget audienceRole={user?.role} />
        <CommandMenu />
        <OfflineIndicator />
      </Box>
    </Box>
  );
};
