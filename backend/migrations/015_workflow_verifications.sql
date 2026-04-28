-- Workflow verification tracking table
-- Stores user feedback on whether auto-resolution worked (YES/NO)

CREATE TABLE IF NOT EXISTS workflow_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    approval_id UUID NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    worked BOOLEAN NOT NULL,
    notes TEXT,
    verified_by UUID NOT NULL REFERENCES users(id),
    verified_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(approval_id)
);

-- Index for quick lookups
CREATE INDEX idx_workflow_verifications_ticket_id ON workflow_verifications(ticket_id);
CREATE INDEX idx_workflow_verifications_approval_id ON workflow_verifications(approval_id);

-- Success metrics tracking table
CREATE TABLE IF NOT EXISTS workflow_success_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    total_attempts INT DEFAULT 0,
    successful_resolutions INT DEFAULT 0,
    failed_resolutions INT DEFAULT 0,
    escalated_count INT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(category, action)
);

-- Function to update metrics on verification
CREATE OR REPLACE FUNCTION update_workflow_metrics()
RETURNS TRIGGER AS $$
BEGIN
    -- Update or insert metrics for this category/action
    INSERT INTO workflow_success_metrics (category, action, total_attempts, successful_resolutions, failed_resolutions)
    SELECT 
        t.category,
        'auto_resolution',
        1,
        CASE WHEN NEW.worked THEN 1 ELSE 0 END,
        CASE WHEN NEW.worked THEN 0 ELSE 1 END
    FROM tickets t
    WHERE t.id = NEW.ticket_id
    ON CONFLICT (category, action) DO UPDATE SET
        total_attempts = workflow_success_metrics.total_attempts + 1,
        successful_resolutions = workflow_success_metrics.successful_resolutions + CASE WHEN NEW.worked THEN 1 ELSE 0 END,
        failed_resolutions = workflow_success_metrics.failed_resolutions + CASE WHEN NEW.worked THEN 0 ELSE 1 END,
        updated_at = now();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update metrics
CREATE TRIGGER workflow_verification_metrics
    AFTER INSERT ON workflow_verifications
    FOR EACH ROW
    EXECUTE FUNCTION update_workflow_metrics();
