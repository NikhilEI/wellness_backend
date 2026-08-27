const crypto = require("crypto");
const express = require("express");
const pool = require("../../db/pool");
const asyncHandler = require("../../middleware/asyncHandler");
const requireAuth = require("../../middleware/requireAuth");
const requireRole = require("../../middleware/requireRole");
const requireEventContext = require("../../middleware/requireEventContext");
const validate = require("../../middleware/validate");
const { ApiError } = require("../../middleware/errorHandler");
const { resolveOwnProfileId } = require("../../utils/exhibitorProfile");
const { notifyAdmins } = require("../../utils/notify");
const { z } = require("zod");

const router = express.Router();

const ADMIN_ROLES = ["super_admin", "organiser", "finance"];

router.use(requireAuth, requireEventContext);

async function getOrCreateCart(profileId, userId, eventId) {
  const [existing] = await pool.query(
    "SELECT * FROM carts WHERE event_id = ? AND exhibitor_profile_id = ? AND status = 'active' LIMIT 1",
    [eventId, profileId]
  );
  if (existing.length > 0) return existing[0];

  const [result] = await pool.query(
    `INSERT INTO carts (uuid, event_id, exhibitor_profile_id, user_id, currency, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'INR', 'active', NOW(), NOW())`,
    [crypto.randomUUID(), eventId, profileId, userId]
  );
  return { id: result.insertId, event_id: eventId, exhibitor_profile_id: profileId, user_id: userId, currency: "INR", status: "active" };
}

async function loadCartWithItems(cartId) {
  const [items] = await pool.query(
    `SELECT ci.*, si.name, si.sku, si.unit, si.tax_rate_pct
     FROM cart_items ci
     JOIN service_items si ON si.id = ci.service_item_id
     WHERE ci.cart_id = ?`,
    [cartId]
  );

  const subtotal = items.reduce((sum, i) => sum + Number(i.unit_price) * i.quantity, 0);
  const surchargeTotal = items.reduce((sum, i) => sum + (Number(i.unit_price) * i.quantity * Number(i.surcharge_pct)) / 100, 0);
  const taxTotal = items.reduce(
    (sum, i) => sum + ((Number(i.unit_price) * i.quantity + (Number(i.unit_price) * i.quantity * Number(i.surcharge_pct)) / 100) * Number(i.tax_rate_pct)) / 100,
    0
  );

  return { items, subtotal, surchargeTotal, taxTotal, grandTotal: subtotal + surchargeTotal + taxTotal };
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const profileId = await resolveOwnProfileId(pool, req);
    const cart = await getOrCreateCart(profileId, req.user.id, req.user.eventId);
    const details = await loadCartWithItems(cart.id);
    res.json({ cart, ...details });
  })
);

router.get(
  "/all",
  requireRole(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const [carts] = await pool.query(
      `SELECT c.id, c.exhibitor_profile_id, c.status, c.updated_at, comp.display_name AS company_name
       FROM carts c
       JOIN exhibitor_event_profiles eep ON eep.id = c.exhibitor_profile_id
       JOIN companies comp ON comp.id = eep.company_id
       WHERE c.event_id = ? AND c.status = 'active'
       ORDER BY c.updated_at DESC`,
      [req.user.eventId]
    );

    const summaries = await Promise.all(
      carts.map(async (cart) => {
        const details = await loadCartWithItems(cart.id);
        return {
          profileId: cart.exhibitor_profile_id,
          companyName: cart.company_name,
          status: cart.status,
          itemCount: details.items.reduce((sum, i) => sum + i.quantity, 0),
          grandTotal: details.grandTotal,
          updatedAt: cart.updated_at
        };
      })
    );

    res.json({ carts: summaries });
  })
);

