import React from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  Add as AddIcon,
  AttachFileRounded as AttachIcon,
  ChevronLeftRounded as BackIcon,
  DeleteOutlineRounded as DeleteIcon,
  ForumRounded as CommentIcon,
  RefreshRounded as RefreshIcon,
  ViewKanbanRounded as BoardIcon,
} from "@mui/icons-material";
import { useNavigate, useParams } from "react-router-dom";
import {
  closestCorners,
  DndContext,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getApiErrorMessage } from "../../../services/api";
import {
  addBoardCardAttachment,
  addBoardCardComment,
  addBoardMember,
  createBoardCard,
  createBoardColumn,
  createBoardSwimlane,
  deleteBoardCard,
  getBoardAttachmentDownloadUrl,
  getBoardCardActivity,
  getBoardView,
  moveBoardCard,
  removeBoardMember,
  updateBoardCard,
  type BoardCard,
  type BoardCardActivityItem,
  type BoardMember,
  type BoardViewResponse,
} from "../../../services/boards";
import { api } from "../../../services/api";
import { subscribeToBoard } from "../../../services/socket.service";
import { useAuth } from "../../../services/auth";

const DEFAULT_LANE_KEY = "__default__";

const PRIORITY_COLORS: Record<string, string> = {
  HIGH: "#ef4444",
  MEDIUM: "#f59e0b",
  LOW: "#10b981",
};

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  WAITING_FOR_CUSTOMER: "Waiting",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

const timeAgo = (value?: string | null) => {
  if (!value) return "just now";
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(diff / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const normalizeLaneKey = (value?: string | null) => value || DEFAULT_LANE_KEY;

const getCardId = (id: string) => `card:${id}`;
const getCellId = (columnId: string, laneKey: string) => `cell:${columnId}:${encodeURIComponent(laneKey)}`;

const parseCellId = (value: string | undefined | null) => {
  if (!value || !value.startsWith("cell:")) return null;
  const [, columnId, encodedLaneKey] = value.split(":");
  return { columnId, laneKey: decodeURIComponent(encodedLaneKey || DEFAULT_LANE_KEY) };
};

const parseCardId = (value: string | undefined | null) => {
  if (!value || !value.startsWith("card:")) return null;
  return value.replace("card:", "");
};

const getCardsForCell = (cards: BoardCard[], columnId: string, laneKey: string) =>
  cards.filter((card) => card.column_id === columnId && normalizeLaneKey(card.swimlane_key) === laneKey);

const buildDestinationCards = (
  cards: BoardCard[],
  activeCardId: string,
  destination: { columnId: string; laneKey: string; overCardId?: string | null }
) => {
  const activeCard = cards.find((card) => card.id === activeCardId);
  if (!activeCard) return null;

  const withoutActive = cards.filter((card) => card.id !== activeCardId);
  const movedCard: BoardCard = {
    ...activeCard,
    column_id: destination.columnId,
    swimlane_key: destination.laneKey,
  };

  let insertIndex = withoutActive.length;
  if (destination.overCardId) {
    const overIndex = withoutActive.findIndex((card) => card.id === destination.overCardId);
    if (overIndex >= 0) insertIndex = overIndex;
  } else {
    const destinationIndices = withoutActive
      .map((card, index) => ({ card, index }))
      .filter(
        ({ card }) =>
          card.column_id === destination.columnId &&
          normalizeLaneKey(card.swimlane_key) === destination.laneKey
      )
      .map(({ index }) => index);
    if (destinationIndices.length > 0) {
      insertIndex = destinationIndices[destinationIndices.length - 1] + 1;
    }
  }

  const next = [...withoutActive];
  next.splice(insertIndex, 0, movedCard);
  return next;
};

const SortableBoardCard: React.FC<{
  card: BoardCard;
  disabled?: boolean;
  onOpen: (cardId: string) => void;
}> = ({ card, disabled, onOpen }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: getCardId(card.id),
    disabled,
  });

  return (
    <Paper
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(card.id)}
      sx={{
        p: 1.5,
        mb: 1.25,
        borderRadius: 3,
        border: "1px solid rgba(15,23,42,0.08)",
        boxShadow: isDragging ? "0 18px 30px rgba(15,23,42,0.2)" : "0 8px 18px rgba(15,23,42,0.06)",
        cursor: disabled ? "pointer" : "grab",
        opacity: isDragging ? 0.8 : 1,
        transform: CSS.Transform.toString(transform),
        transition,
        bgcolor: "#fff",
      }}
    >
      <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="flex-start">
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700, lineHeight: 1.3 }}>
            {card.display_number ? `${card.display_number} • ${card.title}` : card.title}
          </Typography>
          {card.description ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.6 }}>
              {card.description.length > 120 ? `${card.description.slice(0, 120)}...` : card.description}
            </Typography>
          ) : null}
        </Box>
        <Box
          sx={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            bgcolor: PRIORITY_COLORS[card.priority] || "#64748b",
            flexShrink: 0,
            mt: 0.4,
          }}
        />
      </Stack>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.2 }}>
        {card.status ? <Chip size="small" label={STATUS_LABELS[card.status] || card.status} /> : null}
        <Chip size="small" label={card.priority} />
        {card.assigned_agent_name ? <Chip size="small" label={card.assigned_agent_name} variant="outlined" /> : null}
        {card.assigned_team_name ? <Chip size="small" label={card.assigned_team_name} variant="outlined" /> : null}
      </Stack>

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.25 }}>
        <Typography variant="caption" color="text.secondary">
          {timeAgo(card.updated_at)}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="caption" color="text.secondary">
            {card.comment_count}
          </Typography>
          <CommentIcon sx={{ fontSize: 16, color: "text.secondary" }} />
          <Typography variant="caption" color="text.secondary">
            {card.attachment_count}
          </Typography>
          <AttachIcon sx={{ fontSize: 16, color: "text.secondary" }} />
        </Stack>
      </Stack>
    </Paper>
  );
};

