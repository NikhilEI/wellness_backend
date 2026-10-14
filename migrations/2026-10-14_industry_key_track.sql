-- Migration 2026-10-14
-- Adds the Industry dropdown (space booking, visitor, speaker) and Key Track dropdown
-- (visitor/delegate, speaker). brochure_downloads.industry already exists.
-- Duplicate email/mobile blocking is enforced in the API (SELECT before INSERT).
-- Safe to re-run. Works on MySQL and MariaDB.

USE wellness_india_expo;

DELIMITER $$
DROP PROCEDURE IF EXISTS add_col_if_missing$$
CREATE PROCEDURE add_col_if_missing(IN tbl VARCHAR(64), IN col VARCHAR(64), IN def VARCHAR(100))
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND COLUMN_NAME = col) = 0 THEN
    SET @ddl = CONCAT('ALTER TABLE ', tbl, ' ADD COLUMN ', col, ' ', def);
    PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

CALL add_col_if_missing('space_bookings', 'industry', 'VARCHAR(150) NULL');
CALL add_col_if_missing('visitor_registrations', 'industry', 'VARCHAR(150) NULL');
CALL add_col_if_missing('visitor_registrations', 'key_track', 'VARCHAR(150) NULL');
CALL add_col_if_missing('speaker_registrations', 'industry', 'VARCHAR(150) NULL');
CALL add_col_if_missing('speaker_registrations', 'key_track', 'VARCHAR(150) NULL');
CALL add_col_if_missing('space_bookings', 'state', 'VARCHAR(100) NULL');
CALL add_col_if_missing('brochure_downloads', 'state', 'VARCHAR(100) NULL');

DROP PROCEDURE add_col_if_missing;
