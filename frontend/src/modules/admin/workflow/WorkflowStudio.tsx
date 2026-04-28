declare module './components/Toolbar';
declare module './components/PropertiesPanel';
declare module './nodes/EndNode';
declare module './nodes/ActionNode';
declare module './nodes/ConditionNode';
declare module './nodes/DelayNode';
declare module './nodes/NotificationNode';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Box,
  Paper,
  Theme,
  alpha,
  Alert,
  Snackbar,
  Typography,
  Chip,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  MenuItem,
  CircularProgress,
  Divider,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import ReactFlow, {
  ReactFlowProvider,
  addEdge,
  updateEdge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Connection,
  Edge,
  Node,
  NodeTypes,
  ConnectionMode,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useBeforeUnload, useBlocker, useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { Toolbox } from './components/Toolbox';
import { Toolbar, WorkflowToolbarOption } from './components/Toolbar';
import { PropertiesPanel } from './components/PropertiesPanel';
import { HelpDialog } from './components/HelpDialog';
import { StartNode } from './nodes/StartNode';
import { EndNode } from './nodes/EndNode';
import { ActionNode } from './nodes/ActionNode';
import { ConditionNode } from './nodes/ConditionNode';
import { DelayNode } from './nodes/DelayNode';
import { NotificationNode } from './nodes/NotificationNode';
import { api, getApiErrorMessage } from '../../../services/api';
import { useAuth } from '../../../services/auth';
import { subscribeToWorkflow } from '../../../services/socket.service';

const StudioShell = styled(Box)(({ theme }: { theme: Theme }) => ({
  minHeight: '100vh',
  padding: theme.spacing(1),
  backgroundImage: [
    'radial-gradient(1200px 600px at 10% -10%, rgba(14, 165, 233, 0.18), transparent 60%)',
    'radial-gradient(900px 500px at 85% 0%, rgba(16, 185, 129, 0.16), transparent 55%)',
    'linear-gradient(180deg, #F7F9FC 0%, #EEF2F7 100%)',
  ].join(', '),
  color: theme.palette.text.primary,
  fontFamily: "Space Grotesk, Inter, system-ui, sans-serif",
}));

const StudioSurface = styled(Paper)(({ theme }: { theme: Theme }) => ({
  height: 'calc(100vh - 16px)',
  borderRadius: theme.spacing(1.5),
  background: '#FFFFFF',
  border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
  boxShadow: '0 30px 80px rgba(15, 23, 42, 0.18)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  animation: 'studioFade 420ms ease-out',
  '@keyframes studioFade': {
    from: { opacity: 0, transform: 'translateY(8px)' },
    to: { opacity: 1, transform: 'translateY(0)' },
  },
}));

const StudioFrame = styled(Box)(({ theme }: { theme: Theme }) => ({
  flex: 1,
  display: 'grid',
  gridTemplateColumns: '240px minmax(0, 1fr) 280px',
  gap: theme.spacing(1),
  padding: theme.spacing(1),
  minHeight: 0,
}));

const PanelSurface = styled(Box)(({ theme }: { theme: Theme }) => ({
  height: '100%',
  borderRadius: theme.spacing(1.5),
  border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
  background: alpha('#F8FAFC', 0.7),
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.8)',
  overflow: 'hidden',
}));

const CanvasSurface = styled(Box)(({ theme }: { theme: Theme }) => ({
  position: 'relative',
  borderRadius: theme.spacing(1.5),
  background: '#F8FAFC',
  border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
  boxShadow: '0 10px 24px rgba(15, 23, 42, 0.06)',
  overflow: 'hidden',
}));

const nodeTypes: NodeTypes = {
  start: StartNode,
  end: EndNode,
  action: ActionNode,
  condition: ConditionNode,
  delay: DelayNode,
  notification: NotificationNode,
};

const initialNodes: Node[] = [
  {
    id: '1',
    type: 'start',
    position: { x: 100, y: 100 },
    data: { label: 'Start' },
  },
];

const initialEdges: Edge[] = [];

type WorkflowSnapshot = {
  name: string;
  description: string;
  enabled: boolean;
  triggerType: string;
  triggerConfig: Record<string, any>;
  nodes: Node[];
  edges: Edge[];
};

type WorkflowDraftState = WorkflowSnapshot & {
  selectedWorkflowId: string;
  savedAt?: string | null;
  autosavedAt: string;
};

type WorkflowTemplate = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  icon?: string | null;
  template_data: {
    name: string;
    description?: string;
    enabled: boolean;
    categoryFilter: string[];
    triggerType: string;
    triggerConfig?: Record<string, any>;
    priority: number;
    nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, any> }>;
    edges: Array<{ id: string; source: string; target: string; condition?: string; animated?: boolean }>;
  };
  is_system: boolean;
};

type WorkflowVersion = {
  id: string;
  workflowId: string;
  versionNumber: number;
  snapshot: {
    name: string;
    description?: string;
    triggerType: string;
    nodes: Array<unknown>;
    edges: Array<unknown>;
  };
  changeSummary?: string | null;
  createdBy?: string | null;
  createdAt: string;
};

type WorkflowExecutionListItem = {
  id: string;
  workflow_id: string;
  ticket_id?: string | null;
  status: string;
  current_node_id?: string | null;
  started_at: string;
  completed_at?: string | null;
  error_message?: string | null;
};

type WorkflowExecutionDetail = {
  id: string;
  workflowId: string;
  workflowName: string;
  ticketId?: string | null;
  ticketTitle?: string | null;
  status: string;
  currentNodeId?: string | null;
  startedAt: string;
  completedAt?: string | null;
  errorMessage?: string | null;
  triggerData?: Record<string, any>;
  executionContext?: Record<string, any>;
  steps: Array<{
    id: string;
    nodeId: string;
    nodeType: string;
    status: string;
    startedAt: string;
    completedAt?: string | null;
    inputData?: Record<string, any> | null;
    outputData?: Record<string, any> | null;
    errorMessage?: string | null;
    logs?: Array<Record<string, any>> | null;
  }>;
};

