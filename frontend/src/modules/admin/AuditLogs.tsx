import React, { useState, useEffect } from "react";
import {
  Alert,
  Box,
  Typography,
  Card,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  TextField,
  InputAdornment,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Pagination,
  LinearProgress,
  Skeleton,
  Grid,
  styled,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  Snackbar,
} from "@mui/material";
import {
  Search as SearchIcon,
  Download as DownloadIcon,
  Refresh as RefreshIcon,
  Visibility as VisibilityIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  AccessTime as TimeIcon,
  Person as PersonIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
  MoreVert as MoreVertIcon,
  AccountTree as WorkflowIcon,
  SystemUpdate as SystemUpdateIcon,
  Add as AddIcon,
} from "@mui/icons-material";
import { api } from "../../services/api";
import { format } from "date-fns";

// Styled components
const AuditContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100vh',
  backgroundColor: '#f8fafc',
  padding: '24px',
  gap: '24px',
  [theme.breakpoints.down('md')]: {
    padding: '16px',
    gap: '16px',
  },
}));

const FilterCard = styled(Card)(() => ({
  padding: '24px',
  borderRadius: '16px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)',
}));

const LogsCard = styled(Card)(() => ({
  borderRadius: '16px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)',
  overflow: 'hidden',
}));

const StyledTableCell = styled(TableCell)(() => ({
  fontWeight: 600,
  backgroundColor: '#f8fafc',
  borderBottom: '2px solid #e5e7eb',
  fontSize: '0.875rem',
  color: '#374151',
}));

const StyledTableRow = styled(TableRow)(() => ({
  '&:nth-of-type(odd)': {
    backgroundColor: '#fafbfc',
  },
  '&:hover': {
    backgroundColor: '#f3f4f6',
  },
  '&:last-child td, &:last-child th': {
    border: 0,
  },
}));

const ActionChip = styled(Chip)<{ severity: 'info' | 'success' | 'warning' | 'error' }>(({ severity }) => ({
  fontWeight: 500,
  fontSize: '0.75rem',
  height: '24px',
  backgroundColor: 
    severity === 'success' ? '#10b98120' :
    severity === 'warning' ? '#f59e0b20' :
    severity === 'error' ? '#ef444420' :
    '#3b82f620',
  color: 
    severity === 'success' ? '#10b981' :
    severity === 'warning' ? '#f59e0b' :
    severity === 'error' ? '#ef4444' :
    '#3b82f6',
  border: `1px solid ${
    severity === 'success' ? '#10b98140' :
    severity === 'warning' ? '#f59e0b40' :
    severity === 'error' ? '#ef444440' :
    '#3b82f640'
  }`,
}));

type AuditLog = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_value?: string | null;
  new_value?: string | null;
  user_id: string;
  user_name: string;
  user_email: string;
  ip_address: string;
  user_agent: string;
  session_id?: string | null;
  field_name?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  category: string;
  description: string;
};

type FilterState = {
  search: string;
  action: string;
  entity_type: string;
  user_id: string;
  severity: string;
  category: string;
  date_from: Date | null;
  date_to: Date | null;
};

