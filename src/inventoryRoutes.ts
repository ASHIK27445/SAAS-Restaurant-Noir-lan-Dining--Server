import { Router } from "express";
import { PrismaClient, StockMovementType, PurchaseOrderStatus } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

const prisma = new PrismaClient();
const router = Router();

// Helper: derive stock status the same way the UI does (in-stock / low-stock / out-of-stock)
function stockStatus(currentStock: Decimal, minThreshold: Decimal) {
  const current = Number(currentStock);
  const min = Number(minThreshold);
  if (current <= 0) return "out-of-stock";
  if (current <= min) return "low-stock";
  return "in-stock";
}

// ───────────── Inventory ─────────────

// GET /inventory  ?search=&status=&category=&page=&pageSize=
router.get("/inventory", async (req, res) => {
  try {
    const { search = "", status, category, page = "1", pageSize = "20", supplierId } = req.query as Record<string, string>;

  const where = {
        name: { contains: search, mode: "insensitive" as const },
        ...(category ? { category } : {}),
        ...(supplierId ? { supplierId } : {}),
      };

    const items = await prisma.inventoryItem.findMany({
      where,
      include: { supplier: true },
      orderBy: { name: "asc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    });

    const total = await prisma.inventoryItem.count({ where });

    let withStatus = items.map((i) => ({
      ...i,
      status: stockStatus(i.currentStock, i.minThreshold),
    }));

    if (status) {
      withStatus = withStatus.filter((i) => i.status === status);
    }

    res.json({
      success: true,
      data: withStatus,
      pagination: { page: Number(page), pageSize: Number(pageSize), total },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch inventory" });
  }
});

// GET /inventory/low-stock  (for the "Critical Restock Required" alert card)
router.get("/inventory/low-stock", async (_req, res) => {
  try {
    const items = await prisma.inventoryItem.findMany({
      include: { supplier: true },
    });

    const lowOrOut = items
      .map((i) => ({ ...i, status: stockStatus(i.currentStock, i.minThreshold) }))
      .filter((i) => i.status !== "in-stock");

    res.json({ success: true, data: lowOrOut });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch low-stock items" });
  }
});

// GET /inventory/:id
router.get("/inventory/:id", async (req, res) => {
  try {
    const item = await prisma.inventoryItem.findUnique({
      where: { id: req.params.id },
      include: { supplier: true },
    });

    if (!item) {
      return res.status(404).json({ success: false, message: "Inventory item not found" });
    }

    res.json({ success: true, data: { ...item, status: stockStatus(item.currentStock, item.minThreshold) } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch inventory item" });
  }
});

// POST /inventory/create
router.post("/inventory/create", async (req, res) => {
  try {
    const { name, sku, unit, image, category, currentStock = 0, minThreshold = 0, costPerUnit, supplierId } = req.body;

    if (!name || !sku || !unit || !category || costPerUnit === undefined) {
      return res.status(400).json({ success: false, message: "name, sku, unit, category and costPerUnit are required" });
    }

    const item = await prisma.inventoryItem.create({
      data: {
        name,
        sku,
        unit,
        image,
        category,
        currentStock: new Decimal(currentStock.toString()),
        minThreshold: new Decimal(minThreshold.toString()),
        costPerUnit: new Decimal(costPerUnit.toString()),
        supplierId: supplierId || null,
      },
    });

    res.status(201).json({ success: true, message: "Inventory item created", data: item });
  } catch (error: any) {
    console.error(error);
    if (error.code === "P2002") {
      return res.status(409).json({ success: false, message: "SKU already exists" });
    }
    res.status(500).json({ success: false, message: "Failed to create inventory item" });
  }
});

// PUT /inventory/:id  (edit details, not stock quantity)
router.put("/inventory/:id", async (req, res) => {
  try {
    const { name, sku, unit, image, category, minThreshold, costPerUnit, supplierId } = req.body;

    const item = await prisma.inventoryItem.update({
      where: { id: req.params.id },
      data: {
        name,
        sku,
        unit,
        image,
        category,
        ...(minThreshold !== undefined ? { minThreshold: new Decimal(minThreshold.toString()) } : {}),
        ...(costPerUnit !== undefined ? { costPerUnit: new Decimal(costPerUnit.toString()) } : {}),
        supplierId: supplierId || null,
      },
    });

    res.json({ success: true, message: "Inventory item updated", data: item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to update inventory item" });
  }
});

// PATCH /inventory/:id/stock  { type: "RESTOCK" | "USAGE" | "WASTE" | "ADJUSTMENT", quantity, note }
// Adjusts currentStock and writes a StockMovement in one transaction — keeps stock history auditable.
router.patch("/inventory/:id/stock", async (req, res) => {
  try {
    const { id } = req.params;
    const { type, quantity, note } = req.body as { type: keyof typeof StockMovementType; quantity: number; note?: string };

    if (!type || quantity === undefined) {
      return res.status(400).json({ success: false, message: "type and quantity are required" });
    }

    const delta =
      type === "RESTOCK" ? Math.abs(quantity) :
      type === "USAGE" || type === "WASTE" ? -Math.abs(quantity) :
      quantity; // ADJUSTMENT: caller passes the signed delta directly

    const [movement, item] = await prisma.$transaction([
      prisma.stockMovement.create({
        data: {
          inventoryItemId: id,
          type: type as StockMovementType,
          quantity: new Decimal(delta.toString()),
          note: note ?? null,
        },
      }),
      prisma.inventoryItem.update({
        where: { id },
        data: { currentStock: { increment: delta } },
      }),
    ]);

    res.json({
      success: true,
      message: "Stock updated",
      data: { movement, item: { ...item, status: stockStatus(item.currentStock, item.minThreshold) } },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to update stock" });
  }
});

// GET /inventory/:id/movements  (stock history for an item)
router.get("/inventory/:id/movements", async (req, res) => {
  try {
    const movements = await prisma.stockMovement.findMany({
      where: { inventoryItemId: req.params.id },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: movements });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch stock movements" });
  }
});

// DELETE /inventory/:id
router.delete("/inventory/:id", async (req, res) => {
  try {
    await prisma.inventoryItem.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Inventory item deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to delete inventory item" });
  }
});

// GET /inventory/:id/usage  ?days=14&months=6
// Daily/monthly usage report built from StockMovement records of type USAGE.
// Each adjustStock call already timestamps its movement, so "daily recording" is
// automatic — this route just buckets that history by day and by month.
router.get("/inventory/:id/usage", async (req, res) => {
  try {
    const { id } = req.params;
    const days = Number(req.query.days) || 14;
    const months = Number(req.query.months) || 6;

    const item = await prisma.inventoryItem.findUnique({ where: { id } });
    if (!item) {
      return res.status(404).json({ success: false, message: "Inventory item not found" });
    }

    const movements = await prisma.stockMovement.findMany({
      where: { inventoryItemId: id, type: "USAGE" },
      orderBy: { createdAt: "asc" },
    });

    const now = new Date();

    // Daily buckets for the last `days` days (including today)
    const dailyMap = new Map<string, number>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dailyMap.set(d.toISOString().slice(0, 10), 0);
    }

    // Monthly buckets for the last `months` months (including this month)
    const monthlyMap = new Map<string, number>();
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthlyMap.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, 0);
    }

    for (const m of movements) {
      const used = Math.abs(Number(m.quantity)); // USAGE is stored as a negative delta
      const dayKey = m.createdAt.toISOString().slice(0, 10);
      if (dailyMap.has(dayKey)) {
        dailyMap.set(dayKey, dailyMap.get(dayKey)! + used);
      }
      const monthKey = `${m.createdAt.getFullYear()}-${String(m.createdAt.getMonth() + 1).padStart(2, "0")}`;
      if (monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, monthlyMap.get(monthKey)! + used);
      }
    }

    const dailyUsage = [...dailyMap.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, quantity]) => ({ date, quantity: Math.round(quantity * 100) / 100 }));

    const monthlyUsage = [...monthlyMap.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([month, quantity]) => ({ month, quantity: Math.round(quantity * 100) / 100 }));

    // Average daily usage — total usage divided by the number of days actually tracked
    // (capped at the requested window), so a brand-new item isn't diluted by days
    // before it ever had a recorded usage.
    let averageDailyUsage: number | null = null;

    const earliestMovement = movements[0];

    if (earliestMovement) {
      const earliest = earliestMovement.createdAt;

      const daysSinceStart = Math.max(
        1,
        Math.ceil(
          (now.getTime() - earliest.getTime()) /
            (1000 * 60 * 60 * 24)
        ) + 1
      );

      const windowDays = Math.min(days, daysSinceStart);

      const totalInWindow = dailyUsage
        .slice(-windowDays)
        .reduce((sum, d) => sum + d.quantity, 0);

      averageDailyUsage =
        Math.round((totalInWindow / windowDays) * 100) / 100;
    }

    res.json({
      success: true,
      data: {
        itemId: item.id,
        itemName: item.name,
        unit: item.unit,
        currentStock: item.currentStock,
        dailyUsage,
        monthlyUsage,
        averageDailyUsage,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch usage report" });
  }
});

// GET /inventory-usage-overview?days=30
// One aggregate query for the stock table's at-a-glance usage columns.
router.get("/inventory-usage-overview", async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - days + 1);

    const movements = await prisma.stockMovement.findMany({
      where: { type: "USAGE", createdAt: { gte: start, lte: now } },
      select: { inventoryItemId: true, quantity: true },
    });
    const totals = new Map<string, number>();
    for (const movement of movements) {
      totals.set(movement.inventoryItemId, (totals.get(movement.inventoryItemId) ?? 0) + Math.abs(Number(movement.quantity)));
    }

    res.json({
      success: true,
      days,
      data: [...totals.entries()].map(([itemId, totalUsage]) => ({
        itemId,
        totalUsage,
        averageDailyUsage: totalUsage / days,
      })),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch usage overview" });
  }
});

// ───────────── Suppliers ─────────────

// GET /suppliers ?search=&category=&status=
router.get("/suppliers", async (req, res) => {
  try {
    const { search = "", category, status } = req.query as Record<string, string>;

    const suppliers = await prisma.supplier.findMany({
      where: {
        name: { contains: search, mode: "insensitive" },
        ...(category ? { category } : {}),
        ...(status ? { status: status as any } : {}),
      },
      orderBy: { name: "asc" },
    });

    res.json({ success: true, data: suppliers });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch suppliers" });
  }
});

// GET /suppliers/directory
// Aggregates supplier performance from received purchase orders and their received quantities.
router.get("/suppliers/directory", async (_req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      include: {
        purchaseOrders: {
          select: {
            totalAmount: true,
            status: true,
            expectedDate: true,
            deliveredDate: true,
            rating: true,
            items: { select: { quantity: true, receivedQuantity: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    });

    const data = suppliers.map((s) => {
      const receivedOrders = s.purchaseOrders.filter((po) => po.status === "RECEIVED");
      const totalSpend = receivedOrders.reduce((sum, po) => sum + Number(po.totalAmount), 0);
      const lastDelivery = receivedOrders.reduce<Date | null>(
        (latest, po) => (!po.deliveredDate || (latest && po.deliveredDate <= latest) ? latest : po.deliveredDate),
        null
      );
      const ratedOrders = receivedOrders.filter((po) => po.rating !== null);
      const rating = ratedOrders.length > 0
        ? Math.round((ratedOrders.reduce((sum, po) => sum + (po.rating ?? 0), 0) / ratedOrders.length) * 10) / 10
        : s.rating && s.rating > 0 ? s.rating : null;

      let onTimeTrackedCount = 0;
      let onTimeCount = 0;
      for (const po of receivedOrders) {
        if (po.expectedDate && po.deliveredDate) {
          onTimeTrackedCount += 1;
          if (po.deliveredDate <= po.expectedDate) onTimeCount += 1;
        }
      }

      let orderedQuantity = 0;
      let receivedQuantity = 0;
      for (const po of receivedOrders) {
        for (const item of po.items) {
          if (item.receivedQuantity !== null) {
            orderedQuantity += Number(item.quantity);
            receivedQuantity += Number(item.receivedQuantity);
          }
        }
      }

      const orderFulfillment = s.purchaseOrders.length > 0
        ? (receivedOrders.length / s.purchaseOrders.length) * 100
        : null;
      const onTimeDelivery = onTimeTrackedCount > 0
        ? (onTimeCount / onTimeTrackedCount) * 100
        : null;
      const productQuality = rating !== null ? (rating / 5) * 100 : null;
      const demandFulfillment = orderedQuantity > 0
        ? Math.min((receivedQuantity / orderedQuantity) * 100, 100)
        : null;
      const reliabilityScore = [productQuality, onTimeDelivery, orderFulfillment, demandFulfillment].every(
        (score) => score !== null
      )
        ? productQuality! * 0.3 + onTimeDelivery! * 0.25 + orderFulfillment! * 0.25 + demandFulfillment! * 0.2
        : null;

      return {
        id: s.id,
        name: s.name,
        category: s.category,
        rating,
        status: s.status,
        totalSpend,
        lastDelivery,
        reliabilityScore: reliabilityScore === null ? null : Math.round(reliabilityScore * 10) / 10,
        productQualityScore: productQuality === null ? null : Math.round(productQuality * 10) / 10,
        onTimeDeliveryScore: onTimeDelivery === null ? null : Math.round(onTimeDelivery * 10) / 10,
        orderFulfillmentScore: orderFulfillment === null ? null : Math.round(orderFulfillment * 10) / 10,
        demandFulfillmentScore: demandFulfillment === null ? null : Math.round(demandFulfillment * 10) / 10,
        qualityAcceptance: demandFulfillment === null ? null : Math.round(demandFulfillment * 10) / 10,
        onTimeTrackedCount,
        qualityTrackedQuantity: orderedQuantity,
        totalOrders: s.purchaseOrders.length,
        receivedOrderCount: receivedOrders.length,
        ratedOrderCount: ratedOrders.length,
      };
    });

    const activeSupplierCount = suppliers.filter((s) => s.status === "ACTIVE").length;

    res.json({ success: true, data, meta: { activeSupplierCount } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch supplier directory" });
  }
});

// POST /suppliers/create
router.post("/suppliers/create", async (req, res) => {
  try {
    const { name, category, contactName, email, phone, address, rating, status } = req.body;

    if (!name || !category) {
      return res.status(400).json({ success: false, message: "name and category are required" });
    }

    const supplier = await prisma.supplier.create({
      data: { name, category, contactName, email, phone, address, rating, status },
    });

    res.status(201).json({ success: true, message: "Supplier created", data: supplier });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to create supplier" });
  }
});

// ───────────── Purchase Orders ─────────────

// GET /purchase-orders ?status=&supplierId=
router.get("/purchase-orders", async (req, res) => {
  try {
    const { status, supplierId } = req.query as Record<string, string>;

    const orders = await prisma.purchaseOrder.findMany({
      where: {
        ...(status ? { status: status as PurchaseOrderStatus } : {}),
        ...(supplierId ? { supplierId } : {}),
      },
      include: { supplier: true, items: { include: { inventoryItem: true } } },
      orderBy: { issuedDate: "desc" },
    });

    res.json({ success: true, data: orders });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch purchase orders" });
  }
});

// POST /purchase-orders/create
router.post("/purchase-orders/create", async (req, res) => {
  try {
    const { poNumber, supplierId, expectedDate, items } = req.body as {
      poNumber: string;
      supplierId: string;
      expectedDate?: string;
      items: { inventoryItemId: string; quantity: number; unitPrice: number }[];
    };

    if (!poNumber || !supplierId || !items?.length) {
      return res.status(400).json({ success: false, message: "poNumber, supplierId and items are required" });
    }

    const totalAmount = items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0);

    const order = await prisma.purchaseOrder.create({
      data: {
        poNumber,
        supplierId,
        expectedDate: expectedDate ? new Date(expectedDate) : null,
        purchaseAmount: new Decimal(totalAmount.toFixed(2)),
        totalAmount: new Decimal(totalAmount.toFixed(2)),
        items: {
          create: items.map((it) => ({
            inventoryItemId: it.inventoryItemId,
            quantity: new Decimal(it.quantity.toString()),
            unitPrice: new Decimal(it.unitPrice.toString()),
          })),
        },
      },
      include: { items: true },
    });

    res.status(201).json({ success: true, message: "Purchase order created", data: order });
  } catch (error: any) {
    console.error(error);
    if (error.code === "P2002") {
      return res.status(409).json({ success: false, message: "PO number already exists" });
    }
    res.status(500).json({ success: false, message: "Failed to create purchase order" });
  }
});

// PATCH /purchase-orders/:id/status
//
// body: { status: "SHIPPED" | "CANCELLED" }
// OR
// body: { status: "RECEIVED", receivedEverything: true }
// OR
// body: { status: "RECEIVED", items: [{ purchaseOrderItemId, receivedQuantity, receivedUnitPrice }] }
//
// Marking RECEIVED recomputes totalAmount from the real received quantity × received unit
// price for every item. purchaseAmount (set at order creation) is never touched, so it
// stays as a safety record of what was originally ordered. Also restocks inventory using
// the RECEIVED quantity (not the ordered quantity) and logs a RESTOCK movement per item.
router.patch("/purchase-orders/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body as {
      status: PurchaseOrderStatus;
      receivedEverything?: boolean;
      items?: { purchaseOrderItemId: string; receivedQuantity: number; receivedUnitPrice: number }[];
    };

    if (body.status !== "RECEIVED") {
      const order = await prisma.purchaseOrder.update({
        where: { id },
        data: { status: body.status },
        include: { items: true },
      });
      return res.json({ success: true, message: "Purchase order status updated", data: order });
    }

    // ── RECEIVED path ──
    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!order) {
      return res.status(404).json({ success: false, message: "Purchase order not found" });
    }
    
    if (order.status !== "SHIPPED") {
      return res.status(400).json({ success: false, message: "Only shipped orders can be received" });
    }

    const receivedMap = new Map<string, { quantity: number; unitPrice: number }>();

    if (body.receivedEverything) {
      for (const it of order.items) {
        receivedMap.set(it.id, { quantity: Number(it.quantity), unitPrice: Number(it.unitPrice) });
      }
    } else {
      if (!body.items?.length) {
        return res
          .status(400)
          .json({ success: false, message: "items are required unless receivedEverything is true" });
      }
      for (const it of body.items) {
        if (it.receivedQuantity < 0 || it.receivedUnitPrice < 0) {
          return res
            .status(400)
            .json({ success: false, message: "receivedQuantity and receivedUnitPrice must be >= 0" });
        }
        receivedMap.set(it.purchaseOrderItemId, {
          quantity: it.receivedQuantity,
          unitPrice: it.receivedUnitPrice,
        });
      }
      const missing = order.items.filter((it) => !receivedMap.has(it.id));
      if (missing.length > 0) {
        return res
          .status(400)
          .json({ success: false, message: "All line items must be included when not receiving everything" });
      }
    }

    let newTotal = 0;
    for (const it of order.items) {
      const r = receivedMap.get(it.id)!;
      newTotal += r.quantity * r.unitPrice;
    }

    const now = new Date();

    const updatedOrder = await prisma.$transaction(async (tx) => {
      for (const it of order.items) {
        const r = receivedMap.get(it.id)!;

        await tx.purchaseOrderItem.update({
          where: { id: it.id },
          data: {
            receivedQuantity: new Decimal(r.quantity.toString()),
            receivedUnitPrice: new Decimal(r.unitPrice.toString()),
          },
        });

        if (r.quantity > 0) {
          await tx.stockMovement.create({
            data: {
              inventoryItemId: it.inventoryItemId,
              type: "RESTOCK",
              quantity: new Decimal(r.quantity.toString()),
              note: `Received from PO ${order.poNumber}`,
            },
          });
          await tx.inventoryItem.update({
            where: { id: it.inventoryItemId },
            data: { currentStock: { increment: r.quantity } },
          });
        }
      }

      return tx.purchaseOrder.update({
        where: { id },
        data: {
          status: "RECEIVED",
          deliveredDate: now,
          totalAmount: new Decimal(newTotal.toFixed(2)),
        },
        include: { items: { include: { inventoryItem: true } }, supplier: true },
      });
    });

    res.json({ success: true, message: "Purchase order received", data: updatedOrder });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to update purchase order status" });
  }
});

// PATCH /purchase-orders/:id/rating  { rating: 0-5, one decimal place, e.g. 4.5 }
// Only allowed once the order is RECEIVED. Once a rating is set, it can't be changed —
// this keeps supplier reliability data honest (no retroactive editing).
router.patch("/purchase-orders/:id/rating", async (req, res) => {
  try {
    const { id } = req.params;
    const { rating } = req.body as { rating: number };

    const rounded = Math.round(rating * 10) / 10;
    if (typeof rating !== "number" || Number.isNaN(rating) || rounded < 0 || rounded > 5) {
      return res.status(400).json({ success: false, message: "rating must be a number between 0 and 5" });
    }

    const order = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!order) {
      return res.status(404).json({ success: false, message: "Purchase order not found" });
    }
    if (order.status !== "RECEIVED") {
      return res.status(400).json({ success: false, message: "Only received orders can be rated" });
    }
    if (order.rating !== null) {
      return res.status(400).json({ success: false, message: "This order has already been rated" });
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id },
      data: { rating: rounded },
    });

    res.json({ success: true, message: "Order rated", data: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to rate order" });
  }
});


// GET /suppliers/:id  (single supplier with real aggregated stats)
router.get("/suppliers/:id", async (req, res) => {
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      include: {
        purchaseOrders: {
          select: {
            poNumber: true,
            status: true,
            totalAmount: true,
            issuedDate: true,
            expectedDate: true,
            deliveredDate: true,
            rating: true,
            items: {
              select: {
                quantity: true,
                receivedQuantity: true,
                inventoryItem: { select: { name: true, unit: true } },
              },
            },
          },
        },
      },
    });

    if (!supplier) {
      return res.status(404).json({ success: false, message: "Supplier not found" });
    }

    const receivedOrders = supplier.purchaseOrders.filter((po) => po.status === "RECEIVED");

    const totalSpend = receivedOrders.reduce((sum, po) => sum + Number(po.totalAmount), 0);

    const lastDelivery = receivedOrders.reduce<Date | null>(
      (latest, po) => (!po.deliveredDate || (latest && po.deliveredDate <= latest) ? latest : po.deliveredDate),
      null
    );

    const fulfillmentRate =
      supplier.purchaseOrders.length > 0
        ? (receivedOrders.length / supplier.purchaseOrders.length) * 100
        : null;

    const ratedOrders = supplier.purchaseOrders.filter((po) => po.rating !== null) as { rating: number }[];
    const qualityScore =
      ratedOrders.length > 0
        ? Math.round((ratedOrders.reduce((sum, po) => sum + po.rating, 0) / ratedOrders.length) * 10) / 10
        : null;

    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

    let onTimeTrackedCount = 0;
    let onTimeCount = 0;

    for (const po of receivedOrders) {
      if (po.issuedDate < twoMonthsAgo) continue;
      if (po.expectedDate === null || po.deliveredDate === null) continue;

      const expectedDate: Date = po.expectedDate;
      const deliveredDate: Date = po.deliveredDate;

      onTimeTrackedCount += 1;
      if (deliveredDate <= expectedDate) {
        onTimeCount += 1;
      }
    }

    const onTimeDeliveryRate = onTimeTrackedCount > 0 ? (onTimeCount / onTimeTrackedCount) * 100 : null;

    // Shortage report — year to date, based on received orders only. A shortage is any
    // line item where the actual received quantity came in under the ordered quantity.
    const currentYear = new Date().getFullYear();
    const shortages: {
      poNumber: string;
      itemName: string;
      unit: string;
      orderedQuantity: number;
      receivedQuantity: number;
      shortageQuantity: number;
      deliveredDate: string | null;
    }[] = [];

    for (const po of receivedOrders) {
      const deliveredYear = po.deliveredDate ? po.deliveredDate.getFullYear() : null;
      if (deliveredYear !== currentYear) continue;

      for (const item of po.items) {
        if (item.receivedQuantity === null) continue;
        const ordered = Number(item.quantity);
        const received = Number(item.receivedQuantity);
        if (received < ordered) {
          shortages.push({
            poNumber: po.poNumber,
            itemName: item.inventoryItem.name,
            unit: item.inventoryItem.unit,
            orderedQuantity: ordered,
            receivedQuantity: received,
            shortageQuantity: Math.round((ordered - received) * 100) / 100,
            deliveredDate: po.deliveredDate ? po.deliveredDate.toISOString() : null,
          });
        }
      }
    }

    shortages.sort((a, b) =>
      !a.deliveredDate || !b.deliveredDate
        ? 0
        : new Date(b.deliveredDate).getTime() - new Date(a.deliveredDate).getTime()
    );

    const { purchaseOrders, ...supplierFields } = supplier;

    res.json({
      success: true,
      data: {
        ...supplierFields,
        totalSpend,
        lastDelivery,
        fulfillmentRate,
        totalOrders: supplier.purchaseOrders.length,
        receivedOrderCount: receivedOrders.length,
        qualityScore,
        ratedOrderCount: ratedOrders.length,
        onTimeDeliveryRate,
        onTimeTrackedCount,
        shortageCount: shortages.length,
        shortages,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch supplier" });
  }
});

/---------------------suppelier Contact----------------/
// GET /supplier-contacts ?search=&category=
router.get("/supplier-contacts", async (req, res) => {
  try {
    const { search = "", category } = req.query as Record<string, string>;

    const contacts = await prisma.supplierContact.findMany({
      where: {
        OR: [
          { companyName: { contains: search, mode: "insensitive" } },
          { contactName: { contains: search, mode: "insensitive" } },
        ],
        ...(category && category !== "All" ? { category } : {}),
      },
      orderBy: [{ isFavorite: "desc" }, { companyName: "asc" }],
    });

    res.json({ success: true, data: contacts });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch contacts" });
  }
});

// POST /supplier-contacts/create
router.post("/supplier-contacts/create", async (req, res) => {
  try {
    const { companyName, category, contactName, role, email, phone, address, businessHours } = req.body;

    if (!companyName) {
      return res.status(400).json({ success: false, message: "companyName is required" });
    }

    const contact = await prisma.supplierContact.create({
      data: { companyName, category, contactName, role, email, phone, address, businessHours },
    });

    res.status(201).json({ success: true, message: "Contact created", data: contact });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to create contact" });
  }
});

// PATCH /supplier-contacts/:id/favorite
router.patch("/supplier-contacts/:id/favorite", async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await prisma.supplierContact.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Contact not found" });
    }

    const contact = await prisma.supplierContact.update({
      where: { id },
      data: { isFavorite: !existing.isFavorite },
    });

    res.json({ success: true, message: "Favorite toggled", data: contact });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to toggle favorite" });
  }
});

// PUT /supplier-contacts/:id
router.put("/supplier-contacts/:id", async (req, res) => {
  try {
    const { companyName, category, contactName, role, email, phone, address, businessHours } = req.body;

    const contact = await prisma.supplierContact.update({
      where: { id: req.params.id },
      data: { companyName, category, contactName, role, email, phone, address, businessHours },
    });

    res.json({ success: true, message: "Contact updated", data: contact });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to update contact" });
  }
});

// DELETE /supplier-contacts/:id
router.delete("/supplier-contacts/:id", async (req, res) => {
  try {
    await prisma.supplierContact.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Contact deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to delete contact" });
  }
});

export default router;