export const WorkflowStudio: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const authTolerantConfig = useMemo(() => ({ skipAuthRedirect: true } as any), []);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const reactFlowInstanceRef = useRef<any>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [workflowName, setWorkflowName] = useState('Untitled Workflow');
  const [workflowDescription, setWorkflowDescription] = useState('');
  const [triggerType, setTriggerType] = useState<'manual' | 'ticket_created' | 'ticket_updated' | 'scheduled' | 'api'>('manual');
  const [triggerConfig, setTriggerConfig] = useState<Record<string, any>>({});
  const [enabled, setEnabled] = useState(true);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('');
  const [workflowOptions, setWorkflowOptions] = useState<WorkflowToolbarOption[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [lastAutosavedAt, setLastAutosavedAt] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationDialogOpen, setValidationDialogOpen] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [toast, setToast] = useState<{ severity: 'success' | 'info' | 'warning' | 'error'; message: string } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executeOpen, setExecuteOpen] = useState(false);
  const [executeTicketId, setExecuteTicketId] = useState('');
  const [recentTickets, setRecentTickets] = useState<Array<{ id: string; display_number?: string; title?: string }>>([]);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [executionEvents, setExecutionEvents] = useState<Array<{ ts: number; status?: string; nodeId?: string; message?: string }>>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateCategory, setTemplateCategory] = useState('');
  const [templateQuery, setTemplateQuery] = useState('');
  const [templateCategoryFilter, setTemplateCategoryFilter] = useState<'all' | string>('all');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [executionsOpen, setExecutionsOpen] = useState(false);
  const [executionsLoading, setExecutionsLoading] = useState(false);
  const [executionDetailLoading, setExecutionDetailLoading] = useState(false);
  const [executionHistory, setExecutionHistory] = useState<WorkflowExecutionListItem[]>([]);
  const [selectedExecutionDetail, setSelectedExecutionDetail] = useState<WorkflowExecutionDetail | null>(null);
  const [importRequestToken, setImportRequestToken] = useState(0);

  const historyRef = useRef<WorkflowSnapshot[]>([]);
  const historyIndexRef = useRef(-1);
  const historyLockRef = useRef(false);
  const historyTimerRef = useRef<number | null>(null);
  const workflowSubscriptionRef = useRef<null | (() => void)>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const draftHydratedRef = useRef(false);
  const restoringDraftRef = useRef(false);
  const launchIntentHandledRef = useRef(false);

  const isFocusedStudio = location.pathname.endsWith('/studio');
  const launchMode = searchParams.get('mode');
  const launchWorkflowId = searchParams.get('workflowId') || '';
  const launchTemplateId = searchParams.get('templateId') || '';

  const canPersist = useMemo(() => user?.role === 'ADMIN', [user?.role]);
  const templateCategories = useMemo(
    () => ['all', ...Array.from(new Set(templates.map((template) => template.category || 'Uncategorized')))],
    [templates]
  );
  const filteredTemplates = useMemo(() => {
    return templates.filter((template) => {
      const category = template.category || 'Uncategorized';
      const matchesCategory = templateCategoryFilter === 'all' || templateCategoryFilter === category;
      const haystack = `${template.name} ${template.description || ''} ${category} ${template.template_data?.triggerType || ''}`.toLowerCase();
      const matchesQuery = !templateQuery.trim() || haystack.includes(templateQuery.trim().toLowerCase());
      return matchesCategory && matchesQuery;
    });
  }, [templateCategoryFilter, templateQuery, templates]);
  const selectedTemplate = useMemo(
    () => filteredTemplates.find((template) => template.id === selectedTemplateId) || filteredTemplates[0] || null,
    [filteredTemplates, selectedTemplateId]
  );
  const validationDetails = useMemo(
    () =>
      validationErrors.map((error) => {
        if (error.includes('Scheduled workflows need a ticket ID')) {
          return {
            error,
            title: 'Scheduled trigger is missing a ticket ID',
            detail:
              'Scheduled workflows need the top Ticket ID field filled in so the automatic scheduler knows which ticket to run against. For manual Run, you can still choose a ticket in the run dialog.',
          };
        }
        if (error.includes('missing recipientMode')) {
          return {
            error,
            title: 'Notification node is incomplete',
            detail:
              'Open the notification node in the inspector and choose who should receive the notification, such as requester, assigned agent, or team manager.',
          };
        }
        if (error.includes('missing action type')) {
          return {
            error,
            title: 'Action node is missing its action type',
            detail:
              'Open the action node in the inspector and select the action to perform, such as add comment, assign ticket, update status, or set priority.',
          };
        }
        if (error.includes('missing expression')) {
          return {
            error,
            title: 'Condition node needs a rule expression',
            detail:
              'Open the condition node and add the expression that decides which path the workflow should follow.',
          };
        }
        if (error.includes('missing durationSeconds')) {
          return {
            error,
            title: 'Delay node is missing a duration',
            detail:
              'Open the delay node and set a duration in seconds or minutes so the workflow knows how long to wait before continuing.',
          };
        }
        if (error.includes('not connected')) {
          return {
            error,
            title: 'A node is disconnected',
            detail: 'Connect that node into the workflow path so execution can move through it correctly.',
          };
        }
        if (error.includes('Start node')) {
          return {
            error,
            title: 'Start node missing',
            detail: 'Every workflow needs one start node so the engine knows where execution begins.',
          };
        }
        if (error.includes('End node')) {
          return {
            error,
            title: 'End node missing',
            detail: 'Every workflow needs an end node so the engine has a valid completion point.',
          };
        }
        return {
          error,
          title: 'Validation issue',
          detail: 'Open the related node or trigger settings and complete the missing configuration.',
        };
      }),
    [validationErrors]
  );
  const blocker = useBlocker(hasChanges);
  const draftStorageKey = useCallback(
    (workflowId?: string | null) => `workflow_studio_draft:${user?.id || 'anon'}:${workflowId || 'new'}`,
    [user?.id]
  );
  const buildDraftState = useCallback(
    (workflowIdOverride?: string | null): WorkflowDraftState => ({
      selectedWorkflowId: workflowIdOverride ?? selectedWorkflowId,
      name: workflowName,
      description: workflowDescription,
      enabled,
      triggerType,
      triggerConfig,
      nodes,
      edges,
      savedAt: lastSavedAt,
      autosavedAt: new Date().toISOString(),
    }),
    [edges, enabled, lastSavedAt, nodes, selectedWorkflowId, triggerConfig, triggerType, workflowDescription, workflowName]
  );
  const writeDraft = useCallback(
    (workflowIdOverride?: string | null) => {
      if (typeof window === 'undefined') return;
      const draft = buildDraftState(workflowIdOverride);
      window.localStorage.setItem(draftStorageKey(workflowIdOverride ?? selectedWorkflowId), JSON.stringify(draft));
      setLastAutosavedAt(draft.autosavedAt);
    },
    [buildDraftState, draftStorageKey, selectedWorkflowId]
  );
  const clearDraft = useCallback(
    (workflowIdOverride?: string | null) => {
      if (typeof window === 'undefined') return;
      window.localStorage.removeItem(draftStorageKey(workflowIdOverride ?? selectedWorkflowId));
    },
    [draftStorageKey, selectedWorkflowId]
  );
  const readDraft = useCallback(
    (workflowIdOverride?: string | null): WorkflowDraftState | null => {
      if (typeof window === 'undefined') return null;
      try {
        const raw = window.localStorage.getItem(draftStorageKey(workflowIdOverride ?? selectedWorkflowId));
        if (!raw) return null;
        return JSON.parse(raw) as WorkflowDraftState;
      } catch {
        return null;
      }
    },
    [draftStorageKey, selectedWorkflowId]
  );
  const statusMeta = useMemo(() => {
    if (hasChanges) {
      return {
        label: 'Unsaved draft',
        detail: lastAutosavedAt ? `Auto-saved ${new Date(lastAutosavedAt).toLocaleString()}` : 'Draft changes not saved to the workflow catalog yet',
      };
    }
    if (lastSavedAt) {
      return {
        label: 'Last saved',
        detail: new Date(lastSavedAt).toLocaleString(),
      };
    }
    return {
      label: 'New draft',
      detail: 'Not saved yet',
    };
  }, [hasChanges, lastAutosavedAt, lastSavedAt]);

  const setHistoryFlags = useCallback(() => {
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  const pushHistory = useCallback((snapshot: WorkflowSnapshot) => {
    if (historyLockRef.current) return;

    const last = historyRef.current[historyIndexRef.current];
    const lastKey = last ? JSON.stringify(last) : '';
    const nextKey = JSON.stringify(snapshot);
    if (lastKey === nextKey) return;

    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    }

    historyRef.current.push(snapshot);
    historyIndexRef.current = historyRef.current.length - 1;
    setHistoryFlags();
  }, [setHistoryFlags]);

  const scheduleHistory = useCallback(() => {
    if (historyTimerRef.current) {
      window.clearTimeout(historyTimerRef.current);
    }
    historyTimerRef.current = window.setTimeout(() => {
      pushHistory({ name: workflowName, description: workflowDescription, enabled, triggerType, triggerConfig, nodes, edges });
    }, 200);
  }, [edges, enabled, nodes, pushHistory, triggerConfig, triggerType, workflowDescription, workflowName]);

  const handleWorkflowNameChange = useCallback((name: string) => {
    setWorkflowName(name);
    setHasChanges(true);
    scheduleHistory();
  }, [scheduleHistory]);

  const handleWorkflowDescriptionChange = useCallback((description: string) => {
    setWorkflowDescription(description);
    setHasChanges(true);
    scheduleHistory();
  }, [scheduleHistory]);

  const handleTriggerTypeChange = useCallback((next: string) => {
    setTriggerType(next as any);
    setHasChanges(true);
    scheduleHistory();
  }, [scheduleHistory]);

  const handleEnabledChange = useCallback((value: boolean) => {
    setEnabled(value);
    setHasChanges(true);
    scheduleHistory();
  }, [scheduleHistory]);

  const updateTriggerConfig = useCallback((field: string, value: any) => {
    setTriggerConfig((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
    scheduleHistory();
  }, [scheduleHistory]);

  const validateConnection = useCallback((connection: Connection): boolean => {
    const sourceNode = nodes.find(n => n.id === connection.source);
    const targetNode = nodes.find(n => n.id === connection.target);

    if (!sourceNode || !targetNode) {
      setConnectionError('Invalid connection: source or target node not found');
      return false;
    }

    if (connection.source === connection.target) {
      setConnectionError('Cannot connect node to itself');
      return false;
    }

    const existingConnection = edges.find(
      edge => edge.source === connection.source && edge.target === connection.target
    );
    if (existingConnection) {
      setConnectionError('Connection already exists');
      return false;
    }

    const invalidConnections = [
      { source: 'end', target: 'start', message: 'Cannot connect End to Start node' },
      { source: 'start', target: 'end', message: 'Cannot directly connect Start to End node' },
    ];

    for (const invalid of invalidConnections) {
      if (sourceNode.type === invalid.source && targetNode.type === invalid.target) {
        setConnectionError(invalid.message);
        return false;
      }
    }

    const visited = new Set<string>();
    const hasCircularDependency = (nodeId: string, targetId: string): boolean => {
      if (nodeId === targetId) return true;
      if (visited.has(nodeId)) return false;
      visited.add(nodeId);

      const outgoingEdges = edges.filter(edge => edge.source === nodeId);
      for (const edge of outgoingEdges) {
        if (hasCircularDependency(edge.target, targetId)) return true;
      }

      if (connection.target === nodeId && connection.source === targetId) {
        return true;
      }

      return false;
    };

    if (connection.source && connection.target && hasCircularDependency(connection.source, connection.target)) {
      setConnectionError('Circular dependency detected');
      return false;
    }

    return true;
  }, [nodes, edges]);

  const onConnect = useCallback(
    (params: Connection | Edge) => {
      if (validateConnection(params as Connection)) {
        const sourceNode = nodes.find((n) => n.id === (params as Connection).source);
        const isConditionSource = sourceNode?.type === 'condition';
        const outgoingCount = isConditionSource
          ? edges.filter((e) => e.source === (params as Connection).source).length
          : 0;
        const condition =
          isConditionSource && outgoingCount === 0
            ? 'true'
            : isConditionSource && outgoingCount === 1
              ? 'false'
              : undefined;

        const nextParams = condition ? ({ ...(params as any), condition } as any) : params;
        setEdges((eds) => addEdge(nextParams, eds));
        setHasChanges(true);
        setConnectionError(null);
        scheduleHistory();
      }
    },
    [edges, nodes, scheduleHistory, setEdges, validateConnection]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/reactflow');
    if (!type || !reactFlowWrapper.current || !reactFlowInstanceRef.current) return;

    const bounds = reactFlowWrapper.current.getBoundingClientRect();
    const position = reactFlowInstanceRef.current.project({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });

    const newNode: Node = {
      id: `${Date.now()}`,
      type,
      position,
      data: { label: type.charAt(0).toUpperCase() + type.slice(1) },
    };
    setNodes((nds) => [...nds, newNode]);
    setHasChanges(true);
    scheduleHistory();
  }, [scheduleHistory, setNodes]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const onNodesDelete = useCallback(() => {
    setHasChanges(true);
    scheduleHistory();
  }, [scheduleHistory]);

  const onEdgesDelete = useCallback(() => {
    setHasChanges(true);
    scheduleHistory();
  }, [scheduleHistory]);

  const onNodeDragStop = useCallback(() => {
    setHasChanges(true);
    scheduleHistory();
  }, [scheduleHistory]);

  const addNode = useCallback((type: string, data?: any) => {
    const newNode: Node = {
      id: `${Date.now()}`,
      type,
      position: { x: Math.random() * 400 + 100, y: Math.random() * 300 + 100 },
      data: data || { label: type.charAt(0).toUpperCase() + type.slice(1) },
    };
    setNodes((nds) => [...nds, newNode]);
    setHasChanges(true);
    scheduleHistory();
  }, [scheduleHistory, setNodes]);

  const updateNodeData = useCallback((nodeId: string, data: any) => {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, ...data } } : node
      )
    );
    setHasChanges(true);
    scheduleHistory();
  }, [scheduleHistory, setNodes]);

  const deleteNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((node) => node.id !== nodeId));
    setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setSelectedNode(null);
    setHasChanges(true);
    scheduleHistory();
  }, [scheduleHistory, setEdges, setNodes]);

  const normalizeNodes = useCallback((input: Node[]) => {
    return input.map((n) => ({
      id: String(n.id),
      type: String(n.type || 'action'),
      position: { x: Number((n as any).position?.x || 0), y: Number((n as any).position?.y || 0) },
      data: (n as any).data || {},
    })) as Node[];
  }, []);

  const normalizeEdges = useCallback((input: Edge[]) => {
    return input.map((e) => ({
      id: String(e.id),
      source: String((e as any).source),
      target: String((e as any).target),
      ...(typeof (e as any).condition === 'string' ? { condition: (e as any).condition } : {}),
      ...(typeof (e as any).animated === 'boolean' ? { animated: (e as any).animated } : {}),
    })) as Edge[];
  }, []);

  const applyDraft = useCallback((draft: WorkflowDraftState) => {
    restoringDraftRef.current = true;
    const nextNodes = normalizeNodes(draft.nodes || []);
    const nextEdges = normalizeEdges(draft.edges || []);
    setSelectedWorkflowId(draft.selectedWorkflowId || '');
    setWorkflowName(draft.name || 'Untitled Workflow');
    setWorkflowDescription(draft.description || '');
    setTriggerType((draft.triggerType || 'manual') as any);
    setTriggerConfig((draft.triggerConfig && typeof draft.triggerConfig === 'object') ? draft.triggerConfig : {});
    setEnabled(Boolean(draft.enabled));
    setNodes(nextNodes);
    setEdges(nextEdges);
    setHasChanges(true);
    setLastSavedAt(draft.savedAt || null);
    setLastAutosavedAt(draft.autosavedAt || null);
    historyLockRef.current = true;
    pushHistory({
      name: draft.name || 'Untitled Workflow',
      description: draft.description || '',
      enabled: Boolean(draft.enabled),
      triggerType: (draft.triggerType || 'manual') as any,
      triggerConfig: (draft.triggerConfig && typeof draft.triggerConfig === 'object') ? draft.triggerConfig : {},
      nodes: nextNodes,
      edges: nextEdges,
    });
    historyLockRef.current = false;
    window.setTimeout(() => {
      restoringDraftRef.current = false;
    }, 0);
  }, [normalizeEdges, normalizeNodes, pushHistory, setEdges, setNodes]);

  const refreshWorkflowLibrary = useCallback(async () => {
    if (!user) return;
    if (user.role !== 'ADMIN' && user.role !== 'MANAGER') return;
    setIsRefreshing(true);
    try {
      const res = await api.get<{ data: any[] }>('/workflows/visual', { params: { limit: 200 }, ...authTolerantConfig });
      const list = Array.isArray(res.data?.data) ? res.data.data : [];
      setWorkflowOptions(
        list.map((w) => ({
          id: w.id,
          name: w.name,
          triggerType: w.triggerType,
          enabled: Boolean(w.enabled),
        }))
      );
    } catch (err) {
      setToast({ severity: 'error', message: getApiErrorMessage(err, 'Failed to refresh workflows') });
    } finally {
      setIsRefreshing(false);
    }
  }, [user]);

  const refreshTemplates = useCallback(async () => {
    if (!user || (user.role !== 'ADMIN' && user.role !== 'MANAGER')) return;
    setTemplatesLoading(true);
    try {
      const res = await api.get<{ data: WorkflowTemplate[] }>('/workflows/templates', authTolerantConfig);
      setTemplates(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch (err) {
      setToast({ severity: 'error', message: getApiErrorMessage(err, 'Failed to load templates') });
    } finally {
      setTemplatesLoading(false);
    }
  }, [user]);

  const refreshVersions = useCallback(async () => {
    if (!selectedWorkflowId) {
      setVersions([]);
      return;
    }
    setVersionsLoading(true);
    try {
      const res = await api.get<{ data: WorkflowVersion[] }>(`/workflows/visual/${selectedWorkflowId}/versions`, authTolerantConfig);
      setVersions(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch (err) {
      setToast({ severity: 'error', message: getApiErrorMessage(err, 'Failed to load workflow history') });
    } finally {
      setVersionsLoading(false);
    }
  }, [selectedWorkflowId]);

  const refreshExecutionHistory = useCallback(async () => {
    if (!selectedWorkflowId) {
      setExecutionHistory([]);
      return;
    }
    setExecutionsLoading(true);
    try {
      const res = await api.get<{ data: WorkflowExecutionListItem[] }>(`/workflows/visual/${selectedWorkflowId}/executions`, authTolerantConfig);
      setExecutionHistory(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch (err) {
      setToast({ severity: 'error', message: getApiErrorMessage(err, 'Failed to load execution history') });
    } finally {
      setExecutionsLoading(false);
    }
  }, [selectedWorkflowId]);

  const loadExecutionDetail = useCallback(async (executionId: string) => {
    setExecutionDetailLoading(true);
    try {
      const res = await api.get<WorkflowExecutionDetail>(`/workflows/visual/executions/${executionId}`, authTolerantConfig);
      setSelectedExecutionDetail(res.data);
    } catch (err) {
      setToast({ severity: 'error', message: getApiErrorMessage(err, 'Failed to load execution detail') });
    } finally {
      setExecutionDetailLoading(false);
    }
  }, []);

  const openVersionsDialog = useCallback(async () => {
    if (!selectedWorkflowId) {
      setToast({ severity: 'warning', message: 'Load or save a workflow first to view version history.' });
      return;
    }
    setVersionsOpen(true);
    await refreshVersions();
  }, [refreshVersions, selectedWorkflowId]);

  const openExecutionsDialog = useCallback(async () => {
    if (!selectedWorkflowId) {
      setToast({ severity: 'warning', message: 'Load or save a workflow first to inspect executions.' });
      return;
    }
    setExecutionsOpen(true);
    setSelectedExecutionDetail(null);
    await refreshExecutionHistory();
  }, [refreshExecutionHistory, selectedWorkflowId]);
  void openVersionsDialog;
  void openExecutionsDialog;

  const openTemplatesDialog = useCallback(async () => {
    setTemplatesOpen(true);
    setTemplateQuery('');
    setTemplateCategoryFilter('all');
    if (templates.length === 0) {
      await refreshTemplates();
    }
  }, [refreshTemplates, templates.length]);

  const loadWorkflowById = useCallback(
    async (id: string) => {
      if (!id) {
        setSelectedWorkflowId('');
        return;
      }
      setIsRefreshing(true);
      try {
        const res = await api.get<any>(`/workflows/visual/${id}`, authTolerantConfig);
        const wf = res.data;
        const nextNodes = normalizeNodes(wf.nodes || []);
        const nextEdges = normalizeEdges(wf.edges || []);
        setSelectedWorkflowId(wf.id);
        setWorkflowName(wf.name || 'Untitled Workflow');
        setWorkflowDescription(wf.description || '');
        setTriggerType((wf.triggerType || 'manual') as any);
        setTriggerConfig((wf.triggerConfig && typeof wf.triggerConfig === 'object') ? wf.triggerConfig : {});
        setEnabled(Boolean(wf.enabled));
        setLastSavedAt(wf.updatedAt || wf.createdAt || new Date().toISOString());
        setLastAutosavedAt(null);
        setNodes(nextNodes);
        setEdges(nextEdges);
        setHasChanges(false);
        historyLockRef.current = true;
        pushHistory({
          name: wf.name || 'Untitled Workflow',
          description: wf.description || '',
          enabled: Boolean(wf.enabled),
          triggerType: (wf.triggerType || 'manual') as any,
          triggerConfig: (wf.triggerConfig && typeof wf.triggerConfig === 'object') ? wf.triggerConfig : {},
          nodes: nextNodes,
          edges: nextEdges,
        });
        historyLockRef.current = false;
        const savedDraft = readDraft(wf.id);
        if (savedDraft) {
          applyDraft(savedDraft);
          setToast({ severity: 'info', message: 'Restored your unsaved draft for this workflow' });
          return;
        }
        setToast({ severity: 'info', message: 'Workflow loaded' });
      } catch (err) {
        setToast({ severity: 'error', message: getApiErrorMessage(err, 'Failed to load workflow') });
      } finally {
        setIsRefreshing(false);
      }
    },
    [applyDraft, authTolerantConfig, normalizeEdges, normalizeNodes, pushHistory, readDraft, setEdges, setNodes]
  );

  const saveWorkflow = useCallback(async () => {
    if (!canPersist) {
      setToast({ severity: 'warning', message: 'Only admins can create or update saved workflows.' });
      return;
    }

    const payload = {
      name: workflowName,
      description: workflowDescription || undefined,
      enabled,
      categoryFilter: [],
      triggerType,
      triggerConfig,
      priority: 0,
      nodes: normalizeNodes(nodes).map((n) => ({
        id: n.id,
        type: n.type,
        position: (n as any).position,
        data: (n as any).data || {},
      })),
      edges: normalizeEdges(edges).map((e) => ({
        id: e.id,
        source: (e as any).source,
        target: (e as any).target,
        condition: (e as any).condition,
        animated: (e as any).animated,
      })),
    };

    setIsSaving(true);
    try {
      const res = selectedWorkflowId
        ? await api.put<any>(`/workflows/visual/${selectedWorkflowId}`, payload, authTolerantConfig)
        : await api.post<any>(`/workflows/visual`, payload, authTolerantConfig);
      const wf = res.data;
      setSelectedWorkflowId(wf.id);
      setHasChanges(false);
      setLastSavedAt(wf.updatedAt || wf.createdAt || new Date().toISOString());
      setLastAutosavedAt(null);
      clearDraft(selectedWorkflowId || null);
      clearDraft(wf.id);
      pushHistory({ name: workflowName, description: workflowDescription, enabled, triggerType, triggerConfig, nodes, edges });
      setToast({ severity: 'success', message: selectedWorkflowId ? 'Workflow updated' : 'Workflow created' });
      await refreshWorkflowLibrary();
    } catch (err) {
      setToast({ severity: 'error', message: getApiErrorMessage(err, 'Failed to save workflow') });
    } finally {
      setIsSaving(false);
    }
  }, [canPersist, clearDraft, edges, enabled, nodes, normalizeEdges, normalizeNodes, refreshWorkflowLibrary, selectedWorkflowId, triggerConfig, triggerType, workflowDescription, workflowName, pushHistory]);

  const saveCurrentAsTemplate = useCallback(() => {
    if (!canPersist) {
      setToast({ severity: 'warning', message: 'Only admins can save workflow templates.' });
      return;
    }
    setTemplateName(workflowName === 'Untitled Workflow' ? '' : workflowName);
    setTemplateDescription(workflowDescription);
    setTemplateCategory('');
    setSaveTemplateOpen(true);
  }, [canPersist, workflowDescription, workflowName]);

  const createTemplate = useCallback(async () => {
    if (!templateName.trim()) {
      setToast({ severity: 'error', message: 'Template name is required.' });
      return;
    }

    setTemplateBusy(true);
    try {
      await api.post('/workflows/templates', {
        name: templateName.trim(),
        description: templateDescription.trim() || undefined,
        category: templateCategory.trim() || undefined,
        templateData: {
          name: workflowName,
          description: workflowDescription || undefined,
          enabled,
          categoryFilter: [],
          triggerType,
          triggerConfig,
          priority: 0,
          nodes: normalizeNodes(nodes).map((n) => ({
            id: n.id,
            type: n.type,
            position: (n as any).position,
            data: (n as any).data || {},
          })),
          edges: normalizeEdges(edges).map((e) => ({
            id: e.id,
            source: (e as any).source,
            target: (e as any).target,
            condition: (e as any).condition,
            animated: (e as any).animated,
          })),
        },
      }, authTolerantConfig);
      setSaveTemplateOpen(false);
      setToast({ severity: 'success', message: 'Workflow template saved' });
      await refreshTemplates();
    } catch (err) {
      setToast({ severity: 'error', message: getApiErrorMessage(err, 'Failed to save template') });
    } finally {
      setTemplateBusy(false);
    }
  }, [edges, enabled, nodes, normalizeEdges, normalizeNodes, refreshTemplates, templateCategory, templateDescription, templateName, triggerConfig, triggerType, workflowDescription, workflowName]);

  const useTemplate = useCallback(async (templateId: string) => {
    setTemplateBusy(true);
    try {
      const res = await api.post<any>(`/workflows/templates/${templateId}/use`, undefined, authTolerantConfig);
      const workflow = res.data;
      setTemplatesOpen(false);
      await refreshWorkflowLibrary();
      await loadWorkflowById(workflow.id);
      setToast({ severity: 'success', message: 'Template added to your workflow library' });
    } catch (err) {
      setToast({ severity: 'error', message: getApiErrorMessage(err, 'Failed to use template') });
    } finally {
      setTemplateBusy(false);
    }
  }, [loadWorkflowById, refreshWorkflowLibrary]);

  const restoreVersion = useCallback(async (versionId: string) => {
    if (!selectedWorkflowId || !canPersist) return;
    setTemplateBusy(true);
    try {
      await api.post(`/workflows/visual/${selectedWorkflowId}/versions/${versionId}/restore`, undefined, authTolerantConfig);
      await loadWorkflowById(selectedWorkflowId);
      await refreshVersions();
      setToast({ severity: 'success', message: 'Workflow restored from version history' });
    } catch (err) {
      setToast({ severity: 'error', message: getApiErrorMessage(err, 'Failed to restore workflow version') });
    } finally {
      setTemplateBusy(false);
    }
  }, [canPersist, loadWorkflowById, refreshVersions, selectedWorkflowId]);

  const createNewWorkflow = useCallback(() => {
    clearDraft(selectedWorkflowId || null);
    setSelectedWorkflowId('');
    setWorkflowName('Untitled Workflow');
    setWorkflowDescription('');
    setTriggerType('manual');
    setTriggerConfig({});
    setEnabled(true);
    setLastSavedAt(null);
    setLastAutosavedAt(null);
    setNodes(initialNodes);
    setEdges(initialEdges);
    setSelectedNode(null);
    setHasChanges(false);
    setValidationErrors([]);
    historyLockRef.current = true;
    pushHistory({ name: 'Untitled Workflow', description: '', enabled: true, triggerType: 'manual', triggerConfig: {}, nodes: initialNodes, edges: initialEdges });
    historyLockRef.current = false;
  }, [clearDraft, pushHistory, selectedWorkflowId, setEdges, setNodes]);

  const exportWorkflow = useCallback(() => {
    const workflowData = {
      id: selectedWorkflowId || null,
      name: workflowName,
      description: workflowDescription,
      enabled,
      triggerType,
      triggerConfig,
      nodes,
      edges,
      timestamp: new Date().toISOString(),
    };
    const dataStr = JSON.stringify(workflowData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${workflowName.replace(/\s+/g, '_')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [edges, enabled, nodes, selectedWorkflowId, triggerConfig, triggerType, workflowDescription, workflowName]);

  const importWorkflow = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const workflowData = JSON.parse(e.target?.result as string);
        const nextNodes = workflowData.nodes || [];
        const nextEdges = workflowData.edges || [];
        setNodes(nextNodes);
        setEdges(nextEdges);
        setWorkflowName(workflowData.name || 'Imported Workflow');
        setWorkflowDescription(workflowData.description || '');
        setTriggerType((workflowData.triggerType || 'manual') as any);
        setTriggerConfig((workflowData.triggerConfig && typeof workflowData.triggerConfig === 'object') ? workflowData.triggerConfig : {});
        setEnabled(workflowData.enabled !== undefined ? Boolean(workflowData.enabled) : true);
        setSelectedWorkflowId('');
        setHasChanges(true);
        historyLockRef.current = true;
        pushHistory({
          name: workflowData.name || 'Imported Workflow',
          description: workflowData.description || '',
          enabled: workflowData.enabled !== undefined ? Boolean(workflowData.enabled) : true,
          triggerType: (workflowData.triggerType || 'manual') as any,
          triggerConfig: (workflowData.triggerConfig && typeof workflowData.triggerConfig === 'object') ? workflowData.triggerConfig : {},
          nodes: nextNodes,
          edges: nextEdges,
        });
        historyLockRef.current = false;
      } catch (error) {
        console.error('Failed to import workflow:', error);
        setToast({ severity: 'error', message: 'Failed to import workflow JSON' });
      }
    };
    reader.readAsText(file);
  }, [pushHistory, setEdges, setNodes]);

  useEffect(() => {
    if (launchIntentHandledRef.current) return;
    if (!launchMode && !launchWorkflowId && !launchTemplateId) return;

    let isCancelled = false;

    const consumeLaunchIntent = async () => {
      const clearParams = () => {
        if (isCancelled) return;
        launchIntentHandledRef.current = true;
        setSearchParams(new URLSearchParams(), { replace: true });
      };

      draftHydratedRef.current = true;

      if (launchMode === 'new') {
        createNewWorkflow();
        clearParams();
        return;
      }

      if (launchMode === 'import') {
        createNewWorkflow();
        setImportRequestToken(Date.now());
        clearParams();
        return;
      }

      if (launchMode === 'template' && launchTemplateId) {
        await useTemplate(launchTemplateId);
        clearParams();
        return;
      }

      if (launchMode === 'draft') {
        const draft = readDraft(launchWorkflowId || '');
        if (draft) {
          applyDraft(draft);
          setToast({ severity: 'info', message: 'Restored your selected draft.' });
        } else if (launchWorkflowId) {
          await loadWorkflowById(launchWorkflowId);
          setToast({ severity: 'warning', message: 'No separate draft was found, so the saved workflow was loaded instead.' });
        } else {
          createNewWorkflow();
          setToast({ severity: 'warning', message: 'No local draft was found, so a fresh workflow was opened instead.' });
        }
        clearParams();
        return;
      }

      if (launchWorkflowId) {
        await loadWorkflowById(launchWorkflowId);
        clearParams();
      }
    };

    void consumeLaunchIntent();

    return () => {
      isCancelled = true;
    };
  }, [
    applyDraft,
    createNewWorkflow,
    launchMode,
    launchTemplateId,
    launchWorkflowId,
    loadWorkflowById,
    readDraft,
    setSearchParams,
    useTemplate,
  ]);

  const validateWorkflow = useCallback((options?: { forExecution?: boolean; openDetails?: boolean }) => {
    const errors: string[] = [];
    const hasStartNode = nodes.some(node => node.type === 'start');
    const hasEndNode = nodes.some(node => node.type === 'end');

    if (!hasStartNode) {
      errors.push('Workflow must have a Start node');
    }
    if (!hasEndNode) {
      errors.push('Workflow must have an End node');
    }

    const connectedNodeIds = new Set<string>();
    edges.forEach(edge => {
      connectedNodeIds.add(edge.source);
      connectedNodeIds.add(edge.target);
    });

    nodes.forEach(node => {
      if (node.type !== 'start' && node.type !== 'end' && !connectedNodeIds.has(node.id)) {
        errors.push(`Node "${node.data?.label || node.id}" is not connected`);
      }
    });

    nodes.forEach(node => {
      if (node.type === 'action' && !node.data?.actionType) {
        errors.push(`Action node "${node.data?.label || node.id}" is missing action type`);
      }
      if (node.type === 'condition' && !node.data?.expression) {
        errors.push(`Condition node "${node.data?.label || node.id}" is missing expression`);
      }
      if (node.type === 'delay' && node.data?.durationSeconds === undefined && node.data?.duration === undefined) {
        errors.push(`Delay node "${node.data?.label || node.id}" is missing durationSeconds`);
      }
      if (node.type === 'notification' && !node.data?.recipientMode) {
        errors.push(`Notification node "${node.data?.label || node.id}" is missing recipientMode`);
      }
    });

    if (!options?.forExecution && triggerType === 'scheduled' && !String(triggerConfig.ticketId || '').trim()) {
      errors.push('Scheduled workflows need a ticket ID in the trigger settings.');
    }

    setValidationErrors(errors);
    if (errors.length > 0 && options?.openDetails) {
      setValidationDialogOpen(true);
    }
    return errors.length === 0;
  }, [nodes, edges, triggerConfig.ticketId, triggerType]);

  const openExecuteDialog = useCallback(async () => {
    const isValid = validateWorkflow({ forExecution: true, openDetails: true });
    if (!isValid) {
      setToast({ severity: 'error', message: 'Fix validation errors before running.' });
      return;
    }
    if (!selectedWorkflowId) {
      setToast({ severity: 'warning', message: 'Save the workflow to the catalog before running it.' });
      return;
    }

    setExecuteTicketId('');
    setExecuteOpen(true);

    try {
      const ticketsRes = await api.get<any>('/tickets', { params: { limit: 20, offset: 0, sort: 'updated_at', order: 'desc' }, ...authTolerantConfig });
      const items = ticketsRes.data?.items || ticketsRes.data?.data?.items || [];
      if (Array.isArray(items)) {
        setRecentTickets(items.map((t: any) => ({ id: t.id, display_number: t.display_number, title: t.title })));
      }
    } catch {
      // ignore - manual UUID entry is always possible
    }
  }, [selectedWorkflowId, validateWorkflow]);

  const executeWorkflow = useCallback(async () => {
    if (!selectedWorkflowId) return;
    const ticketId = executeTicketId.trim();
    if (!ticketId) {
      setToast({ severity: 'error', message: 'Select or paste a ticket ID to run this workflow.' });
      return;
    }

    setIsExecuting(true);
    try {
      const res = await api.post<any>(`/workflows/visual/${selectedWorkflowId}/execute`, { ticketId, triggerData: {} }, authTolerantConfig);
      const execution = res.data;
      setExecuteOpen(false);
      setExecutionId(execution.id);
      setExecutionEvents([{ ts: Date.now(), status: 'running', message: 'Execution started' }]);
      setToast({ severity: 'success', message: 'Workflow execution started' });

      if (workflowSubscriptionRef.current) {
        workflowSubscriptionRef.current();
        workflowSubscriptionRef.current = null;
      }

      workflowSubscriptionRef.current = subscribeToWorkflow(execution.id, (data: any) => {
        setExecutionEvents((prev) => [
          { ts: Date.now(), status: data?.status, nodeId: data?.nodeId, message: data?.message },
          ...prev,
        ].slice(0, 25));
      });
    } catch (err) {
      setToast({ severity: 'error', message: getApiErrorMessage(err, 'Failed to execute workflow') });
    } finally {
      setIsExecuting(false);
    }
  }, [executeTicketId, selectedWorkflowId]);

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyLockRef.current = true;
    historyIndexRef.current -= 1;
    const snapshot = historyRef.current[historyIndexRef.current];
    setWorkflowName(snapshot.name);
    setWorkflowDescription(snapshot.description);
    setEnabled(snapshot.enabled);
    setTriggerType(snapshot.triggerType as any);
    setTriggerConfig(snapshot.triggerConfig || {});
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    setHasChanges(true);
    historyLockRef.current = false;
    setHistoryFlags();
  }, [setEdges, setHistoryFlags, setNodes]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyLockRef.current = true;
    historyIndexRef.current += 1;
    const snapshot = historyRef.current[historyIndexRef.current];
    setWorkflowName(snapshot.name);
    setWorkflowDescription(snapshot.description);
    setEnabled(snapshot.enabled);
    setTriggerType(snapshot.triggerType as any);
    setTriggerConfig(snapshot.triggerConfig || {});
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    setHasChanges(true);
    historyLockRef.current = false;
    setHistoryFlags();
  }, [setEdges, setHistoryFlags, setNodes]);

  useEffect(() => {
    if (historyRef.current.length === 0) {
      pushHistory({ name: workflowName, description: workflowDescription, enabled, triggerType, triggerConfig, nodes, edges });
    }
  }, []);

  useEffect(() => {
    if (draftHydratedRef.current) return;
    const draft = readDraft('');
    draftHydratedRef.current = true;
    if (!draft) return;
    applyDraft(draft);
    setToast({ severity: 'info', message: 'Restored your last unsaved workflow draft' });
  }, [applyDraft, readDraft]);

  useEffect(() => {
    void refreshWorkflowLibrary();
  }, [refreshWorkflowLibrary]);

  useEffect(() => {
    return () => {
      if (workflowSubscriptionRef.current) {
        workflowSubscriptionRef.current();
        workflowSubscriptionRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (selectedTemplateId && filteredTemplates.some((template) => template.id === selectedTemplateId)) return;
    setSelectedTemplateId(filteredTemplates[0]?.id || null);
  }, [filteredTemplates, selectedTemplateId]);

  useEffect(() => {
    if (!executionsOpen || executionDetailLoading || selectedExecutionDetail || executionHistory.length === 0) return;
    void loadExecutionDetail(executionHistory[0].id);
  }, [executionDetailLoading, executionHistory, executionsOpen, loadExecutionDetail, selectedExecutionDetail]);

  useEffect(() => {
    if (!draftHydratedRef.current || restoringDraftRef.current || !hasChanges) return;
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      writeDraft(selectedWorkflowId || null);
    }, 700);

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [
    edges,
    enabled,
    hasChanges,
    nodes,
    selectedWorkflowId,
    triggerConfig,
    triggerType,
    workflowDescription,
    workflowName,
    writeDraft,
  ]);

  useBeforeUnload(
    useCallback((event: BeforeUnloadEvent) => {
      if (!hasChanges) return;
      event.preventDefault();
      event.returnValue = '';
    }, [hasChanges])
  );

  useEffect(() => {
    if (blocker.state === 'blocked') {
      setLeaveDialogOpen(true);
    } else if (blocker.state === 'unblocked') {
      setLeaveDialogOpen(false);
    }
  }, [blocker.state]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      if (event.ctrlKey || event.metaKey) {
        switch (event.key) {
          case 's':
            event.preventDefault();
            void saveWorkflow();
            break;
          case 'z':
            event.preventDefault();
            undo();
            break;
          case 'y':
            event.preventDefault();
            redo();
            break;
          case 'Enter':
            event.preventDefault();
            void openExecuteDialog();
            break;
          case 'e':
            event.preventDefault();
            exportWorkflow();
            break;
        }
      }

      if (event.key === 'Delete' && selectedNode) {
        event.preventDefault();
        deleteNode(selectedNode.id);
      }

      if (event.key === 'Escape') {
        setSelectedNode(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveWorkflow, undo, redo, openExecuteDialog, exportWorkflow, selectedNode, deleteNode]);

  return (
    <StudioShell>
      <StudioSurface elevation={0}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2.25, py: 1.35, borderBottom: 1, borderColor: 'divider' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: '-0.03em' }}>
              {isFocusedStudio ? 'Workflow Studio' : 'Workflow Builder'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {isFocusedStudio
                ? 'Focused canvas view for editing nodes, routing, and execution details.'
                : 'Design automation flows with governance and audit visibility.'}
            </Typography>
          </Box>
          <Chip
            label={hasChanges ? 'Draft' : 'Saved'}
            size="small"
            sx={{
              fontWeight: 700,
              background: hasChanges ? alpha('#F59E0B', 0.14) : alpha('#10B981', 0.16),
              color: hasChanges ? '#B45309' : '#047857',
            }}
          />
        </Box>

        <Toolbar
          mode={isFocusedStudio ? 'focus' : 'full'}
          workflowName={workflowName}
          workflowDescription={workflowDescription}
          onWorkflowNameChange={handleWorkflowNameChange}
          onWorkflowDescriptionChange={handleWorkflowDescriptionChange}
          hasChanges={hasChanges}
          statusLabel={statusMeta.label}
          statusDetail={statusMeta.detail}
          onSave={saveWorkflow}
          onRefresh={refreshWorkflowLibrary}
          onCreateNew={createNewWorkflow}
          onExport={exportWorkflow}
          onImport={importWorkflow}
          onExecute={openExecuteDialog}
          onOpenTemplates={() => void openTemplatesDialog()}
          onSaveAsTemplate={saveCurrentAsTemplate}
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          onHelp={() => setHelpOpen(true)}
          workflowOptions={workflowOptions}
          selectedWorkflowId={selectedWorkflowId}
          onSelectWorkflow={(id) => void loadWorkflowById(id)}
          triggerType={triggerType}
          onTriggerTypeChange={handleTriggerTypeChange}
          enabled={enabled}
          onEnabledChange={handleEnabledChange}
          canPersist={canPersist}
          isRefreshing={isRefreshing}
          isSaving={isSaving}
          isExecuting={isExecuting}
          isTemplateBusy={templateBusy}
          importRequestToken={importRequestToken}
          onBack={isFocusedStudio ? () => navigate('/admin/workflow') : undefined}
        />

        {triggerType !== 'manual' && (
          <Box
            sx={{
              px: 2,
              py: 1.25,
              borderBottom: 1,
              borderColor: 'divider',
              background: alpha('#F8FAFC', 0.8),
            }}
          >
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', md: 'center' }}>
              <Alert severity="info" sx={{ flex: 1, mb: 0 }}>
                {triggerType === 'ticket_created' && 'This workflow runs automatically for new tickets that match the configured criteria.'}
                {triggerType === 'ticket_updated' && 'This workflow runs when saved ticket updates satisfy the trigger rules.'}
                {triggerType === 'scheduled' && 'Scheduled workflows need a ticket reference and interval so the runner knows what to execute.'}
                {triggerType === 'api' && 'API workflows can accept a default ticket reference, then be overridden by the runtime request payload.'}
              </Alert>

              {triggerType === 'scheduled' && (
                <>
                  <TextField
                    size="small"
                    label="Ticket ID"
                    value={triggerConfig.ticketId || ''}
                    onChange={(e) => updateTriggerConfig('ticketId', e.target.value)}
                    sx={{ minWidth: 240, '& .MuiOutlinedInput-root': { background: '#FFFFFF', borderRadius: 2 } }}
                    placeholder="UUID for scheduled runs"
                  />
                  <TextField
                    size="small"
                    type="number"
                    label="Every (minutes)"
                    value={Number(triggerConfig.intervalMinutes ?? 60)}
                    onChange={(e) => updateTriggerConfig('intervalMinutes', Number(e.target.value) || 60)}
                    sx={{ width: 170, '& .MuiOutlinedInput-root': { background: '#FFFFFF', borderRadius: 2 } }}
                    inputProps={{ min: 1, max: 1440 }}
                  />
                </>
              )}

              {triggerType === 'api' && (
                <TextField
                  size="small"
                  label="Default Ticket ID (optional)"
                  value={triggerConfig.ticketId || ''}
                  onChange={(e) => updateTriggerConfig('ticketId', e.target.value)}
                  sx={{ minWidth: 240, '& .MuiOutlinedInput-root': { background: '#FFFFFF', borderRadius: 2 } }}
                  placeholder="Can be overridden by API call"
                />
              )}
            </Stack>
          </Box>
        )}

        <StudioFrame>
          <PanelSurface>
        <Box sx={{ height: '100%', p: 1.5 }}>
          <Toolbox onAddNode={addNode} />
        </Box>
      </PanelSurface>

      <CanvasSurface>
        <ReactFlowProvider>
          <Box ref={reactFlowWrapper} sx={{ height: '100%' }}>
            <ReactFlow
              onInit={(instance) => {
                reactFlowInstanceRef.current = instance;
              }}
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              onNodesDelete={onNodesDelete}
              onEdgesDelete={onEdgesDelete}
              onNodeDragStop={onNodeDragStop}
              onDragOver={onDragOver}
              onDrop={onDrop}
              nodeTypes={nodeTypes}
              connectionMode={ConnectionMode.Loose}
              fitView
              attributionPosition="bottom-left"
              isValidConnection={(connection) => validateConnection(connection)}
              defaultEdgeOptions={{
                style: { stroke: '#1E3A8A', strokeWidth: 2 },
                animated: false,
              }}
              onEdgeUpdate={(oldEdge, connection) => {
                if (!validateConnection(connection)) return;
                setEdges((eds) => updateEdge(oldEdge, connection, eds));
                setHasChanges(true);
                scheduleHistory();
              }}
            >
              <Background color="#CBD5E1" gap={20} />
              <Controls position="top-right" />
              <MiniMap
                position="bottom-right"
                style={{
                  backgroundColor: alpha('#0F172A', 0.04),
                  border: `1px solid ${alpha('#0F172A', 0.12)}`,
                  borderRadius: 10,
                }}
                nodeColor={(node) => {
                  switch (node.type) {
                    case 'start': return '#10B981';
                    case 'end': return '#EF4444';
                    case 'action': return '#2563EB';
                    case 'condition': return '#F59E0B';
                    case 'delay': return '#0EA5E9';
                    case 'notification': return '#14B8A6';
                    default: return '#64748B';
                  }
                }}
              />
            </ReactFlow>
          </Box>
        </ReactFlowProvider>

            {validationErrors.length > 0 && (
              <Button
                onClick={() => setValidationDialogOpen(true)}
                sx={{
                  position: 'absolute',
                  top: 16,
                  left: 16,
                  background: alpha('#FEE2E2', 0.95),
                  color: '#991B1B',
                  px: 2,
                  py: 1,
                  borderRadius: 1.5,
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  border: `1px solid ${alpha('#DC2626', 0.2)}`,
                  textTransform: 'none',
                  justifyContent: 'flex-start',
                }}
              >
                Validation issues: {validationErrors.length} - click for details
              </Button>
            )}

            {executionId && executionEvents.length > 0 && (
              <Box
                sx={{
                  position: 'absolute',
                  top: 16,
                  right: 16,
                  width: 320,
                  maxHeight: 220,
                  overflow: 'auto',
                  background: alpha('#0F172A', 0.86),
                  color: '#E2E8F0',
                  px: 1.5,
                  py: 1.25,
                  borderRadius: 2,
                  border: `1px solid ${alpha('#94A3B8', 0.22)}`,
                  boxShadow: '0 14px 40px rgba(15,23,42,0.35)',
                }}
              >
                <Typography variant="caption" sx={{ fontWeight: 900, letterSpacing: '0.06em', textTransform: 'uppercase', color: alpha('#E2E8F0', 0.8) }}>
                  Execution Feed
                </Typography>
                <Typography variant="caption" sx={{ display: 'block', color: alpha('#E2E8F0', 0.7), mb: 1 }}>
                  {executionId}
                </Typography>
                <Stack spacing={0.75}>
                  {executionEvents.map((e) => (
                    <Box key={e.ts} sx={{ fontSize: '0.78rem', lineHeight: 1.25 }}>
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        {e.status && (
                          <Chip
                            size="small"
                            label={e.status}
                            sx={{
                              height: 18,
                              fontSize: '0.68rem',
                              fontWeight: 800,
                              background: alpha('#38BDF8', 0.18),
                              color: '#7DD3FC',
                            }}
                          />
                        )}
                        {e.nodeId && (
                          <Typography variant="caption" sx={{ color: alpha('#E2E8F0', 0.75) }}>
                            node {e.nodeId}
                          </Typography>
                        )}
                      </Box>
                      {e.message && <Typography variant="caption">{e.message}</Typography>}
                    </Box>
                  ))}
                </Stack>
              </Box>
            )}
          </CanvasSurface>

      <PanelSurface>
        <Box sx={{ height: '100%', p: 1.5 }}>
          <PropertiesPanel
            selectedNode={selectedNode}
            onUpdateNode={updateNodeData}
            onDeleteNode={deleteNode}
          />
        </Box>
          </PanelSurface>
        </StudioFrame>
      </StudioSurface>

      <Snackbar
        open={!!connectionError}
        autoHideDuration={6000}
        onClose={() => setConnectionError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setConnectionError(null)}>
          {connectionError}
        </Alert>
      </Snackbar>

      <Snackbar
        open={!!toast}
        autoHideDuration={5000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={toast?.severity || 'info'} onClose={() => setToast(null)}>
          {toast?.message}
        </Alert>
      </Snackbar>

      <Dialog open={leaveDialogOpen} onClose={() => { blocker.reset?.(); setLeaveDialogOpen(false); }} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>Leave Workflow Studio?</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body1" sx={{ fontWeight: 700, mb: 1 }}>
            You have unsaved workflow changes.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            If you leave now, this draft may return to the last saved version and you may need to rebuild parts of your workflow again.
          </Typography>
          <Alert severity="warning">
            Save your workflow first if you want to keep the current canvas exactly as it is.
          </Alert>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button
            onClick={() => {
              blocker.reset?.();
              setLeaveDialogOpen(false);
            }}
            variant="outlined"
            sx={{ borderRadius: 999, fontWeight: 800 }}
          >
            Stay Here
          </Button>
          <Button
            onClick={() => {
              setLeaveDialogOpen(false);
              blocker.proceed?.();
            }}
            variant="contained"
            color="warning"
            sx={{ borderRadius: 999, fontWeight: 900 }}
          >
            Leave Without Saving
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={validationDialogOpen} onClose={() => setValidationDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>Validation Details</DialogTitle>
        <DialogContent dividers>
          {validationDetails.length === 0 ? (
            <Alert severity="success">No validation issues are currently detected.</Alert>
          ) : (
            <List sx={{ p: 0 }}>
              {validationDetails.map((item, index) => (
                <ListItem
                  key={`${item.error}-${index}`}
                  sx={{
                    alignItems: 'flex-start',
                    px: 0,
                    py: 1.25,
                    borderBottom: index === validationDetails.length - 1 ? 'none' : `1px solid ${alpha('#CBD5E1', 0.7)}`,
                  }}
                >
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 900, mb: 0.5 }}>
                      {item.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
                      {item.detail}
                    </Typography>
                    <Chip size="small" label={item.error} variant="outlined" />
                  </Box>
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setValidationDialogOpen(false)} variant="contained" sx={{ borderRadius: 999, fontWeight: 900 }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={executeOpen} onClose={() => setExecuteOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>Run Workflow</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 1.5 }}>
            Pick a ticket to execute this workflow against. Execution events will stream in the canvas overlay.
          </Alert>

          <TextField
            select
            fullWidth
            size="small"
            label="Recent tickets"
            value={recentTickets.some((t) => t.id === executeTicketId) ? executeTicketId : ''}
            onChange={(e) => setExecuteTicketId(e.target.value)}
            sx={{ mb: 1.25 }}
          >
            <MenuItem value="">Select a ticket...</MenuItem>
            {recentTickets.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {(t.display_number ? `${t.display_number} - ` : '') + (t.title || t.id)}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            fullWidth
            size="small"
            label="Ticket ID (UUID)"
            value={executeTicketId}
            onChange={(e) => setExecuteTicketId(e.target.value)}
            placeholder="e.g. 2a6a62d6-3b63-4ec0-8c31-7f0bfad4f1d0"
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setExecuteOpen(false)} variant="outlined" sx={{ borderRadius: 999, fontWeight: 800 }}>
            Cancel
          </Button>
          <Button
            onClick={() => void executeWorkflow()}
            variant="contained"
            color="success"
            sx={{ borderRadius: 999, fontWeight: 900 }}
            disabled={isExecuting}
            startIcon={isExecuting ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            Run Now
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={versionsOpen} onClose={() => setVersionsOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>Workflow Version History</DialogTitle>
        <DialogContent dividers>
          <Alert severity="info" sx={{ mb: 2 }}>
            Review workflow changes, compare saved snapshots, and restore a previous version when needed.
          </Alert>

          {versionsLoading ? (
            <Box sx={{ py: 6, display: 'grid', placeItems: 'center' }}>
              <CircularProgress />
            </Box>
          ) : versions.length === 0 ? (
            <Alert severity="warning">No version history is available for this workflow yet.</Alert>
          ) : (
            <Stack spacing={1.5}>
              {versions.map((version) => (
                <Paper
                  key={version.id}
                  variant="outlined"
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    background: '#FFFFFF',
                    borderColor: alpha('#CBD5E1', 0.9),
                  }}
                >
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={1.5}
                    justifyContent="space-between"
                    alignItems={{ xs: 'flex-start', md: 'center' }}
                  >
                    <Box>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5, flexWrap: 'wrap' }}>
                        <Chip
                          size="small"
                          label={`Version ${version.versionNumber}`}
                          sx={{
                            background: alpha('#2563EB', 0.12),
                            color: '#1D4ED8',
                            fontWeight: 800,
                          }}
                        />
                        <Typography variant="body2" color="text.secondary">
                          {new Date(version.createdAt).toLocaleString()}
                        </Typography>
                      </Stack>
                      <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
                        {version.snapshot?.name || workflowName}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                        {version.changeSummary || 'Workflow snapshot saved'}
                      </Typography>
                      <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                        <Chip size="small" variant="outlined" label={`Trigger: ${version.snapshot?.triggerType || 'manual'}`} />
                        <Chip size="small" variant="outlined" label={`Nodes: ${version.snapshot?.nodes?.length || 0}`} />
                        <Chip size="small" variant="outlined" label={`Edges: ${version.snapshot?.edges?.length || 0}`} />
                      </Stack>
                    </Box>
                    <Button
                      variant="contained"
                      onClick={() => void restoreVersion(version.id)}
                      disabled={!canPersist || templateBusy}
                      sx={{ borderRadius: 999, fontWeight: 900 }}
                    >
                      Restore
                    </Button>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => void refreshVersions()} variant="outlined" sx={{ borderRadius: 999, fontWeight: 800 }}>
            Refresh
          </Button>
          <Button onClick={() => setVersionsOpen(false)} variant="contained" sx={{ borderRadius: 999, fontWeight: 900 }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={executionsOpen} onClose={() => setExecutionsOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>Execution Detail</DialogTitle>
        <DialogContent dividers>
          <Alert severity="info" sx={{ mb: 2 }}>
            Inspect workflow runs with node-by-node status, execution context, and per-step log data.
          </Alert>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '320px minmax(0, 1fr)' }, gap: 2 }}>
            <Box>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
                  Recent Runs
                </Typography>
                {executionsLoading && <CircularProgress size={18} />}
              </Stack>

              {executionHistory.length === 0 && !executionsLoading ? (
                <Alert severity="warning">No executions have been recorded for this workflow yet.</Alert>
              ) : (
                <List sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 0, overflow: 'hidden' }}>
                  {executionHistory.map((run) => (
                    <ListItemButton
                      key={run.id}
                      selected={selectedExecutionDetail?.id === run.id}
                      onClick={() => void loadExecutionDetail(run.id)}
                      sx={{ alignItems: 'flex-start', py: 1.25 }}
                    >
                      <ListItemText
                        primary={run.ticket_id ? `Ticket ${run.ticket_id.slice(0, 8)}` : run.id}
                        secondary={`${run.status.toUpperCase()} - ${new Date(run.started_at).toLocaleString()}`}
                        primaryTypographyProps={{ fontWeight: 800 }}
                        secondaryTypographyProps={{ sx: { mt: 0.25 } }}
                      />
                    </ListItemButton>
                  ))}
                </List>
              )}
            </Box>

            <Box
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 2,
                background: '#FFFFFF',
                boxShadow: '0 10px 20px rgba(15, 23, 42, 0.04)',
                p: 2,
                minHeight: 360,
              }}
            >
              {executionDetailLoading ? (
                <Box sx={{ py: 8, display: 'grid', placeItems: 'center' }}>
                  <CircularProgress />
                </Box>
              ) : selectedExecutionDetail ? (
                <Stack spacing={2}>
                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                      <Typography variant="h6" sx={{ fontWeight: 900 }}>
                        {selectedExecutionDetail.workflowName}
                      </Typography>
                      <Chip
                        size="small"
                        label={selectedExecutionDetail.status.toUpperCase()}
                        sx={{
                          background: alpha(
                            selectedExecutionDetail.status === 'completed'
                              ? '#10B981'
                              : selectedExecutionDetail.status === 'failed'
                                ? '#EF4444'
                                : '#2563EB',
                            0.14
                          ),
                          color:
                            selectedExecutionDetail.status === 'completed'
                              ? '#047857'
                              : selectedExecutionDetail.status === 'failed'
                                ? '#B91C1C'
                                : '#1D4ED8',
                          fontWeight: 800,
                        }}
                      />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      Started {new Date(selectedExecutionDetail.startedAt).toLocaleString()}
                      {selectedExecutionDetail.completedAt
                        ? ` | Completed ${new Date(selectedExecutionDetail.completedAt).toLocaleString()}`
                        : ''}
                    </Typography>
                    {selectedExecutionDetail.ticketTitle && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        Ticket: {selectedExecutionDetail.ticketTitle}
                      </Typography>
                    )}
                    {selectedExecutionDetail.errorMessage && (
                      <Alert severity="error" sx={{ mt: 1.5 }}>
                        {selectedExecutionDetail.errorMessage}
                      </Alert>
                    )}
                  </Box>

                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip size="small" variant="outlined" label={`Current node: ${selectedExecutionDetail.currentNodeId || 'N/A'}`} />
                    <Chip size="small" variant="outlined" label={`Steps: ${selectedExecutionDetail.steps.length}`} />
                  </Stack>

                  <Divider />

                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 900, mb: 1 }}>
                      Trigger & Execution Context
                    </Typography>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 1.5,
                        borderRadius: 2,
                        background: '#F8FAFC',
                        borderColor: alpha('#CBD5E1', 0.9),
                      }}
                    >
                      <Typography component="pre" sx={{ m: 0, fontSize: '0.78rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {JSON.stringify(
                          {
                            triggerData: selectedExecutionDetail.triggerData || {},
                            executionContext: selectedExecutionDetail.executionContext || {},
                          },
                          null,
                          2
                        )}
                      </Typography>
                    </Paper>
                  </Box>

                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 900, mb: 1 }}>
                      Per-Node Logs
                    </Typography>
                    <Stack spacing={1}>
                      {selectedExecutionDetail.steps.map((step) => (
                        <Paper
                          key={step.id}
                          variant="outlined"
                          sx={{
                            p: 1.5,
                            borderRadius: 2,
                            background: '#FFFFFF',
                            borderColor: alpha('#CBD5E1', 0.9),
                          }}
                        >
                          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between" sx={{ mb: 1 }}>
                            <Box>
                              <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
                                {step.nodeId} ({step.nodeType})
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {new Date(step.startedAt).toLocaleString()}
                                {step.completedAt ? ` -> ${new Date(step.completedAt).toLocaleString()}` : ''}
                              </Typography>
                            </Box>
                            <Chip
                              size="small"
                              label={step.status.toUpperCase()}
                              sx={{
                                alignSelf: 'flex-start',
                                background: alpha(
                                  step.status === 'completed' ? '#10B981' : step.status === 'failed' ? '#EF4444' : '#2563EB',
                                  0.14
                                ),
                                color: step.status === 'completed' ? '#047857' : step.status === 'failed' ? '#B91C1C' : '#1D4ED8',
                                fontWeight: 800,
                              }}
                            />
                          </Stack>
                          {step.errorMessage && (
                            <Alert severity="error" sx={{ mb: 1 }}>
                              {step.errorMessage}
                            </Alert>
                          )}
                          <Typography component="pre" sx={{ m: 0, fontSize: '0.76rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {JSON.stringify(
                              {
                                input: step.inputData || {},
                                output: step.outputData || {},
                                logs: step.logs || [],
                              },
                              null,
                              2
                            )}
                          </Typography>
                        </Paper>
                      ))}
                    </Stack>
                  </Box>
                </Stack>
              ) : (
                <Alert severity="info">Select an execution from the left to inspect its details.</Alert>
              )}
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => void refreshExecutionHistory()} variant="outlined" sx={{ borderRadius: 999, fontWeight: 800 }}>
            Refresh
          </Button>
          <Button onClick={() => setExecutionsOpen(false)} variant="contained" sx={{ borderRadius: 999, fontWeight: 900 }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={templatesOpen} onClose={() => setTemplatesOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>Workflow Templates</DialogTitle>
        <DialogContent dividers>
          <Alert severity="info" sx={{ mb: 2 }}>
            Start from reusable patterns for triage, SLA governance, notifications, and approval flows.
          </Alert>

          {templatesLoading ? (
            <Box sx={{ py: 6, display: 'grid', placeItems: 'center' }}>
              <CircularProgress />
            </Box>
          ) : templates.length === 0 ? (
            <Alert severity="warning">No workflow templates are available yet.</Alert>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '280px minmax(0, 1fr)' }, gap: 2 }}>
              <Box>
                <TextField
                  fullWidth
                  size="small"
                  label="Search templates"
                  value={templateQuery}
                  onChange={(e) => setTemplateQuery(e.target.value)}
                  sx={{ mb: 1.5 }}
                />
                <TextField
                  fullWidth
                  size="small"
                  select
                  label="Category"
                  value={templateCategoryFilter}
                  onChange={(e) => setTemplateCategoryFilter(e.target.value)}
                  sx={{ mb: 1.5 }}
                >
                  {templateCategories.map((category) => (
                    <MenuItem key={category} value={category}>
                      {category === 'all' ? 'All categories' : category}
                    </MenuItem>
                  ))}
                </TextField>

                <List sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 0, overflow: 'hidden' }}>
                  {filteredTemplates.map((template) => (
                    <ListItemButton
                      key={template.id}
                      selected={template.id === selectedTemplate?.id}
                      onClick={() => setSelectedTemplateId(template.id)}
                      sx={{ alignItems: 'flex-start', py: 1.25 }}
                    >
                      <ListItemText
                        primary={template.name}
                        secondary={`${template.category || 'Uncategorized'} - ${template.template_data?.triggerType || 'manual'}`}
                        primaryTypographyProps={{ fontWeight: 800 }}
                        secondaryTypographyProps={{ sx: { mt: 0.25 } }}
                      />
                    </ListItemButton>
                  ))}
                </List>
              </Box>

              <Box
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 2,
                  background: '#FFFFFF',
                  boxShadow: '0 10px 20px rgba(15, 23, 42, 0.04)',
                  p: 2,
                  minHeight: 320,
                }}
              >
                {selectedTemplate ? (
                  <Stack spacing={1.5}>
                    <Box>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, flexWrap: 'wrap' }}>
                        <Typography variant="h6" sx={{ fontWeight: 900 }}>
                          {selectedTemplate.name}
                        </Typography>
                        <Chip size="small" label={selectedTemplate.category || 'Uncategorized'} />
                        <Chip
                          size="small"
                          label={selectedTemplate.is_system ? 'System Template' : 'Custom Template'}
                          sx={{
                            background: selectedTemplate.is_system ? alpha('#2563EB', 0.12) : alpha('#10B981', 0.14),
                            color: selectedTemplate.is_system ? '#1D4ED8' : '#047857',
                            fontWeight: 800,
                          }}
                        />
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        {selectedTemplate.description || 'No description provided.'}
                      </Typography>
                    </Box>

                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Chip size="small" variant="outlined" label={`Trigger: ${selectedTemplate.template_data?.triggerType || 'manual'}`} />
                      <Chip size="small" variant="outlined" label={`Nodes: ${selectedTemplate.template_data?.nodes?.length || 0}`} />
                      <Chip size="small" variant="outlined" label={`Edges: ${selectedTemplate.template_data?.edges?.length || 0}`} />
                    </Stack>

                    <Divider />

                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 900, mb: 0.75 }}>
                        Preview Nodes
                      </Typography>
                      <Stack spacing={0.75}>
                        {(selectedTemplate.template_data?.nodes || []).map((node: any) => (
                          <Box
                            key={node.id}
                            sx={{
                              p: 1,
                              borderRadius: 1.5,
                              background: '#F8FAFC',
                              border: 1,
                              borderColor: 'divider',
                            }}
                          >
                            <Typography variant="body2" sx={{ fontWeight: 800 }}>
                              {node.data?.label || node.id}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {String(node.type).toUpperCase()}
                            </Typography>
                          </Box>
                        ))}
                      </Stack>
                    </Box>

                    <Box sx={{ pt: 1 }}>
                      <Button
                        variant="contained"
                        onClick={() => void useTemplate(selectedTemplate.id)}
                        disabled={templateBusy || !canPersist}
                        sx={{ borderRadius: 999, fontWeight: 900 }}
                      >
                        Use Template
                      </Button>
                    </Box>
                  </Stack>
                ) : (
                  <Alert severity="info">No template matches the current filters.</Alert>
                )}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => void refreshTemplates()} variant="outlined" sx={{ borderRadius: 999, fontWeight: 800 }}>
            Refresh
          </Button>
          <Button onClick={() => setTemplatesOpen(false)} variant="contained" sx={{ borderRadius: 999, fontWeight: 900 }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={saveTemplateOpen} onClose={() => setSaveTemplateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>Save Workflow as Template</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Save the current workflow as a reusable starter for future automations.
          </Typography>

          <TextField
            fullWidth
            size="small"
            label="Template Name"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            sx={{ mb: 1.5 }}
          />
          <TextField
            fullWidth
            size="small"
            label="Category"
            value={templateCategory}
            onChange={(e) => setTemplateCategory(e.target.value)}
            sx={{ mb: 1.5 }}
            placeholder="e.g. Incident Management"
          />
          <TextField
            fullWidth
            size="small"
            label="Description"
            value={templateDescription}
            onChange={(e) => setTemplateDescription(e.target.value)}
            multiline
            minRows={3}
          />

          <Divider sx={{ my: 2 }} />

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip size="small" variant="outlined" label={`Trigger: ${triggerType}`} />
            <Chip size="small" variant="outlined" label={`Nodes: ${nodes.length}`} />
            <Chip size="small" variant="outlined" label={`Edges: ${edges.length}`} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setSaveTemplateOpen(false)} variant="outlined" sx={{ borderRadius: 999, fontWeight: 800 }}>
            Cancel
          </Button>
          <Button
            onClick={() => void createTemplate()}
            variant="contained"
            disabled={templateBusy}
            startIcon={templateBusy ? <CircularProgress size={16} color="inherit" /> : undefined}
            sx={{ borderRadius: 999, fontWeight: 900 }}
          >
            Save Template
          </Button>
        </DialogActions>
      </Dialog>

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </StudioShell>
  );
};

export default WorkflowStudio;

