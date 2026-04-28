import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelpDialog } from '../components/HelpDialog';

describe('HelpDialog', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dialog when open is true', () => {
    render(<HelpDialog {...defaultProps} />);
    
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Workflow Studio Help')).toBeInTheDocument();
  });

  it('does not render dialog when open is false', () => {
    render(<HelpDialog {...defaultProps} open={false} />);
    
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('displays keyboard shortcuts section', () => {
    render(<HelpDialog {...defaultProps} />);
    
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Ctrl')).toBeInTheDocument();
    expect(screen.getByText('S')).toBeInTheDocument();
    expect(screen.getByText('Save workflow')).toBeInTheDocument();
  });

  it('displays node types section', () => {
    render(<HelpDialog {...defaultProps} />);
    
    expect(screen.getByText('Node Types')).toBeInTheDocument();
    expect(screen.getByText('Start Node')).toBeInTheDocument();
    expect(screen.getByText('Beginning of the workflow')).toBeInTheDocument();
  });

  it('displays workflow tips section', () => {
    render(<HelpDialog {...defaultProps} />);
    
    expect(screen.getByText('Workflow Tips')).toBeInTheDocument();
    expect(screen.getByText('Always start with a Start node and end with an End node')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HelpDialog {...defaultProps} onClose={onClose} />);
    
    const closeButton = screen.getByText('Close');
    await user.click(closeButton);
    
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders node icons', () => {
    render(<HelpDialog {...defaultProps} />);
    
    expect(screen.getByText('🚀')).toBeInTheDocument();
    expect(screen.getByText('🏁')).toBeInTheDocument();
    expect(screen.getByText('⚙️')).toBeInTheDocument();
  });
});
