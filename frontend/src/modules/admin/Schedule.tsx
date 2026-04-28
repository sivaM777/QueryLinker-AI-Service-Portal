import React from "react";
import {
  Box,
  Typography,
  Paper,
  Grid,
  Button,
  Avatar,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Menu,
  MenuItem,
  Alert,
  CircularProgress,
  Stack,
} from "@mui/material";
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Add as AddIcon,
  Attachment as AttachmentIcon,
} from "@mui/icons-material";
import { format, startOfWeek, addDays, isSameDay } from "date-fns";
import { useAuth } from "../../services/auth";
import { api, getApiErrorMessage } from "../../services/api";
import { subscribeToScheduleUpdates } from "../../services/socket.service";
import { resolveApiAssetUrl } from "../../utils/url";

const SHIFT_TYPES = {
  MORNING: { label: "Morning (8am-4pm)", color: "primary" as const },
  EVENING: { label: "Evening (4pm-12am)", color: "secondary" as const },
  NIGHT: { label: "Night (12am-8am)", color: "warning" as const },
  OFF: { label: "Off", color: "default" as const },
};

type ShiftType = keyof typeof SHIFT_TYPES;

type ScheduleEntry = {
  userId: string;
  userName: string;
  userAvatar?: string;
  shifts: Record<string, ShiftType>;
};

type ScheduleUser = {
  id: string;
  name: string;
  role: "EMPLOYEE" | "AGENT" | "MANAGER" | "ADMIN";
  team_id: string | null;
  avatar_url: string | null;
};

type ScheduleShift = {
  user_id: string;
  shift_date: string;
  shift_type: ShiftType;
};

type TimeOffEntry = {
  id: string;
  user_id: string;
  user_name?: string | null;
  start_date: string;
  end_date: string;
  subject: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "DENIED" | "CANCELLED";
  approver_id?: string | null;
  approver_name?: string | null;
  decided_at?: string | null;
  created_at: string;
  attachment_name?: string | null;
  attachment_url?: string | null;
  attachment_content_type?: string | null;
};

type RequestFieldErrors = {
  start?: string;
  end?: string;
  subject?: string;
  reason?: string;
  attachment?: string;
};

const acceptedAttachmentTypes = ".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp";

const formatDisplayDate = (value: string) => {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : format(date, "MMM d, yyyy");
};

const getStatusChipColor = (status: TimeOffEntry["status"]) => {
  if (status === "APPROVED") return "success" as const;
  if (status === "PENDING") return "warning" as const;
  if (status === "DENIED") return "error" as const;
  return "default" as const;
};

const getStatusLabel = (status: TimeOffEntry["status"]) => {
  if (status === "DENIED") return "Declined";
  if (status === "CANCELLED") return "Cancelled";
  if (status === "APPROVED") return "Approved";
  return "Pending";
};

