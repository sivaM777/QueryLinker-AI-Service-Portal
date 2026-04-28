import React from "react";
import {
  Box,
  Typography,
  Grid,
  Paper,
  Alert,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from "@mui/material";
import { Speed as SpeedIcon } from "@mui/icons-material";
import { api, getApiErrorMessage, getCachedData } from "../../services/api";
import { subscribeToMetrics } from "../../services/socket.service";
import { useNavigate } from "react-router-dom";

type SlaRiskResponse = {
  counts: { high: number; medium: number; low: number };
  tickets: Array<{
    id: string;
    display_number?: string | null;
    title: string;
    priority: string;
    status: string;
    sla_resolution_due_at: string | null;
    risk: string | null;
  }>;
};

export const SlaMonitor: React.FC = () => {
  const navigate = useNavigate();
  const initialRisk = getCachedData<SlaRiskResponse>({ url: "/analytics/sla-risk" });
  const [error, setError] = React.useState("");
  const [slaRisk, setSlaRisk] = React.useState<SlaRiskResponse | null>(initialRisk || null);

  const load = React.useCallback(async () => {
    setError("");
    try {
      const res = await api.get<SlaRiskResponse>("/analytics/sla-risk");
      setSlaRisk(res.data || null);
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to load SLA risk"));
    }
  }, []);

  React.useEffect(() => {
    void load();
    const unsubscribe = subscribeToMetrics("dashboard", () => {
      void load();
    });
    return () => {
      unsubscribe();
    };
  }, [load]);

  const badge = (label: string, value: number, color: "success" | "warning" | "error") => (
    <Paper sx={{ p: 2, border: "1px solid", borderColor: "divider" }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h5" sx={{ fontWeight: 800, display: "flex", alignItems: "center", gap: 1 }}>
        <SpeedIcon fontSize="small" color={color} /> {value}
      </Typography>
    </Paper>
  );

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 2, mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            SLA Monitor
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Tickets nearing or breaching SLA resolution deadlines
          </Typography>
        </Box>
        <Chip label="Operational" size="small" icon={<SpeedIcon />} />
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={4}>
          {badge("High Risk / Breached", slaRisk?.counts.high || 0, "error")}
        </Grid>
        <Grid item xs={12} sm={4}>
          {badge("Medium Risk", slaRisk?.counts.medium || 0, "warning")}
        </Grid>
        <Grid item xs={12} sm={4}>
          {badge("Low / None", slaRisk?.counts.low || 0, "success")}
        </Grid>
      </Grid>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
          At-Risk Tickets
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Showing tickets with SLA risk calculated by the SLA monitor.
        </Typography>

        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Ticket #</TableCell>
                <TableCell>Title</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Priority</TableCell>
                <TableCell>Risk</TableCell>
                <TableCell>Due</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(slaRisk?.tickets?.length || 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography color="text.secondary">No at-risk tickets.</Typography>
                  </TableCell>
                </TableRow>
              )}
              {(slaRisk?.tickets || []).map((t) => (
                <TableRow key={t.id} hover onClick={() => navigate(`/admin/tickets/${t.id}`)} sx={{ cursor: 'pointer' }}>
                  <TableCell>
                    <Typography variant="body2" color="primary" sx={{ fontWeight: 600 }}>
                      {t.display_number || t.id}
                    </Typography>
                  </TableCell>
                  <TableCell>{t.title}</TableCell>
                  <TableCell>{t.status}</TableCell>
                  <TableCell>{t.priority}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={(t.risk || "").toUpperCase()}
                      color={t.risk?.toUpperCase() === "HIGH" ? "error" : t.risk?.toUpperCase() === "MEDIUM" ? "warning" : "default"}
                    />
                  </TableCell>
                  <TableCell>
                    {t.sla_resolution_due_at ? new Date(t.sla_resolution_due_at).toLocaleString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
};
