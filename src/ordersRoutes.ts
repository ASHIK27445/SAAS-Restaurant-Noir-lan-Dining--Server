import { Router } from "express";
import { OrderType, OrderStatus } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "./prisma";

const router = Router();

function formatOrderNumber(n: number) {
  return `#${String(n).padStart(5, "0")}`;
}

// Valid status transitions per order type. Payment is handled separately — status only
// tracks fulfillment progress.
const VALID_TRANSITIONS: Record<OrderType, Partial<Record<OrderStatus, OrderStatus[]>>> = {
  DINE_IN: {
    PREPARING: ["SERVED", "CANCELLED"],
    SERVED: ["CANCELLED"], // dine-in reaches COMPLETED only via /complete-with-payment
  },
  TAKEAWAY: {
    PREPARING: ["COMPLETED", "CANCELLED"],
  },
  DELIVERY: {
    PREPARING: ["OUT_FOR_DELIVERY", "CANCELLED"],
    OUT_FOR_DELIVERY: ["RECEIVED", "CANCELLED"],
    RECEIVED: ["COMPLETED", "CANCELLED"],
  },
};

async function getActiveCashierName(): Promise<string | null> {
  const setting = await prisma.cashierSetting.findFirst({
    include: { activeCashier: true },
    orderBy: { updatedAt: "desc" },
  });
  return setting?.activeCashier?.name ?? null;
}

// ───────────── Menu items by POS bucket (items only, no category grouping) ─────────────

router.get("/menu/items/by-bucket/:bucket", async (req, res) => {
  try {
    const bucket = req.params.bucket.toUpperCase();
    const items = await prisma.menuItem.findMany({
      where: {
        isActive: true,
        category: { bucketType: bucket as any, isActive: true },
      },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        discountPrice: true,
        image: true,
        categoryId: true,
        category: { select: { id: true, name: true, bucketType: true } },
      },
      orderBy: { name: "asc" },
    });
    res.json({ success: true, data: items });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch menu items" });
  }
});

// ───────────── Cashier Setting ─────────────

router.get("/cashier-setting", async (_req, res) => {
  try {
    const setting = await prisma.cashierSetting.findFirst({
      include: { activeCashier: true },
      orderBy: { updatedAt: "desc" },
    });
    res.json({ success: true, data: setting });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch cashier setting" });
  }
});

// PATCH /orders/cashier-setting  { staffId }
router.patch("/cashier-setting", async (req, res) => {
  try {
    const { staffId } = req.body as { staffId: string };
    const existing = await prisma.cashierSetting.findFirst({ orderBy: { updatedAt: "desc" } });

    const setting = existing
      ? await prisma.cashierSetting.update({ where: { id: existing.id }, data: { activeCashierStaffId: staffId } })
      : await prisma.cashierSetting.create({ data: { activeCashierStaffId: staffId } });

    const full = await prisma.cashierSetting.findUnique({ where: { id: setting.id }, include: { activeCashier: true } });
    res.json({ success: true, message: "Active cashier updated", data: full });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to update cashier setting" });
  }
});

// ───────────── Orders ─────────────

