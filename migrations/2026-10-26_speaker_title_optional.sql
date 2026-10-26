-- Migration 2026-10-26
-- Changes:
--   1. speaker_registrations.title -> now NULLable. The Title field was removed from the
--                                     speaker registration form; existing rows keep their value.
-- No schema change is needed for the Designation dropdowns: the designation columns are
-- VARCHAR(100) and every dropdown option fits.
-- Safe to re-run: the ALTER only runs while the column is still NOT NULL.
-- Works on both MySQL and MariaDB.

USE wellness_india_expo;

SET @title_not_null := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'speaker_registrations'
    AND COLUMN_NAME = 'title' AND IS_NULLABLE = 'NO'
);
SET @ddl := IF(@title_not_null > 0,
  "ALTER TABLE speaker_registrations MODIFY COLUMN title VARCHAR(10) NULL",
  "SELECT 'speaker_registrations.title is already nullable (or missing)' AS note");
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
