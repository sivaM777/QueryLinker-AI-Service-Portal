import { Command } from "cmdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen,
  FileText,
  LayoutDashboard,
  Link2,
  LogOut,
  Plus,
  Search,
  Settings,
  Ticket,
  Users,
  Columns3,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Box, Chip, Divider, InputBase, Paper, Typography } from "@mui/material";
import { api } from "../services/api";
import { useAuth } from "../services/auth";
import { SearchResultItem } from "../services/ticketProductivity";

type CommandItem = {
  id: string;
  title: string;
  description?: string;
  type: "search" | "nav" | "action" | "jump";
  icon: React.ReactNode;
  onSelect: () => void;
  badge?: string;
};

const quickJumpDefinitions = [
  {
    command: "ticket.list",
    label: "Open Ticket List",
    description: "Jump to the main queue",
    resolvePath: (role: string | undefined) => (role === "EMPLOYEE" ? "/app/tickets" : "/admin/tickets"),
  },
  {
    command: "ticket.form",
    label: "Create Ticket",
    description: "Open a new ticket form",
    resolvePath: (role: string | undefined) => (role === "EMPLOYEE" ? "/app/create-ticket" : "/admin/tickets"),
  },
  {
    command: "problem.list",
    label: "Problem Queue",
    description: "Open problems filtered from tickets",
    resolvePath: () => "/admin/tickets",
    defaultFilters: { type: "PROBLEM" },
  },
  {
    command: "change.list",
    label: "Change Queue",
    description: "Open changes filtered from tickets",
    resolvePath: () => "/admin/tickets",
    defaultFilters: { type: "CHANGE" },
  },
  {
    command: "user.list",
    label: "Open Users",
    description: "Open the people workspace",
    resolvePath: () => "/admin/users",
  },
  {
    command: "team.list",
    label: "Open Teams",
    description: "Open the team workspace",
    resolvePath: () => "/admin/teams",
  },
];

const kbResultPath = (role: string | undefined, result: SearchResultItem) => {
  const rawUrl = result.url || "";
  if (rawUrl.startsWith("/app/kb/")) {
    return role === "EMPLOYEE" ? rawUrl : rawUrl.replace("/app/kb/", "/admin/help?article=");
  }
  if (result.metadata?.article_id && typeof result.metadata.article_id === "string") {
    return role === "EMPLOYEE"
      ? `/app/kb/${result.metadata.article_id}`
      : `/admin/help?article=${result.metadata.article_id}`;
  }
  return role === "EMPLOYEE" ? "/app/kb" : "/admin/help";
};

