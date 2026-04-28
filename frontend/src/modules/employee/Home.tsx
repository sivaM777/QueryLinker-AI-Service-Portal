import React from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence, Variants } from "framer-motion";
import {
  Box,
  Typography,
  Button,
  TextField,
  Alert,
  Paper,
  Chip,
  Grid,
  useTheme,
  Card,
  CardContent,
  InputAdornment,
  Avatar,
  Container,
} from "@mui/material";
import { styled, alpha } from "@mui/material/styles";
import {
  Send,
  Article as ArticleIcon,
  ConfirmationNumber as TicketIcon,
  Warning as WarningIcon,
  Search as SearchIcon,
  Add as AddIcon,
  Person as PersonIcon,
  History as HistoryIcon,
  Help as HelpIcon,
} from "@mui/icons-material";
import { api, getApiErrorMessage } from "../../services/api";

// Styled components
const HeroSection = styled(Box)(({ theme }) => ({
  background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${alpha(theme.palette.primary.main, 0.15)} 100%)`,
  borderRadius: theme.shape.borderRadius * 4,
  padding: theme.spacing(6),
  position: 'relative',
  overflow: 'hidden',
  marginBottom: theme.spacing(4),
  textAlign: 'center',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  [theme.breakpoints.down('md')]: {
    padding: theme.spacing(4),
  },
}));

const GlassCard = styled(motion(Card))(({ theme }) => ({
  background: 'rgba(255, 255, 255, 0.8)',
  backdropFilter: 'blur(12px)',
  borderRadius: theme.shape.borderRadius * 3,
  border: '1px solid rgba(255, 255, 255, 0.3)',
  boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)',
  transition: 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)',
  cursor: 'pointer',
  height: '100%',
  '&:hover': {
    transform: 'translateY(-5px)',
    boxShadow: '0 12px 40px 0 rgba(31, 38, 135, 0.12)',
    borderColor: alpha(theme.palette.primary.main, 0.3),
  },
}));

const ActionButton = styled(Button)(({ theme }) => ({
  borderRadius: theme.shape.borderRadius * 3,
  padding: theme.spacing(1.5, 3),
  textTransform: 'none',
  fontSize: '1rem',
  fontWeight: 600,
  boxShadow: 'none',
  '&:hover': {
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
  },
}));

const StyledTextField = styled(TextField)(({ theme }) => ({
  '& .MuiOutlinedInput-root': {
    borderRadius: theme.shape.borderRadius * 3,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    transition: 'all 0.2s',
    '& fieldset': {
      borderColor: 'transparent',
    },
    '&:hover fieldset': {
      borderColor: alpha(theme.palette.primary.main, 0.3),
    },
    '&.Mui-focused': {
      backgroundColor: '#fff',
      boxShadow: `0 4px 20px ${alpha(theme.palette.primary.main, 0.15)}`,
      '& fieldset': {
        borderColor: theme.palette.primary.main,
      },
    },
  },
}));

interface IconWrapperProps {
  color?: string;
}

const IconWrapper = styled(Box, {
  shouldForwardProp: (prop) => prop !== "color",
})<IconWrapperProps>(({ theme, color }) => ({
  width: 56,
  height: 56,
  borderRadius: "16px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  marginBottom: theme.spacing(2),
  background: alpha(color ?? theme.palette.primary.main, 0.1),
  color: color ?? theme.palette.primary.main,
  transition: "all 0.3s ease",
  ".MuiSvgIcon-root": {
    fontSize: 28,
  },
}));

type CreateTicketResponse = {
  id: string;
  category?: string | null;
  ai_confidence?: number | null;
};

type SuggestTicket = {
  id: string;
  title: string;
  status: string;
  category: string | null;
};

type SuggestKb = {
  id: string;
  title: string;
  snippet: string;
};

type SuggestResponse = {
  related_incidents: SuggestTicket[];
  kb_suggestions: SuggestKb[];
  active_outages: { id: string; title: string; regions?: string[] }[];
};

export const Home: React.FC = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  const [message, setMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [createdId, setCreatedId] = React.useState<string | null>(null);
  const [createdCategory, setCreatedCategory] = React.useState<string | null>(null);
  const [createdConfidence, setCreatedConfidence] = React.useState<number | null>(null);
  const [suggestions, setSuggestions] = React.useState<SuggestResponse | null>(null);
  const [suggestLoading, setSuggestLoading] = React.useState(false);

  const submit = async () => {
    const text = message.trim();
    if (!text) return;
    setLoading(true);
    setError("");
    setCreatedId(null);
    setCreatedCategory(null);
    setCreatedConfidence(null);
    setSuggestions(null);
    try {
      const title = text.length > 80 ? `${text.slice(0, 77)}...` : text;
      const res = await api.post<CreateTicketResponse>("/tickets", { title, description: text });
      setCreatedId(res.data.id);
      setCreatedCategory(res.data.category ?? null);
      setCreatedConfidence(res.data.ai_confidence ?? null);
      setMessage("");
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to create ticket"));
    } finally {
      setLoading(false);
    }
  };

  // Debounced suggestions while typing
  React.useEffect(() => {
    const text = message.trim();
    if (!text || text.length < 10) {
      setSuggestions(null);
      return;
    }

    const handle = setTimeout(async () => {
      try {
        setSuggestLoading(true);
        const res = await api.post<SuggestResponse>("/tickets/suggest", { text });
        setSuggestions(res.data);
      } catch {
        // best-effort; keep UI quiet on failure
      } finally {
        setSuggestLoading(false);
      }
    }, 500);

    return () => clearTimeout(handle);
  }, [message]);

  const hasSuggestions = suggestions && (
    suggestions.related_incidents.length > 0 ||
    suggestions.kb_suggestions.length > 0 ||
    suggestions.active_outages.length > 0
  );

  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const itemVariants: Variants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: {
        type: "spring",
        stiffness: 100
      }
    }
  };

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={itemVariants}>
          <HeroSection>
            <Box
              sx={{
                position: 'absolute',
                top: -50,
                right: -50,
                width: 200,
                height: 200,
                borderRadius: '50%',
                background: alpha(theme.palette.secondary.main, 0.1),
                filter: 'blur(40px)',
              }}
            />
            <Box
              sx={{
                position: 'absolute',
                bottom: -50,
                left: -50,
                width: 300,
                height: 300,
                borderRadius: '50%',
                background: alpha(theme.palette.primary.main, 0.1),
                filter: 'blur(60px)',
              }}
            />
            
            <Typography variant="h3" gutterBottom sx={{ fontWeight: 800, mb: 2, position: 'relative' }}>
              How can we help you today?
            </Typography>
            <Typography variant="h6" color="text.secondary" sx={{ mb: 4, maxWidth: 600, position: 'relative' }}>
              Describe your issue below or search our knowledge base for instant answers.
            </Typography>

            <Box sx={{ width: '100%', maxWidth: 700, position: 'relative', zIndex: 1 }}>
              <StyledTextField
                fullWidth
                multiline
                rows={createdId ? 1 : 3}
                placeholder="e.g. I cannot connect to the VPN..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start" sx={{ mt: 1, alignSelf: 'flex-start' }}>
                      <SearchIcon color="action" />
                    </InputAdornment>
                  ),
                }}
              />
              <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
                <ActionButton
                  variant="contained"
                  endIcon={loading ? null : <Send />}
                  onClick={submit}
                  disabled={loading || !message.trim()}
                  sx={{ 
                    minWidth: 140,
                    background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                  }}
                >
                  {loading ? "Processing..." : "Submit Ticket"}
                </ActionButton>
              </Box>
            </Box>
          </HeroSection>
        </motion.div>

        {error && (
          <motion.div variants={itemVariants}>
            <Alert severity="error" sx={{ mb: 4, borderRadius: 2 }}>
              {error}
            </Alert>
          </motion.div>
        )}

        <AnimatePresence>
          {createdId && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              <Paper 
                sx={{ 
                  mb: 4, 
                  p: 3, 
                  borderRadius: 3,
                  background: alpha(theme.palette.success.main, 0.05),
                  border: `1px solid ${alpha(theme.palette.success.main, 0.2)}`
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: 'wrap' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Avatar sx={{ bgcolor: theme.palette.success.main }}>
                      <TicketIcon />
                    </Avatar>
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>Ticket Created Successfully</Typography>
                      <Typography variant="body2" color="text.secondary">
                        Ticket ID: <strong>{createdId}</strong>
                        {createdCategory && (
                          <Chip 
                            label={`AI Category: ${createdCategory}`} 
                            size="small" 
                            color="primary" 
                            variant="outlined" 
                            sx={{ ml: 1, height: 20, fontSize: '0.7rem' }} 
                          />
                        )}
                        {createdConfidence !== null && (
                          <Chip
                            label={`Confidence: ${Math.round(createdConfidence * 100)}%`}
                            size="small"
                            color="success"
                            variant="outlined"
                            sx={{ ml: 1, height: 20, fontSize: '0.7rem' }}
                          />
                        )}
                      </Typography>
                    </Box>
                  </Box>
                  <Box sx={{ display: "flex", gap: 1 }}>
                    <Button variant="outlined" onClick={() => navigate(`/app/tickets/${createdId}`)}>
                      View Ticket
                    </Button>
                    <Button variant="text" onClick={() => navigate("/app/tickets")}>
                      All Tickets
                    </Button>
                  </Box>
                </Box>
              </Paper>
            </motion.div>
          )}
        </AnimatePresence>

        {suggestLoading && !hasSuggestions && (
          <Box sx={{ mb: 3 }}>
            <Alert severity="info" sx={{ borderRadius: 2 }}>
              Searching for similar incidents and knowledge base articles...
            </Alert>
          </Box>
        )}

        <AnimatePresence>
          {hasSuggestions && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              style={{ overflow: 'hidden', marginBottom: 32 }}
            >
              <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <HelpIcon color="primary" /> Suggested Solutions
              </Typography>
              <Grid container spacing={2}>
                {suggestions!.active_outages.map((outage: any) => (
                  <Grid item xs={12} key={outage.id}>
                    <Alert severity="warning" icon={<WarningIcon />}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Active Outage: {outage.title}</Typography>
                      {outage.regions && (
                        <Typography variant="caption">Affected Regions: {outage.regions.join(", ")}</Typography>
                      )}
                    </Alert>
                  </Grid>
                ))}
                
                {suggestions!.kb_suggestions.map((kb: any) => (
                  <Grid item xs={12} md={6} key={kb.id}>
                    <Paper
                      sx={{
                        p: 2,
                        cursor: "pointer",
                        borderRadius: 2,
                        border: '1px solid transparent',
                        '&:hover': { borderColor: theme.palette.primary.main, bgcolor: alpha(theme.palette.primary.main, 0.02) }
                      }}
                      onClick={() => window.open(`/app/kb/${kb.id}`, "_blank")}
                    >
                      <Box sx={{ display: 'flex', gap: 2 }}>
                        <Avatar sx={{ bgcolor: alpha(theme.palette.info.main, 0.1), color: theme.palette.info.main, width: 40, height: 40 }}>
                          <ArticleIcon fontSize="small" />
                        </Avatar>
                        <Box>
                          <Typography variant="subtitle1" sx={{ fontWeight: 600, color: theme.palette.primary.main }}>
                            {kb.title}
                          </Typography>
                          <Typography variant="body2" color="text.secondary" sx={{
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden'
                          }}>
                            {kb.snippet}
                          </Typography>
                        </Box>
                      </Box>
                    </Paper>
                  </Grid>
                ))}

                {suggestions!.related_incidents.map((ticket: any) => (
                  <Grid item xs={12} md={6} key={ticket.id}>
                    <Paper
                      sx={{
                        p: 2,
                        cursor: "pointer",
                        borderRadius: 2,
                        bgcolor: alpha(theme.palette.warning.main, 0.02),
                        border: '1px dashed',
                        borderColor: alpha(theme.palette.warning.main, 0.3)
                      }}
                      onClick={() => navigate(`/app/tickets/${ticket.id}`)}
                    >
                      <Box sx={{ display: 'flex', gap: 2 }}>
                        <Avatar sx={{ bgcolor: alpha(theme.palette.warning.main, 0.1), color: theme.palette.warning.main, width: 40, height: 40 }}>
                          <HistoryIcon fontSize="small" />
                        </Avatar>
                        <Box>
                          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                            {ticket.title}
                          </Typography>
                          <Typography variant="caption" sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5 }}>
                            <Chip label={ticket.status} size="small" sx={{ height: 20, fontSize: '0.65rem' }} />
                            <span>Similar Incident</span>
                          </Typography>
                        </Box>
                      </Box>
                    </Paper>
                  </Grid>
                ))}
              </Grid>
            </motion.div>
          )}
        </AnimatePresence>

        <Typography variant="h5" sx={{ mb: 3, fontWeight: 700 }}>Quick Actions</Typography>
        
        <Grid container spacing={3}>
          <Grid item xs={12} sm={6} md={3}>
            <GlassCard onClick={() => navigate("/app/tickets/new")}>
              <CardContent sx={{ p: 3 }}>
                <IconWrapper color={theme.palette.primary.main}>
                  <AddIcon />
                </IconWrapper>
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 700 }}>
                  Create Ticket
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Submit a new support request for hardware or software issues.
                </Typography>
              </CardContent>
            </GlassCard>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <GlassCard onClick={() => navigate("/app/tickets")}>
              <CardContent sx={{ p: 3 }}>
                <IconWrapper color={theme.palette.secondary.main}>
                  <TicketIcon />
                </IconWrapper>
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 700 }}>
                  My Tickets
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  View and track the status of your existing support requests.
                </Typography>
              </CardContent>
            </GlassCard>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <GlassCard onClick={() => navigate("/app/kb")}>
              <CardContent sx={{ p: 3 }}>
                <IconWrapper color={theme.palette.success.main}>
                  <ArticleIcon />
                </IconWrapper>
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 700 }}>
                  Knowledge Base
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Browse articles and guides to solve common problems yourself.
                </Typography>
              </CardContent>
            </GlassCard>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <GlassCard onClick={() => navigate("/app/profile")}>
              <CardContent sx={{ p: 3 }}>
                <IconWrapper color={theme.palette.info.main}>
                  <PersonIcon />
                </IconWrapper>
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 700 }}>
                  My Profile
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Manage your account settings and contact information.
                </Typography>
              </CardContent>
            </GlassCard>
          </Grid>
        </Grid>
      </motion.div>
    </Container>
  );
};
