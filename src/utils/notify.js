async function notifyUser(pool, { userId, title, message, type = "info" }) {
  await pool.query("INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)", [
    userId,
    title,
    message,
    type
  ]);
}

// Notifies every global super_admin plus every organiser/finance user scoped
// to `eventId` — the audience for "a new company registered", "an order needs
// review", etc.
async function notifyAdmins(pool, eventId, { title, message, type = "info" }) {
  const [rows] = await pool.query(
    `SELECT DISTINCT uer.user_id FROM user_event_roles uer
     JOIN roles r ON r.id = uer.role_id
     WHERE uer.is_active = 1
       AND (r.name = 'super_admin' OR (uer.event_id = ? AND r.name IN ('organiser', 'finance')))`,
    [eventId]
  );

  await Promise.all(rows.map((row) => notifyUser(pool, { userId: row.user_id, title, message, type })));
}

module.exports = { notifyUser, notifyAdmins };
