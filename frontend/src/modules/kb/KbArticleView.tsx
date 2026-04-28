import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box,
  Typography,
  IconButton,
  Chip,
  Button,
  Alert,
  Tooltip,
  Skeleton,
  Container,
  Rating,
  Avatar,
  TextField,
  Grid,
  useTheme,
  Card,
} from "@mui/material";
import { styled, alpha } from "@mui/material/styles";
import {
  ArrowBack as BackIcon,
  Bookmark as BookmarkIcon,
  BookmarkBorder as BookmarkBorderIcon,
  Visibility as ViewIcon,
  ThumbUp as ThumbUpIcon,
  ThumbDown as ThumbDownIcon,
  Schedule as ScheduleIcon,
  Person as PersonIcon,
  Send as SendIcon,
} from "@mui/icons-material";
import { api, getApiErrorMessage } from "../../services/api";
import { motion, Variants } from "framer-motion";

const GlassCard = styled(motion(Card))(({ theme }) => ({
  background: 'rgba(255, 255, 255, 0.8)',
  backdropFilter: 'blur(12px)',
  borderRadius: theme.shape.borderRadius * 3,
  border: '1px solid rgba(255, 255, 255, 0.3)',
  boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)',
  overflow: 'visible',
}));

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4 } }
};

type KbArticle = {
  id: string;
  title: string;
  body: string;
  category: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  author?: string;
  view_count?: number;
  helpful_count?: number;
  avg_rating?: number;
};

type Comment = {
  id: string;
  body: string;
  created_at: string;
  author_name: string;
  author_email: string;
};