router.get(
  "/:profileId",
  requireRole(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const [cartRows] = await pool.query(
      "SELECT * FROM carts WHERE event_id = ? AND exhibitor_profile_id = ? AND status = 'active' LIMIT 1",
      [req.user.eventId, req.params.profileId]
    );
    if (cartRows.length === 0) return res.json({ cart: null, items: [], subtotal: 0, surchargeTotal: 0, taxTotal: 0, grandTotal: 0 });

    const details = await loadCartWithItems(cartRows[0].id);
    res.json({ cart: cartRows[0], ...details });
  })
);

const addItemSchema = z.object({
  serviceItemId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().positive().default(1)
});

async function addItemToCart(profileId, userId, eventId, serviceItemId, quantity) {
  const [itemRows] = await pool.query("SELECT * FROM service_items WHERE id = ? AND event_id = ? AND is_active = 1 LIMIT 1", [
    serviceItemId,
    eventId
  ]);
  const item = itemRows[0];
  if (!item) throw new ApiError(404, "Catalogue item not found.");

  if (quantity < item.min_order_qty) {
    throw new ApiError(400, `Minimum order quantity for this item is ${item.min_order_qty}.`);
  }
  if (item.max_order_qty && quantity > item.max_order_qty) {
    throw new ApiError(400, `Maximum order quantity for this item is ${item.max_order_qty}.`);
  }
  if (item.inventory_total !== null) {
    const available = item.inventory_total - item.inventory_reserved - item.inventory_sold;
    if (quantity > available) {
      throw new ApiError(409, `Only ${available} unit(s) of this item are available.`);
    }
  }

  const surchargePct = item.late_surcharge_from && new Date(item.late_surcharge_from) < new Date() ? item.late_surcharge_pct : 0;
  const cart = await getOrCreateCart(profileId, userId, eventId);

  await pool.query(
    `INSERT INTO cart_items (cart_id, service_item_id, quantity, unit_price, surcharge_pct, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), unit_price = VALUES(unit_price), surcharge_pct = VALUES(surcharge_pct), updated_at = NOW()`,
    [cart.id, serviceItemId, quantity, item.price_inr, surchargePct]
  );
}

async function removeItemFromCart(profileId, eventId, itemId) {
  const [cartRows] = await pool.query(
    "SELECT id FROM carts WHERE event_id = ? AND exhibitor_profile_id = ? AND status = 'active' LIMIT 1",
    [eventId, profileId]
  );
  if (cartRows.length === 0) throw new ApiError(404, "Cart not found.");

  const [result] = await pool.query("DELETE FROM cart_items WHERE id = ? AND cart_id = ?", [itemId, cartRows[0].id]);
  if (result.affectedRows === 0) throw new ApiError(404, "Cart item not found.");
}

router.post(
  "/items",
  validate(addItemSchema),
  asyncHandler(async (req, res) => {
    const profileId = await resolveOwnProfileId(pool, req);
    await addItemToCart(profileId, req.user.id, req.user.eventId, req.body.serviceItemId, req.body.quantity);
    res.status(201).json({ message: "Added to cart." });
  })
);

router.delete(
  "/items/:itemId",
  asyncHandler(async (req, res) => {
    const profileId = await resolveOwnProfileId(pool, req);
    await removeItemFromCart(profileId, req.user.eventId, req.params.itemId);
    res.json({ message: "Removed from cart." });
  })
);

router.post(
  "/:profileId/items",
  requireRole(...ADMIN_ROLES),
  validate(addItemSchema),
  asyncHandler(async (req, res) => {
    await addItemToCart(req.params.profileId, req.user.id, req.user.eventId, req.body.serviceItemId, req.body.quantity);
    res.status(201).json({ message: "Added to cart." });
  })
);

router.delete(
  "/:profileId/items/:itemId",
  requireRole(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    await removeItemFromCart(req.params.profileId, req.user.eventId, req.params.itemId);
    res.json({ message: "Removed from cart." });
  })
);

