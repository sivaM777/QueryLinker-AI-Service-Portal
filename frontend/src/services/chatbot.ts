import { api } from "./api";

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  intent?: string;
  confidence?: number;
  kbArticlesSuggested?: string[];
  ticketCreatedId?: string;
  autoResolved?: boolean;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  userId: string | null;
  sessionToken: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export const chatbotApi = {
  createSession: async (sessionToken?: string): Promise<{ sessionId: string; sessionToken: string }> => {
    const res = await api.post("/chatbot/session", { sessionToken });
    return res.data;
  },

  sendMessage: async (
    message: string,
    sessionToken?: string
  ): Promise<{
    message: ChatMessage;
    kbArticles?: Array<{ id: string; title: string; body: string }>;
    shouldCreateTicket: boolean;
    ticketCreated: { id: string } | null;
    sessionToken: string;
  }> => {
    const res = await api.post("/chatbot/message", { message, sessionToken });
    return res.data;
  },

  getMessages: async (sessionId: string, limit = 50): Promise<ChatMessage[]> => {
    const res = await api.get(`/chatbot/session/${sessionId}/messages`, { params: { limit } });
    return res.data;
  },

  createTicketFromChat: async (
    sessionId: string,
    title: string,
    description: string
  ): Promise<{ ticketId: string }> => {
    const res = await api.post("/chatbot/create-ticket", { sessionId, title, description });
    return res.data;
  },
};
