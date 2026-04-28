import { api } from "./api";
import type { TicketListFilter } from "./ticketProductivity";

export type BoardKind = "FREEFORM" | "DATA_DRIVEN";
export type BoardMode = "GUIDED" | "FLEXIBLE";
export type BoardVisibility = "PERSONAL" | "SHARED";
export type BoardSourceEntity = "TICKET";
export type BoardSwimlaneMode = "NONE" | "MANUAL" | "FIELD";
export type BoardMemberRole = "OWNER" | "EDITOR" | "VIEWER";

export type BoardDropUpdateRule = {
  field: "status" | "priority" | "assigned_team" | "assigned_agent";
  value: string | null;
};

export type BoardSummary = {
  id: string;
  organization_id: string | null;
  owner_user_id: string;
  owner_name?: string | null;
  team_id: string | null;
  team_name?: string | null;
  name: string;
  description: string | null;
  kind: BoardKind;
  mode: BoardMode | null;
  visibility: BoardVisibility;
  source_entity: BoardSourceEntity | null;
  base_filters: TicketListFilter[];
  column_field: string | null;
  swimlane_mode: BoardSwimlaneMode;
  swimlane_field: string | null;
  created_at: string;
  updated_at: string;
  column_count?: number;
  freeform_card_count?: number;
  can_edit?: boolean;
  can_manage?: boolean;
};

export type BoardColumn = {
  id: string;
  board_id: string;
  name: string;
  position: number;
  color: string | null;
  archived: boolean;
  mapped_value: string | null;
  filter_config: TicketListFilter[];
  drop_update: BoardDropUpdateRule | null;
  created_at: string;
};

export type BoardSwimlane = {
  id: string;
  key: string | null;
  name: string;
  position: number;
  color?: string | null;
};

export type BoardCard = {
  id: string;
  board_card_id?: string | null;
  kind: "FREEFORM" | "TICKET";
  title: string;
  description: string | null;
  display_number?: string | null;
  type?: "INCIDENT" | "SERVICE_REQUEST" | "CHANGE" | "PROBLEM" | null;
  status?: "OPEN" | "IN_PROGRESS" | "WAITING_FOR_CUSTOMER" | "RESOLVED" | "CLOSED" | null;
  priority: "LOW" | "MEDIUM" | "HIGH";
  assigned_team?: string | null;
  assigned_team_name?: string | null;
  assigned_agent?: string | null;
  assigned_agent_name?: string | null;
  requester_name?: string | null;
  requester_department?: string | null;
  due_date?: string | null;
  tags: string[];
  checklist_summary?: { total: number; completed: number };
  column_id: string | null;
  swimlane_key: string | null;
  updated_at: string;
  comment_count: number;
  attachment_count: number;
};

export type BoardMember = {
  id: string;
  board_id: string;
  user_id: string;
  member_role: BoardMemberRole;
  created_by: string;
  created_at: string;
  name: string;
  email: string;
  role: "ADMIN" | "MANAGER" | "AGENT" | "EMPLOYEE";
};

export type BoardViewResponse = {
  board: BoardSummary & { can_edit: boolean; can_manage: boolean };
  columns: BoardColumn[];
  swimlanes: BoardSwimlane[];
  cards: BoardCard[];
  members: BoardMember[];
};

