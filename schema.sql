CREATE DATABASE IF NOT EXISTS wellness_india_expo
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE wellness_india_expo;

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  source_page VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_newsletter_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS space_bookings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(30) NOT NULL,
  last_name VARCHAR(30) NOT NULL,
  organisation VARCHAR(100) NOT NULL,
  designation VARCHAR(100) NULL,
  email VARCHAR(255) NOT NULL,
  learn_about_expo VARCHAR(50) NOT NULL,
  city VARCHAR(100) NOT NULL,
  country VARCHAR(100) NOT NULL,
  mobile_no VARCHAR(20) NOT NULL,
  shell_space VARCHAR(255) NULL,
  -- Reserved for future use — not currently collected by the form or written by the API.
  business_intrest VARCHAR(100) NULL,
  -- 'public' = /space-booking (OTP verified), 'marketing' = /space-booking-marketing (no OTP).
  source VARCHAR(20) NOT NULL DEFAULT 'public',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- CREATE TABLE ... IF NOT EXISTS won't add these columns to a table that already exists
-- (e.g. the UAT database). Run these once there instead:
-- ALTER TABLE space_bookings MODIFY business_intrest VARCHAR(100) NULL;
-- ALTER TABLE space_bookings ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'public' AFTER business_intrest;

CREATE TABLE IF NOT EXISTS visitor_registrations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  registration_id VARCHAR(20) NOT NULL,
  title VARCHAR(10) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  organisation VARCHAR(150) NULL,
  designation VARCHAR(100) NOT NULL,
  department VARCHAR(100) NULL,
  country VARCHAR(100) NOT NULL,
  country_code VARCHAR(10) NOT NULL,
  state VARCHAR(100) NOT NULL,
  city VARCHAR(100) NOT NULL,
  mobile VARCHAR(20) NOT NULL,
  email VARCHAR(255) NOT NULL,
  otp_verified_via VARCHAR(10) NOT NULL,
  visit_objective VARCHAR(150) NOT NULL,
  product_interests JSON NOT NULL,
  terms_accepted TINYINT(1) NOT NULL DEFAULT 0,
  marketing_consent TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_visitor_registration_id (registration_id),
  UNIQUE KEY uq_visitor_email (email),
  UNIQUE KEY uq_visitor_mobile (mobile)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS speaker_registrations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(10) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NULL,
  organisation VARCHAR(150) NOT NULL,
  designation VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  mobile VARCHAR(20) NOT NULL,
  address VARCHAR(255) NULL,
  city VARCHAR(100) NOT NULL,
  zip_code VARCHAR(20) NULL,
  state VARCHAR(100) NULL,
  country VARCHAR(100) NOT NULL,
  terms_accepted TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS media_registrations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  media_name VARCHAR(150) NOT NULL,
  press_card_no VARCHAR(50) NULL,
  full_name VARCHAR(100) NOT NULL,
  designation VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  city VARCHAR(100) NOT NULL,
  country VARCHAR(100) NOT NULL,
  mobile VARCHAR(20) NOT NULL,
  terms_accepted TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS hosted_buyer_registrations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  designation VARCHAR(100) NOT NULL,
  company VARCHAR(150) NOT NULL,
  email VARCHAR(255) NOT NULL,
  mobile VARCHAR(20) NOT NULL,
  city VARCHAR(100) NOT NULL,
  country VARCHAR(100) NOT NULL,
  website VARCHAR(255) NOT NULL,
  outlets VARCHAR(100) NOT NULL,
  company_turnover VARCHAR(100) NOT NULL,
  company_profile VARCHAR(400) NOT NULL,
  terms_accepted TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS brochure_downloads (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  designation VARCHAR(100) NOT NULL,
  company_name VARCHAR(150) NOT NULL,
  industry VARCHAR(150) NULL,
  interest VARCHAR(150) NULL,
  email VARCHAR(255) NOT NULL,
  country VARCHAR(100) NOT NULL,
  country_code VARCHAR(10) NOT NULL,
  mobile VARCHAR(20) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---- CMS admin panel (/cms-admin): separate from Exhibitor Zone users/sessions ----
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

-- SEO overrides per public page path. A page with no row falls back to the defaults
-- hardcoded in the frontend (src/lib/seoDefaults.ts).
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
