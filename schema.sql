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
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- CREATE TABLE ... IF NOT EXISTS won't add this column to a table that already exists
-- (e.g. the UAT database). Run this once there instead:
-- ALTER TABLE space_bookings MODIFY business_intrest VARCHAR(100) NULL;

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
