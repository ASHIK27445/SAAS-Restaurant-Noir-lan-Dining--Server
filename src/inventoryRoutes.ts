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
// Aggregates real spend + last-delivery date from RECEIVED purchase orders per supplier.
// reliabilityScore / qualityAcceptance are null for now — there's no data source for them yet
// (would need a delivery-performance tracking model). The frontend should render "No data yet"
// rather than inventing a percentage.
router.get("/suppliers/directory", async (_req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      include: {
        purchaseOrders: {
          where: { status: "RECEIVED" },
          select: { totalAmount: true, issuedDate: true },
        },
      },
      orderBy: { name: "asc" },
    });

    const data = suppliers.map((s) => {
      const totalSpend = s.purchaseOrders.reduce((sum, po) => sum + Number(po.totalAmount), 0);
      const lastDelivery = s.purchaseOrders.reduce<Date | null>(
        (latest, po) => (!latest || po.issuedDate > latest ? po.issuedDate : latest),
        null
      );

      return {
        id: s.id,
        name: s.name,
        category: s.category,
        rating: s.rating,
        status: s.status,
        totalSpend,
        lastDelivery,
        reliabilityScore: null as number | null,
        qualityAcceptance: null as number | null,
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
// body: { poNumber, supplierId, expectedDate, items: [{ inventoryItemId, quantity, unitPrice }] }
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
        totalAmount: new Decimal(totalAmount.toString()),
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

// PATCH /purchase-orders/:id/status  { status: "SHIPPED" | "RECEIVED" | "CANCELLED" }
// When status becomes RECEIVED, this also restocks each inventory item and logs a RESTOCK movement.
router.patch("/purchase-orders/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body as { status: PurchaseOrderStatus };

    const order = await prisma.purchaseOrder.update({
      where: { id },
      data: { status },
      include: { items: true },
    });

    if (status === "RECEIVED") {
      await prisma.$transaction(
        order.items.flatMap((it) => [
          prisma.stockMovement.create({
            data: {
              inventoryItemId: it.inventoryItemId,
              type: "RESTOCK",
              quantity: it.quantity,
              note: `Received from PO ${order.poNumber}`,
            },
          }),
          prisma.inventoryItem.update({
            where: { id: it.inventoryItemId },
            data: { currentStock: { increment: Number(it.quantity) } },
          }),
        ])
      );
    }

    res.json({ success: true, message: "Purchase order status updated", data: order });
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
          select: { status: true, totalAmount: true, issuedDate: true },
        },
      },
    });

    if (!supplier) {
      return res.status(404).json({ success: false, message: "Supplier not found" });
    }

    const receivedOrders = supplier.purchaseOrders.filter((po) => po.status === "RECEIVED");
    const totalSpend = receivedOrders.reduce((sum, po) => sum + Number(po.totalAmount), 0);
    const lastDelivery = receivedOrders.reduce<Date | null>(
      (latest, po) => (!latest || po.issuedDate > latest ? po.issuedDate : latest),
      null
    );
    // Fulfillment = % of all orders placed with this supplier that were actually RECEIVED.
    // On-time delivery can't be computed yet — there's no "actual delivered at" timestamp,
    // only expectedDate, so we don't fabricate that number.
    const fulfillmentRate =
      supplier.purchaseOrders.length > 0
        ? (receivedOrders.length / supplier.purchaseOrders.length) * 100
        : null;

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