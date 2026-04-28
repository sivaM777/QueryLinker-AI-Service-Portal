import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toolbox } from '../components/Toolbox';

describe('Toolbox', () => {
  const defaultProps = {
    onAddNode: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders toolbox with all node types', () => {
    render(<Toolbox {...defaultProps} />);
    
    expect(screen.getByText('Workflow Components')).toBeInTheDocument();
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByText('End')).toBeInTheDocument();
    expect(screen.getByText('Action')).toBeInTheDocument();
    expect(screen.getByText('Condition')).toBeInTheDocument();
    expect(screen.getByText('Delay')).toBeInTheDocument();
    expect(screen.getByText('Notification')).toBeInTheDocument();
  });

  it('shows node descriptions', () => {
    render(<Toolbox {...defaultProps} />);
    
    expect(screen.getByText(/Entry point for manual/i)).toBeInTheDocument();
    expect(screen.getByText(/Mark the terminal point/i)).toBeInTheDocument();
    expect(screen.getByText(/Assign tickets/i)).toBeInTheDocument();
    expect(screen.getByText(/Branch the workflow/i)).toBeInTheDocument();
    expect(screen.getByText(/Pause the run/i)).toBeInTheDocument();
    expect(screen.getByText(/Create an in-app notification/i)).toBeInTheDocument();
  });

  it('calls onAddNode with correct node type when node is clicked', async () => {
    const user = userEvent.setup();
    const onAddNode = vi.fn();
    render(<Toolbox onAddNode={onAddNode} />);
    
    const startNode = screen.getByText('Start').closest('div[role="button"]');
    await user.click(startNode!);
    
    expect(onAddNode).toHaveBeenCalledWith('start', expect.any(Object));
  });

  it('sets dataTransfer on drag start', () => {
    render(<Toolbox {...defaultProps} />);
    
    const startNode = screen.getByText('Start').closest('div[role="button"]');
    const dataTransfer = {
      setData: vi.fn(),
      effectAllowed: '',
    };
    
    fireEvent.dragStart(startNode!, { dataTransfer });
    
    expect(dataTransfer.setData).toHaveBeenCalledWith('application/reactflow', 'start');
    expect(dataTransfer.effectAllowed).toBe('move');
  });

  it('renders node icons', () => {
    render(<Toolbox {...defaultProps} />);
    
    // Check for SVG icons (they should be present in the DOM)
    const icons = document.querySelectorAll('svg');
    expect(icons.length).toBeGreaterThan(0);
  });
});
