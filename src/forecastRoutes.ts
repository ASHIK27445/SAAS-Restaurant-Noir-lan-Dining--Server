import { Router } from "express";
import { RoleEnum } from "@prisma/client";
import { prisma } from "./prisma";
import { requireRole } from "./auth";

const router = Router();
const HISTORY_DAYS = 56;
const RECENT_DAYS = 14;
const PRIOR_DAYS = 14;

type SalesPoint = { date: string; quantity: number };

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dateAtUtcOffset(offset: number) {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + offset));
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function average(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function forecastFor(points: SalesPoint[], targetDate: Date) {
  const targetKey = dayKey(targetDate);
  const targetWeekday = targetDate.getUTCDay();
  const historyStart = dateAtUtcOffset(-HISTORY_DAYS);
  const recentStart = dateAtUtcOffset(-RECENT_DAYS);
  const priorStart = dateAtUtcOffset(-(RECENT_DAYS + PRIOR_DAYS));
  const historyByDate = new Map(points.map((point) => [point.date, point.quantity]));
  const weekdayValues: number[] = [];
  const recentValues: number[] = [];
  const priorValues: number[] = [];

  for (let cursor = new Date(historyStart); cursor < new Date(); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const quantity = historyByDate.get(dayKey(cursor)) ?? 0;
    if (cursor.getUTCDay() === targetWeekday) weekdayValues.push(quantity);
    if (cursor >= recentStart) recentValues.push(quantity);
    if (cursor >= priorStart && cursor < recentStart) priorValues.push(quantity);
  }

  const weekdayAverage = average(weekdayValues);
  const recentAverage = average(recentValues);
  const priorAverage = average(priorValues);
  const trend = priorAverage > 0 ? clamp(recentAverage / priorAverage, 0.75, 1.25) : 1;
  const sampleCount = points.filter((point) => point.quantity > 0).length;
  const soldDayAverage = average(points.filter((point) => point.quantity > 0).map((point) => point.quantity));
  const demandAverage = sampleCount < 4 ? soldDayAverage : recentAverage;
  const base = weekdayAverage > 0 ? weekdayAverage * 0.65 + demandAverage * 0.35 : demandAverage;
  const expectedQuantity = Math.max(0, round(base * trend));
  const recommendedQuantity = sampleCount === 0
    ? 0
    : expectedQuantity > 0 && expectedQuantity < 1
      ? 1
      : Math.round(expectedQuantity);
  const confidence = sampleCount === 0 ? 20 : Math.min(95, 45 + sampleCount * 5);
  const status = sampleCount === 0 ? "NO_HISTORY" : expectedQuantity < 1 ? "LOW_DEMAND" : "FORECAST";

  return {
    date: targetKey,
    expectedQuantity,
    recommendedQuantity,
    status,
    confidence,
    weekdayAverage: round(weekdayAverage),
    recentAverage: round(recentAverage),
    soldDayAverage: round(soldDayAverage),
    trend: round(trend),
    sampleCount,
  };
}

// GET /forecasting/menu — internal, historical-sales-based menu demand forecast.
router.get("/menu", requireRole(RoleEnum.Admin, RoleEnum.Manager, RoleEnum.DemoAdmin), async (_req, res) => {
  try {
    const today = dateAtUtcOffset(0);
    const historyStart = dateAtUtcOffset(-HISTORY_DAYS);
    const forecastDates = Array.from({ length: 7 }, (_, index) => dateAtUtcOffset(index + 1));
    const [menuItems, orders] = await Promise.all([
      prisma.menuItem.findMany({
        where: { isActive: true },
        select: { id: true, name: true, price: true, category: { select: { name: true } } },
        orderBy: { name: "asc" },
      }),
      prisma.order.findMany({
        where: {
          createdAt: { gte: historyStart, lt: dateAtUtcOffset(1) },
          status: { not: "CANCELLED" },
        },
        select: {
          createdAt: true,
          items: { select: { menuItemId: true, quantity: true } },
        },
      }),
    ]);

    const sales = new Map<string, Map<string, number>>();
    for (const order of orders) {
      const date = dayKey(order.createdAt);
      for (const item of order.items) {
        const itemSales = sales.get(item.menuItemId) ?? new Map<string, number>();
        itemSales.set(date, (itemSales.get(date) ?? 0) + item.quantity);
        sales.set(item.menuItemId, itemSales);
      }
    }

    const data = menuItems.map((item) => {
      const points = [...(sales.get(item.id) ?? new Map<string, number>())].map(([date, quantity]) => ({ date, quantity }));
      const forecasts = forecastDates.map((date) => forecastFor(points, date));
      const tomorrow = forecasts[0];
      return {
        menuItemId: item.id,
        name: item.name,
        category: item.category.name,
        price: Number(item.price),
        tomorrow,
        next7Days: {
          expectedQuantity: round(forecasts.reduce((total, forecast) => total + forecast.expectedQuantity, 0)),
          recommendedQuantity: forecasts.reduce((total, forecast) => total + forecast.recommendedQuantity, 0),
          averageConfidence: Math.round(average(forecasts.map((forecast) => forecast.confidence))),
        },
        forecast: forecasts,
      };
    }).sort((left, right) => right.next7Days.recommendedQuantity - left.next7Days.recommendedQuantity);

    return res.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        history: { fromDate: dayKey(historyStart), toDate: dayKey(today), days: HISTORY_DAYS },
        method: "weekday-weighted-average-with-trend",
        items: data,
      },
    });
  } catch (error) {
    console.error("Failed to build menu demand forecast", error);
    return res.status(500).json({ success: false, message: "Failed to generate menu demand forecast" });
  }
});

export default router;