export const Schedule: React.FC = () => {
  const { user } = useAuth();
  const [currentDate, setCurrentDate] = React.useState(new Date());
  const startDate = React.useMemo(
    () => startOfWeek(currentDate, { weekStartsOn: 1 }),
    [currentDate]
  );
  const startDateKey = format(startDate, "yyyy-MM-dd");
  const endDateKey = format(addDays(startDate, 6), "yyyy-MM-dd");
  const canEdit = user?.role === "MANAGER" || user?.role === "ADMIN";
  const canReviewTimeOff = canEdit;

  const weekDays = Array.from({ length: 7 }).map((_, i) => addDays(startDate, i));

  const [scheduleData, setScheduleData] = React.useState<ScheduleEntry[]>([]);
  const [weeklyTimeOff, setWeeklyTimeOff] = React.useState<TimeOffEntry[]>([]);
  const [upcomingTimeOff, setUpcomingTimeOff] = React.useState<TimeOffEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const scheduleRequestRef = React.useRef(0);
  const timeOffRequestRef = React.useRef(0);

  const [requestOpen, setRequestOpen] = React.useState(false);
  const [requestStart, setRequestStart] = React.useState(startDateKey);
  const [requestEnd, setRequestEnd] = React.useState(endDateKey);
  const [requestSubject, setRequestSubject] = React.useState("");
  const [requestReason, setRequestReason] = React.useState("");
  const [requestAttachment, setRequestAttachment] = React.useState<File | null>(null);
  const [requestErrors, setRequestErrors] = React.useState<RequestFieldErrors>({});
  const [requestSubmitting, setRequestSubmitting] = React.useState(false);
  const [timeOffActionId, setTimeOffActionId] = React.useState<string | null>(null);

  const [shiftMenuAnchorEl, setShiftMenuAnchorEl] = React.useState<HTMLElement | null>(null);
  const shiftMenuTargetRef = React.useRef<{ userId: string; dateKey: string } | null>(null);

  const combinedTimeOff = React.useMemo(() => {
    const merged = new Map<string, TimeOffEntry>();
    [...weeklyTimeOff, ...upcomingTimeOff].forEach((entry) => {
      merged.set(entry.id, entry);
    });
    return Array.from(merged.values());
  }, [upcomingTimeOff, weeklyTimeOff]);

  const timeOffDayMap = React.useMemo(() => {
    const approved = combinedTimeOff.filter((entry) => entry.status === "APPROVED");
    const map = new Set<string>();
    approved.forEach((entry) => {
      const start = new Date(`${entry.start_date}T00:00:00`);
      const end = new Date(`${entry.end_date}T00:00:00`);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = `${entry.user_id}:${format(new Date(d), "yyyy-MM-dd")}`;
        map.add(key);
      }
    });
    return map;
  }, [combinedTimeOff]);

  const userNameMap = React.useMemo(() => {
    const map = new Map<string, string>();
    scheduleData.forEach((entry) => map.set(entry.userId, entry.userName));
    return map;
  }, [scheduleData]);

  const orderedTimeOff = React.useMemo(() => {
    const statusWeight: Record<TimeOffEntry["status"], number> = {
      PENDING: 0,
      APPROVED: 1,
      DENIED: 2,
      CANCELLED: 3,
    };

    return [...upcomingTimeOff].sort((a, b) => {
      const statusDiff = statusWeight[a.status] - statusWeight[b.status];
      if (statusDiff !== 0) return statusDiff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [upcomingTimeOff]);

  const loadSchedule = React.useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) setLoading(true);
    if (!silent) setError("");
    const requestId = ++scheduleRequestRef.current;
    try {
      const params: Record<string, string> = { start: startDateKey, role: "AGENT" };
      if (user?.role === "AGENT" || user?.role === "EMPLOYEE") {
        params.user_id = user.id;
        params.role = user.role;
      }

      const res = await api.get("/schedule/weekly", {
        params,
        headers: { "x-cache-ttl": "0" },
      });

      const users = res.data.users as ScheduleUser[];
      const shifts = res.data.shifts as ScheduleShift[];
      const timeOffList = res.data.timeOff as TimeOffEntry[];

      const shiftMap = new Map<string, Record<string, ShiftType>>();
      shifts.forEach((shift) => {
        const shiftKey =
          typeof shift.shift_date === "string"
            ? shift.shift_date.slice(0, 10)
            : String(shift.shift_date);
        if (!shiftMap.has(shift.user_id)) {
          shiftMap.set(shift.user_id, {});
        }
        shiftMap.get(shift.user_id)![shiftKey] = shift.shift_type;
      });

      const rows: ScheduleEntry[] = users.map((entry) => ({
        userId: entry.id,
        userName: entry.name,
        userAvatar: entry.name?.[0],
        shifts: shiftMap.get(entry.id) || {},
      }));

      if (requestId === scheduleRequestRef.current) {
        setScheduleData(rows);
        setWeeklyTimeOff(timeOffList);
      }
    } catch (e: unknown) {
      if (requestId === scheduleRequestRef.current) {
        setError(getApiErrorMessage(e, "Failed to load schedule"));
      }
    } finally {
      if (!silent && requestId === scheduleRequestRef.current) {
        setLoading(false);
      }
    }
  }, [startDateKey, user?.id, user?.role]);

  const loadUpcomingTimeOff = React.useCallback(async () => {
    const requestId = ++timeOffRequestRef.current;
    try {
      const res = await api.get("/schedule/time-off", {
        params: { start: startDateKey, end: format(addDays(startDate, 30), "yyyy-MM-dd") },
        headers: { "x-cache-ttl": "0" },
      });
      if (requestId === timeOffRequestRef.current) {
        setUpcomingTimeOff(res.data as TimeOffEntry[]);
      }
    } catch {
      // Weekly payload already includes time-off data, so this can fail silently.
    }
  }, [startDate, startDateKey]);

  React.useEffect(() => {
    void loadSchedule();
    void loadUpcomingTimeOff();

    const unsubscribe = subscribeToScheduleUpdates(() => {
      void loadSchedule({ silent: true });
      void loadUpcomingTimeOff();
    });

    const intervalId = window.setInterval(() => {
      if (!document.hidden) {
        void loadSchedule({ silent: true });
        void loadUpcomingTimeOff();
      }
    }, 3000);

    return () => {
      unsubscribe();
      window.clearInterval(intervalId);
    };
  }, [loadSchedule, loadUpcomingTimeOff]);

  React.useEffect(() => {
    setRequestStart(startDateKey);
    setRequestEnd(endDateKey);
  }, [startDateKey, endDateKey]);

  const handlePrevWeek = () => setCurrentDate(addDays(currentDate, -7));
  const handleNextWeek = () => setCurrentDate(addDays(currentDate, 7));

  const openShiftMenu = (event: React.MouseEvent<HTMLElement>, userId: string, dateKey: string) => {
    if (!canEdit) return;
    shiftMenuTargetRef.current = { userId, dateKey };
    setShiftMenuAnchorEl(event.currentTarget);
  };

  const closeShiftMenu = () => {
    setShiftMenuAnchorEl(null);
    shiftMenuTargetRef.current = null;
  };

  const applyShift = async (shiftType: ShiftType) => {
    const target = shiftMenuTargetRef.current;
    if (!target) return;
    const targetUserId = target.userId;
    const targetDate = target.dateKey;
    closeShiftMenu();

    setScheduleData((prev) =>
      prev.map((row) =>
        row.userId === targetUserId
          ? { ...row, shifts: { ...row.shifts, [targetDate]: shiftType } }
          : row
      )
    );

    try {
      const res = await api.post("/schedule/shifts", {
        user_id: targetUserId,
        shift_date: targetDate,
        shift_type: shiftType,
      });

      if (res?.data?.shift_type && res?.data?.shift_date) {
        const savedDate =
          typeof res.data.shift_date === "string" ? res.data.shift_date.slice(0, 10) : targetDate;
        const savedType = res.data.shift_type as ShiftType;
        setScheduleData((prev) =>
          prev.map((row) =>
            row.userId === targetUserId
              ? { ...row, shifts: { ...row.shifts, [savedDate]: savedType } }
              : row
          )
        );
      }
      void loadSchedule({ silent: true });
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to update shift"));
      void loadSchedule({ silent: true });
    }
  };

  const resetRequestForm = React.useCallback(() => {
    setRequestSubject("");
    setRequestReason("");
    setRequestAttachment(null);
    setRequestErrors({});
    setRequestStart(startDateKey);
    setRequestEnd(endDateKey);
  }, [endDateKey, startDateKey]);

  const openRequestDialog = () => {
    resetRequestForm();
    setRequestOpen(true);
  };

  const closeRequestDialog = () => {
    if (requestSubmitting) return;
    setRequestOpen(false);
    resetRequestForm();
  };

  const validateRequest = (): boolean => {
    const nextErrors: RequestFieldErrors = {};

    if (!requestStart) nextErrors.start = "Start date is required";
    if (!requestEnd) nextErrors.end = "End date is required";
    if (requestStart && requestEnd && requestStart > requestEnd) {
      nextErrors.end = "End date must be after the start date";
    }
    if (!requestSubject.trim()) nextErrors.subject = "Subject is required";
    if (!requestReason.trim()) nextErrors.reason = "Reason is required";
    if (requestReason.trim() && requestReason.trim().length < 10) {
      nextErrors.reason = "Reason should explain the leave clearly";
    }
    if (!requestAttachment) nextErrors.attachment = "Please upload a leave letter or supporting document";

    setRequestErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const submitTimeOff = async () => {
    if (!validateRequest()) return;

    setRequestSubmitting(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("start_date", requestStart);
      formData.append("end_date", requestEnd);
      formData.append("subject", requestSubject.trim());
      formData.append("reason", requestReason.trim());
      if (requestAttachment) {
        formData.append("attachment", requestAttachment);
      }

      const res = await api.post<TimeOffEntry>("/schedule/time-off", formData);
      const created = res.data;

      setUpcomingTimeOff((prev) => [created, ...prev.filter((entry) => entry.id !== created.id)]);
      setRequestOpen(false);
      resetRequestForm();
      void loadSchedule({ silent: true });
      void loadUpcomingTimeOff();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to request time off"));
    } finally {
      setRequestSubmitting(false);
    }
  };

  const reviewTimeOff = async (entryId: string, status: "APPROVED" | "DENIED") => {
    setTimeOffActionId(entryId);
    setError("");
    try {
      const res = await api.patch<TimeOffEntry>(`/schedule/time-off/${entryId}`, { status });
      const updated = res.data;
      setUpcomingTimeOff((prev) =>
        prev.map((entry) => (entry.id === entryId ? { ...entry, ...updated } : entry))
      );
      setWeeklyTimeOff((prev) =>
        prev.map((entry) => (entry.id === entryId ? { ...entry, ...updated } : entry))
      );
      void loadSchedule({ silent: true });
      void loadUpcomingTimeOff();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, `Failed to ${status === "APPROVED" ? "approve" : "decline"} time off`));
    } finally {
      setTimeOffActionId(null);
    }
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1600, margin: "0 auto" }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800, mb: 1 }}>
            Schedule
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Manage team shifts and availability
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openRequestDialog}>
          Request Time Off
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <IconButton onClick={handlePrevWeek}>
              <ChevronLeftIcon />
            </IconButton>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              {format(startDate, "MMMM yyyy")}
            </Typography>
            <IconButton onClick={handleNextWeek}>
              <ChevronRightIcon />
            </IconButton>
          </Box>
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            {loading && scheduleData.length > 0 && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "text.secondary" }}>
                <CircularProgress size={14} />
                <Typography variant="caption">Updating...</Typography>
              </Box>
            )}
            <Button variant="outlined" size="small" onClick={() => setCurrentDate(new Date())}>
              Today
            </Button>
          </Box>
        </Box>

        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700, width: 200 }}>Agent</TableCell>
                {weekDays.map((day) => (
                  <TableCell key={day.toString()} align="center" sx={{ minWidth: 120 }}>
                    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <Typography variant="caption" color="text.secondary">
                        {format(day, "EEE")}
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 700,
                          color: isSameDay(day, new Date()) ? "primary.main" : "text.primary",
                          bgcolor: isSameDay(day, new Date()) ? "primary.light" : "transparent",
                          borderRadius: "50%",
                          width: 24,
                          height: 24,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {format(day, "d")}
                      </Typography>
                    </Box>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && scheduleData.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center">
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", py: 4 }}>
                      <CircularProgress size={24} />
                      <Typography sx={{ ml: 2 }} color="text.secondary">
                        Loading schedule
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              )}

              {!loading && scheduleData.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center">
                    <Typography color="text.secondary">No agents available for this week.</Typography>
                  </TableCell>
                </TableRow>
              )}

              {scheduleData.map((entry) => (
                <TableRow key={entry.userId}>
                  <TableCell>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                      <Avatar sx={{ width: 32, height: 32 }}>{entry.userAvatar || entry.userName[0]}</Avatar>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {entry.userName}
                      </Typography>
                    </Box>
                  </TableCell>
                  {weekDays.map((day) => {
                    const dateKey = format(day, "yyyy-MM-dd");
                    const shift = entry.shifts[dateKey] || "OFF";
                    const shiftConfig = SHIFT_TYPES[shift];
                    const timeOffKey = `${entry.userId}:${dateKey}`;
                    const isTimeOff = timeOffDayMap.has(timeOffKey);

                    return (
                      <TableCell key={dateKey} align="center">
                        {isTimeOff ? (
                          <Chip
                            label="Time Off"
                            color="default"
                            size="small"
                            variant="outlined"
                            sx={{ width: "100%" }}
                          />
                        ) : shift !== "OFF" ? (
                          <Chip
                            label={shiftConfig.label.split(" ")[0]}
                            color={shiftConfig.color}
                            size="small"
                            variant="filled"
                            sx={{ width: "100%" }}
                            onClick={canEdit ? (event) => openShiftMenu(event, entry.userId, dateKey) : undefined}
                          />
                        ) : (
                          <Box
                            onClick={canEdit ? (event) => openShiftMenu(event, entry.userId, dateKey) : undefined}
                            sx={{
                              height: 28,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: 1,
                              border: canEdit ? "1px dashed rgba(0,0,0,0.2)" : "1px dashed transparent",
                              cursor: canEdit ? "pointer" : "default",
                            }}
                          >
                            <Typography variant="caption" color="text.disabled">
                              -
                            </Typography>
                          </Box>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>
              Shift Legend
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {Object.entries(SHIFT_TYPES).map(([key, config]) => (
                <Box key={key} sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <Chip label={config.label.split(" ")[0]} color={config.color} size="small" sx={{ width: 80 }} />
                  <Typography variant="body2" color="text.secondary">
                    {config.label.split(" ").slice(1).join(" ")}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Paper>
        </Grid>
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>
              Upcoming Time Off
            </Typography>
            {orderedTimeOff.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No upcoming time off requests.
              </Typography>
            ) : (
              <Stack spacing={1.5}>
              {orderedTimeOff.map((entry) => {
                  const displayName =
                    entry.user_id === user?.id
                      ? "You"
                      : entry.user_name || userNameMap.get(entry.user_id) || `User ${entry.user_id.slice(0, 6)}`;
                  const canApproveRow =
                    canReviewTimeOff && entry.status === "PENDING" && entry.user_id !== user?.id;

                  return (
                    <Box
                      key={entry.id}
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 2,
                        flexWrap: "wrap",
                        border: "1px solid rgba(0,0,0,0.06)",
                        borderRadius: 2,
                        p: 1.5,
                      }}
                    >
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {displayName} - {entry.subject}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                          {formatDisplayDate(entry.start_date)} - {formatDisplayDate(entry.end_date)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: entry.attachment_url ? 0.75 : 0 }}>
                          {entry.reason}
                        </Typography>
                        {entry.approver_name && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                            Reviewed by {entry.approver_name}
                            {entry.decided_at ? ` on ${format(new Date(entry.decided_at), "MMM d, yyyy h:mm a")}` : ""}
                          </Typography>
                        )}
                        {entry.attachment_url && (
                          <Button
                            component="a"
                            href={resolveApiAssetUrl(entry.attachment_url)}
                            target="_blank"
                            rel="noreferrer"
                            size="small"
                            startIcon={<AttachmentIcon />}
                            sx={{ mt: 0.5, alignSelf: "flex-start", px: 0 }}
                          >
                            {entry.attachment_name || "View leave document"}
                          </Button>
                        )}
                      </Box>

                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, ml: "auto" }}>
                        <Chip
                          label={getStatusLabel(entry.status)}
                          size="small"
                          color={getStatusChipColor(entry.status)}
                        />
                        {canApproveRow && (
                          <>
                            <Button
                              size="small"
                              variant="contained"
                              color="success"
                              disabled={timeOffActionId === entry.id}
                              onClick={() => void reviewTimeOff(entry.id, "APPROVED")}
                            >
                              Accept
                            </Button>
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              disabled={timeOffActionId === entry.id}
                              onClick={() => void reviewTimeOff(entry.id, "DENIED")}
                            >
                              Decline
                            </Button>
                          </>
                        )}
                      </Box>
                    </Box>
                  );
                })}
              </Stack>
            )}
          </Paper>
        </Grid>
      </Grid>

      <Dialog open={requestOpen} onClose={closeRequestDialog} fullWidth maxWidth="sm">
        <DialogTitle>Request Time Off</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} md={6}>
              <TextField
                label="Start Date"
                type="date"
                value={requestStart}
                onChange={(e) => setRequestStart(e.target.value)}
                fullWidth
                InputLabelProps={{ shrink: true }}
                error={Boolean(requestErrors.start)}
                helperText={requestErrors.start}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="End Date"
                type="date"
                value={requestEnd}
                onChange={(e) => setRequestEnd(e.target.value)}
                fullWidth
                InputLabelProps={{ shrink: true }}
                error={Boolean(requestErrors.end)}
                helperText={requestErrors.end}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Subject *"
                placeholder="Example: Medical leave request"
                value={requestSubject}
                onChange={(e) => setRequestSubject(e.target.value)}
                fullWidth
                error={Boolean(requestErrors.subject)}
                helperText={requestErrors.subject || "Add a short subject so managers can review quickly."}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Reason *"
                placeholder="Explain the leave request clearly. This is required."
                value={requestReason}
                onChange={(e) => setRequestReason(e.target.value)}
                fullWidth
                multiline
                minRows={4}
                error={Boolean(requestErrors.reason)}
                helperText={requestErrors.reason || "Describe the reason and any necessary context."}
              />
            </Grid>
            <Grid item xs={12}>
              <Stack spacing={1}>
                <Button component="label" variant="outlined" startIcon={<AttachmentIcon />}>
                  {requestAttachment ? "Replace Leave Document *" : "Upload Leave Document *"}
                  <input
                    hidden
                    type="file"
                    accept={acceptedAttachmentTypes}
                    onChange={(event) => {
                      const file = event.target.files?.[0] || null;
                      setRequestAttachment(file);
                    }}
                  />
                </Button>
                <Typography variant="caption" color={requestErrors.attachment ? "error" : "text.secondary"}>
                  {requestAttachment
                    ? `${requestAttachment.name} (${Math.max(1, Math.round(requestAttachment.size / 1024))} KB)`
                    : requestErrors.attachment || "Attach the leave letter or supporting form (PDF, DOC, DOCX, PNG, JPG, WEBP)."}
                </Typography>
              </Stack>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeRequestDialog}>Cancel</Button>
          <Button onClick={submitTimeOff} variant="contained" disabled={requestSubmitting}>
            {requestSubmitting ? "Submitting..." : "Submit Request"}
          </Button>
        </DialogActions>
      </Dialog>

      <Menu
        open={Boolean(shiftMenuAnchorEl)}
        onClose={closeShiftMenu}
        anchorEl={shiftMenuAnchorEl}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        transformOrigin={{ vertical: "top", horizontal: "center" }}
      >
        {Object.entries(SHIFT_TYPES).map(([key, config]) => (
          <MenuItem key={key} onClick={() => applyShift(key as ShiftType)}>
            {config.label}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
};
