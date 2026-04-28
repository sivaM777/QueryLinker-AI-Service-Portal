import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Typography,
  TextField,
  Chip,
  Button,
  Paper,
  Card,
  CardContent,
  Grid,
  IconButton,
  Tabs,
  Tab,
  Container,
  Avatar,
  Rating,
  useTheme,
  alpha,
} from "@mui/material";
import {
  Search as SearchIcon,
  Bookmark as BookmarkIcon,
  BookmarkBorder as BookmarkBorderIcon,
  Visibility as ViewIcon,
  ThumbUp as ThumbUpIcon,
  RocketLaunch as RocketIcon,
  Security as SecurityIcon,
  Apps as AppsIcon,
  Devices as DevicesIcon,
  NetworkCheck as NetworkCheckIcon,
  Email as EmailIcon,
  Print as PrintIcon,
  Storage as StorageIcon,
  Build as BuildIcon,
  ArrowForward as ArrowForwardIcon,
  Article as ArticleIcon,
  Star as StarIcon,
} from "@mui/icons-material";
import { motion, AnimatePresence } from "framer-motion";
import { api, getCachedData } from "../../services/api";

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

const CATEGORY_LABELS: Record<string, string> = {
  KB_GENERAL: "Getting Started",
  IDENTITY_ACCESS: "Account & Security",
  SOFTWARE_INSTALL_LICENSE: "Software & Apps",
  HARDWARE_PERIPHERAL: "Hardware & Devices",
  ENDPOINT_DEVICE: "Endpoint & Devices",
  NETWORK_VPN_WIFI: "Network & Connectivity",
  EMAIL_COLLAB: "Email & Calendar",
  PRINTING_SCANNING: "Printing & Scanning",
  DATA_STORAGE: "Data & Storage",
  BUSINESS_APP_ERP_CRM: "Business Apps",
  SECURITY_INCIDENT: "Security & Compliance",
  OTHER: "Other",
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  KB_GENERAL: <RocketIcon />,
  IDENTITY_ACCESS: <SecurityIcon />,
  SOFTWARE_INSTALL_LICENSE: <AppsIcon />,
  HARDWARE_PERIPHERAL: <DevicesIcon />,
  ENDPOINT_DEVICE: <DevicesIcon />,
  NETWORK_VPN_WIFI: <NetworkCheckIcon />,
  EMAIL_COLLAB: <EmailIcon />,
  PRINTING_SCANNING: <PrintIcon />,
  DATA_STORAGE: <StorageIcon />,
  BUSINESS_APP_ERP_CRM: <AppsIcon />,
  SECURITY_INCIDENT: <SecurityIcon />,
  OTHER: <BuildIcon />,
};

const CATEGORY_CARDS = [
  { code: "KB_GENERAL", label: "Getting Started", icon: <RocketIcon /> },
  { code: "IDENTITY_ACCESS", label: "Account & Security", icon: <SecurityIcon /> },
  { code: "SOFTWARE_INSTALL_LICENSE", label: "Software & Apps", icon: <AppsIcon /> },
  { code: "HARDWARE_PERIPHERAL", label: "Hardware & Devices", icon: <DevicesIcon /> },
];

const MotionCard = motion(Card);

const ArticleCard: React.FC<{
  article: KbArticle;
  onBookmark: (id: string) => void;
  bookmarked: boolean;
}> = ({ article, onBookmark, bookmarked }) => {
  const navigate = useNavigate();
  const theme = useTheme();

  const body = article.body || '';
  const snippet = body
    .replace(/[#*`]/g, '')
    .substring(0, 120)
    .trim() + (body.length > 120 ? '...' : '');

  return (
    <MotionCard
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -5, boxShadow: theme.shadows[10] }}
      transition={{ duration: 0.3 }}
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        borderRadius: 3,
        overflow: 'hidden',
        border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
        background: theme.palette.background.paper,
      }}
      onClick={() => navigate(`/app/kb/${article.id}`)}
    >
      <CardContent sx={{ p: 3, flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Chip
            label={CATEGORY_LABELS[article.category] || article.category}
            size="small"
            icon={(CATEGORY_ICONS[article.category] || <ArticleIcon />) as React.ReactElement}
            sx={{ 
              borderRadius: 1, 
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              color: theme.palette.primary.main,
              fontWeight: 600,
              fontSize: '0.75rem'
            }}
          />
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onBookmark(article.id);
            }}
            sx={{ color: bookmarked ? 'primary.main' : 'text.disabled' }}
          >
            {bookmarked ? <BookmarkIcon /> : <BookmarkBorderIcon />}
          </IconButton>
        </Box>

        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5, lineHeight: 1.3 }}>
          {article.title}
        </Typography>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 3, flexGrow: 1, lineHeight: 1.6 }}>
          {snippet}
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 'auto', pt: 2, borderTop: `1px solid ${theme.palette.divider}` }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
              <ViewIcon sx={{ fontSize: 16 }} />
              <Typography variant="caption" fontWeight={600}>{article.view_count || 0}</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
              <ThumbUpIcon sx={{ fontSize: 16 }} />
              <Typography variant="caption" fontWeight={600}>{article.helpful_count || 0}</Typography>
            </Box>
          </Box>
          
          {article.avg_rating && article.avg_rating > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Rating value={Number(article.avg_rating)} precision={0.5} size="small" readOnly />
              <Typography variant="caption" color="text.secondary">({article.avg_rating})</Typography>
            </Box>
          )}
        </Box>
      </CardContent>
    </MotionCard>
  );
};

