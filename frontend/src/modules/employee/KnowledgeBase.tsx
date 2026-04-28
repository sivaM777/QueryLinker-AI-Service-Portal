import React from "react";
import {
  Box,
  Typography,
  TextField,
  Card,
  CardContent,
  Grid,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Alert,
} from "@mui/material";
import { Search as SearchIcon } from "@mui/icons-material";
import { api, getApiErrorMessage, isCanceledError } from "../../services/api";

type KbListItem = {
  id: string;
  title: string;
  category: string;
  tags: string[];
  updated_at: string;
};

type KbArticle = {
  id: string;
  title: string;
  body: string;
  category: string;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export const KnowledgeBase: React.FC = () => {
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState("All");

  const [articles, setArticles] = React.useState<KbListItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const [open, setOpen] = React.useState(false);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [active, setActive] = React.useState<KbArticle | null>(null);
  const [activeLoading, setActiveLoading] = React.useState(false);
  const [activeError, setActiveError] = React.useState("");

  const [searchAnalyticsId, setSearchAnalyticsId] = React.useState<string | null>(null);
  const [feedbackSubmitting, setFeedbackSubmitting] = React.useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = React.useState<string>("");

  const categories = React.useMemo(() => {
    const set = new Set<string>();
    for (const a of articles) set.add(a.category);
    return ["All", ...Array.from(set).sort()];
  }, [articles]);

  React.useEffect(() => {
    const controller = new AbortController();

    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api.get<any>("/kb", {
          params: {
            q: query.trim() ? query.trim() : undefined,
            category: category === "All" ? undefined : category,
            limit: 50,
            track: query.trim() ? true : undefined,
          },
          signal: controller.signal,
        });

        if (res.data && typeof res.data === "object" && Array.isArray(res.data.items)) {
          setArticles(res.data.items || []);
          setSearchAnalyticsId(res.data.analyticsId || null);
        } else {
          setArticles(res.data || []);
          setSearchAnalyticsId(null);
        }
      } catch (e: unknown) {
        if (isCanceledError(e)) return;
        setError(getApiErrorMessage(e, "Failed to load articles"));
      } finally {
        setLoading(false);
      }
    };

    void run();
    return () => controller.abort();
  }, [query, category]);

  const viewArticle = async (id: string) => {
    setOpen(true);
    setActiveId(id);
    setActive(null);
    setActiveLoading(true);
    setActiveError("");
    setFeedbackSuccess("");
    try {
      if (searchAnalyticsId) {
        try {
          await api.post(`/kb/search-analytics/${searchAnalyticsId}/click`, { articleId: id });
        } catch {
          // best-effort
        }
      }

      const res = await api.get<KbArticle>(`/kb/${id}`);
      setActive(res.data);

      try {
        await api.post(`/kb/articles/${id}/track-view`);
      } catch {
        // best-effort
      }
    } catch (e: unknown) {
      setActiveError(getApiErrorMessage(e, "Failed to load article"));
    } finally {
      setActiveLoading(false);
    }
  };

  const submitFeedback = async (helpful: boolean) => {
    if (!active?.id) return;
    setFeedbackSubmitting(true);
    setFeedbackSuccess("");
    setActiveError("");
    try {
      await api.post(`/kb/articles/${active.id}/feedback`, { helpful });
      setFeedbackSuccess(helpful ? "Thanks — marked as helpful." : "Thanks — marked as not helpful.");
    } catch (e: unknown) {
      setActiveError(getApiErrorMessage(e, "Failed to submit feedback"));
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Knowledge Base
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: "flex", gap: 2, mb: 3 }}>
        <TextField
          placeholder="Search articles"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          InputProps={{
            startAdornment: <SearchIcon sx={{ mr: 1, color: "action.active" }} />,
          }}
          sx={{ minWidth: 300 }}
        />
        <TextField
          select
          label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          sx={{ minWidth: 180 }}
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </TextField>
      </Box>

      <Grid container spacing={2}>
        {articles.map((article) => (
          <Grid item xs={12} sm={6} md={4} key={article.id}>
            <Card variant="outlined" sx={{ height: "100%" }}>
              <CardContent>
                <Typography variant="subtitle1" gutterBottom>
                  {article.title}
                </Typography>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mt: 2 }}>
                  <Chip label={article.category} size="small" />
                  <Button size="small" onClick={() => void viewArticle(article.id)}>
                    View
                  </Button>
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                  Updated {new Date(article.updated_at).toLocaleDateString()}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {!loading && articles.length === 0 && (
        <Box sx={{ mt: 4, textAlign: "center" }}>
          <Typography color="text.secondary">No articles found.</Typography>
        </Box>
      )}

      {loading && (
        <Box sx={{ mt: 2, display: "flex", justifyContent: "center" }}>
          <CircularProgress size={22} />
        </Box>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>{active?.title || (activeId ? `Article ${activeId}` : "Article")}</DialogTitle>
        <DialogContent dividers>
          {activeError && <Alert severity="error">{activeError}</Alert>}
          {feedbackSuccess && <Alert severity="success" sx={{ mb: 1 }}>{feedbackSuccess}</Alert>}
          {activeLoading && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
              <CircularProgress size={22} />
            </Box>
          )}
          {active && (
            <Box>
              <Box sx={{ display: "flex", gap: 1, alignItems: "center", mb: 2 }}>
                <Chip label={active.category} size="small" />
                {active.tags?.slice(0, 5)?.map((t) => (
                  <Chip key={t} label={t} size="small" variant="outlined" />
                ))}
              </Box>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                {active.body}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Close</Button>
          <Button
            variant="outlined"
            disabled={!active || feedbackSubmitting}
            onClick={() => void submitFeedback(false)}
          >
            Not helpful
          </Button>
          <Button
            variant="contained"
            disabled={!active || feedbackSubmitting}
            onClick={() => void submitFeedback(true)}
          >
            Helpful
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
