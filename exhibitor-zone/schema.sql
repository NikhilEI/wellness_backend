-- Exhibitor Zone — additive patch only, now against the single wellness_india_expo
-- database (originally a separate `exhibitor_zone` database; consolidated per
-- request — all 34 exhibitor-zone tables were moved in with `RENAME TABLE`).
--
-- users, companies, events, roles, user_event_roles, exhibitor_event_profiles,
-- stalls, stall_allocations, service_categories/service_items, carts/orders/
-- invoices, pass_types/passes, form_templates/form_submissions,
-- notification_log/notification_templates, audit_logs, etc. already exist here
-- and are NOT recreated by this file.
--
-- The one genuinely missing piece (matching the documented "notifications
-- table doesn't exist" bug) is added below: a real in-app notification inbox,
-- distinct from notification_log/notification_templates (which track outbound
-- email/SMS/in-app *dispatch*, not per-user read state).

USE wellness_india_expo;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  type ENUM('info','success','warning','error') NOT NULL DEFAULT 'info',
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notifications_user_unread (user_id, is_read)
) ENGINE=InnoDB;