export const ModernKnowledgeBase: React.FC = () => {
  const theme = useTheme();
  
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState("featured");
  const initialCache = getCachedData<KbArticle[] | { items: KbArticle[] }>({
    url: "/kb/featured",
    params: { limit: 12 },
  });
  const initialItems = Array.isArray(initialCache) ? initialCache : initialCache?.items || [];
  const [articles, setArticles] = useState<KbArticle[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [bookmarked, setBookmarked] = useState<Set<string>>(new Set());

  useEffect(() => {
    const savedBookmarks = localStorage.getItem('kb-bookmarks');
    if (savedBookmarks) {
      setBookmarked(new Set(JSON.parse(savedBookmarks)));
    }
  }, []);

  useEffect(() => {
    const loadArticles = async () => {
      setLoading(true);
      try {
        let endpoint = "/kb";
        let params: any = { limit: 12 };

        if (query) {
          params.q = query;
          params.sortBy = "relevance";
        } else {
          switch (activeTab) {
            case "featured":
              endpoint = "/kb/featured";
              break;
            case "popular":
              endpoint = "/kb/most-viewed";
              break;
            case "useful":
              endpoint = "/kb/most-useful";
              break;
            case "recent":
              params.sortBy = "updated";
              break;
            default:
              params.category = activeTab;
          }
        }

        const res = await api.get<KbArticle[] | { items: KbArticle[] }>(endpoint, { params });
        // Handle both array response and paginated response
        const items = Array.isArray(res.data) ? res.data : (res.data as any).items || [];
        setArticles(items);
      } catch (e) {
        console.error("Failed to load articles", e);
      } finally {
        setLoading(false);
      }
    };

    const timeoutId = setTimeout(loadArticles, 300);
    return () => clearTimeout(timeoutId);
  }, [query, activeTab]);

  const handleBookmark = async (articleId: string) => {
    const newBookmarked = new Set(bookmarked);
    if (newBookmarked.has(articleId)) {
      newBookmarked.delete(articleId);
    } else {
      newBookmarked.add(articleId);
    }
    setBookmarked(newBookmarked);
    localStorage.setItem('kb-bookmarks', JSON.stringify([...newBookmarked]));
    // Ideally call API to persist
  };

  const handleCategoryClick = (category: string) => {
    setActiveTab(category);
    // Scroll to articles
    document.getElementById('articles-section')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Hero Section */}
      <Box sx={{
        position: 'relative',
        bgcolor: 'primary.main',
        color: 'white',
        pt: 8,
        pb: 12,
        overflow: 'hidden',
        mb: 6
      }}>
        {/* Abstract Background Shapes */}
        <Box sx={{
          position: 'absolute',
          top: -100,
          right: -100,
          width: 400,
          height: 400,
          borderRadius: '50%',
          bgcolor: alpha('#fff', 0.1),
        }} />
        <Box sx={{
          position: 'absolute',
          bottom: -50,
          left: -50,
          width: 200,
          height: 200,
          borderRadius: '50%',
          bgcolor: alpha('#fff', 0.1),
        }} />

        <Container maxWidth="md" sx={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
          <Typography variant="h2" fontWeight={800} mb={2} sx={{ 
            background: 'linear-gradient(45deg, #fff 30%, #e0e0e0 90%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            textShadow: '0 2px 10px rgba(0,0,0,0.1)'
          }}>
            How can we help you?
          </Typography>
          <Typography variant="h6" sx={{ opacity: 0.9, mb: 5, fontWeight: 400 }}>
            Find answers, support, and inspiration for your workflow.
          </Typography>

          <Paper
            elevation={0}
            component={motion.div}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5 }}
            sx={{
              p: 1,
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              borderRadius: 4,
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
              bgcolor: 'background.paper'
            }}
          >
            <IconButton sx={{ p: 2 }}>
              <SearchIcon color="primary" />
            </IconButton>
            <TextField
              fullWidth
              placeholder="Search for articles..."
              variant="standard"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              InputProps={{ disableUnderline: true }}
              sx={{ px: 2 }}
            />
            <Button 
              variant="contained" 
              size="large"
              sx={{ borderRadius: 3, px: 4, py: 1.5, fontWeight: 700 }}
            >
              Search
            </Button>
          </Paper>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ mt: -8, position: 'relative', zIndex: 2 }}>
        {/* Categories Grid */}
        <Grid container spacing={2} sx={{ mb: 6 }}>
          {CATEGORY_CARDS.map((cat) => (
            <Grid item xs={6} md={3} key={cat.code}>
              <MotionCard
                whileHover={{ y: -5 }}
                onClick={() => handleCategoryClick(cat.code)}
                sx={{
                  p: 3,
                  cursor: 'pointer',
                  borderRadius: 3,
                  textAlign: 'center',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  boxShadow: '0 4px 20px rgba(0,0,0,0.05)'
                }}
              >
                <Avatar sx={{ 
                  bgcolor: alpha(theme.palette.primary.main, 0.1), 
                  color: 'primary.main',
                  width: 56,
                  height: 56
                }}>
                  {cat.icon}
                </Avatar>
                <Typography variant="subtitle1" fontWeight={700}>
                  {cat.label}
                </Typography>
              </MotionCard>
            </Grid>
          ))}
        </Grid>

        {/* Content Section */}
        <Box id="articles-section" sx={{ mb: 8 }}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 4 }}>
            <Tabs 
              value={['featured', 'popular', 'useful', 'recent'].includes(activeTab) ? activeTab : false}
              onChange={(_, v) => v && setActiveTab(v)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{ 
                '& .MuiTab-root': { 
                  fontWeight: 600, 
                  textTransform: 'none',
                  fontSize: '1rem',
                  minWidth: 100
                } 
              }}
            >
              <Tab label="Featured" value="featured" icon={<StarIcon />} iconPosition="start" />
              <Tab label="Most Viewed" value="popular" icon={<ViewIcon />} iconPosition="start" />
              <Tab label="Most Useful" value="useful" icon={<ThumbUpIcon />} iconPosition="start" />
              <Tab label="Recently Updated" value="recent" icon={<ArticleIcon />} iconPosition="start" />
            </Tabs>
          </Box>

          {activeTab && !['featured', 'popular', 'useful', 'recent'].includes(activeTab) && (
            <Box sx={{ mb: 4, display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="h5" fontWeight={700}>
                {CATEGORY_LABELS[activeTab] || activeTab}
              </Typography>
              <Button 
                size="small" 
                onClick={() => setActiveTab('featured')}
                startIcon={<ArrowForwardIcon sx={{ transform: 'rotate(180deg)' }} />}
              >
                Back to All
              </Button>
            </Box>
          )}

          <AnimatePresence mode="wait">
            <Grid container spacing={3} component={motion.div} layout>
              {articles.length > 0 ? (
                articles.map((article) => (
                  <Grid item xs={12} sm={6} md={4} key={article.id}>
                    <ArticleCard 
                      article={article} 
                      bookmarked={bookmarked.has(article.id)}
                      onBookmark={handleBookmark}
                    />
                  </Grid>
                ))
              ) : (
                !loading ? (
                  <Grid item xs={12}>
                    <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
                      <SearchIcon sx={{ fontSize: 64, mb: 2, opacity: 0.2 }} />
                      <Typography variant="h6">No articles found</Typography>
                      <Typography variant="body2">Try adjusting your search or filters</Typography>
                    </Box>
                  </Grid>
                ) : null
              )}
            </Grid>
          </AnimatePresence>
        </Box>
      </Container>
    </Box>
  );
};
