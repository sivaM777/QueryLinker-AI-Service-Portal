import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Stack,
  FormControlLabel,
  IconButton,
  MenuItem,
  Switch,
  TextField,
  Theme,
  Tooltip,
  Typography,
} from '@mui/material';
import { styled, alpha } from '@mui/material/styles';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import CancelRoundedIcon from '@mui/icons-material/CancelRounded';
import { Node } from 'reactflow';

const Panel = styled(Box)(({ theme }: { theme: Theme }) => ({
  background: '#FFFFFF',
  border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
  borderRadius: theme.spacing(1.5),
  padding: theme.spacing(1.5),
  height: '100%',
  overflowY: 'auto',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.8)',
}));

const PanelField = styled(TextField)(({ theme }: { theme: Theme }) => ({
  '& .MuiOutlinedInput-root': {
    background: '#F8FAFC',
    borderRadius: theme.spacing(1.25),
  },
  '& .MuiInputLabel-root': {
    background: '#FFFFFF',
    paddingLeft: theme.spacing(0.6),
    paddingRight: theme.spacing(0.6),
    borderRadius: theme.spacing(0.6),
  },
}));

const PanelButton = styled(Button)(() => ({
  borderRadius: 999,
  textTransform: 'none',
  fontWeight: 800,
  boxShadow: 'none',
}));

type NodeData = Record<string, any>;

const notificationTypes = [
  'TICKET_CREATED',
  'TICKET_ASSIGNED',
  'TICKET_STATUS_CHANGED',
  'TICKET_COMMENTED',
  'TICKET_SLA_RISK',
  'TICKET_ESCALATED',
  'SLA_FIRST_RESPONSE_BREACH',
  'SLA_RESOLUTION_BREACH',
  'APPROVAL_REQUESTED',
] as const;

const actionTypes = [
  { value: 'assign_ticket', label: 'Assign Ticket' },
  { value: 'set_priority', label: 'Set Priority' },
  { value: 'send_email', label: 'Send Email' },
  { value: 'add_comment', label: 'Add Comment' },
  { value: 'create_notification', label: 'Create Notification' },
  { value: 'wait_for_condition', label: 'Wait For Condition' },
  { value: 'webhook', label: 'Call Webhook' },
] as const;