const AuditLogs: React.FC = () => {
  const [rawLogs, setRawLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [rowsPerPage] = useState(25);
  const [filters, setFilters] = useState<FilterState>({
    search: '',
    action: '',
    entity_type: '',
    user_id: '',
    severity: '',
    category: '',
    date_from: null,
    date_to: null,
  });
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [menuLog, setMenuLog] = useState<AuditLog | null>(null);
  const [detailLog, setDetailLog] = useState<AuditLog | null>(null);
  const [toast, setToast] = useState<{ severity: 'success' | 'error' | 'info'; message: string } | null>(null);

  const loadLogs = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        limit: rowsPerPage,
        offset: (page - 1) * rowsPerPage,
        ...(filters.action && { action: filters.action }),
        ...(filters.entity_type && { entityType: filters.entity_type }),
        ...(filters.user_id && { userId: filters.user_id }),
        ...(filters.date_from && { startDate: filters.date_from.toISOString() }),
        ...(filters.date_to && { endDate: filters.date_to.toISOString() }),
      };

      const response = await api.get(`/audit`, { params });
      const apiLogs = response.data?.data || [];
      const mapped = apiLogs.map((log: any) => ({
        ...log,
        severity: deriveSeverity(log.action),
        category: log.entity_type,
        description: buildDescription(log),
      }));
      setRawLogs(mapped);
      setTotal(response.data?.pagination?.total || 0);
    } catch (error) {
      console.error('Failed to load audit logs:', error);
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, filters]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const handleFilterChange = (key: keyof FilterState, value: any) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleExport = async () => {
    try {
      const body: Record<string, any> = {
        format: "csv",
        ...(filters.action && { action: filters.action }),
        ...(filters.entity_type && { entityType: filters.entity_type }),
        ...(filters.user_id && { userId: filters.user_id }),
        ...(filters.date_from && { startDate: filters.date_from.toISOString() }),
        ...(filters.date_to && { endDate: filters.date_to.toISOString() }),
      };

      const response = await api.post(`/audit/export`, body, { responseType: 'blob' });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `audit-logs-${format(new Date(), 'yyyy-MM-dd')}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export audit logs:', error);
    }
  };

  const getActionIcon = (action: string) => {
    if (action.includes('create')) return <AddIcon sx={{ fontSize: 16 }} />;
    if (action.includes('update') || action.includes('edit')) return <EditIcon sx={{ fontSize: 16 }} />;
    if (action.includes('delete')) return <DeleteIcon sx={{ fontSize: 16 }} />;
    if (action.includes('view')) return <VisibilityIcon sx={{ fontSize: 16 }} />;
    if (action.includes('export')) return <DownloadIcon sx={{ fontSize: 16 }} />;
    if (action.includes('login')) return <PersonIcon sx={{ fontSize: 16 }} />;
    if (action.includes('workflow')) return <WorkflowIcon sx={{ fontSize: 16 }} />;
    if (action.includes('system')) return <SystemUpdateIcon sx={{ fontSize: 16 }} />;
    return <InfoIcon sx={{ fontSize: 16 }} />;
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'success': return <CheckCircleIcon sx={{ fontSize: 16, color: '#10b981' }} />;
      case 'warning': return <WarningIcon sx={{ fontSize: 16, color: '#f59e0b' }} />;
      case 'error': return <ErrorIcon sx={{ fontSize: 16, color: '#ef4444' }} />;
      default: return <InfoIcon sx={{ fontSize: 16, color: '#3b82f6' }} />;
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return format(new Date(timestamp), 'MMM dd, yyyy HH:mm:ss');
  };

  const shortId = (value: string) => {
    if (!value) return "-";
    if (value.length <= 12) return value;
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  };

  const filteredLogs = React.useMemo(() => {
    let data = rawLogs;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      data = data.filter((log) =>
        [
          log.user_name,
          log.user_email,
          log.action,
          log.entity_type,
          log.entity_id,
          log.description,
        ]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );
    }
    if (filters.severity) {
      data = data.filter((log) => log.severity === filters.severity);
    }
    if (filters.category) {
      data = data.filter((log) => log.category === filters.category);
    }
    return data;
  }, [rawLogs, filters.search, filters.severity, filters.category]);

  const deriveSeverity = (action: string): 'info' | 'success' | 'warning' | 'error' => {
    const a = String(action || '').toLowerCase();
    if (a.includes('deleted') || a.includes('failed') || a.includes('error')) return 'error';
    if (a.includes('updated') || a.includes('exported')) return 'warning';
    if (a.includes('created')) return 'success';
    return 'info';
  };

  const buildDescription = (log: any): string => {
    const action = String(log.action || '').toLowerCase();
    if (action === 'created') return `Created ${log.entity_type}`;
    if (action === 'updated') return log.field_name ? `Updated ${log.field_name}` : `Updated ${log.entity_type}`;
    if (action === 'deleted') return `Deleted ${log.entity_type}`;
    if (action === 'viewed') return `Viewed ${log.entity_type}`;
    if (action === 'exported') return `Exported ${log.entity_type}`;
    return `${log.action}`;
  };

  const parseStructuredValue = (value?: string | null) => {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  };

  const formatStructuredValue = (value?: string | null) => {
    if (!value) return "No value recorded";
    const parsed = parseStructuredValue(value);
    if (typeof parsed === "string") return parsed;
    return JSON.stringify(parsed, null, 2);
  };

  const handleMenuClick = (event: React.MouseEvent<HTMLElement>, log: AuditLog) => {
    setAnchorEl(event.currentTarget);
    setMenuLog(log);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setMenuLog(null);
  };

  const handleViewDetails = () => {
    if (!menuLog) return;
    setDetailLog(menuLog);
    handleMenuClose();
  };

  const exportAuditEntry = async (log: AuditLog) => {
    try {
      const payload = {
        id: log.id,
        timestamp: log.created_at,
        user: {
          id: log.user_id,
          name: log.user_name,
          email: log.user_email,
        },
        action: log.action,
        entity: {
          type: log.entity_type,
          id: log.entity_id,
        },
        field_name: log.field_name ?? null,
        severity: log.severity,
        description: log.description,
        ip_address: log.ip_address || null,
        user_agent: log.user_agent || null,
        session_id: log.session_id ?? null,
        old_value: parseStructuredValue(log.old_value),
        new_value: parseStructuredValue(log.new_value),
        metadata: log.metadata ?? null,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `audit-entry-${log.id}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setToast({ severity: "success", message: "Audit entry exported" });
    } catch (error) {
      console.error("Failed to export audit entry:", error);
      setToast({ severity: "error", message: "Failed to export audit entry" });
    }
  };

  const handleExportEntry = async () => {
    if (!menuLog) return;
    await exportAuditEntry(menuLog);
    handleMenuClose();
  };

  return (
    <AuditContainer>
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <Typography variant="h3" sx={{ fontWeight: 700, color: '#111827', mb: 1 }}>
              Audit Logs
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Track system activities, security events, and data changes
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={handleExport}
              sx={{ borderRadius: '8px' }}
            >
              Export
            </Button>
            <Button
              variant="contained"
              startIcon={<RefreshIcon />}
              onClick={loadLogs}
              sx={{ borderRadius: '8px' }}
            >
              Refresh
            </Button>
          </Box>
        </Box>

        {/* Filters */}
        <FilterCard>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
            Filters
          </Typography>
          <Grid container spacing={3}>
            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                size="small"
                placeholder="Search logs..."
                value={filters.search}
                onChange={(e) => handleFilterChange('search', e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon sx={{ color: '#6b7280' }} />
                    </InputAdornment>
                  ),
                }}
                sx={{ borderRadius: '8px' }}
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Action</InputLabel>
                <Select
                  value={filters.action}
                  label="Action"
                  onChange={(e) => handleFilterChange('action', e.target.value)}
                >
                  <MenuItem value="">All</MenuItem>
                  <MenuItem value="created">Created</MenuItem>
                  <MenuItem value="updated">Updated</MenuItem>
                  <MenuItem value="deleted">Deleted</MenuItem>
                  <MenuItem value="viewed">Viewed</MenuItem>
                  <MenuItem value="exported">Exported</MenuItem>
                  <MenuItem value="printed">Printed</MenuItem>
                  <MenuItem value="shared">Shared</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Entity Type</InputLabel>
                <Select
                  value={filters.entity_type}
                  label="Entity Type"
                  onChange={(e) => handleFilterChange('entity_type', e.target.value)}
                >
                  <MenuItem value="">All</MenuItem>
                  <MenuItem value="ticket">Ticket</MenuItem>
                  <MenuItem value="user">User</MenuItem>
                  <MenuItem value="team">Team</MenuItem>
                  <MenuItem value="workflow">Workflow</MenuItem>
                  <MenuItem value="system">System</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Severity</InputLabel>
                <Select
                  value={filters.severity}
                  label="Severity"
                  onChange={(e) => handleFilterChange('severity', e.target.value)}
                >
                  <MenuItem value="">All</MenuItem>
                  <MenuItem value="info">Info</MenuItem>
                  <MenuItem value="success">Success</MenuItem>
                  <MenuItem value="warning">Warning</MenuItem>
                  <MenuItem value="error">Error</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                size="small"
                label="Date From"
                type="date"
                value={filters.date_from ? format(filters.date_from, 'yyyy-MM-dd') : ""}
                onChange={(e) => handleFilterChange('date_from', e.target.value ? new Date(e.target.value) : null)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                size="small"
                label="Date To"
                type="date"
                value={filters.date_to ? format(filters.date_to, 'yyyy-MM-dd') : ""}
                onChange={(e) => handleFilterChange('date_to', e.target.value ? new Date(e.target.value) : null)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
          </Grid>
        </FilterCard>

        {/* Logs Table */}
        <LogsCard>
          {loading && <LinearProgress />}
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <StyledTableCell>Timestamp</StyledTableCell>
                  <StyledTableCell>User</StyledTableCell>
                  <StyledTableCell>Action</StyledTableCell>
                  <StyledTableCell>Entity</StyledTableCell>
                  <StyledTableCell>Severity</StyledTableCell>
                  <StyledTableCell>Description</StyledTableCell>
                  <StyledTableCell>IP Address</StyledTableCell>
                  <StyledTableCell align="center">Actions</StyledTableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  Array.from({ length: 10 }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell><Skeleton width={120} /></TableCell>
                      <TableCell><Skeleton width={100} /></TableCell>
                      <TableCell><Skeleton width={80} /></TableCell>
                      <TableCell><Skeleton width={80} /></TableCell>
                      <TableCell><Skeleton width={60} /></TableCell>
                      <TableCell><Skeleton width={200} /></TableCell>
                      <TableCell><Skeleton width={100} /></TableCell>
                      <TableCell align="center"><Skeleton width={40} /></TableCell>
                    </TableRow>
                  ))
                ) : filteredLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} align="center" sx={{ py: 8 }}>
                      <Typography variant="body1" color="text.secondary">
                        No audit logs found matching your criteria
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredLogs.map((log) => (
                    <StyledTableRow key={log.id}>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <TimeIcon sx={{ fontSize: 14, color: '#6b7280' }} />
                          <Typography variant="body2">
                            {formatTimestamp(log.created_at)}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {log.user_name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {log.user_email}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {getActionIcon(log.action)}
                          <Typography variant="body2">
                            {log.action}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {log.entity_type}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {shortId(log.entity_id)}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {getSeverityIcon(log.severity)}
                          <ActionChip
                            label={log.severity}
                            severity={log.severity}
                            size="small"
                          />
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {log.description}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                          {log.ip_address || "-"}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <IconButton
                          size="small"
                          onClick={(e) => handleMenuClick(e, log)}
                        >
                          <MoreVertIcon />
                        </IconButton>
                      </TableCell>
                    </StyledTableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
          {!loading && filteredLogs.length > 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, borderTop: '1px solid #e5e7eb' }}>
              <Typography variant="body2" color="text.secondary">
                Showing {((page - 1) * rowsPerPage) + 1} to {Math.min(page * rowsPerPage, total)} of {total} entries
              </Typography>
              <Pagination
                count={Math.ceil(total / rowsPerPage)}
                page={page}
                onChange={(_, value) => setPage(value)}
                color="primary"
                size="small"
              />
            </Box>
          )}
        </LogsCard>

        {/* Context Menu */}
        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleMenuClose}
        >
          <MenuItem onClick={handleViewDetails} disabled={!menuLog}>
            <VisibilityIcon sx={{ mr: 1, fontSize: 16 }} />
            View Details
          </MenuItem>
          <MenuItem onClick={() => void handleExportEntry()} disabled={!menuLog}>
            <DownloadIcon sx={{ mr: 1, fontSize: 16 }} />
            Export Entry
          </MenuItem>
        </Menu>

        <Dialog open={Boolean(detailLog)} onClose={() => setDetailLog(null)} maxWidth="md" fullWidth>
          <DialogTitle sx={{ fontWeight: 800 }}>
            Audit Entry Details
          </DialogTitle>
          <DialogContent dividers>
            {detailLog ? (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
                <Box>
                  <Typography variant="overline" color="text.secondary">Summary</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
                    {detailLog.description}
                  </Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                    <ActionChip label={detailLog.severity} severity={detailLog.severity} size="small" />
                    <Chip size="small" label={detailLog.action} variant="outlined" />
                    <Chip size="small" label={detailLog.entity_type} variant="outlined" />
                  </Box>
                </Box>

                <Divider />

                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="overline" color="text.secondary">Timestamp</Typography>
                    <Typography variant="body1" sx={{ fontWeight: 600 }}>
                      {formatTimestamp(detailLog.created_at)}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="overline" color="text.secondary">Entry ID</Typography>
                    <Typography variant="body2" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>
                      {detailLog.id}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="overline" color="text.secondary">User</Typography>
                    <Typography variant="body1" sx={{ fontWeight: 600 }}>
                      {detailLog.user_name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {detailLog.user_email}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="overline" color="text.secondary">Entity</Typography>
                    <Typography variant="body1" sx={{ fontWeight: 600 }}>
                      {detailLog.entity_type}
                    </Typography>
                    <Typography variant="body2" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>
                      {detailLog.entity_id}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="overline" color="text.secondary">IP Address</Typography>
                    <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                      {detailLog.ip_address || "Not captured"}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="overline" color="text.secondary">Field Name</Typography>
                    <Typography variant="body2">
                      {detailLog.field_name || "Not applicable"}
                    </Typography>
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="overline" color="text.secondary">User Agent</Typography>
                    <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                      {detailLog.user_agent || "Not captured"}
                    </Typography>
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="overline" color="text.secondary">Session ID</Typography>
                    <Typography variant="body2" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>
                      {detailLog.session_id || "Not captured"}
                    </Typography>
                  </Grid>
                </Grid>

                <Divider />

                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <Typography variant="overline" color="text.secondary">Old Value</Typography>
                    <Box
                      component="pre"
                      sx={{
                        m: 0,
                        mt: 0.75,
                        p: 2,
                        borderRadius: 2,
                        bgcolor: "#0f172a",
                        color: "#e2e8f0",
                        fontSize: "0.8rem",
                        overflowX: "auto",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        minHeight: 96,
                      }}
                    >
                      {formatStructuredValue(detailLog.old_value)}
                    </Box>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography variant="overline" color="text.secondary">New Value</Typography>
                    <Box
                      component="pre"
                      sx={{
                        m: 0,
                        mt: 0.75,
                        p: 2,
                        borderRadius: 2,
                        bgcolor: "#0f172a",
                        color: "#e2e8f0",
                        fontSize: "0.8rem",
                        overflowX: "auto",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        minHeight: 96,
                      }}
                    >
                      {formatStructuredValue(detailLog.new_value)}
                    </Box>
                  </Grid>
                </Grid>

                <Box>
                  <Typography variant="overline" color="text.secondary">Metadata</Typography>
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      mt: 0.75,
                      p: 2,
                      borderRadius: 2,
                      bgcolor: "#f8fafc",
                      border: "1px solid #e5e7eb",
                      color: "#0f172a",
                      fontSize: "0.8rem",
                      overflowX: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {detailLog.metadata ? JSON.stringify(detailLog.metadata, null, 2) : "No metadata recorded"}
                  </Box>
                </Box>
              </Box>
            ) : null}
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button onClick={() => setDetailLog(null)} variant="outlined">
              Close
            </Button>
            <Button
              onClick={() => {
                if (!detailLog) return;
                void exportAuditEntry(detailLog);
              }}
              variant="contained"
              startIcon={<DownloadIcon />}
            >
              Export Entry
            </Button>
          </DialogActions>
        </Dialog>

        <Snackbar
          open={Boolean(toast)}
          autoHideDuration={3200}
          onClose={() => setToast(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        >
          <Alert severity={toast?.severity || "info"} onClose={() => setToast(null)} sx={{ borderRadius: 2 }}>
            {toast?.message}
          </Alert>
        </Snackbar>
      </AuditContainer>
  );
};

export default AuditLogs;
