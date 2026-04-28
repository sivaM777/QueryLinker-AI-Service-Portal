import { pool } from "../../config/db.js";
import { getIO } from "../../websocket/socket-server.js";

const emitBoardRoomEvent = (boardId: string, eventName: string, payload: Record<string, unknown>) => {
  const io = getIO();
  if (!io) return;
  io.to(`board:${boardId}`).emit(eventName, payload);
};

export const broadcastBoardEvent = (
  boardId: string,
  eventName:
    | "board:board-updated"
    | "board:card-created"
    | "board:card-updated"
    | "board:card-moved"
    | "board:card-deleted"
    | "board:comment-added"
    | "board:attachment-added",
  payload: Record<string, unknown>
) => {
  emitBoardRoomEvent(boardId, eventName, { boardId, ...payload });
};

export const broadcastBoardUpdated = (boardId: string, reason: string, extra?: Record<string, unknown>) => {
  broadcastBoardEvent(boardId, "board:board-updated", { reason, ...(extra || {}) });
};

export const broadcastBoardsForTicket = async (ticketId: string, reason: string, extra?: Record<string, unknown>) => {
  const res = await pool.query<{ board_id: string }>(
    `SELECT id AS board_id
     FROM task_boards
     WHERE kind = 'DATA_DRIVEN'
       AND source_entity = 'TICKET'`
  );

  for (const row of res.rows) {
    broadcastBoardUpdated(row.board_id, reason, { ticketId, ...(extra || {}) });
  }
};
