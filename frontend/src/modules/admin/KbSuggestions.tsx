import React from "react";
import { Box, Typography, Card, CardContent, Button, Alert, Stack, Divider, TextField, Chip } from "@mui/material";
import { api, getApiErrorMessage } from "../../services/api";

type Suggestion = {
  id: string;
  pattern: string;
  frequency: number;
  suggested_title: string;
  suggested_body: string;
  related_ticket_ids: string[];
  status: string;
  created_at: string;
};

type DraftById = Record<
  string,
  {
    title: string;
    body: string;
    category: string;
    tagsText: string;
  }
>;

export const KbSuggestions: React.FC = () => {
  const [suggestions, setSuggestions] = React.useState<Suggestion[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");
  const [drafts, setDrafts] = React.useState<DraftById>({});

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await api.get<{ suggestions: Suggestion[] }>("/kb/suggestions");
      setSuggestions(res.data.suggestions || []);

      setDrafts((prev) => {
        const next: DraftById = { ...prev };
        for (const s of res.data.suggestions || []) {
          if (!next[s.id]) {
            next[s.id] = {
              title: s.suggested_title,
              body: s.suggested_body,
              category: "",
              tagsText: "",
            };
          }
        }
        return next;
      });
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to load KB suggestions"));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const approve = async (id: string) => {
    setError("");
    setSuccess("");
    try {
      const d = drafts[id];
      const tags = d?.tagsText
        ? d.tagsText
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [];

      const res = await api.post<{ articleId: string; message: string }>(`/kb/suggestions/${id}/approve`, {
        title: d?.title?.trim() ? d.title.trim() : undefined,
        body: d?.body?.trim() ? d.body.trim() : undefined,
        category: d?.category?.trim() ? d.category.trim() : undefined,
        tags: tags.length ? tags : undefined,
      });
      setSuccess(res.data.message || "KB article created");
      await load();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to approve suggestion"));
    }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 600 }}>
        AI KB Suggestions
      </Typography>

      <Alert severity="info" sx={{ mb: 2 }}>
        Suggestions are generated from repeated patterns across resolved tickets (typically when a similar issue shows up 3+
        times). A single resolved ticket will not immediately create a suggestion. Once a suggestion is published, it won’t
        reappear unless a new, distinct pattern emerges.
      </Alert>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {success}
        </Alert>
      )}
      {loading && <Typography color="text.secondary">Loading…</Typography>}

      {suggestions.length === 0 && !loading ? (
        <Typography color="text.secondary">No pending suggestions.</Typography>
      ) : (
        <Stack spacing={2}>
          {suggestions.map((s) => (
            <Card key={s.id} variant="outlined">
              <CardContent>
                <TextField
                  label="Title"
                  value={drafts[s.id]?.title ?? s.suggested_title}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [s.id]: { ...prev[s.id], title: e.target.value },
                    }))
                  }
                  fullWidth
                />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Pattern: <strong>{s.pattern}</strong> • Frequency: <strong>{s.frequency}</strong>
                </Typography>
                <Divider sx={{ my: 1.5 }} />

                <Stack spacing={1.5}>
                  <TextField
                    label="Body"
                    value={drafts[s.id]?.body ?? s.suggested_body}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [s.id]: { ...prev[s.id], body: e.target.value },
                      }))
                    }
                    fullWidth
                    multiline
                    minRows={6}
                  />

                  <Stack direction="row" spacing={1} alignItems="center">
                    <TextField
                      label="Category (optional)"
                      value={drafts[s.id]?.category ?? ""}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [s.id]: { ...prev[s.id], category: e.target.value },
                        }))
                      }
                      sx={{ minWidth: 220 }}
                    />
                    <TextField
                      label="Tags (comma-separated)"
                      value={drafts[s.id]?.tagsText ?? ""}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [s.id]: { ...prev[s.id], tagsText: e.target.value },
                        }))
                      }
                      fullWidth
                    />
                  </Stack>

                  {drafts[s.id]?.tagsText?.trim() && (
                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                      {drafts[s.id]!.tagsText
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean)
                        .slice(0, 10)
                        .map((t) => (
                          <Chip key={t} label={t} size="small" variant="outlined" />
                        ))}
                    </Stack>
                  )}
                </Stack>

                <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2 }}>
                  <Button variant="contained" onClick={() => void approve(s.id)}>
                    Review & Publish
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}
    </Box>
  );
};

