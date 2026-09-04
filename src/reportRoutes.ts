import { Router } from "express";
import { OrderStatus, RoleEnum } from "@prisma/client";
import { prisma } from "./prisma";
import { requireRole } from "./auth";

const router = Router();

type DateRange = { start: Date; end: Date };

function parseDate(value: unknown, endOfDay = false): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDateRange(fromDate: unknown, toDate: unknown): DateRange {
  const today = new Date();
  const defaultStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const defaultEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  const start = parseDate(fromDate) ?? defaultStart;
  const end = parseDate(toDate, true) ?? defaultEnd;
  return { start, end };
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildDailySeries(start: Date, end: Date) {
  const daily = new Map<string, { revenue: number; orders: number }>();
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    daily.set(dayKey(cursor), { revenue: 0, orders: 0 });
  }
  return daily;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

// GET /reports/overview?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD
router.get("/overview", requireRole(RoleEnum.Admin, RoleEnum.Manager, RoleEnum.DemoAdmin), async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query.fromDate, req.query.toDate);
    if (start > end) return res.status(400).json({ success: false, message: "fromDate must be before toDate" });

    const orders = await prisma.order.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        paymentStatus: "PAID",
        status: { not: OrderStatus.CANCELLED },
      },
      select: {
        id: true,
        orderType: true,
        total: true,
        createdAt: true,
        items: {
          select: {
            quantity: true,
            unitPrice: true,
            menuItem: {
              select: {
                id: true,
                name: true,
                category: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    let revenue = 0;
    const daily = buildDailySeries(start, end);
    const categories = new Map<string, { revenue: number; quantity: number }>();
    const dishes = new Map<string, { menuItemId: string; name: string; quantity: number; revenue: number }>();
    const orderTypes = new Map<string, { orders: number; revenue: number }>();

    for (const order of orders) {
      const orderRevenue = Number(order.total);
      revenue += orderRevenue;

      const date = dayKey(order.createdAt);
      const dailyEntry = daily.get(date) ?? { revenue: 0, orders: 0 };
      dailyEntry.revenue += orderRevenue;
      dailyEntry.orders += 1;
      daily.set(date, dailyEntry);

      const typeEntry = orderTypes.get(order.orderType) ?? { orders: 0, revenue: 0 };
      typeEntry.orders += 1;
      typeEntry.revenue += orderRevenue;
      orderTypes.set(order.orderType, typeEntry);

      for (const item of order.items) {
        const quantity = item.quantity;
        const itemRevenue = quantity * Number(item.unitPrice);
        const categoryName = item.menuItem.category.name;
        const categoryEntry = categories.get(categoryName) ?? { revenue: 0, quantity: 0 };
        categoryEntry.revenue += itemRevenue;
        categoryEntry.quantity += quantity;
        categories.set(categoryName, categoryEntry);

        const dishEntry = dishes.get(item.menuItem.id) ?? { menuItemId: item.menuItem.id, name: item.menuItem.name, quantity: 0, revenue: 0 };
        dishEntry.quantity += quantity;
        dishEntry.revenue += itemRevenue;
        dishes.set(item.menuItem.id, dishEntry);
      }
    }

    const orderCount = orders.length;
    const categoryData = [...categories.entries()]
      .map(([name, value]) => ({ name, quantity: value.quantity, revenue: round(value.revenue), percentage: revenue ? round((value.revenue / revenue) * 100) : 0 }))
      .sort((a, b) => b.revenue - a.revenue);
    const topDishes = [...dishes.values()]
      .map((dish) => ({ ...dish, revenue: round(dish.revenue) }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    return res.json({
      success: true,
      data: {
        period: { fromDate: dayKey(start), toDate: dayKey(end) },
        summary: {
          revenue: round(revenue),
          orderCount,
          averageOrderValue: orderCount ? round(revenue / orderCount) : 0,
        },
        daily: [...daily.entries()].map(([date, value]) => ({ date, revenue: round(value.revenue), orders: value.orders })),
        categories: categoryData,
        topDishes,
        orderTypes: [...orderTypes.entries()].map(([orderType, value]) => ({ orderType, orders: value.orders, revenue: round(value.revenue) })),
      },
    });
  } catch (error) {
    console.error("Failed to build reports overview", error);
    return res.status(500).json({ success: false, message: "Failed to fetch reports" });
  }
});

export default router;
