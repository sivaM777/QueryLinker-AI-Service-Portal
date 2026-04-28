import React from "react";
import { Box, Paper, Typography, Stepper, Step, StepLabel, Chip, LinearProgress, Tooltip } from "@mui/material";
import { formatDistanceToNow } from "date-fns";
import {
  Create as CreateIcon,
  Psychology as AIIcon,
  Route as RouteIcon,
  Assignment as AssignIcon,
  CheckCircle as ResolveIcon,
  Notifications as NotifyIcon,
  Person as PersonIcon,
} from "@mui/icons-material";

interface TicketEvent {
  id?: string;
  action: string;
  performed_by?: string;
  performed_by_name?: string;
  timestamp: string;
  [key: string]: any;
}

interface TicketFlowProps {
  ticketId: string;
  status: "OPEN" | "IN_PROGRESS" | "WAITING_FOR_CUSTOMER" | "RESOLVED" | "CLOSED";
  category?: string | null;
  aiConfidence?: number | null;
  assignedTeam?: string | null;
  assignedAgent?: string | null;
  sourceType?: string;
  events?: TicketEvent[];
  createdAt?: string;
}

const steps = [
  { label: "Ticket Created", icon: CreateIcon, key: "created" },
  { label: "AI Classification", icon: AIIcon, key: "classification" },
  { label: "Intelligent Routing", icon: RouteIcon, key: "routing" },
  { label: "Assignment", icon: AssignIcon, key: "assignment" },
  { label: "Notification Sent", icon: NotifyIcon, key: "notification" },
  { label: "Resolution", icon: ResolveIcon, key: "resolution" },
];