export function CommandMenu() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  useEffect(() => {
    if (!open || !search.trim()) {
      setResults([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await api.get<{ query: string; items: SearchResultItem[] }>("/search/global", {
          params: { q: search.trim(), limit: 12 },
        });
        setResults(response.data.items || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);

    return () => window.clearTimeout(timer);
  }, [open, search]);

  const openInNewTab = useCallback((path: string) => {
    window.open(path, "_blank", "noopener,noreferrer");
  }, []);

  const handleResultSelect = useCallback(
    (item: SearchResultItem) => {
      setOpen(false);
      setSearch("");
      if (item.entity === "ticket") {
        navigate(user?.role === "EMPLOYEE" ? `/app/tickets/${item.id}` : `/admin/tickets/${item.id}`);
        return;
      }
      if (item.entity === "kb_article") {
        navigate(kbResultPath(user?.role, item));
        return;
      }
      if (item.entity === "attachment" && item.metadata?.ticket_id && typeof item.metadata.ticket_id === "string") {
        navigate(user?.role === "EMPLOYEE" ? `/app/tickets/${item.metadata.ticket_id}` : `/admin/tickets/${item.metadata.ticket_id}`);
        return;
      }
      if (item.entity === "canned_response") {
        navigate(user?.role === "EMPLOYEE" ? "/app/help" : "/admin/kb-suggestions");
      }
    },
    [navigate, user?.role]
  );

  const quickJumpItems = useMemo<CommandItem[]>(() => {
    const normalized = search.trim().toLowerCase();
    return quickJumpDefinitions
      .filter((definition) => !normalized || definition.command.includes(normalized) || definition.label.toLowerCase().includes(normalized))
      .map((definition) => {
        const path = definition.resolvePath(user?.role);
        const query = definition.defaultFilters ? `?${new URLSearchParams(definition.defaultFilters).toString()}` : "";
        const finalPath = `${path}${query}`;
        return {
          id: `jump:${definition.command}`,
          title: definition.label,
          description: definition.command,
          type: "jump",
          badge: "Quick Jump",
          icon: <Link2 size={18} />,
          onSelect: () => {
            setOpen(false);
            setSearch("");
            navigate(finalPath);
          },
        };
      });
  }, [navigate, search, user?.role]);

  const navigationItems = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [
      {
        id: "nav:dashboard",
        title: "Dashboard",
        description: "Open the main console",
        type: "nav",
        icon: <LayoutDashboard size={18} />,
        onSelect: () => navigate(user?.role === "EMPLOYEE" ? "/app" : user?.role === "AGENT" ? "/admin/agent-dashboard" : user?.role === "MANAGER" ? "/admin/manager" : "/admin/dashboard"),
      },
      {
        id: "nav:tickets",
        title: "Tickets",
        description: "Open the ticket list",
        type: "nav",
        icon: <Ticket size={18} />,
        onSelect: () => navigate(user?.role === "EMPLOYEE" ? "/app/tickets" : "/admin/tickets"),
      },
      {
        id: "nav:knowledge",
        title: "Knowledge Base",
        description: "Browse documentation",
        type: "nav",
        icon: <BookOpen size={18} />,
        onSelect: () => navigate(user?.role === "EMPLOYEE" ? "/app/kb" : "/admin/help"),
      },
    ];

    if (user?.role && user.role !== "EMPLOYEE") {
      items.push({
        id: "nav:boards",
        title: "Boards",
        description: "Open the visual task boards workspace",
        type: "nav",
        icon: <Columns3 size={18} />,
        onSelect: () => navigate("/admin/boards"),
      });
      items.push({
        id: "nav:users",
        title: "Users",
        description: "Open people and roles",
        type: "nav",
        icon: <Users size={18} />,
        onSelect: () => navigate("/admin/users"),
      });
    }

    return items;
  }, [navigate, user?.role]);

  const actionItems = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [
      {
        id: "action:create-ticket",
        title: "Create New Ticket",
        description: "Start a fresh request",
        type: "action",
        icon: <Plus size={18} />,
        onSelect: () => navigate(user?.role === "EMPLOYEE" ? "/app/create-ticket" : "/admin/tickets"),
      },
      {
        id: "action:open-list-new-tab",
        title: "Open List in New Tab",
        description: "Keep your current page where it is",
        type: "action",
        icon: <Ticket size={18} />,
        onSelect: () => openInNewTab(user?.role === "EMPLOYEE" ? "/app/tickets" : "/admin/tickets"),
      },
      {
        id: "action:settings",
        title: "Settings",
        description: "Open portal settings",
        type: "action",
        icon: <Settings size={18} />,
        onSelect: () => navigate(user?.role === "EMPLOYEE" ? "/app/profile" : "/admin/settings"),
      },
      {
        id: "action:logout",
        title: "Log Out",
        description: "End the current session",
        type: "action",
        icon: <LogOut size={18} />,
        onSelect: () => logout(),
      },
    ];

    return items;
  }, [logout, navigate, openInNewTab, user?.role]);

  const renderCommandItem = (item: CommandItem) => (
    <Command.Item key={item.id} value={item.title} onSelect={item.onSelect} asChild>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          px: 1.5,
          py: 1.25,
          borderRadius: 2,
          cursor: "pointer",
          transition: "background-color 0.15s ease",
          "&[data-selected='true']": {
            backgroundColor: "rgba(37, 99, 235, 0.08)",
          },
          "&:hover": {
            backgroundColor: "rgba(37, 99, 235, 0.08)",
          },
        }}
      >
        <Box
          sx={{
            width: 34,
            height: 34,
            borderRadius: 2,
            display: "grid",
            placeItems: "center",
            bgcolor: "rgba(15, 23, 42, 0.05)",
            color: "text.secondary",
            flexShrink: 0,
          }}
        >
          {item.icon}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {item.title}
          </Typography>
          {item.description ? (
            <Typography variant="caption" color="text.secondary" noWrap>
              {item.description}
            </Typography>
          ) : null}
        </Box>
        {item.badge ? <Chip size="small" label={item.badge} /> : null}
      </Box>
    </Command.Item>
  );

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        style={{ position: "fixed", inset: 0, zIndex: 1300 }}
      >
        <Box
          onClick={() => setOpen(false)}
          sx={{
            position: "fixed",
            inset: 0,
            bgcolor: "rgba(15, 23, 42, 0.44)",
            backdropFilter: "blur(6px)",
          }}
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: -12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -12 }}
          transition={{ duration: 0.15 }}
          style={{
            position: "fixed",
            top: "12vh",
            left: "50%",
            transform: "translateX(-50%)",
            width: "100%",
            maxWidth: "760px",
            padding: "0 16px",
          }}
        >
          <Paper
            elevation={24}
            sx={{
              borderRadius: 4,
              overflow: "hidden",
              border: "1px solid rgba(15, 23, 42, 0.08)",
            }}
          >
            <Command loop>
              <Box sx={{ display: "flex", alignItems: "center", px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
                <Search size={18} style={{ marginRight: 12, color: "#64748b" }} />
                <Command.Input value={search} onValueChange={setSearch} placeholder="Search tickets, articles, attachments, or type a quick jump like ticket.list" asChild>
                  <InputBase sx={{ flex: 1, "& input": { p: 0, fontSize: 16 } }} />
                </Command.Input>
                <Chip size="small" label="Esc" />
              </Box>

              <Command.List style={{ maxHeight: 460, overflow: "auto", padding: "10px" }}>
                {loading ? (
                  <Box sx={{ py: 4, textAlign: "center" }}>
                    <Typography color="text.secondary">Searching...</Typography>
                  </Box>
                ) : null}

                {!loading && search.trim() ? (
                  <>
                    {quickJumpItems.length ? (
                      <Command.Group heading="Quick Jump">
                        <Typography variant="caption" sx={{ px: 1.5, py: 0.75, display: "block", color: "text.secondary", fontWeight: 700 }}>
                          Quick Jump
                        </Typography>
                        {quickJumpItems.map(renderCommandItem)}
                      </Command.Group>
                    ) : null}

                    <Command.Group heading="Search Results">
                      <Typography variant="caption" sx={{ px: 1.5, py: 0.75, display: "block", color: "text.secondary", fontWeight: 700 }}>
                        Search Results
                      </Typography>
                      {results.length ? (
                        results.map((result) => (
                          <Command.Item key={`${result.entity}:${result.id}`} value={result.title} onSelect={() => handleResultSelect(result)} asChild>
                            <Box
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1.5,
                                px: 1.5,
                                py: 1.25,
                                borderRadius: 2,
                                cursor: "pointer",
                                "&[data-selected='true']": { backgroundColor: "rgba(37, 99, 235, 0.08)" },
                                "&:hover": { backgroundColor: "rgba(37, 99, 235, 0.08)" },
                              }}
                            >
                              <Box
                                sx={{
                                  width: 34,
                                  height: 34,
                                  borderRadius: 2,
                                  display: "grid",
                                  placeItems: "center",
                                  bgcolor: "rgba(15, 23, 42, 0.05)",
                                  color: "text.secondary",
                                }}
                              >
                                {result.entity === "ticket" ? (
                                  <Ticket size={18} />
                                ) : result.entity === "kb_article" ? (
                                  <BookOpen size={18} />
                                ) : result.entity === "attachment" ? (
                                  <FileText size={18} />
                                ) : (
                                  <FileText size={18} />
                                )}
                              </Box>
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                  {result.title}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" noWrap>
                                  {[result.subtitle, result.description].filter(Boolean).join(" - ")}
                                </Typography>
                              </Box>
                              <Chip size="small" label={result.entity.replace(/_/g, " ")} />
                            </Box>
                          </Command.Item>
                        ))
                      ) : (
                        <Command.Empty>
                          <Box sx={{ py: 4, textAlign: "center" }}>
                            <Typography>No results found.</Typography>
                          </Box>
                        </Command.Empty>
                      )}
                    </Command.Group>
                  </>
                ) : (
                  <>
                    <Command.Group heading="Navigation">
                      <Typography variant="caption" sx={{ px: 1.5, py: 0.75, display: "block", color: "text.secondary", fontWeight: 700 }}>
                        Navigation
                      </Typography>
                      {navigationItems.map(renderCommandItem)}
                    </Command.Group>
                    <Divider sx={{ my: 1 }} />
                    <Command.Group heading="Actions">
                      <Typography variant="caption" sx={{ px: 1.5, py: 0.75, display: "block", color: "text.secondary", fontWeight: 700 }}>
                        Quick Actions
                      </Typography>
                      {actionItems.map(renderCommandItem)}
                    </Command.Group>
                  </>
                )}
              </Command.List>

              <Divider />
              <Box sx={{ px: 2, py: 1.25, display: "flex", justifyContent: "space-between", alignItems: "center", bgcolor: "rgba(15, 23, 42, 0.02)" }}>
                <Typography variant="caption" color="text.secondary">
                  Ctrl/Cmd + K to open, Enter to run
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Quick jumps: ticket.list, ticket.form, problem.list, change.list
                </Typography>
              </Box>
            </Command>
          </Paper>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