export const KbArticleView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  
  const [article, setArticle] = useState<KbArticle | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bookmarked, setBookmarked] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [userRating, setUserRating] = useState<number | null>(null);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);

  useEffect(() => {
    if (!id) return;
    
    const loadData = async () => {
      setLoading(true);
      try {
        const [articleRes, commentsRes] = await Promise.all([
          api.get<KbArticle>(`/kb/${id}`),
          api.get<Comment[]>(`/kb/${id}/comments`)
        ]);
        
        setArticle(articleRes.data);
        setComments(commentsRes.data);
        
        // Check bookmark
        const savedBookmarks = localStorage.getItem('kb-bookmarks');
        if (savedBookmarks) {
          const bookmarks = new Set(JSON.parse(savedBookmarks));
          setBookmarked(bookmarks.has(id));
        }
      } catch (e) {
        setError(getApiErrorMessage(e, "Failed to load article"));
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [id]);

  const handleBookmark = () => {
    if (!id) return;
    const savedBookmarks = localStorage.getItem('kb-bookmarks');
    const bookmarks = new Set(savedBookmarks ? JSON.parse(savedBookmarks) : []);
    
    if (bookmarked) {
      bookmarks.delete(id);
    } else {
      bookmarks.add(id);
    }
    
    localStorage.setItem('kb-bookmarks', JSON.stringify([...bookmarks]));
    setBookmarked(!bookmarked);
  };

  const handleSubmitComment = async () => {
    if (!id || !newComment.trim()) return;
    
    setSubmittingComment(true);
    try {
      const res = await api.post<Comment>(`/kb/${id}/comments`, { body: newComment });
      setComments([res.data, ...comments]);
      setNewComment("");
    } catch (e) {
      console.error("Failed to post comment", e);
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleRate = async (rating: number | null, helpful: boolean) => {
    if (!id || ratingSubmitted) return;
    
    try {
      await api.post(`/kb/${id}/rate`, { 
        rating: rating || (helpful ? 5 : 1),
        helpful 
      });
      setUserRating(rating);
      setRatingSubmitted(true);
    } catch (e) {
      console.error("Failed to rate article", e);
    }
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 4, mb: 4 }} />
        <Skeleton height={40} width="60%" sx={{ mb: 2 }} />
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} />
        ))}
      </Container>
    );
  }

  if (error || !article) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">{error || "Article not found"}</Alert>
        <Button startIcon={<BackIcon />} onClick={() => navigate('/app/kb')} sx={{ mt: 2 }}>
          Back to Knowledge Base
        </Button>
      </Container>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 8 }}>
      {/* Hero Header */}
      <Box sx={{ 
        bgcolor: 'primary.main', 
        color: 'white', 
        pt: 6, 
        pb: 10,
        position: 'relative',
        overflow: 'hidden'
      }}>
        <Box sx={{
          position: 'absolute',
          top: -50,
          right: -50,
          width: 300,
          height: 300,
          borderRadius: '50%',
          bgcolor: alpha('#fff', 0.1),
        }} />
        
        <Container maxWidth="lg">
          <Button 
            startIcon={<BackIcon />} 
            onClick={() => navigate('/app/kb')}
            sx={{ color: 'white', mb: 4, '&:hover': { bgcolor: alpha('#fff', 0.1) } }}
          >
            Back to KB
          </Button>
          
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <Chip 
              label={article.category} 
              sx={{ bgcolor: 'white', color: 'primary.main', fontWeight: 600 }} 
            />
            {article.tags.map(tag => (
              <Chip 
                key={tag} 
                label={tag} 
                variant="outlined" 
                sx={{ color: 'white', borderColor: alpha('#fff', 0.5) }} 
              />
            ))}
          </Box>

          <Typography variant="h3" fontWeight={800} sx={{ mb: 3, maxWidth: 800 }}>
            {article.title}
          </Typography>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Avatar sx={{ width: 32, height: 32, bgcolor: alpha('#fff', 0.2) }}>
                <PersonIcon fontSize="small" />
              </Avatar>
              <Typography variant="body2" fontWeight={500}>
                {article.author || 'System Admin'}
              </Typography>
            </Box>
            
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, opacity: 0.8 }}>
              <ScheduleIcon fontSize="small" />
              <Typography variant="body2">
                {new Date(article.updated_at).toLocaleDateString()}
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, opacity: 0.8 }}>
              <ViewIcon fontSize="small" />
              <Typography variant="body2">
                {article.view_count || 0} views
              </Typography>
            </Box>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ mt: -6 }}>
        <Grid container spacing={4}>
          <Grid item xs={12} md={8}>
            {/* Article Content */}
            <GlassCard
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              sx={{ p: 4, mb: 4 }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
                <Tooltip title={bookmarked ? "Remove bookmark" : "Add bookmark"}>
                  <IconButton onClick={handleBookmark} color="primary">
                    {bookmarked ? <BookmarkIcon /> : <BookmarkBorderIcon />}
                  </IconButton>
                </Tooltip>
              </Box>
              
              <Box sx={{ 
                '& h1, & h2, & h3, & h4, & h5, & h6': { fontWeight: 700, mt: 4, mb: 2, color: 'text.primary' },
                '& p': { mb: 2, lineHeight: 1.8, color: 'text.primary' },
                '& ul, & ol': { mb: 2, pl: 3, color: 'text.primary' },
                '& li': { mb: 1 },
                '& code': { bgcolor: alpha(theme.palette.primary.main, 0.1), px: 0.5, borderRadius: 0.5, fontFamily: 'monospace', fontSize: '0.875rem' },
                '& pre': { bgcolor: '#1e293b', color: '#f1f5f9', p: 2, borderRadius: 2, overflowX: 'auto', mb: 3 }
              }}>
                {/* Basic markdown rendering */}
                {(article.body || '').split('\n').map((line, i) => {
                  if (line.startsWith('# ')) return <Typography key={i} variant="h3" component="h1">{line.substring(2)}</Typography>;
                  if (line.startsWith('## ')) return <Typography key={i} variant="h4" component="h2">{line.substring(3)}</Typography>;
                  if (line.startsWith('### ')) return <Typography key={i} variant="h5" component="h3">{line.substring(4)}</Typography>;
                  if (line.startsWith('- ')) return (
                    <Box key={i} component="ul" sx={{ m: 0, pl: 2 }}>
                      <Typography component="li" variant="body1">{line.substring(2)}</Typography>
                    </Box>
                  );
                  if (line.trim() === '') return <Box key={i} sx={{ height: 16 }} />;
                  return <Typography key={i} variant="body1" paragraph>{line}</Typography>;
                })}
              </Box>
            </GlassCard>

            {/* Rating Section */}
            <GlassCard
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              sx={{ p: 4, mb: 4, textAlign: 'center' }}
            >
              <Typography variant="h6" fontWeight={600} gutterBottom>
                Was this article helpful?
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, mb: 3 }}>
                <Button 
                  variant={ratingSubmitted && userRating === 5 ? "contained" : "outlined"}
                  color="success"
                  startIcon={<ThumbUpIcon />}
                  onClick={() => handleRate(5, true)}
                  disabled={ratingSubmitted}
                >
                  Yes
                </Button>
                <Button 
                  variant={ratingSubmitted && userRating === 1 ? "contained" : "outlined"}
                  color="error"
                  startIcon={<ThumbDownIcon />}
                  onClick={() => handleRate(1, false)}
                  disabled={ratingSubmitted}
                >
                  No
                </Button>
              </Box>
              
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Rate this article
              </Typography>
              <Rating 
                value={userRating || article.avg_rating || 0} 
                onChange={(_, val) => handleRate(val, val ? val >= 3 : false)}
                disabled={ratingSubmitted}
                size="large"
              />
            </GlassCard>

            {/* Comments Section */}
            <Box>
              <Typography variant="h5" fontWeight={700} sx={{ mb: 3 }}>
                Comments ({comments.length})
              </Typography>
              
              <GlassCard
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                sx={{ p: 3, mb: 4 }}
              >
                <TextField
                  fullWidth
                  multiline
                  rows={3}
                  placeholder="Share your thoughts..."
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  sx={{ mb: 2 }}
                />
                <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button 
                    variant="contained" 
                    endIcon={<SendIcon />}
                    onClick={handleSubmitComment}
                    disabled={!newComment.trim() || submittingComment}
                  >
                    Post Comment
                  </Button>
                </Box>
              </GlassCard>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {comments.map((comment) => (
                  <GlassCard
                    key={comment.id}
                    variants={cardVariants}
                    initial="hidden"
                    animate="visible"
                    sx={{ p: 3 }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                      <Avatar sx={{ bgcolor: theme.palette.secondary.main }}>
                        {comment.author_name.charAt(0)}
                      </Avatar>
                      <Box>
                        <Typography variant="subtitle2" fontWeight={600}>
                          {comment.author_name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(comment.created_at).toLocaleDateString()}
                        </Typography>
                      </Box>
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      {comment.body}
                    </Typography>
                  </GlassCard>
                ))}
              </Box>
            </Box>
          </Grid>
          
          <Grid item xs={12} md={4}>
            {/* Sidebar - could add Table of Contents or Related Articles here */}
            <GlassCard
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              sx={{ p: 3, position: 'sticky', top: 20 }}
            >
               <Typography variant="h6" fontWeight={600} gutterBottom>
                In this article
              </Typography>
              {/* Simplified TOC for now */}
              <Typography variant="body2" color="text.secondary">
                Table of contents is generated from article headers.
              </Typography>
            </GlassCard>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
};
