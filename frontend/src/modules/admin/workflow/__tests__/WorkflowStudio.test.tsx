import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkflowStudio } from '../WorkflowStudio';

vi.mock('../../../../services/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'ADMIN', email: 'a@b.com', name: 'Admin' } }),
}));

vi.mock('../../../../services/api', () => ({
  api: {
    get: vi.fn(async () => ({ data: { data: [] } })),
    post: vi.fn(async () => ({ data: { id: 'exec-1' } })),
    put: vi.fn(async () => ({ data: { id: 'wf-1' } })),
  },
  getApiErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

vi.mock('../../../../services/socket.service', () => ({
  subscribeToWorkflow: () => () => {},
}));

// Mock ReactFlow components
vi.mock('reactflow', async () => {
  const actual = await vi.importActual<any>('reactflow');
  const ReactFlow = ({ children, ...props }: any) => (
    <div data-testid="reactflow" {...props}>
      {children}
    </div>
  );

  return {
    ...actual,
    default: ReactFlow,
    ReactFlow,
    ReactFlowProvider: ({ children }: any) => <div>{children}</div>,
    Background: () => <div data-testid="background" />,
    Controls: () => <div data-testid="controls" />,
    MiniMap: () => <div data-testid="minimap" />,
    addEdge: vi.fn(),
    useNodesState: () => [[{ id: '1', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } }], vi.fn(), vi.fn()],
    useEdgesState: () => [[], vi.fn(), vi.fn()],
    useReactFlow: () => ({
      getNodes: vi.fn(() => []),
      getEdges: vi.fn(() => []),
      setNodes: vi.fn(),
      setEdges: vi.fn(),
      fitView: vi.fn(),
    }),
    ConnectionMode: {
      Loose: 'loose',
    },
    Position: {
      Top: 'top',
      Right: 'right',
      Bottom: 'bottom',
      Left: 'left',
    },
    Handle: ({ type, position }: any) => <div data-testid={`handle-${type}-${position}`} />,
  };
});

describe('WorkflowStudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders studio shell and key components', () => {
    render(<WorkflowStudio />);
    expect(screen.getByText('Workflow Builder')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Workflow name')).toBeInTheDocument();
    expect(screen.getByTestId('reactflow')).toBeInTheDocument();
    expect(screen.getByTestId('background')).toBeInTheDocument();
    expect(screen.getByTestId('controls')).toBeInTheDocument();
    expect(screen.getByTestId('minimap')).toBeInTheDocument();
  });

  it('renders toolbox node catalog', () => {
    render(<WorkflowStudio />);
    expect(screen.getByText('Workflow Components')).toBeInTheDocument();
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByText('End')).toBeInTheDocument();
    expect(screen.getByText('Action')).toBeInTheDocument();
  });

  it('shows inspector placeholder when nothing is selected', () => {
    render(<WorkflowStudio />);
    expect(screen.getByText('Select a node to view and edit its properties.')).toBeInTheDocument();
  });
});

