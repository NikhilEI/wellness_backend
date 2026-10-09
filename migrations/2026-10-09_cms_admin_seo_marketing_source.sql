-- Migration 2026-10-09
-- Changes:
--   1. space_bookings.source        -> tells the public form ('public') apart from the
--                                      marketing-team form ('marketing')
--   2. cms_admins / cms_admin_sessions -> standalone CMS admin panel login (/cms-admin)
--   3. seo_pages                    -> per-page SEO meta overrides edited in the CMS panel
-- Safe to re-run: every statement checks whether it has already been applied.
-- Works on both MySQL and MariaDB.

USE wellness_india_expo;

-- 1) space_bookings.source ---------------------------------------------------------------
SET @has_source := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'space_bookings' AND COLUMN_NAME = 'source'
);
SET @ddl := IF(@has_source = 0,
  "ALTER TABLE space_bookings ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'public' AFTER business_intrest",
  "SELECT 'space_bookings.source already exists' AS note");
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) CMS admin panel ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cms_admins (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cms_admin_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cms_admin_sessions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token_hash CHAR(64) NOT NULL,
  admin_id INT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cms_session_token (token_hash),
  KEY idx_cms_session_admin (admin_id),
  CONSTRAINT fk_cms_session_admin FOREIGN KEY (admin_id) REFERENCES cms_admins (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 3) SEO overrides ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS seo_pages (
  path VARCHAR(150) NOT NULL PRIMARY KEY,
  title VARCHAR(200) NULL,
  description VARCHAR(500) NULL,
  keywords VARCHAR(500) NULL,
  canonical_url VARCHAR(500) NULL,
  og_image VARCHAR(500) NULL,
  updated_by VARCHAR(255) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