router.post(
  "/checkout",
  asyncHandler(async (req, res) => {
    const profileId = await resolveOwnProfileId(pool, req);

    const [cartRows] = await pool.query(
      "SELECT * FROM carts WHERE event_id = ? AND exhibitor_profile_id = ? AND status = 'active' LIMIT 1",
      [req.user.eventId, profileId]
    );
    const cart = cartRows[0];
    if (!cart) throw new ApiError(400, "Your cart is empty.");

    const { items, subtotal, surchargeTotal, taxTotal, grandTotal } = await loadCartWithItems(cart.id);
    if (items.length === 0) throw new ApiError(400, "Your cart is empty.");

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const orderNumber = `ORD-${req.user.eventId}-${Date.now().toString(36).toUpperCase()}`;
      const [orderResult] = await connection.query(
        `INSERT INTO orders
          (uuid, order_number, event_id, exhibitor_profile_id, placed_by, cart_id, currency,
           subtotal, surcharge_total, tax_total, discount_total, grand_total, status, payment_status,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, 0, ?, 'pending', 'unpaid', NOW(), NOW())`,
        [crypto.randomUUID(), orderNumber, req.user.eventId, profileId, req.user.id, cart.id, subtotal, surchargeTotal, taxTotal, grandTotal]
      );
      const orderId = orderResult.insertId;

      for (const item of items) {
        const lineSurcharge = (Number(item.unit_price) * item.quantity * Number(item.surcharge_pct)) / 100;
        const lineTax = ((Number(item.unit_price) * item.quantity + lineSurcharge) * Number(item.tax_rate_pct)) / 100;
        const lineTotal = Number(item.unit_price) * item.quantity + lineSurcharge + lineTax;

        await connection.query(
          `INSERT INTO order_items
            (order_id, event_id, service_item_id, sku_snapshot, name_snapshot, quantity, unit_price,
             surcharge_pct, surcharge_amount, tax_rate_pct, tax_amount, line_total, currency, fulfillment_status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', 'pending', NOW())`,
          [orderId, req.user.eventId, item.service_item_id, item.sku, item.name, item.quantity, item.unit_price, item.surcharge_pct, lineSurcharge, item.tax_rate_pct, lineTax, lineTotal]
        );

        await connection.query("UPDATE service_items SET inventory_reserved = inventory_reserved + ? WHERE id = ?", [
          item.quantity,
          item.service_item_id
        ]);
      }

      const [companyRows] = await connection.query(
        `SELECT c.display_name, c.address_line1, c.address_line2, c.city, c.state, c.postal_code, c.country
         FROM exhibitor_event_profiles eep JOIN companies c ON c.id = eep.company_id WHERE eep.id = ?`,
        [profileId]
      );
      const company = companyRows[0];
      const billingAddress = [company.address_line1, company.address_line2, company.city, company.state, company.postal_code, company.country]
        .filter(Boolean)
        .join(", ");

      const invoiceNumber = `INV-${req.user.eventId}-${Date.now().toString(36).toUpperCase()}`;
      await connection.query(
        `INSERT INTO invoices
          (uuid, invoice_number, event_id, order_id, exhibitor_profile_id, billing_name, billing_address,
           currency, subtotal, tax_total, grand_total, amount_paid, amount_due, invoice_status, issued_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, 0, ?, 'sent', NOW(), NOW(), NOW())`,
        [crypto.randomUUID(), invoiceNumber, req.user.eventId, orderId, profileId, company.display_name, billingAddress, subtotal, taxTotal, grandTotal, grandTotal]
      );

      await connection.query("UPDATE carts SET status = 'checked_out', updated_at = NOW() WHERE id = ?", [cart.id]);

      await connection.commit();

      notifyAdmins(pool, req.user.eventId, {
        title: "New order placed",
        message: `${company.display_name} placed order ${orderNumber} for ₹${grandTotal.toFixed(2)}.`,
        type: "info"
      }).catch((err) => console.error("Failed to notify admins of new order:", err));

      res.status(201).json({ message: "Order placed.", orderId, orderNumber });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  })
);

module.exports = router;