export type BoardCardActivityItem = {
  id: string;
  type: "EVENT" | "COMMENT" | "INTERNAL_NOTE" | "ATTACHMENT";
  actor_name: string | null;
  actor_id: string | null;
  body: string | null;
  filename?: string | null;
  attachment_id?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type CreateBoardInput = {
  name: string;
  description?: string | null;
  kind: BoardKind;
  mode?: BoardMode | null;
  visibility?: BoardVisibility;
  team_id?: string | null;
  saved_view_id?: string | null;
  base_filters?: TicketListFilter[];
  column_field?: "status" | "priority" | "assigned_team" | "assigned_agent" | null;
  swimlane_mode?: BoardSwimlaneMode;
  swimlane_field?: "assigned_team" | "assigned_agent" | "priority" | "requester_department" | null;
  preset_key?: "OPS_QUEUE_STATUS" | "HIGH_PRIORITY_ESCALATIONS" | "AGENT_WORK_QUEUE" | "PERSONAL_FREEFORM" | null;
};

export const listBoards = async () => {
  const response = await api.get<BoardSummary[]>("/boards");
  return response.data;
};

export const getBoard = async (boardId: string) => {
  const response = await api.get<BoardSummary>(`/boards/${boardId}`);
  return response.data;
};

export const createBoard = async (input: CreateBoardInput) => {
  const response = await api.post<BoardSummary>("/boards", input);
  return response.data;
};

export const updateBoard = async (
  boardId: string,
  input: Partial<Pick<BoardSummary, "name" | "description" | "visibility" | "team_id" | "column_field" | "swimlane_mode" | "swimlane_field">>
) => {
  const response = await api.patch<BoardSummary>(`/boards/${boardId}`, input);
  return response.data;
};

export const deleteBoard = async (boardId: string) => {
  await api.delete(`/boards/${boardId}`);
};

export const getBoardView = async (boardId: string) => {
  const response = await api.get<BoardViewResponse>(`/boards/${boardId}/view`);
  return response.data;
};

export const createBoardColumn = async (
  boardId: string,
  input: {
    name: string;
    color?: string | null;
    mapped_value?: string | null;
    filter_config?: TicketListFilter[];
    drop_update?: BoardDropUpdateRule | null;
    position?: number;
  }
) => {
  const response = await api.post<BoardColumn>(`/boards/${boardId}/columns`, input);
  return response.data;
};

export const createBoardSwimlane = async (
  boardId: string,
  input: { name: string; mapped_value?: string | null; color?: string | null; position?: number }
) => {
  const response = await api.post(`/boards/${boardId}/swimlanes`, input);
  return response.data;
};

export const createBoardCard = async (
  boardId: string,
  input: {
    title: string;
    description?: string | null;
    priority?: "LOW" | "MEDIUM" | "HIGH";
    assignee_user_id?: string | null;
    due_date?: string | null;
    tags?: string[];
    checklist_summary?: { total: number; completed: number };
    column_id?: string | null;
    swimlane_id?: string | null;
  }
) => {
  const response = await api.post(`/boards/${boardId}/cards`, input);
  return response.data;
};

export const updateBoardCard = async (
  boardId: string,
  cardId: string,
  input: Partial<{
    title: string;
    description: string | null;
    priority: "LOW" | "MEDIUM" | "HIGH";
    assignee_user_id: string | null;
    due_date: string | null;
    tags: string[];
    checklist_summary: { total: number; completed: number };
    column_id: string | null;
    swimlane_id: string | null;
  }>
) => {
  const response = await api.patch(`/boards/${boardId}/cards/${cardId}`, input);
  return response.data;
};

export const deleteBoardCard = async (boardId: string, cardId: string) => {
  await api.delete(`/boards/${boardId}/cards/${cardId}`);
};

export const moveBoardCard = async (
  boardId: string,
  cardId: string,
  input: {
    destination_column_id: string;
    destination_swimlane_key?: string | null;
    ordered_card_ids?: string[];
  }
) => {
  const response = await api.post(`/boards/${boardId}/cards/${cardId}/move`, input);
  return response.data;
};

export const getBoardCardActivity = async (boardId: string, cardId: string) => {
  const response = await api.get<BoardCardActivityItem[]>(`/boards/${boardId}/cards/${cardId}/activity`);
  return response.data;
};

export const addBoardCardComment = async (
  boardId: string,
  cardId: string,
  input: { body: string; visibility?: "REQUESTER_COMMENT" | "INTERNAL_NOTE" }
) => {
  const response = await api.post(`/boards/${boardId}/cards/${cardId}/comments`, input);
  return response.data;
};

export const addBoardCardAttachment = async (boardId: string, cardId: string, file: File) => {
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post(`/boards/${boardId}/cards/${cardId}/attachments`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

export const getBoardAttachmentDownloadUrl = (boardId: string, cardId: string, attachmentId: string) =>
  `${import.meta.env.VITE_API_URL || "/api/v1"}/boards/${boardId}/cards/${cardId}/attachments/${attachmentId}`;

export const getBoardMembers = async (boardId: string) => {
  const response = await api.get<BoardMember[]>(`/boards/${boardId}/members`);
  return response.data;
};

export const addBoardMember = async (
  boardId: string,
  input: { user_id: string; member_role?: BoardMemberRole }
) => {
  const response = await api.post<BoardMember>(`/boards/${boardId}/members`, input);
  return response.data;
};

export const removeBoardMember = async (boardId: string, userId: string) => {
  await api.delete(`/boards/${boardId}/members/${userId}`);
};
