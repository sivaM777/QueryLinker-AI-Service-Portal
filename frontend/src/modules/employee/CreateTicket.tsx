import React from "react";
import { useNavigate } from "react-router-dom";
import { motion, Variants } from "framer-motion";
import {
  Box,
  Typography,
  Card,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  SelectChangeEvent,
  Alert,
  Stack,
  Container,
  styled,
  alpha,
  useTheme,
  Avatar,
  Tooltip,
  FormHelperText,
  Chip,
  Autocomplete,
} from "@mui/material";
import { Send, ConfirmationNumber, ArrowBack, InfoOutlined, UploadFile, AttachFile, Close } from "@mui/icons-material";
import { api, getApiErrorMessage } from "../../services/api";
import { TicketTemplate } from "../../services/ticketProductivity";

const GlassCard = styled(motion(Card))(({ theme }) => ({
  background: 'rgba(255, 255, 255, 0.8)',
  backdropFilter: 'blur(12px)',
  borderRadius: theme.shape.borderRadius * 3,
  border: '1px solid rgba(255, 255, 255, 0.3)',
  boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)',
  overflow: 'visible',
  padding: theme.spacing(4),
}));

const StyledTextField = styled(TextField)(({ theme }) => ({
  '& .MuiOutlinedInput-root': {
    borderRadius: theme.shape.borderRadius * 2,
    transition: 'all 0.2s',
    '&:hover fieldset': {
      borderColor: theme.palette.primary.main,
    },
    '&.Mui-focused fieldset': {
      borderColor: theme.palette.primary.main,
      borderWidth: 2,
    },
  },
}));

const containerVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: "easeOut",
      staggerChildren: 0.1
    }
  }
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5 }
  }
};

type TicketType = "INCIDENT" | "SERVICE_REQUEST" | "CHANGE" | "PROBLEM";
type TicketPriority = "LOW" | "MEDIUM" | "HIGH";

const CATEGORY_OPTIONS = [
  "Access / Authentication",
  "Network",
  "Software",
  "Hardware",
  "Other",
] as const;

const maxAttachmentBytes = 2 * 1024 * 1024;
const maxAttachmentCount = 5;