// GET /orders/next-number — preview the next order number for the POS header
router.get("/next-number", async (_req, res) => {
  try {
    const latest = await prisma.order.aggregate({ _max: { orderNumber: true } });
    res.json({ success: true, data: { orderNumber: (latest._max.orderNumber ?? 0) + 1 } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch next order number" });
  }
});

// GET /orders  ?status=&orderType=&date=YYYY-MM-DD or fromDate=&toDate=
router.get("/", async (req, res) => {
  try {
    const { status, orderType, date, fromDate, toDate } = req.query as Record<string, string>;
    const where: any = {};
    if (status) where.status = status;
    if (orderType) where.orderType = orderType;
    if (date) {
      const start = new Date(`${date}T00:00:00.000Z`);
      const end = new Date(`${date}T23:59:59.999Z`);
      where.createdAt = { gte: start, lte: end };
    } else if (fromDate || toDate) {
      where.createdAt = {
        ...(fromDate ? { gte: new Date(`${fromDate}T00:00:00.000Z`) } : {}),
        ...(toDate ? { lte: new Date(`${toDate}T23:59:59.999Z`) } : {}),
      };
    }

    const orders = await prisma.order.findMany({
      where,
      include: { items: { include: { menuItem: true, units: true } } },
      orderBy: { createdAt: "desc" },
    });

    const data = orders.map((o) => ({ ...o, orderNumberDisplay: formatOrderNumber(o.orderNumber) }));
    res.json({ success: true, data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch orders" });
  }
});

// POST /orders/create
// body: { orderType, serverStaffId?, tableNo?, guestCount?, customerName?, deliveryAddress?,
//         note?, paymentMethod?, items: [{ menuItemId, quantity, unitPrice, note? }],
//         subtotal, tax, serviceCharge, total }
//
// Payment timing: TAKEAWAY/DELIVERY are paid upfront right here (paymentMethod required).
// DINE_IN stays UNPAID — payment happens later via /orders/:id/complete-with-payment.
router.post("/create", async (req, res) => {
  try {
    const body = req.body as {
      orderType: OrderType;
      serverStaffId?: string;
      tableNo?: string;
      guestCount?: number;
      customerName?: string;
      deliveryAddress?: string;
      note?: string;
      paymentMethod?: string;
      items: { menuItemId: string; quantity: number; unitPrice: number; note?: string }[];
      subtotal: number;
      tax: number;
      serviceCharge: number;
      total: number;
      promoCode?: string;
    };

    if (!body.orderType || !body.items?.length) {
      return res.status(400).json({ success: false, message: "orderType and items are required" });
    }
    if (body.orderType === "DELIVERY" && !body.deliveryAddress) {
      return res.status(400).json({ success: false, message: "deliveryAddress is required for delivery orders" });
    }
    if ((body.orderType === "TAKEAWAY" || body.orderType === "DELIVERY") && !body.paymentMethod) {
      return res.status(400).json({ success: false, message: "paymentMethod is required — this order type pays upfront" });
    }

    let serverName: string | null = null;
    if (body.serverStaffId) {
      const server = await prisma.staff.findUnique({ where: { id: body.serverStaffId } });
      serverName = server?.name ?? null;
    }

    const upfrontPaid = body.orderType === "TAKEAWAY" || body.orderType === "DELIVERY";
    const cashierName = upfrontPaid ? await getActiveCashierName() : null;
    const posSetting = await prisma.posSetting.findFirst({ orderBy: { updatedAt: "desc" } });
    const configuredTaxRate = Number(posSetting?.taxRate ?? 8);
    const configuredServiceCharge = Number(posSetting?.serviceCharge ?? 0);
    const subtotal = Number(body.subtotal.toFixed(2));
    const tax = Number((subtotal * configuredTaxRate / 100).toFixed(2));
    const serviceCharge = Number((subtotal > 0 ? configuredServiceCharge : 0).toFixed(2));
    let discount = 0;
    let appliedPromoCode: string | null = null;
    if (body.promoCode) {
      const promo = await prisma.promoCode.findUnique({ where: { code: body.promoCode.trim().toUpperCase() } });
      if (!promo || !promo.isActive || !promo.showInPos || (promo.usageLimit !== null && promo.usageCount >= promo.usageLimit)) {
        return res.status(400).json({ success: false, message: "Promo code is invalid or unavailable" });
      }
      const claimed = await prisma.promoCode.updateMany({
        where: { id: promo.id, isActive: true, showInPos: true, ...(promo.usageLimit === null ? {} : { usageCount: { lt: promo.usageLimit } }) },
        data: { usageCount: { increment: 1 } },
      });
      if (claimed.count !== 1) return res.status(400).json({ success: false, message: "Promo code limit reached" });
      discount = Number((subtotal * Number(promo.discountPercent) / 100).toFixed(2));
      appliedPromoCode = promo.code;
    }
    const total = Number((subtotal + tax + serviceCharge - discount).toFixed(2));
    const now = new Date();

    const order = await prisma.order.create({
      data: {
        orderType: body.orderType,
        status: "PREPARING",
        paymentStatus: upfrontPaid ? "PAID" : "UNPAID",
        paymentMethod: body.paymentMethod ?? null,
        paidAt: upfrontPaid ? now : null,
        cashierName,
        serverStaffId: body.serverStaffId ?? null,
        serverName,
        tableNo: (body.orderType === "DINE_IN" ? body.tableNo : null) ?? null,
        guestCount: (body.orderType === "DINE_IN" ? body.guestCount : null) ?? null,
        customerName: body.customerName ?? null,
        deliveryAddress: (body.orderType === "DELIVERY" ? body.deliveryAddress : null) ?? null,
        note: body.note ?? null,
        subtotal: new Decimal(subtotal.toFixed(2)),
        tax: new Decimal(tax.toFixed(2)),
        serviceCharge: new Decimal(serviceCharge.toFixed(2)),
        discount: new Decimal(discount.toFixed(2)),
        promoCode: appliedPromoCode,
        total: new Decimal(total.toFixed(2)),
        items: {
          create: body.items.map((it) => ({
            menuItemId: it.menuItemId,
            quantity: it.quantity,
            unitPrice: new Decimal(it.unitPrice.toFixed(2)),
            note: it.note ?? null,
            units: {
              create: Array.from({ length: it.quantity }, (_, i) => ({ unitIndex: i + 1 })),
            },
          })),
        },
      },
      include: { items: { include: { menuItem: true, units: true } } },
    });

    res.status(201).json({
      success: true,
      message: "Order created",
      data: { ...order, orderNumberDisplay: formatOrderNumber(order.orderNumber) },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to create order" });
  }
});

// PATCH /orders/:id/status  { status }
// Handles every transition EXCEPT dine-in's final PREPARING/SERVED -> COMPLETED, which
// goes through /complete-with-payment since it also collects payment.
router.patch("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body as { status: OrderStatus };

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    const allowed = VALID_TRANSITIONS[order.orderType]?.[order.status] ?? [];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot move ${order.orderType} order from ${order.status} to ${status}`,
      });
    }

    const updated = await prisma.order.update({
      where: { id },
      data: {
        status,
        ...(status === "COMPLETED" ? { completedAt: new Date() } : {}),
      },
    });

    res.json({ success: true, message: "Order status updated", data: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to update order status" });
  }
});

// POST /orders/:id/complete-with-payment  { paymentMethod }
// Dine-in only: collects payment and marks the order COMPLETED in one step.
router.post("/:id/complete-with-payment", async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentMethod } = req.body as { paymentMethod: string };

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (order.orderType !== "DINE_IN") {
      return res.status(400).json({ success: false, message: "This endpoint is for dine-in orders only" });
    }
    if (order.status !== "PREPARING" && order.status !== "SERVED") {
      return res.status(400).json({ success: false, message: "Order is not in a completable state" });
    }
    if (!paymentMethod) {
      return res.status(400).json({ success: false, message: "paymentMethod is required" });
    }

    const cashierName = await getActiveCashierName();
    const now = new Date();

    const updated = await prisma.order.update({
      where: { id },
      data: {
        status: "COMPLETED",
        completedAt: now,
        paymentStatus: "PAID",
        paidAt: now,
        paymentMethod,
        cashierName,
      },
    });

    res.json({ success: true, message: "Order completed and paid", data: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to complete order" });
  }
});

// ───────────── Order Item Unit prep tracking (kitchen marks manually) ─────────────

router.post("/item-units/:unitId/prep-start", async (req, res) => {
  try {
    const unit = await prisma.orderItemUnit.update({
      where: { id: req.params.unitId },
      data: { prepStartedAt: new Date() },
    });
    res.json({ success: true, message: "Prep started", data: unit });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to mark prep started" });
  }
});

router.post("/item-units/:unitId/prep-complete", async (req, res) => {
  try {
    const unit = await prisma.orderItemUnit.update({
      where: { id: req.params.unitId },
      data: { prepCompletedAt: new Date() },
    });
    res.json({ success: true, message: "Prep completed", data: unit });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to mark prep completed" });
  }
});

// GET /orders/kitchen-queue — units still needing prep work, across active orders
router.get("/kitchen-queue", async (_req, res) => {
  try {
    const units = await prisma.orderItemUnit.findMany({
      where: {
        prepCompletedAt: null,
        orderItem: { order: { status: { in: ["PREPARING"] } } },
      },
      select: {
        id: true,
        unitIndex: true,
        prepStartedAt: true,
        prepCompletedAt: true,
        orderItem: {
          select: {
            menuItem: { select: { name: true } },
            order: { select: { orderNumber: true, createdAt: true } },
          },
        },
      },
      orderBy: { orderItem: { order: { createdAt: "asc" } } },
    });
    res.json({ success: true, data: units });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch kitchen queue" });
  }
});

// Lightweight payload for the public customer token screen.
router.get("/token-display", async (_req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: { status: { in: ["PREPARING", "SERVED", "OUT_FOR_DELIVERY", "RECEIVED"] } },
      select: { orderNumber: true, status: true, orderType: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });
    res.json({ success: true, data: orders });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch token display" });
  }
});

export default router;