interface PropertiesPanelProps {
  selectedNode: Node | null;
  onUpdateNode: (nodeId: string, data: any) => void;
  onDeleteNode: (nodeId: string) => void;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ selectedNode, onUpdateNode, onDeleteNode }) => {
  const [nodeData, setNodeData] = useState<NodeData>({});
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (selectedNode) {
      setNodeData((selectedNode.data as NodeData) || {});
      setHasChanges(false);
    }
  }, [selectedNode]);

  const handleDataChange = (field: string, value: any) => {
    setNodeData((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleConfigChange = (field: string, value: any) => {
    setNodeData((prev) => ({ ...prev, config: { ...(prev.config || {}), [field]: value } }));
    setHasChanges(true);
  };

  const handleSave = () => {
    if (!selectedNode) return;
    onUpdateNode(selectedNode.id, nodeData);
    setHasChanges(false);
  };

  const handleCancel = () => {
    if (!selectedNode) return;
    setNodeData((selectedNode.data as NodeData) || {});
    setHasChanges(false);
  };

  const handleDelete = () => {
    if (!selectedNode) return;
    onDeleteNode(selectedNode.id);
  };

  const title = useMemo(() => {
    const type = (selectedNode?.type || 'node').toString();
    return `${type.charAt(0).toUpperCase()}${type.slice(1)} Inspector`;
  }, [selectedNode?.type]);

  if (!selectedNode) {
    return (
      <Panel>
        <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 900 }}>
          Inspector
        </Typography>
        <Alert severity="info" sx={{ mb: 1.25 }}>
          Select a node to view and edit its properties.
        </Alert>
        <Typography variant="body2" color="text.secondary">
          Click any node on the canvas to configure routing, conditions, actions, and notifications.
        </Typography>
      </Panel>
    );
  }

  const renderBaseFields = () => (
    <>
      <PanelField
        fullWidth
        label="Label"
        value={nodeData.label || ''}
        onChange={(e) => handleDataChange('label', e.target.value)}
        sx={{ mb: 1.25 }}
        size="small"
      />
      <PanelField
        fullWidth
        label="Description"
        value={nodeData.description || ''}
        onChange={(e) => handleDataChange('description', e.target.value)}
        sx={{ mb: 1.25 }}
        size="small"
        multiline
        minRows={2}
      />
    </>
  );

  const renderActionFields = () => {
    const current = String(nodeData.actionType || 'assign_ticket');
    const config = (nodeData.config || {}) as Record<string, any>;

    return (
      <>
        <PanelField
          fullWidth
          label="Action"
          value={current}
          onChange={(e) => handleDataChange('actionType', e.target.value)}
          sx={{ mb: 1.25 }}
          select
          size="small"
        >
          {actionTypes.map((a) => (
            <MenuItem key={a.value} value={a.value}>
              {a.label}
            </MenuItem>
          ))}
        </PanelField>

        {current === 'assign_ticket' && (
          <>
            <PanelField
              fullWidth
              label="Assigned Team ID (optional)"
              value={config.assignedTeamId || config.teamId || ''}
              onChange={(e) => handleConfigChange('assignedTeamId', e.target.value)}
              sx={{ mb: 1.25 }}
              size="small"
              placeholder="UUID of a team"
            />
            <PanelField
              fullWidth
              label="Assigned Agent ID (optional)"
              value={config.assignedAgentId || config.assigneeId || ''}
              onChange={(e) => handleConfigChange('assignedAgentId', e.target.value)}
              sx={{ mb: 1.25 }}
              size="small"
              placeholder="UUID of an agent"
            />
          </>
        )}

        {current === 'set_priority' && (
          <PanelField
            fullWidth
            label="Priority"
            value={config.priority || 'MEDIUM'}
            onChange={(e) => handleConfigChange('priority', e.target.value)}
            sx={{ mb: 1.25 }}
            select
            size="small"
          >
            <MenuItem value="LOW">LOW</MenuItem>
            <MenuItem value="MEDIUM">MEDIUM</MenuItem>
            <MenuItem value="HIGH">HIGH</MenuItem>
          </PanelField>
        )}

        {current === 'send_email' && (
          <>
            <PanelField
              fullWidth
              label="To (optional)"
              value={config.to || ''}
              onChange={(e) => handleConfigChange('to', e.target.value)}
              sx={{ mb: 1.25 }}
              size="small"
              placeholder="Leave blank to email the requester"
            />
            <PanelField
              fullWidth
              label="Subject"
              value={config.subject || 'Workflow notification'}
              onChange={(e) => handleConfigChange('subject', e.target.value)}
              sx={{ mb: 1.25 }}
              size="small"
            />
            <PanelField
              fullWidth
              label="Message"
              value={config.body || config.message || ''}
              onChange={(e) => handleConfigChange('body', e.target.value)}
              sx={{ mb: 1.25 }}
              size="small"
              multiline
              minRows={3}
            />
          </>
        )}

        {current === 'add_comment' && (
          <>
            <PanelField
              fullWidth
              label="Comment"
              value={config.body || ''}
              onChange={(e) => handleConfigChange('body', e.target.value)}
              sx={{ mb: 1.25 }}
              size="small"
              multiline
              minRows={3}
              placeholder="Write a customer-facing comment or internal note"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={Boolean(config.isInternal)}
                  onChange={(e) => handleConfigChange('isInternal', e.target.checked)}
                />
              }
              label="Internal note"
              sx={{ mb: 1.25 }}
            />
          </>
        )}

        {current === 'create_notification' && (
          <>
            <PanelField
              fullWidth
              label="Recipient"
              value={config.recipientMode || 'requester'}
              onChange={(e) => handleConfigChange('recipientMode', e.target.value)}
              sx={{ mb: 1.25 }}
              select
              size="small"
            >
              <MenuItem value="requester">Requester (employee)</MenuItem>
              <MenuItem value="assigned_agent">Assigned agent</MenuItem>
              <MenuItem value="team_manager">Team manager</MenuItem>
            </PanelField>
            <PanelField
              fullWidth
              label="Type"
              value={config.type || 'TICKET_STATUS_CHANGED'}
              onChange={(e) => handleConfigChange('type', e.target.value)}
              sx={{ mb: 1.25 }}
              select
              size="small"
            >
              {notificationTypes.map((t) => (
                <MenuItem key={t} value={t}>
                  {t}
                </MenuItem>
              ))}
            </PanelField>
            <PanelField
              fullWidth
              label="Title"
              value={config.title || 'Workflow notification'}
              onChange={(e) => handleConfigChange('title', e.target.value)}
              sx={{ mb: 1.25 }}
              size="small"
            />
            <PanelField
              fullWidth
              label="Body"
              value={config.body || config.message || ''}
              onChange={(e) => handleConfigChange('body', e.target.value)}
              sx={{ mb: 1.25 }}
              size="small"
              multiline
              minRows={3}
            />
          </>
        )}

        {current === 'wait_for_condition' && (
          <>
            <PanelField
              fullWidth
              label="Condition expression"
              value={config.condition || "ticket.status == 'RESOLVED'"}
              onChange={(e) => handleConfigChange('condition', e.target.value)}
              sx={{ mb: 1.25 }}
              size="small"
              placeholder="ticket.status == 'RESOLVED'"
            />
            <PanelField
              fullWidth
              label="Timeout (ms)"
              value={Number(config.timeoutMs ?? 60000)}
              onChange={(e) => handleConfigChange('timeoutMs', Number(e.target.value) || 60000)}
              sx={{ mb: 1.25 }}
              size="small"
              type="number"
              inputProps={{ min: 5000, max: 900000, step: 1000 }}
            />
            <PanelField
              fullWidth
              label="Poll interval (ms)"
              value={Number(config.pollIntervalMs ?? 5000)}
              onChange={(e) => handleConfigChange('pollIntervalMs', Number(e.target.value) || 5000)}
              sx={{ mb: 1.25 }}
              size="small"
              type="number"
              inputProps={{ min: 1000, max: 30000, step: 500 }}
            />
          </>
        )}

        {current === 'webhook' && (
          <>
            <PanelField
              fullWidth
              label="URL"
              value={config.url || ''}
              onChange={(e) => handleConfigChange('url', e.target.value)}
              sx={{ mb: 1.25 }}
              size="small"
              placeholder="https://example.com/webhook"
            />
            <PanelField
              fullWidth
              label="Method"
              value={config.method || 'POST'}
              onChange={(e) => handleConfigChange('method', e.target.value)}
              sx={{ mb: 1.25 }}
              select
              size="small"
            >
              <MenuItem value="POST">POST</MenuItem>
              <MenuItem value="PUT">PUT</MenuItem>
              <MenuItem value="PATCH">PATCH</MenuItem>
              <MenuItem value="GET">GET</MenuItem>
            </PanelField>
            <PanelField
              fullWidth
              label="Body (JSON)"
              value={config.body ? JSON.stringify(config.body, null, 2) : ''}
              onChange={(e) => {
                try {
                  handleConfigChange('body', e.target.value.trim() ? JSON.parse(e.target.value) : null);
                } catch {
                  // Keep as raw string until valid; execution will likely fail and surface error in run logs.
                  handleConfigChange('body', e.target.value);
                }
              }}
              sx={{ mb: 1.25 }}
              size="small"
              multiline
              minRows={4}
              placeholder='{"ticketId":"${ticket.id}"}'
            />
          </>
        )}
      </>
    );
  };

  const renderConditionFields = () => (
    <>
      <PanelField
        fullWidth
        label="Expression"
        value={nodeData.expression || "ticket.priority == 'HIGH'"}
        onChange={(e) => handleDataChange('expression', e.target.value)}
        sx={{ mb: 1.25 }}
        size="small"
        placeholder="ticket.status == 'OPEN'"
      />
      <Alert severity="info" sx={{ mb: 1.25 }}>
        Use simple expressions like `ticket.priority == 'HIGH'` or `ticket.status != 'CLOSED'`.
      </Alert>
    </>
  );

  const renderDelayFields = () => (
    <>
      <PanelField
        fullWidth
        label="Duration (seconds)"
        type="number"
        value={Number(nodeData.durationSeconds ?? nodeData.duration ?? 0)}
        onChange={(e) => handleDataChange('durationSeconds', Number(e.target.value) || 0)}
        sx={{ mb: 1.25 }}
        size="small"
        inputProps={{ min: 0, max: 900, step: 5 }}
      />
      <Alert severity="info" sx={{ mb: 1.25 }}>
        Delay nodes cap at 900 seconds to avoid blocking the worker forever.
      </Alert>
    </>
  );

  const renderNotificationFields = () => (
    <>
      <PanelField
        fullWidth
        label="Recipient"
        value={nodeData.recipientMode || 'requester'}
        onChange={(e) => handleDataChange('recipientMode', e.target.value)}
        sx={{ mb: 1.25 }}
        select
        size="small"
      >
        <MenuItem value="requester">Requester (employee)</MenuItem>
        <MenuItem value="assigned_agent">Assigned agent</MenuItem>
        <MenuItem value="team_manager">Team manager</MenuItem>
      </PanelField>
      <PanelField
        fullWidth
        label="Type"
        value={nodeData.type || 'TICKET_STATUS_CHANGED'}
        onChange={(e) => handleDataChange('type', e.target.value)}
        sx={{ mb: 1.25 }}
        select
        size="small"
      >
        {notificationTypes.map((t) => (
          <MenuItem key={t} value={t}>
            {t}
          </MenuItem>
        ))}
      </PanelField>
      <PanelField
        fullWidth
        label="Title"
        value={nodeData.title || ''}
        onChange={(e) => handleDataChange('title', e.target.value)}
        sx={{ mb: 1.25 }}
        size="small"
      />
      <PanelField
        fullWidth
        label="Message"
        value={nodeData.message || ''}
        onChange={(e) => handleDataChange('message', e.target.value)}
        sx={{ mb: 1.25 }}
        size="small"
        multiline
        minRows={3}
      />
    </>
  );

  const nodeType = String(selectedNode.type || 'node');

  return (
    <Panel>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.25 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 900, lineHeight: 1.1 }}>
            {title}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5, flexWrap: 'wrap' }}>
            <Chip
              label={`Type: ${nodeType}`}
              size="small"
              variant="outlined"
              sx={{ fontWeight: 800 }}
            />
            <Typography variant="caption" color="text.secondary">
              Node ID: {selectedNode.id}
            </Typography>
          </Stack>
        </Box>

        <Tooltip title="Delete node" arrow>
          <IconButton
            onClick={handleDelete}
            size="small"
            sx={{
              background: alpha('#FEE2E2', 0.6),
              border: `1px solid ${alpha('#DC2626', 0.18)}`,
              color: '#B91C1C',
              '&:hover': { background: alpha('#FEE2E2', 0.9) },
            }}
          >
            <DeleteOutlineRoundedIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {hasChanges && (
        <Alert severity="warning" sx={{ mb: 1.25 }}>
          You have unsaved node changes.
        </Alert>
      )}

      {renderBaseFields()}

      <Divider sx={{ my: 1.25 }} />

      {nodeType === 'action' && renderActionFields()}
      {nodeType === 'condition' && renderConditionFields()}
      {nodeType === 'delay' && renderDelayFields()}
      {nodeType === 'notification' && renderNotificationFields()}

      {(nodeType === 'start' || nodeType === 'end') && (
        <Alert severity="info" sx={{ mb: 1.25 }}>
          This node controls the workflow path. Connect it to other nodes to define execution order.
        </Alert>
      )}

      <Box sx={{ mt: 1.5, display: 'flex', gap: 1 }}>
        <PanelButton
          onClick={handleSave}
          disabled={!hasChanges}
          startIcon={<SaveOutlinedIcon />}
          variant="contained"
          fullWidth
          size="small"
        >
          Apply
        </PanelButton>
        <PanelButton
          onClick={handleCancel}
          disabled={!hasChanges}
          startIcon={<CancelRoundedIcon />}
          variant="outlined"
          fullWidth
          size="small"
        >
          Reset
        </PanelButton>
      </Box>
    </Panel>
  );
};
