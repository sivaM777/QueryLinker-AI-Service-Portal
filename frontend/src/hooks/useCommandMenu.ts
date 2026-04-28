import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

interface SearchResult {
  id: string;
  title: string;
  type: 'ticket' | 'article' | 'action' | 'nav';
  url?: string;
  icon?: React.ReactNode;
  description?: string;
}

interface UseCommandMenuReturn {
  open: boolean;
  setOpen: (open: boolean) => void;
  search: string;
  setSearch: (search: string) => void;
  results: SearchResult[];
  loading: boolean;
  toggle: () => void;
  close: () => void;
}

export function useCommandMenu(): UseCommandMenuReturn {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Keyboard shortcut: Ctrl+K or Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Search functionality with debounce
  useEffect(() => {
    if (!open || !search.trim()) {
      setResults([]);
      return;
    }

    const searchData = async () => {
      setLoading(true);
      try {
        const searchResults: SearchResult[] = [];

        // Search tickets
        try {
          const ticketRes = await api.get(`/tickets?search=${encodeURIComponent(search)}&limit=5`);
          if (ticketRes.data?.tickets) {
            ticketRes.data.tickets.forEach((ticket: any) => {
              searchResults.push({
                id: `ticket-${ticket.id}`,
                title: ticket.title || `Ticket ${ticket.display_number}`,
                type: 'ticket',
                url: `/admin/tickets/${ticket.id}`,
                description: ticket.status
              });
            });
          }
        } catch (err) {
          console.error('Ticket search error:', err);
        }

        // Search KB articles
        try {
          const kbRes = await api.get(`/kb/articles?search=${encodeURIComponent(search)}&limit=5`);
          if (kbRes.data?.articles) {
            kbRes.data.articles.forEach((article: any) => {
              searchResults.push({
                id: `article-${article.id}`,
                title: article.title,
                type: 'article',
                url: `/kb/${article.id}`,
                description: article.category
              });
            });
          }
        } catch (err) {
          console.error('KB search error:', err);
        }

        setResults(searchResults);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setLoading(false);
      }
    };

    const debounceTimer = setTimeout(searchData, 300);
    return () => clearTimeout(debounceTimer);
  }, [search, open]);

  const toggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  return {
    open,
    setOpen,
    search,
    setSearch,
    results,
    loading,
    toggle,
    close
  };
}
