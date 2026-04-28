import React from "react";
import { SmartTicketWorkspace } from "../../components/tickets/SmartTicketWorkspace";

export const TicketInbox: React.FC = () => {
  return (
    <SmartTicketWorkspace
      endpoint="/tickets"
      title="Tickets"
      subtitle="Run triage, save focused views, edit queues inline, and chart the current workload without leaving the list."
      detailPath={(ticketId) => `/admin/tickets/${ticketId}`}
    />
  );
};