const DroppableBoardCell: React.FC<{
  id: string;
  children: React.ReactNode;
}> = ({ id, children }) => {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <Box
      ref={setNodeRef}
      sx={{
        minHeight: 120,
        p: 1.25,
        borderRadius: 3,
        bgcolor: isOver ? "rgba(37,99,235,0.08)" : "rgba(248,250,252,0.9)",
        border: "1px dashed rgba(37,99,235,0.22)",
        transition: "background-color 0.15s ease",
      }}
    >
      {children}
    </Box>
  );
};

export const BoardDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const [view, setView] = React.useState<BoardViewResponse | null>(null);
  const [cards, setCards] = React.useState<BoardCard[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = React.useState<string | null>(null);
  const [activity, setActivity] = React.useState<BoardCardActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = React.useState(false);
  const [composerBody, setComposerBody] = React.useState("");
  const [composerVisibility, setComposerVisibility] = React.useState<"REQUESTER_COMMENT" | "INTERNAL_NOTE">("INTERNAL_NOTE");
  const [working, setWorking] = React.useState(false);
  const [openNewCard, setOpenNewCard] = React.useState(false);
  const [openNewColumn, setOpenNewColumn] = React.useState(false);
  const [openNewLane, setOpenNewLane] = React.useState(false);
  const [userDirectory, setUserDirectory] = React.useState<Array<{ id: string; name: string; email: string; role: string }>>([]);
  const [selectedMemberId, setSelectedMemberId] = React.useState("");
  const [cardForm, setCardForm] = React.useState({
    title: "",
    description: "",
    priority: "MEDIUM" as "LOW" | "MEDIUM" | "HIGH",
    due_date: "",
    tags: "",
    column_id: "",
    swimlane_id: "",
  });
  const [columnForm, setColumnForm] = React.useState({
    name: "",
    color: "",
    mapped_value: "",
    filter_field: "status",
    filter_operator: "eq",
    filter_value: "",
    drop_field: "status",
    drop_value: "",
  });
  const [laneForm, setLaneForm] = React.useState({ name: "", color: "" });
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const loadBoard = React.useCallback(
    async (silent = false) => {
      if (!id) return;
      try {
        if (silent) setRefreshing(true);
        else setLoading(true);
        const response = await getBoardView(id);
        setView(response);
        setCards(response.cards);
        setError(null);
      } catch (loadError) {
        setError(getApiErrorMessage(loadError, "We couldn't load this board right now."));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [id]
  );

  React.useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  React.useEffect(() => {
    if (!id) return undefined;
    return subscribeToBoard(id, () => {
      void loadBoard(true);
    });
  }, [id, loadBoard]);

  React.useEffect(() => {
    if (!id || !view?.board?.can_manage || user?.role === "AGENT") return;
    let cancelled = false;

    void api
      .get<Array<{ id: string; name: string; email: string; role: string }>>("/users")
      .then((response) => {
        if (!cancelled) {
          setUserDirectory(response.data || []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUserDirectory([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id, user?.role, view?.board?.can_manage]);

  const selectedCard = React.useMemo(
    () => cards.find((card) => card.id === selectedCardId) || null,
    [cards, selectedCardId]
  );

  React.useEffect(() => {
    if (!selectedCardId || !selectedCard || !id) return;
    let cancelled = false;
    setActivityLoading(true);
    void getBoardCardActivity(id, selectedCardId)
      .then((items) => {
        if (!cancelled) setActivity(items);
      })
      .catch(() => {
        if (!cancelled) setActivity([]);
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, selectedCardId, selectedCard]);

  React.useEffect(() => {
    if (selectedCardId && !selectedCard) {
      setSelectedCardId(null);
      setActivity([]);
    }
  }, [selectedCard, selectedCardId]);

  const board = view?.board ?? null;
  const columns = React.useMemo(
    () => (view?.columns || []).filter((column) => !column.archived).sort((a, b) => a.position - b.position),
    [view?.columns]
  );
  const swimlanes = React.useMemo(() => {
    const base = (view?.swimlanes || []).slice().sort((a, b) => a.position - b.position);
    return base.length > 0 ? base : [{ id: DEFAULT_LANE_KEY, key: DEFAULT_LANE_KEY, name: "Board", position: 0 }];
  }, [view?.swimlanes]);

  const canEdit = Boolean(board?.can_edit);
  const canManage = Boolean(board?.can_manage);
  const hasMultipleLanes = swimlanes.length > 1 || board?.swimlane_mode !== "NONE";

  const handleOpenCard = (cardId: string) => {
    setSelectedCardId(cardId);
    setComposerBody("");
    setComposerVisibility("INTERNAL_NOTE");
  };

  const resolveDropDestination = (
    overId: string | undefined | null,
    currentCards: BoardCard[]
  ): { columnId: string; laneKey: string; overCardId?: string | null } | null => {
    const directCell = parseCellId(overId);
    if (directCell) return directCell;

    const overCardId = parseCardId(overId);
    if (!overCardId) return null;
    const overCard = currentCards.find((card) => card.id === overCardId);
    if (!overCard) return null;
    return {
      columnId: overCard.column_id || "",
      laneKey: normalizeLaneKey(overCard.swimlane_key),
      overCardId,
    };
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!board || !canEdit || !id) return;

    const activeCardId = parseCardId(String(event.active.id));
    if (!activeCardId) return;

    const destination = resolveDropDestination(event.over ? String(event.over.id) : null, cards);
    if (!destination?.columnId) return;

    const optimisticCards = buildDestinationCards(cards, activeCardId, destination);
    if (!optimisticCards) return;
    setCards(optimisticCards);

    const orderedCardIds = getCardsForCell(
      optimisticCards,
      destination.columnId,
      destination.laneKey
    ).map((card) => card.id);

    try {
      await moveBoardCard(id, activeCardId, {
        destination_column_id: destination.columnId,
        destination_swimlane_key: destination.laneKey,
        ordered_card_ids: orderedCardIds,
      });
    } catch (moveError) {
      setError(getApiErrorMessage(moveError, "We couldn't move that card. The board has been refreshed."));
      void loadBoard(true);
    }
  };

  const handleCreateCard = async () => {
    if (!id || !cardForm.title.trim()) return;
    try {
      setWorking(true);
      await createBoardCard(id, {
        title: cardForm.title.trim(),
        description: cardForm.description.trim() || null,
        priority: cardForm.priority,
        due_date: cardForm.due_date || null,
        tags: cardForm.tags
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
        column_id: cardForm.column_id || columns[0]?.id || null,
        swimlane_id:
          board?.swimlane_mode === "MANUAL" && cardForm.swimlane_id
            ? cardForm.swimlane_id
            : null,
      });
      setOpenNewCard(false);
      setCardForm({
        title: "",
        description: "",
        priority: "MEDIUM",
        due_date: "",
        tags: "",
        column_id: "",
        swimlane_id: "",
      });
      await loadBoard(true);
    } catch (createError) {
      setError(getApiErrorMessage(createError, "We couldn't create that card."));
    } finally {
      setWorking(false);
    }
  };

  const handleCreateColumn = async () => {
    if (!id || !columnForm.name.trim()) return;
    try {
      setWorking(true);
      await createBoardColumn(id, {
        name: columnForm.name.trim(),
        color: columnForm.color.trim() || null,
        mapped_value:
          board?.kind === "DATA_DRIVEN" && board.mode === "GUIDED"
            ? columnForm.mapped_value.trim() || null
            : null,
        filter_config:
          board?.kind === "DATA_DRIVEN" && board.mode === "FLEXIBLE" && columnForm.filter_value.trim()
            ? [
                {
                  field: columnForm.filter_field,
                  operator: columnForm.filter_operator as "eq" | "neq" | "contains" | "in" | "empty" | "not_empty" | "gte" | "lte",
                  value: columnForm.filter_value.trim(),
                },
              ]
            : [],
        drop_update:
          board?.kind === "DATA_DRIVEN" && board.mode === "FLEXIBLE" && columnForm.drop_value.trim()
            ? {
                field: columnForm.drop_field as "status" | "priority" | "assigned_team" | "assigned_agent",
                value: columnForm.drop_value.trim(),
              }
            : null,
      });
      setOpenNewColumn(false);
      setColumnForm({
        name: "",
        color: "",
        mapped_value: "",
        filter_field: "status",
        filter_operator: "eq",
        filter_value: "",
        drop_field: "status",
        drop_value: "",
      });
      await loadBoard(true);
    } catch (createError) {
      setError(getApiErrorMessage(createError, "We couldn't add that column."));
    } finally {
      setWorking(false);
    }
  };

  const handleCreateLane = async () => {
    if (!id || !laneForm.name.trim()) return;
    try {
      setWorking(true);
      await createBoardSwimlane(id, {
        name: laneForm.name.trim(),
        color: laneForm.color.trim() || null,
      });
      setOpenNewLane(false);
      setLaneForm({ name: "", color: "" });
      await loadBoard(true);
    } catch (createError) {
      setError(getApiErrorMessage(createError, "We couldn't add that swimlane."));
    } finally {
      setWorking(false);
    }
  };

  const handleSaveFreeformCard = async () => {
    if (!id || !selectedCard || selectedCard.kind !== "FREEFORM") return;
    try {
      setWorking(true);
      await updateBoardCard(id, selectedCard.id, {
        title: selectedCard.title,
        description: selectedCard.description,
        priority: selectedCard.priority,
        due_date: selectedCard.due_date || null,
        tags: selectedCard.tags,
      });
      await loadBoard(true);
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, "We couldn't save this card."));
    } finally {
      setWorking(false);
    }
  };

  const handleDeleteFreeformCard = async () => {
    if (!id || !selectedCard || selectedCard.kind !== "FREEFORM") return;
    const confirmed = window.confirm(`Delete "${selectedCard.title}" from this board?`);
    if (!confirmed) return;
    try {
      setWorking(true);
      await deleteBoardCard(id, selectedCard.id);
      setSelectedCardId(null);
      await loadBoard(true);
    } catch (deleteError) {
      setError(getApiErrorMessage(deleteError, "We couldn't delete this card."));
    } finally {
      setWorking(false);
    }
  };

  const handleCommentSubmit = async () => {
    if (!id || !selectedCard || !composerBody.trim()) return;
    try {
      setWorking(true);
      await addBoardCardComment(id, selectedCard.id, {
        body: composerBody.trim(),
        visibility: selectedCard.kind === "TICKET" ? composerVisibility : undefined,
      });
      setComposerBody("");
      const nextActivity = await getBoardCardActivity(id, selectedCard.id);
      setActivity(nextActivity);
      await loadBoard(true);
    } catch (commentError) {
      setError(getApiErrorMessage(commentError, "We couldn't post the activity entry."));
    } finally {
      setWorking(false);
    }
  };

  const handleAttachmentSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!id || !selectedCard || !file) return;
    try {
      setWorking(true);
      await addBoardCardAttachment(id, selectedCard.id, file);
      const nextActivity = await getBoardCardActivity(id, selectedCard.id);
      setActivity(nextActivity);
      await loadBoard(true);
    } catch (attachmentError) {
      setError(getApiErrorMessage(attachmentError, "We couldn't upload that attachment."));
    } finally {
      setWorking(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleAddMember = async () => {
    if (!id || !selectedMemberId) return;
    try {
      setWorking(true);
      await addBoardMember(id, { user_id: selectedMemberId, member_role: "EDITOR" });
      setSelectedMemberId("");
      await loadBoard(true);
    } catch (memberError) {
      setError(getApiErrorMessage(memberError, "We couldn't add that teammate to the board."));
    } finally {
      setWorking(false);
    }
  };

  const handleRemoveMember = async (member: BoardMember) => {
    if (!id) return;
    try {
      setWorking(true);
      await removeBoardMember(id, member.user_id);
      await loadBoard(true);
    } catch (memberError) {
      setError(getApiErrorMessage(memberError, "We couldn't remove that teammate from the board."));
    } finally {
      setWorking(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "grid", placeItems: "center", minHeight: "50vh" }}>
        <Stack alignItems="center" spacing={2}>
          <CircularProgress />
          <Typography color="text.secondary">Loading board workspace...</Typography>
        </Stack>
      </Box>
    );
  }

  if (!board || !view) {
    return (
      <Alert severity="error">
        {error || "We couldn't find this board. Try going back to the Boards workspace."}
      </Alert>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {error ? <Alert severity="error" onClose={() => setError(null)}>{error}</Alert> : null}

      <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2, flexDirection: { xs: "column", xl: "row" } }}>
        <Box>
          <Button startIcon={<BackIcon />} onClick={() => navigate("/admin/boards")} sx={{ mb: 1 }}>
            Back to Boards
          </Button>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.25 }}>
            <Chip icon={<BoardIcon fontSize="small" />} label={board.kind === "FREEFORM" ? "Freeform Board" : `Ticket Board • ${board.mode || "Board"}`} />
            <Chip label={board.visibility === "SHARED" ? "Shared" : "Personal"} color={board.visibility === "SHARED" ? "primary" : "default"} />
            {board.team_name ? <Chip label={board.team_name} variant="outlined" /> : null}
          </Stack>
          <Typography variant="h4" sx={{ fontWeight: 800, mb: 1 }}>
            {board.name}
          </Typography>
          <Typography color="text.secondary">
            {board.description || "No description yet. Add cards, comments, and attachments right from the board."}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1.2} flexWrap="wrap" useFlexGap sx={{ alignItems: "flex-start" }}>
          <Button startIcon={<RefreshIcon />} variant="outlined" onClick={() => void loadBoard(true)}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </Button>
          {canManage ? (
            <Button startIcon={<AddIcon />} variant="outlined" onClick={() => setOpenNewColumn(true)}>
              Add Column
            </Button>
          ) : null}
          {canManage && board.swimlane_mode === "MANUAL" ? (
            <Button startIcon={<AddIcon />} variant="outlined" onClick={() => setOpenNewLane(true)}>
              Add Swimlane
            </Button>
          ) : null}
          {canEdit && board.kind === "FREEFORM" ? (
            <Button startIcon={<AddIcon />} variant="contained" onClick={() => setOpenNewCard(true)}>
              Add Card
            </Button>
          ) : null}
        </Stack>
      </Box>

      <Card sx={{ borderRadius: 4, border: "1px solid rgba(15,23,42,0.08)", overflow: "hidden" }}>
        <CardContent sx={{ p: 0 }}>
          <Box sx={{ p: 2.5, borderBottom: "1px solid rgba(15,23,42,0.08)", bgcolor: "rgba(248,250,252,0.9)" }}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip label={`${columns.length} columns`} />
              <Chip label={`${cards.length} cards`} />
              <Chip label={`${swimlanes.length} swimlane${swimlanes.length === 1 ? "" : "s"}`} />
              <Chip label={`Updated ${timeAgo(board.updated_at)}`} variant="outlined" />
              <Chip label={`${view.members.length} members`} variant="outlined" />
            </Stack>
          </Box>

          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
            <Box sx={{ overflowX: "auto", p: 2 }}>
              <Box
                sx={{
                  minWidth: Math.max(960, columns.length * 300 + (hasMultipleLanes ? 220 : 0)),
                }}
              >
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: hasMultipleLanes
                      ? `220px repeat(${columns.length}, minmax(260px, 1fr))`
                      : `repeat(${Math.max(columns.length, 1)}, minmax(260px, 1fr))`,
                    gap: 2,
                    alignItems: "stretch",
                  }}
                >
                  {hasMultipleLanes ? <Box /> : null}
                  {columns.map((column) => (
                    <Paper
                      key={column.id}
                      sx={{
                        p: 1.75,
                        borderRadius: 3,
                        bgcolor: "rgba(15,23,42,0.03)",
                        borderTop: `4px solid ${column.color || "#2563eb"}`,
                      }}
                    >
                      <Typography sx={{ fontWeight: 800 }}>{column.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {cards.filter((card) => card.column_id === column.id).length} items
                      </Typography>
                    </Paper>
                  ))}

                  {swimlanes.map((lane) => (
                    <React.Fragment key={lane.id}>
                      {hasMultipleLanes ? (
                        <Paper
                          sx={{
                            p: 2,
                            borderRadius: 3,
                            border: "1px solid rgba(15,23,42,0.08)",
                            bgcolor: "#fff",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "center",
                          }}
                        >
                          <Typography sx={{ fontWeight: 800 }}>{lane.name}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {cards.filter((card) => normalizeLaneKey(card.swimlane_key) === normalizeLaneKey(lane.key)).length} items
                          </Typography>
                        </Paper>
                      ) : null}

                      {columns.map((column) => {
                        const laneKey = normalizeLaneKey(lane.key);
                        const cellCards = getCardsForCell(cards, column.id, laneKey);
                        return (
                          <Box key={`${lane.id}-${column.id}`}>
                            <SortableContext items={cellCards.map((card) => getCardId(card.id))} strategy={verticalListSortingStrategy}>
                              <DroppableBoardCell id={getCellId(column.id, laneKey)}>
                                {cellCards.length === 0 ? (
                                  <Typography variant="body2" color="text.secondary">
                                    Drop work here
                                  </Typography>
                                ) : (
                                  cellCards.map((card) => (
                                    <SortableBoardCard
                                      key={card.id}
                                      card={card}
                                      disabled={!canEdit}
                                      onOpen={handleOpenCard}
                                    />
                                  ))
                                )}
                              </DroppableBoardCell>
                            </SortableContext>
                          </Box>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </Box>
              </Box>
            </Box>
          </DndContext>
        </CardContent>
      </Card>

      <Card sx={{ borderRadius: 4, border: "1px solid rgba(15,23,42,0.08)" }}>
        <CardContent>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={2}
            justifyContent="space-between"
            alignItems={{ xs: "stretch", md: "center" }}
            sx={{ mb: 2 }}
          >
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              People on this board
            </Typography>
            {canManage && user?.role !== "AGENT" ? (
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
                <FormControl size="small" sx={{ minWidth: 240 }}>
                  <InputLabel>Add teammate</InputLabel>
                  <Select
                    label="Add teammate"
                    value={selectedMemberId}
                    onChange={(event) => setSelectedMemberId(String(event.target.value))}
                  >
                    {userDirectory
                      .filter((candidate) => !view.members.some((member) => member.user_id === candidate.id))
                      .map((candidate) => (
                        <MenuItem key={candidate.id} value={candidate.id}>
                          {candidate.name} • {candidate.role}
                        </MenuItem>
                      ))}
                  </Select>
                </FormControl>
                <Button variant="outlined" onClick={() => void handleAddMember()} disabled={!selectedMemberId || working}>
                  Add Member
                </Button>
              </Stack>
            ) : null}
          </Stack>
          <List disablePadding>
            {view.members.map((member) => (
              <ListItem key={member.id} sx={{ px: 0 }}>
                <ListItemAvatar>
                  <Avatar>{member.name?.charAt(0)?.toUpperCase() || "U"}</Avatar>
                </ListItemAvatar>
                <ListItemText primary={member.name} secondary={`${member.email} • ${member.member_role}`} />
                {canManage && member.member_role !== "OWNER" ? (
                  <Button color="error" onClick={() => void handleRemoveMember(member)} disabled={working}>
                    Remove
                  </Button>
                ) : null}
              </ListItem>
            ))}
          </List>
        </CardContent>
      </Card>

      <Dialog open={openNewCard} onClose={() => !working && setOpenNewCard(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Card</DialogTitle>
        <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <TextField label="Title" value={cardForm.title} onChange={(event) => setCardForm((current) => ({ ...current, title: event.target.value }))} fullWidth />
          <TextField label="Description" value={cardForm.description} onChange={(event) => setCardForm((current) => ({ ...current, description: event.target.value }))} multiline minRows={4} fullWidth />
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <FormControl fullWidth>
              <InputLabel>Priority</InputLabel>
              <Select label="Priority" value={cardForm.priority} onChange={(event) => setCardForm((current) => ({ ...current, priority: event.target.value as "LOW" | "MEDIUM" | "HIGH" }))}>
                <MenuItem value="LOW">Low</MenuItem>
                <MenuItem value="MEDIUM">Medium</MenuItem>
                <MenuItem value="HIGH">High</MenuItem>
              </Select>
            </FormControl>
            <TextField label="Due Date" type="datetime-local" InputLabelProps={{ shrink: true }} value={cardForm.due_date} onChange={(event) => setCardForm((current) => ({ ...current, due_date: event.target.value }))} fullWidth />
            <FormControl fullWidth>
              <InputLabel>Column</InputLabel>
              <Select label="Column" value={cardForm.column_id} onChange={(event) => setCardForm((current) => ({ ...current, column_id: String(event.target.value || "") }))}>
                {columns.map((column) => (
                  <MenuItem key={column.id} value={column.id}>
                    {column.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {board.swimlane_mode === "MANUAL" ? (
              <FormControl fullWidth>
                <InputLabel>Swimlane</InputLabel>
                <Select label="Swimlane" value={cardForm.swimlane_id} onChange={(event) => setCardForm((current) => ({ ...current, swimlane_id: String(event.target.value || "") }))}>
                  {swimlanes.map((lane) => (
                    <MenuItem key={lane.id} value={lane.id}>
                      {lane.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : null}
          </Box>
          <TextField label="Tags" helperText="Separate tags with commas." value={cardForm.tags} onChange={(event) => setCardForm((current) => ({ ...current, tags: event.target.value }))} fullWidth />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenNewCard(false)} disabled={working}>
            Cancel
          </Button>
          <Button variant="contained" onClick={() => void handleCreateCard()} disabled={working || !cardForm.title.trim()}>
            {working ? "Creating..." : "Create Card"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={openNewColumn} onClose={() => !working && setOpenNewColumn(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Column</DialogTitle>
        <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <TextField label="Column Name" value={columnForm.name} onChange={(event) => setColumnForm((current) => ({ ...current, name: event.target.value }))} fullWidth />
          <TextField label="Accent Color" placeholder="#2563eb" value={columnForm.color} onChange={(event) => setColumnForm((current) => ({ ...current, color: event.target.value }))} fullWidth />
          {board.kind === "DATA_DRIVEN" && board.mode === "GUIDED" ? (
            <TextField label="Mapped Value" helperText={`Map this column to a ${board.column_field || "field"} value.`} value={columnForm.mapped_value} onChange={(event) => setColumnForm((current) => ({ ...current, mapped_value: event.target.value }))} fullWidth />
          ) : null}
          {board.kind === "DATA_DRIVEN" && board.mode === "FLEXIBLE" ? (
            <>
              <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                <FormControl fullWidth>
                  <InputLabel>Filter Field</InputLabel>
                  <Select label="Filter Field" value={columnForm.filter_field} onChange={(event) => setColumnForm((current) => ({ ...current, filter_field: String(event.target.value) }))}>
                    <MenuItem value="status">Status</MenuItem>
                    <MenuItem value="priority">Priority</MenuItem>
                    <MenuItem value="assigned_team">Assigned Team</MenuItem>
                    <MenuItem value="assigned_agent">Assigned Agent</MenuItem>
                    <MenuItem value="requester_department">Requester Department</MenuItem>
                  </Select>
                </FormControl>
                <FormControl fullWidth>
                  <InputLabel>Operator</InputLabel>
                  <Select label="Operator" value={columnForm.filter_operator} onChange={(event) => setColumnForm((current) => ({ ...current, filter_operator: String(event.target.value) }))}>
                    <MenuItem value="eq">Equals</MenuItem>
                    <MenuItem value="contains">Contains</MenuItem>
                  </Select>
                </FormControl>
                <TextField label="Filter Value" value={columnForm.filter_value} onChange={(event) => setColumnForm((current) => ({ ...current, filter_value: event.target.value }))} fullWidth />
              </Box>
              <Divider />
              <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                <FormControl fullWidth>
                  <InputLabel>Drop Update Field</InputLabel>
                  <Select label="Drop Update Field" value={columnForm.drop_field} onChange={(event) => setColumnForm((current) => ({ ...current, drop_field: String(event.target.value) }))}>
                    <MenuItem value="status">Status</MenuItem>
                    <MenuItem value="priority">Priority</MenuItem>
                    <MenuItem value="assigned_team">Assigned Team</MenuItem>
                    <MenuItem value="assigned_agent">Assigned Agent</MenuItem>
                  </Select>
                </FormControl>
                <TextField label="Drop Update Value" value={columnForm.drop_value} onChange={(event) => setColumnForm((current) => ({ ...current, drop_value: event.target.value }))} fullWidth />
              </Box>
            </>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenNewColumn(false)} disabled={working}>
            Cancel
          </Button>
          <Button variant="contained" onClick={() => void handleCreateColumn()} disabled={working || !columnForm.name.trim()}>
            {working ? "Adding..." : "Add Column"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={openNewLane} onClose={() => !working && setOpenNewLane(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Swimlane</DialogTitle>
        <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <TextField label="Swimlane Name" value={laneForm.name} onChange={(event) => setLaneForm((current) => ({ ...current, name: event.target.value }))} fullWidth />
          <TextField label="Accent Color" placeholder="#10b981" value={laneForm.color} onChange={(event) => setLaneForm((current) => ({ ...current, color: event.target.value }))} fullWidth />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenNewLane(false)} disabled={working}>
            Cancel
          </Button>
          <Button variant="contained" onClick={() => void handleCreateLane()} disabled={working || !laneForm.name.trim()}>
            {working ? "Adding..." : "Add Swimlane"}
          </Button>
        </DialogActions>
      </Dialog>

      <Drawer
        anchor="right"
        open={Boolean(selectedCard)}
        onClose={() => setSelectedCardId(null)}
        PaperProps={{ sx: { width: { xs: "100%", md: 460 }, p: 2.5, display: "flex", flexDirection: "column", gap: 2 } }}
      >
        {selectedCard ? (
          <>
            <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="flex-start">
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  {selectedCard.title}
                </Typography>
                <Typography color="text.secondary">
                  {selectedCard.kind === "TICKET"
                    ? `${selectedCard.display_number || "Ticket"} • ${selectedCard.type || "Work item"}`
                    : "Freeform card"}
                </Typography>
              </Box>
              {selectedCard.kind === "TICKET" ? (
                <Button variant="outlined" onClick={() => navigate(`/admin/tickets/${selectedCard.id}`)}>
                  Open Ticket
                </Button>
              ) : null}
            </Stack>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip label={selectedCard.priority} />
              {selectedCard.status ? <Chip label={STATUS_LABELS[selectedCard.status] || selectedCard.status} /> : null}
              {selectedCard.assigned_team_name ? <Chip label={selectedCard.assigned_team_name} variant="outlined" /> : null}
              {selectedCard.assigned_agent_name ? <Chip label={selectedCard.assigned_agent_name} variant="outlined" /> : null}
            </Stack>

            {selectedCard.kind === "FREEFORM" ? (
              <Card sx={{ borderRadius: 3, border: "1px solid rgba(15,23,42,0.08)" }}>
                <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <TextField
                    label="Title"
                    value={selectedCard.title}
                    onChange={(event) =>
                      setCards((current) =>
                        current.map((card) => (card.id === selectedCard.id ? { ...card, title: event.target.value } : card))
                      )
                    }
                    disabled={!canEdit}
                    fullWidth
                  />
                  <TextField
                    label="Description"
                    value={selectedCard.description || ""}
                    onChange={(event) =>
                      setCards((current) =>
                        current.map((card) => (card.id === selectedCard.id ? { ...card, description: event.target.value } : card))
                      )
                    }
                    disabled={!canEdit}
                    multiline
                    minRows={4}
                    fullWidth
                  />
                  <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                    <FormControl fullWidth disabled={!canEdit}>
                      <InputLabel>Priority</InputLabel>
                      <Select
                        label="Priority"
                        value={selectedCard.priority}
                        onChange={(event) =>
                          setCards((current) =>
                            current.map((card) =>
                              card.id === selectedCard.id
                                ? { ...card, priority: event.target.value as "LOW" | "MEDIUM" | "HIGH" }
                                : card
                            )
                          )
                        }
                      >
                        <MenuItem value="LOW">Low</MenuItem>
                        <MenuItem value="MEDIUM">Medium</MenuItem>
                        <MenuItem value="HIGH">High</MenuItem>
                      </Select>
                    </FormControl>
                    <TextField
                      label="Due Date"
                      type="datetime-local"
                      value={selectedCard.due_date || ""}
                      InputLabelProps={{ shrink: true }}
                      onChange={(event) =>
                        setCards((current) =>
                          current.map((card) => (card.id === selectedCard.id ? { ...card, due_date: event.target.value } : card))
                        )
                      }
                      disabled={!canEdit}
                    />
                  </Box>
                  <TextField
                    label="Tags"
                    value={selectedCard.tags.join(", ")}
                    onChange={(event) =>
                      setCards((current) =>
                        current.map((card) =>
                          card.id === selectedCard.id
                            ? {
                                ...card,
                                tags: event.target.value
                                  .split(",")
                                  .map((entry) => entry.trim())
                                  .filter(Boolean),
                              }
                            : card
                        )
                      )
                    }
                    disabled={!canEdit}
                    fullWidth
                  />
                  {canEdit ? (
                    <Stack direction="row" spacing={1.5}>
                      <Button variant="contained" onClick={() => void handleSaveFreeformCard()} disabled={working}>
                        Save Details
                      </Button>
                      <Button variant="outlined" color="error" startIcon={<DeleteIcon />} onClick={() => void handleDeleteFreeformCard()} disabled={working}>
                        Delete Card
                      </Button>
                    </Stack>
                  ) : null}
                </CardContent>
              </Card>
            ) : (
              <Card sx={{ borderRadius: 3, border: "1px solid rgba(15,23,42,0.08)" }}>
                <CardContent>
                  <Typography sx={{ fontWeight: 700, mb: 1 }}>Ticket details</Typography>
                  <Stack spacing={1}>
                    <Typography color="text.secondary">Requester: {selectedCard.requester_name || "Unknown"}</Typography>
                    <Typography color="text.secondary">Department: {selectedCard.requester_department || "Unspecified"}</Typography>
                    <Typography color="text.secondary">Updated: {formatDate(selectedCard.updated_at)}</Typography>
                    <Typography color="text.secondary">Comments: {selectedCard.comment_count} • Attachments: {selectedCard.attachment_count}</Typography>
                  </Stack>
                </CardContent>
              </Card>
            )}

            <Card sx={{ borderRadius: 3, border: "1px solid rgba(15,23,42,0.08)" }}>
              <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <Typography sx={{ fontWeight: 800 }}>Add Activity</Typography>
                {selectedCard.kind === "TICKET" ? (
                  <FormControl fullWidth>
                    <InputLabel>Visibility</InputLabel>
                    <Select label="Visibility" value={composerVisibility} onChange={(event) => setComposerVisibility(event.target.value as "REQUESTER_COMMENT" | "INTERNAL_NOTE")}>
                      <MenuItem value="INTERNAL_NOTE">Internal Note</MenuItem>
                      <MenuItem value="REQUESTER_COMMENT">Requester Comment</MenuItem>
                    </Select>
                  </FormControl>
                ) : null}
                <TextField
                  label="Write an update"
                  value={composerBody}
                  onChange={(event) => setComposerBody(event.target.value)}
                  multiline
                  minRows={3}
                  fullWidth
                />
                <Stack direction="row" spacing={1.5}>
                  <Button variant="contained" onClick={() => void handleCommentSubmit()} disabled={working || !composerBody.trim()}>
                    Post Update
                  </Button>
                  <Button variant="outlined" startIcon={<AttachIcon />} onClick={() => fileInputRef.current?.click()} disabled={working}>
                    Upload File
                  </Button>
                  <input ref={fileInputRef} type="file" hidden onChange={handleAttachmentSelected} />
                </Stack>
              </CardContent>
            </Card>

            <Card sx={{ flex: 1, minHeight: 0, borderRadius: 3, border: "1px solid rgba(15,23,42,0.08)" }}>
              <CardContent sx={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
                <Typography sx={{ fontWeight: 800, mb: 1.5 }}>Activity</Typography>
                {activityLoading ? (
                  <Box sx={{ display: "grid", placeItems: "center", flex: 1 }}>
                    <CircularProgress size={24} />
                  </Box>
                ) : (
                  <List sx={{ overflowY: "auto", flex: 1 }}>
                    {activity.map((item) => (
                      <ListItem key={item.id} alignItems="flex-start" sx={{ px: 0 }}>
                        <ListItemAvatar>
                          <Avatar sx={{ width: 34, height: 34 }}>{item.actor_name?.charAt(0)?.toUpperCase() || "S"}</Avatar>
                        </ListItemAvatar>
                        <ListItemText
                          primary={
                            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                              <Typography sx={{ fontWeight: 700 }}>{item.actor_name || "System"}</Typography>
                              <Chip size="small" label={item.type.replace(/_/g, " ")} />
                              <Typography variant="caption" color="text.secondary">
                                {timeAgo(item.created_at)}
                              </Typography>
                            </Stack>
                          }
                          secondary={
                            <Box sx={{ mt: 0.5 }}>
                              {item.body ? (
                                <Typography variant="body2" color="text.primary" sx={{ whiteSpace: "pre-wrap" }}>
                                  {item.body}
                                </Typography>
                              ) : null}
                              {item.filename && item.attachment_id ? (
                                <Button
                                  sx={{ mt: 1, px: 0 }}
                                  onClick={() =>
                                    window.open(
                                      getBoardAttachmentDownloadUrl(id!, selectedCard.id, item.attachment_id!),
                                      "_blank",
                                      "noopener,noreferrer"
                                    )
                                  }
                                >
                                  {item.filename}
                                </Button>
                              ) : null}
                            </Box>
                          }
                        />
                      </ListItem>
                    ))}
                  </List>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </Drawer>
    </Box>
  );
};

export default BoardDetail;
