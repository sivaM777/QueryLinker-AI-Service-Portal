import React, { useState, useRef, useEffect } from "react";
import {
  Box,
  Typography,
  TextField,
  IconButton,
  Paper,
  Chip,
  Button,
  CircularProgress,
  Alert,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Divider,
} from "@mui/material";
import {
  Send as SendIcon,
  SmartToy as BotIcon,
  Person as UserIcon,
  History as HistoryIcon,
  Lightbulb as SuggestionIcon,
  ThumbUp as ThumbsUpIcon,
  ThumbDown as ThumbsDownIcon,
} from "@mui/icons-material";
import { api, getApiErrorMessage } from "../../services/api";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  suggestions?: string[];
  articleIds?: string[];
  resolved?: boolean;
};

type ChatSession = {
  id: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
};

const SUGGESTED_PROMPTS = [
  "My VPN disconnects every 10 minutes",
  "I can't access shared folders",
  "Outlook keeps crashing",
  "How do I reset my password?",
  "Printer is not working",
];

export const ConversationalKb: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    loadSessions();
    createNewSession();
  }, []);

  const loadSessions = async () => {
    try {
      const res = await api.get<{ sessions: ChatSession[] }>("/kb/chat/sessions");
      setSessions(res.data.sessions || []);
    } catch (e) {
      console.error("Failed to load sessions:", e);
    }
  };

  const createNewSession = async () => {
    try {
      const res = await api.post<{ sessionId: string }>("/kb/chat/sessions");
      setSessionId(res.data.sessionId);
      setMessages([]);
    } catch (e) {
      setError(getApiErrorMessage(e, "Failed to start chat session"));
    }
  };

  const loadSession = async (sessionId: string) => {
    try {
      const res = await api.get<{ session: ChatSession }>(`/kb/chat/sessions/${sessionId}`);
      const session = res.data.session;
      setSessionId(session.id);
      setMessages(session.messages || []);
      setShowHistory(false);
    } catch (e) {
      setError(getApiErrorMessage(e, "Failed to load session"));
    }
  };

  const sendMessage = async (content: string) => {
    if (!content.trim() || isLoading || !sessionId) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: content.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setError("");

    try {
      const res = await api.post<{
        message: Message;
        suggestions?: string[];
        relatedArticles?: Array<{ id: string; title: string; snippet: string }>;
      }>(`/kb/chat/sessions/${sessionId}/messages`, {
        message: content.trim(),
      });

      const assistantMessage: Message = {
        ...res.data.message,
        timestamp: new Date(),
        suggestions: res.data.suggestions || [],
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (e) {
      setError(getApiErrorMessage(e, "Failed to send message"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion);
    inputRef.current?.focus();
  };

  const submitFeedback = async (messageId: string, helpful: boolean) => {
    if (!sessionId) return;
    
    setFeedbackSubmitting(messageId);
    try {
      await api.post(`/kb/chat/sessions/${sessionId}/messages/${messageId}/feedback`, {
        helpful,
      });
      
      setMessages(prev => 
        prev.map(msg => 
          msg.id === messageId ? { ...msg, resolved: helpful } : msg
        )
      );
    } catch (e) {
      console.error("Failed to submit feedback:", e);
    } finally {
      setFeedbackSubmitting(null);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <Box sx={{ height: "100vh", display: "flex", flexDirection: "column", bgcolor: "background.default" }}>
      {/* Header */}
      <Paper sx={{ p: 2, borderRadius: 0, boxShadow: 1 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography variant="h5" sx={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 1 }}>
            <BotIcon color="primary" />
            AI Help Assistant
          </Typography>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button
              startIcon={<HistoryIcon />}
              onClick={() => setShowHistory(true)}
              variant="outlined"
              size="small"
            >
              History
            </Button>
            <Button
              onClick={createNewSession}
              variant="contained"
              size="small"
            >
              New Chat
            </Button>
          </Box>
        </Box>
      </Paper>

      {/* Messages Area */}
      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
        {messages.length === 0 && !isLoading && (
          <Box sx={{ textAlign: "center", mt: 4 }}>
            <BotIcon sx={{ fontSize: 64, color: "primary.main", mb: 2 }} />
            <Typography variant="h6" gutterBottom>
              Hi! I'm your AI help assistant
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              I can help you with IT issues, guide you through solutions, and even fix problems automatically.
            </Typography>
            
            <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
              Try asking about:
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, justifyContent: "center", maxWidth: 600, mx: "auto" }}>
              {SUGGESTED_PROMPTS.map((prompt, index) => (
                <Chip
                  key={index}
                  label={prompt}
                  variant="outlined"
                  clickable
                  onClick={() => handleSuggestionClick(prompt)}
                  icon={<SuggestionIcon />}
                  sx={{ mb: 1 }}
                />
              ))}
            </Box>
          </Box>
        )}

        {messages.map((message) => (
          <Box key={message.id} sx={{ mb: 2, display: "flex", gap: 1 }}>
            {message.role === "user" ? (
              <UserIcon sx={{ color: "primary.main", mt: 1 }} />
            ) : (
              <BotIcon sx={{ color: "secondary.main", mt: 1 }} />
            )}
            
            <Paper
              sx={{
                p: 2,
                maxWidth: "70%",
                bgcolor: message.role === "user" ? "primary.light" : "background.paper",
                borderRadius: 2,
                boxShadow: 1,
                flex: 1,
              }}
            >
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mb: 1 }}>
                {message.content}
              </Typography>
              
              {message.suggestions && message.suggestions.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="caption" sx={{ mb: 1, fontWeight: 600 }}>
                    Related suggestions:
                  </Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                    {message.suggestions.map((suggestion, index) => (
                      <Chip
                        key={index}
                        label={suggestion}
                        size="small"
                        variant="outlined"
                        clickable
                        onClick={() => handleSuggestionClick(suggestion)}
                      />
                    ))}
                  </Box>
                </Box>
              )}

              {message.role === "assistant" && message.resolved === undefined && (
                <Box sx={{ mt: 2, display: "flex", gap: 1, alignItems: "center" }}>
                  <Typography variant="caption" sx={{ mr: 1 }}>
                    Did this solve your issue?
                  </Typography>
                  <Button
                    size="small"
                    startIcon={<ThumbsUpIcon />}
                    onClick={() => submitFeedback(message.id, true)}
                    disabled={feedbackSubmitting === message.id}
                    variant={message.resolved === true ? "contained" : "outlined"}
                    color="success"
                  >
                    Yes
                  </Button>
                  <Button
                    size="small"
                    startIcon={<ThumbsDownIcon />}
                    onClick={() => submitFeedback(message.id, false)}
                    disabled={feedbackSubmitting === message.id}
                    variant={message.resolved === false ? "contained" : "outlined"}
                    color="error"
                  >
                    No
                  </Button>
                </Box>
              )}

              {message.resolved !== undefined && (
                <Chip
                  label={message.resolved ? "✓ Resolved" : "✗ Not resolved"}
                  color={message.resolved ? "success" : "default"}
                  size="small"
                  sx={{ mt: 1 }}
                />
              )}
            </Paper>
          </Box>
        ))}

        {isLoading && (
          <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
            <BotIcon sx={{ color: "secondary.main", mt: 1 }} />
            <Paper sx={{ p: 2, borderRadius: 2, boxShadow: 1 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">
                  Thinking...
                </Typography>
              </Box>
            </Paper>
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <div ref={messagesEndRef} />
      </Box>

      {/* Input Area */}
      <Paper sx={{ p: 2, borderRadius: 0, boxShadow: 3 }}>
        <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end" }}>
          <TextField
            ref={inputRef}
            fullWidth
            multiline
            maxRows={3}
            placeholder="Type your question or describe your issue..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={isLoading}
            variant="outlined"
            sx={{ bgcolor: "background.paper" }}
          />
          <IconButton
            color="primary"
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading}
            sx={{ alignSelf: "center", bgcolor: "primary.main", color: "white", "&:hover": { bgcolor: "primary.dark" } }}
          >
            <SendIcon />
          </IconButton>
        </Box>
      </Paper>

      {/* History Drawer */}
      <Drawer
        anchor="right"
        open={showHistory}
        onClose={() => setShowHistory(false)}
      >
        <Box sx={{ width: 350, p: 2 }}>
          <Typography variant="h6" gutterBottom>
            Chat History
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <List>
            {sessions.map((session) => (
              <ListItem key={session.id} disablePadding>
                <ListItemButton selected={sessionId === session.id} onClick={() => loadSession(session.id)}>
                  <ListItemText
                    primary={session.messages[0]?.content || "New Chat"}
                    secondary={new Date(session.createdAt).toLocaleString()}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Box>
      </Drawer>
    </Box>
  );
};