export const TicketFlowVisualization: React.FC<TicketFlowProps> = ({
  status,
  category,
  aiConfidence,
  assignedTeam,
  assignedAgent,
  sourceType,
  events = [],
  createdAt,
}) => {
  const parseJsonish = React.useCallback((value: unknown): Record<string, any> | null => {
    if (!value) return null;
    if (typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, any>;
    }
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, any>;
        }
      } catch {
        return null;
      }
    }
    return null;
  }, []);

  const normalizedEvents = React.useMemo(
    () =>
      (events || []).map((event) => {
        const payload = parseJsonish(event.new_value);
        return {
          ...event,
          normalizedAction: String(event.action || "").toUpperCase(),
          normalizedStage: String(payload?.stage || "").toUpperCase(),
        };
      }),
    [events, parseJsonish]
  );

  const getLatestEventByActions = (actions: string[]): TicketEvent | null => {
    const wanted = new Set(actions.map((a) => a.toUpperCase()));
    const found = [...normalizedEvents]
      .reverse()
      .find(
        (event) =>
          wanted.has((event as any).normalizedAction) || wanted.has((event as any).normalizedStage)
      );
    if (!found) return null;
    const payload = parseJsonish((found as any).new_value);
    const normalizedAction = String((found as any).normalizedAction || "");
    const stageAction = typeof payload?.stage === "string" ? payload.stage : undefined;
    const { normalizedStage, ...rest } = found as TicketEvent & {
      normalizedAction?: string;
      normalizedStage?: string;
    };
    return {
      ...rest,
      action: stageAction || normalizedAction || rest.action,
    };
  };

  const getStepEvent = (stepKey: string): TicketEvent | null => {
    if (stepKey === "created" && createdAt) {
      return { action: "Ticket Created", timestamp: createdAt, performed_by: "System" };
    }

    if (stepKey === "classification") {
      return (
        getLatestEventByActions(["AI_CLASSIFIED", "COMPLEXITY_SCORED"]) ||
        (category || aiConfidence != null
          ? { action: "AI_CLASSIFIED", timestamp: createdAt || new Date().toISOString(), performed_by: "System" }
          : null)
      );
    }

    if (stepKey === "routing") {
      return (
        getLatestEventByActions(["AI_ROUTING_APPLIED", "AI_ROUTING_EVALUATED"]) ||
        (assignedTeam || assignedAgent
          ? { action: "AI_ROUTING_APPLIED", timestamp: createdAt || new Date().toISOString(), performed_by: "System" }
          : null)
      );
    }

    if (stepKey === "assignment") {
      return (
        getLatestEventByActions(["ASSIGNED", "AI_ROUTING_APPLIED"]) ||
        (assignedTeam || assignedAgent
          ? { action: "ASSIGNED", timestamp: createdAt || new Date().toISOString(), performed_by: "System" }
          : null)
      );
    }

    if (stepKey === "notification") {
      return (
        getLatestEventByActions(["NOTIFICATION_SENT"]) ||
        (status !== "OPEN"
          ? { action: "NOTIFICATION_SENT", timestamp: createdAt || new Date().toISOString(), performed_by: "System" }
          : null)
      );
    }

    if (stepKey === "resolution") {
      const resolvedEvent = [...normalizedEvents].reverse().find((event) => {
        const action = (event as any).normalizedAction as string;
        if (action === "CLOSED") return true;
        const payload = parseJsonish((event as any).new_value);
        const nextStatus = String(payload?.status || payload?.toStatus || "").toUpperCase();
        return nextStatus === "RESOLVED" || nextStatus === "CLOSED";
      });
      if (resolvedEvent) {
        const { normalizedAction, normalizedStage, ...rest } = resolvedEvent as TicketEvent & {
          normalizedAction?: string;
          normalizedStage?: string;
        };
        return rest;
      }
      return status === "RESOLVED" || status === "CLOSED"
        ? { action: "STATUS_CHANGED", timestamp: createdAt || new Date().toISOString(), performed_by: "System" }
        : null;
    }

    return null;
  };

  const getActiveStep = () => {
    const completed = [
      true,
      Boolean(getStepEvent("classification")),
      Boolean(getStepEvent("routing")),
      Boolean(getStepEvent("assignment")),
      Boolean(getStepEvent("notification")),
      status === "RESOLVED" || status === "CLOSED",
    ];

    const firstIncompleteIndex = completed.findIndex((isDone) => !isDone);
    return firstIncompleteIndex === -1 ? steps.length : firstIncompleteIndex;
  };

  const activeStep = getActiveStep();

  return (
    <Paper sx={{ p: 3, mb: 3, background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", color: "white", borderRadius: '16px', boxShadow: '0 10px 20px -10px rgba(102, 126, 234, 0.5)' }}>
      <Typography variant="h6" gutterBottom sx={{ color: "white", fontWeight: 700, mb: 3 }}>
        Ticket Processing Flow
      </Typography>
      
      {sourceType && (
        <Chip
          label={`Source: ${sourceType}`}
          size="small"
          sx={{ mb: 2, bgcolor: "rgba(255,255,255,0.2)", color: "white", fontWeight: 600 }}
        />
      )}

      <Stepper activeStep={activeStep} alternativeLabel sx={{ 
          mt: 2,
          '& .MuiStepLabel-label': { color: 'rgba(255,255,255,0.7) !important' },
          '& .MuiStepLabel-label.Mui-active': { color: 'white !important', fontWeight: 700 },
          '& .MuiStepLabel-label.Mui-completed': { color: 'white !important' },
          '& .MuiStepConnector-line': { borderColor: 'rgba(255,255,255,0.2)' }
      }}>
        {steps.map((step, index) => {
          const StepIcon = step.icon;
          const isCompleted = index < activeStep;
          const isActive = index === activeStep;
          const stepEvent = getStepEvent(step.key);
          const performerName = stepEvent?.performed_by_name || stepEvent?.performed_by || "System";

          return (
            <Step key={step.key} completed={isCompleted} active={isActive}>
              <StepLabel
                StepIconComponent={() => (
                  <Tooltip title={stepEvent ? `${stepEvent.action} - ${new Date(stepEvent.timestamp).toLocaleString()}` : step.label}>
                  <Box
                    sx={{
                      width: 56,
                      height: 56,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      bgcolor: isCompleted
                        ? "white"
                        : isActive
                        ? "rgba(255,255,255,0.3)"
                        : "rgba(255,255,255,0.1)",
                      color: isCompleted ? "#667eea" : "white",
                      border: isActive ? '2px solid white' : 'none',
                      transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                      boxShadow: isActive ? "0 0 0 4px rgba(255,255,255,0.2)" : "none",
                      transform: isActive ? 'scale(1.1)' : 'scale(1)',
                    }}
                  >
                    <StepIcon fontSize={isActive ? "medium" : "small"} />
                  </Box>
                  </Tooltip>
                )}
              >
                <Box sx={{ mt: 1 }}>
                  <Typography
                    variant="body2"
                    sx={{
                      color: isCompleted || isActive ? "white" : "rgba(255,255,255,0.6)",
                      fontWeight: isActive ? 700 : 500,
                      display: "block",
                      fontSize: '0.875rem'
                    }}
                  >
                    {step.label}
                  </Typography>
                  
                  {stepEvent && (
                    <Box sx={{ mt: 0.5 }}>
                       <Typography
                        variant="caption"
                        sx={{
                          color: "rgba(255,255,255,0.8)",
                          fontSize: "0.7rem",
                          display: "block",
                          lineHeight: 1.2,
                          mb: 0.5
                        }}
                      >
                        {formatDistanceToNow(new Date(stepEvent.timestamp), { addSuffix: true })}
                      </Typography>
                      {performerName && performerName !== "System" && (
                        <Chip 
                            label={performerName}
                            size="small" 
                            icon={<PersonIcon sx={{ fontSize: '12px !important' }} />}
                            sx={{ 
                                height: 20, 
                                fontSize: '0.65rem', 
                                bgcolor: 'rgba(255,255,255,0.2)', 
                                color: 'white',
                                '& .MuiChip-icon': { color: 'white' },
                                maxWidth: '100%'
                            }} 
                        />
                      )}
                    </Box>
                  )}
                </Box>
              </StepLabel>
            </Step>
          );
        })}
      </Stepper>

      {/* Additional Info */}
      <Box sx={{ mt: 3, display: "flex", flexWrap: "wrap", gap: 2 }}>
        {category && (
          <Box sx={{ bgcolor: "rgba(255,255,255,0.2)", p: 1.5, borderRadius: 2, flex: 1, minWidth: 200 }}>
            <Typography variant="caption" sx={{ display: "block", opacity: 0.9 }}>
              AI Category
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {category}
            </Typography>
            {aiConfidence !== null && aiConfidence !== undefined && (
              <Box sx={{ mt: 1 }}>
                <LinearProgress
                  variant="determinate"
                  value={(aiConfidence ?? 0) * 100}
                  sx={{
                    height: 6,
                    borderRadius: 3,
                    bgcolor: "rgba(255,255,255,0.3)",
                    "& .MuiLinearProgress-bar": {
                      bgcolor: "white",
                    },
                  }}
                />
                <Typography variant="caption" sx={{ mt: 0.5, display: "block" }}>
                  Confidence: {Math.round((aiConfidence ?? 0) * 100)}%
                </Typography>
              </Box>
            )}
          </Box>
        )}

        {assignedTeam && (
          <Box sx={{ bgcolor: "rgba(255,255,255,0.2)", p: 1.5, borderRadius: 2, flex: 1, minWidth: 200 }}>
            <Typography variant="caption" sx={{ display: "block", opacity: 0.9 }}>
              Assigned Team
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {assignedTeam}
            </Typography>
          </Box>
        )}


        {assignedAgent && (
          <Box sx={{ bgcolor: "rgba(255,255,255,0.2)", p: 1.5, borderRadius: 2, flex: 1, minWidth: 200 }}>
            <Typography variant="caption" sx={{ display: "block", opacity: 0.9 }}>
              Assigned Agent
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {assignedAgent}
            </Typography>
          </Box>
        )}
      </Box>
    </Paper>
  );
};
