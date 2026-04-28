import React, { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Pagination,
  IconButton,
  Tooltip,
  MenuItem,
  ButtonBase,
} from "@mui/material";
import {
  Check as ApproveIcon,
  Close as RejectIcon,
  Refresh as RefreshIcon,
} from "@mui/icons-material";
import { api, getApiErrorMessage } from "../../services/api";
import { useLocation, useNavigate } from "react-router-dom";

type Approval = {
  id: string;
  ticket_id: string;
  ticket_display_number?: string | null;
  ticket_title: string;
  requested_by_name: string;
  requested_by_email: string;
  status: "pending" | "approved" | "rejected" | "expired";
  action_title: string;
  action_body: string;
  created_at: string;
  decided_at: string | null;
};

export const Approvals: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const rowsPerPage = 25;
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "rejected" | "expired" | "">("");
  const ticketIdFilter = React.useMemo(() => {
    const sp = new URLSearchParams(location.search);
    const v = sp.get("ticket_id");
    return v && v.trim() ? v.trim() : "";
  }, [location.search]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedApproval, setSelectedApproval] = useState<Approval | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const ticketLabel = (ticketId: string, display?: string | null) => {
    return display || `#${ticketId.slice(0, 8)}`;
  };

  const fetchApprovals = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<{ items: Approval[]; total: number }>("/approvals/pending", {
        params: {
          limit: rowsPerPage,
          offset: page * rowsPerPage,
          ...(statusFilter ? { status: statusFilter } : {}),
        },
      });
      const all = res.data.items || [];
      const filtered = ticketIdFilter ? all.filter((a) => a.ticket_id === ticketIdFilter) : all;
      setApprovals(filtered);
      setTotal(ticketIdFilter ? filtered.length : res.data.total || 0);
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to load approvals"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchApprovals();
  }, [page, rowsPerPage, statusFilter, ticketIdFilter]);

  const handleApprove = async () => {
    if (!selectedApproval) return;
    setSubmitting(true);
    try {
      await api.post(`/approvals/${selectedApproval.id}/approve`);
      setDialogOpen(false);
      setSelectedApproval(null);
      setDecisionNote("");
      await fetchApprovals();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to approve"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!selectedApproval) return;
    setSubmitting(true);
    try {
      await api.post(`/approvals/${selectedApproval.id}/reject`);
      setDialogOpen(false);
      setSelectedApproval(null);
      setDecisionNote("");
      await fetchApprovals();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to reject"));
    } finally {
      setSubmitting(false);
    }
  };

  const openDecisionDialog = (approval: Approval) => {
    setSelectedApproval(approval);
    setDialogOpen(true);
  };

  const statusColors = {
    pending: "warning",
    approved: "success",
    rejected: "error",
    expired: "default",
  } as const;

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", mb: 3 }}>
        <Box>
          <Typography variant="h4">Approval Center</Typography>
          <Typography variant="body2" color="text.secondary">
            Review and decide pending approval requests
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <TextField
            select
            label="Status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as any);
              setPage(0);
            }}
            size="small"
            sx={{ minWidth: 120 }}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="pending">Pending</MenuItem>
            <MenuItem value="approved">Approved</MenuItem>
            <MenuItem value="rejected">Rejected</MenuItem>
            <MenuItem value="expired">Expired</MenuItem>
          </TextField>
          <Tooltip title="Refresh">
            <IconButton onClick={() => void fetchApprovals()}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Ticket</TableCell>
              <TableCell>Requested By</TableCell>
              <TableCell>Action</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!loading && approvals.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography color="text.secondary">No approvals found.</Typography>
                </TableCell>
              </TableRow>
            )}
            {approvals.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {a.ticket_title}
                    </Typography>
                    <ButtonBase
                      onClick={() => navigate(`/admin/tickets/${a.ticket_id}`)}
                      sx={{
                        mt: 0.25,
                        fontSize: 12,
                        fontWeight: 800,
                        color: "primary.main",
                        justifyContent: "flex-start",
                        textAlign: "left",
                      }}
                    >
                      {ticketLabel(a.ticket_id, a.ticket_display_number)}
                    </ButtonBase>
                  </Box>
                </TableCell>
                <TableCell>
                  <Box>
                    <Typography variant="body2">{a.requested_by_name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {a.requested_by_email}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell>
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {a.action_title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {a.action_body}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell>
                  <Chip
                    label={a.status.toUpperCase()}
                    color={statusColors[a.status] as any}
                    size="small"
                  />
                </TableCell>
                <TableCell>{new Date(a.created_at).toLocaleString()}</TableCell>
                <TableCell align="right">
                  {a.status === "pending" && (
                    <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
                      <Button
                        variant="contained"
                        color="success"
                        size="small"
                        startIcon={<ApproveIcon />}
                        onClick={() => openDecisionDialog(a)}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="outlined"
                        color="error"
                        size="small"
                        startIcon={<RejectIcon />}
                        onClick={() => openDecisionDialog(a)}
                      >
                        Reject
                      </Button>
                    </Box>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
        <Pagination
          count={Math.ceil(total / rowsPerPage)}
          page={page + 1}
          onChange={(_, newPage) => setPage(newPage - 1)}
          color="primary"
        />
      </Box>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          Decide Approval: {selectedApproval?.action_title}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              <strong>Ticket:</strong> {selectedApproval?.ticket_title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              <strong>Requested by:</strong> {selectedApproval?.requested_by_name} ({selectedApproval?.requested_by_email})
            </Typography>
            <Typography variant="body2">{selectedApproval?.action_body}</Typography>
            <TextField
              label="Decision note (optional)"
              multiline
              rows={3}
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="outlined"
            color="error"
            startIcon={<RejectIcon />}
            onClick={handleReject}
            disabled={submitting}
          >
            Reject
          </Button>
          <Button
            variant="contained"
            color="success"
            startIcon={<ApproveIcon />}
            onClick={handleApprove}
            disabled={submitting}
          >
            Approve
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