export const CreateTicket: React.FC = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  const [type, setType] = React.useState<TicketType>("INCIDENT");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [priority, setPriority] = React.useState<TicketPriority>("MEDIUM");
  const [category, setCategory] = React.useState<string>("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");
  const [createdTicketId, setCreatedTicketId] = React.useState<string | null>(null);
  const [templates, setTemplates] = React.useState<TicketTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = React.useState<TicketTemplate | null>(null);
  const [tagsInput, setTagsInput] = React.useState("");
  const [attachments, setAttachments] = React.useState<File[]>([]);
  const [dragActive, setDragActive] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<{
    title?: string;
    description?: string;
    category?: string;
    attachments?: string;
  }>({});
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    let active = true;
    const loadTemplates = async () => {
      try {
        const res = await api.get<TicketTemplate[]>("/tickets/templates");
        if (!active) return;
        setTemplates(res.data || []);
      } catch {
        if (!active) return;
        setTemplates([]);
      }
    };
    void loadTemplates();
    return () => {
      active = false;
    };
  }, []);

  const addFiles = React.useCallback((incomingFiles: FileList | File[]) => {
    const incoming = Array.from(incomingFiles);
    if (!incoming.length) return;

    const oversized = incoming.find((file) => file.size > maxAttachmentBytes);
    if (oversized) {
      setFieldErrors((prev) => ({
        ...prev,
        attachments: `"${oversized.name}" is larger than 2 MB`,
      }));
      return;
    }

    setAttachments((current) => {
      const byKey = new Map(current.map((file) => [`${file.name}-${file.size}-${file.lastModified}`, file]));
      for (const file of incoming) {
        byKey.set(`${file.name}-${file.size}-${file.lastModified}`, file);
      }
      const next = Array.from(byKey.values()).slice(0, maxAttachmentCount);
      if (current.length + incoming.length > maxAttachmentCount) {
        setFieldErrors((prev) => ({
          ...prev,
          attachments: `You can attach up to ${maxAttachmentCount} files`,
        }));
      } else {
        setFieldErrors((prev) => ({ ...prev, attachments: undefined }));
      }
      return next;
    });
  }, []);

  const removeAttachment = (index: number) => {
    setAttachments((current) => current.filter((_, idx) => idx !== index));
    setFieldErrors((prev) => ({ ...prev, attachments: undefined }));
  };

  const submit = async () => {
    const trimmedTitle = title.trim();
    const trimmedDesc = description.trim();
    const nextErrors: {
      title?: string;
      description?: string;
      category?: string;
      attachments?: string;
    } = {};

    if (!trimmedTitle) {
      nextErrors.title = "Title is required";
    }
    if (!trimmedDesc) {
      nextErrors.description = "Description is required";
    }
    if (!category) {
      nextErrors.category = "Please select a category";
    }

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const formData = new FormData();
      formData.append("type", type);
      formData.append("title", trimmedTitle);
      formData.append("description", trimmedDesc);
      formData.append("priority", priority);
      formData.append("category", category);
      formData.append(
        "tags",
        JSON.stringify(
          tagsInput
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        )
      );
      attachments.forEach((file) => {
        formData.append("attachments", file);
      });

      const res = await api.post<{ id: string }>("/tickets", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      setCreatedTicketId(res.data.id);
      setSuccess("Your ticket has been created successfully.");
      setTitle("");
      setDescription("");
      setCategory("");
      setPriority("MEDIUM");
      setTagsInput("");
      setSelectedTemplate(null);
      setAttachments([]);
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to create ticket"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Button 
        startIcon={<ArrowBack />} 
        onClick={() => navigate(-1)} 
        sx={{ mb: 3, borderRadius: 2 }}
      >
        Back
      </Button>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <Box sx={{ mb: 4, textAlign: 'center' }}>
          <motion.div variants={itemVariants}>
            <Avatar 
              sx={{ 
                width: 64, 
                height: 64, 
                margin: '0 auto', 
                mb: 2,
                bgcolor: alpha(theme.palette.primary.main, 0.1),
                color: theme.palette.primary.main
              }}
            >
              <ConfirmationNumber fontSize="large" />
            </Avatar>
          </motion.div>
          <motion.div variants={itemVariants}>
            <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
              Create New Ticket
            </Typography>
          </motion.div>
          <motion.div variants={itemVariants}>
            <Typography color="text.secondary">
              Fill in the details below to submit a new support request.
            </Typography>
          </motion.div>
        </Box>

        {error && (
          <motion.div variants={itemVariants}>
            <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
              {error}
            </Alert>
          </motion.div>
        )}

        {success && (
          <motion.div variants={itemVariants}>
            <Alert
              severity="success"
              sx={{ mb: 3, borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "space-between" }}
            >
              <Box>
                <Typography variant="subtitle2">{success}</Typography>
                {createdTicketId && (
                  <Typography variant="body2">
                    Reference ID: {createdTicketId.substring(0, 8).toUpperCase()}
                  </Typography>
                )}
              </Box>
              {createdTicketId && (
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => navigate(`/app/tickets/${createdTicketId}`)}
                >
                  View ticket
                </Button>
              )}
            </Alert>
          </motion.div>
        )}

        <GlassCard variants={itemVariants}>
          <Stack spacing={4}>
            <Autocomplete
              options={templates}
              value={selectedTemplate}
              onChange={(_, template) => {
                setSelectedTemplate(template);
                if (!template) return;
                setType(template.ticket_type);
                setPriority(template.priority);
                setCategory(template.category || "");
                setTitle(template.title || "");
                setDescription(template.body || "");
                setTagsInput((template.default_tags || []).join(", "));
              }}
              getOptionLabel={(option) => option.name}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Template"
                  placeholder="Choose a saved template"
                  helperText="Apply a saved template to fill the ticket form faster."
                />
              )}
            />

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <FormControl fullWidth>
                <InputLabel>Ticket Type</InputLabel>
                <Select
                  value={type}
                  label="Ticket Type"
                  onChange={(e: SelectChangeEvent<TicketType>) => setType(e.target.value as TicketType)}
                  sx={{ borderRadius: 2 }}
                  disabled={loading}
                >
                  <MenuItem value="INCIDENT">Incident</MenuItem>
                  <MenuItem value="SERVICE_REQUEST">Service Request</MenuItem>
                  <MenuItem value="CHANGE">Change</MenuItem>
                  <MenuItem value="PROBLEM">Problem</MenuItem>
                </Select>
                <FormHelperText>
                  Choose the overall type that best matches your issue.
                </FormHelperText>
              </FormControl>

              <FormControl fullWidth>
                <InputLabel>Priority</InputLabel>
                <Select
                  value={priority}
                  label="Priority"
                  onChange={(e: SelectChangeEvent<TicketPriority>) =>
                    setPriority(e.target.value as TicketPriority)
                  }
                  sx={{ borderRadius: 2 }}
                  disabled={loading}
                >
                  <MenuItem value="HIGH">High – critical impact</MenuItem>
                  <MenuItem value="MEDIUM">Medium – work is affected</MenuItem>
                  <MenuItem value="LOW">Low – minor issue or question</MenuItem>
                </Select>
                <FormHelperText>
                  Used to help the team triage and respond in the right order.
                </FormHelperText>
              </FormControl>
            </Stack>

            <StyledTextField
              fullWidth
              label="Title"
              placeholder="Brief summary of the issue"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              variant="outlined"
              disabled={loading}
              error={Boolean(fieldErrors.title)}
              helperText={fieldErrors.title || "Example: VPN keeps disconnecting from home office"}
            />

            <StyledTextField
              fullWidth
              label="Description"
              placeholder="Detailed explanation of what happened..."
              multiline
              rows={6}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              variant="outlined"
              disabled={loading}
              error={Boolean(fieldErrors.description)}
              helperText={
                fieldErrors.description ||
                "Include steps to reproduce, error messages, and when the issue started."
              }
            />

            <FormControl fullWidth error={Boolean(fieldErrors.category)}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
                <Typography variant="subtitle2">Category</Typography>
                <Tooltip title="Helps route your ticket to the right team">
                  <InfoOutlined fontSize="small" color="action" />
                </Tooltip>
              </Box>
              <Select
                value={category}
                onChange={(e: SelectChangeEvent<string>) => setCategory(e.target.value)}
                displayEmpty
                sx={{ borderRadius: 2 }}
                disabled={loading}
              >
                <MenuItem value="">
                  <em>Select a category</em>
                </MenuItem>
                {CATEGORY_OPTIONS.map((option) => (
                  <MenuItem key={option} value={option}>
                    {option}
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>
                {fieldErrors.category || "Select the area most closely related to your request."}
              </FormHelperText>
            </FormControl>

            <TextField
              fullWidth
              label="Tags"
              placeholder="vpn, hardware, onboarding"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              helperText="Optional tags help with routing, saved views, and search."
            />

            {tagsInput.trim() ? (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {tagsInput
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean)
                  .map((tag) => (
                    <Chip key={tag} label={tag} />
                  ))}
              </Stack>
            ) : null}

            <Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.25 }}>
                <AttachFile fontSize="small" color="action" />
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Attachments
                </Typography>
              </Box>
              <Box
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  addFiles(e.dataTransfer.files);
                }}
                sx={{
                  border: "1px dashed",
                  borderColor: fieldErrors.attachments ? "error.main" : dragActive ? "primary.main" : alpha(theme.palette.text.primary, 0.14),
                  borderRadius: 3,
                  px: 3,
                  py: 4,
                  textAlign: "center",
                  backgroundColor: dragActive ? alpha(theme.palette.primary.main, 0.05) : alpha(theme.palette.common.white, 0.65),
                  transition: "all 0.2s ease",
                }}
              >
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
                  File(s) 2 MB max
                </Typography>
                <Typography variant="body1" sx={{ fontWeight: 600, mb: 2 }}>
                  Drag & drop your file here, or
                </Typography>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outlined"
                  startIcon={<UploadFile />}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  sx={{ borderRadius: 2.5, px: 3 }}
                >
                  Browse...
                </Button>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
                  Up to {maxAttachmentCount} files. Accepted by your browser file picker.
                </Typography>
              </Box>
              <FormHelperText error={Boolean(fieldErrors.attachments)} sx={{ mt: 1 }}>
                {fieldErrors.attachments || "Add screenshots, logs, or supporting documents if they help explain the issue."}
              </FormHelperText>
              {attachments.length > 0 && (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
                  {attachments.map((file, index) => (
                    <Chip
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      label={`${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)`}
                      onDelete={() => removeAttachment(index)}
                      deleteIcon={<Close />}
                      sx={{ borderRadius: 2, px: 0.5 }}
                    />
                  ))}
                </Stack>
              )}
            </Box>

            <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 2 }}>
              <Button
                variant="outlined"
                onClick={() => navigate(-1)}
                sx={{ borderRadius: 2, px: 3 }}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                variant="contained"
                endIcon={<Send />}
                disabled={loading}
                onClick={submit}
                sx={{ 
                  borderRadius: 2, 
                  px: 4,
                  background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                }}
              >
                {loading ? "Creating…" : "Create Ticket"}
              </Button>
            </Box>
          </Stack>
        </GlassCard>
      </motion.div>
    </Container>
  );
};
