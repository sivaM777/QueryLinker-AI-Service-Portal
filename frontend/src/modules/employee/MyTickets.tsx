import React from "react";
import { SmartTicketWorkspace } from "../../components/tickets/SmartTicketWorkspace";

export const MyTickets: React.FC = () => {
  return (
    <SmartTicketWorkspace
      endpoint="/tickets/my"
      title="My Tickets"
      subtitle="Track every request, save personal views, and chart what matters without losing your place."
      detailPath={(ticketId) => `/app/tickets/${ticketId}`}
      createTicketPath="/app/create-ticket"
      createTicketLabel="Create Ticket"
    />
  );
};
