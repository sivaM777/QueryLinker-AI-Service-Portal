-- Migration: 036_fix_collation_version.sql
-- Fix PostgreSQL collation version mismatch after switching to pgvector image

-- Refresh collation versions for all databases
ALTER DATABASE pit_portal REFRESH COLLATION VERSION;

-- Note: The postgres database collation warning is benign and doesn't affect application functionality
-- This migration addresses the warning that appears when switching between PostgreSQL images with different glibc versions
