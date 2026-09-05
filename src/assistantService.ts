import { OrderStatus } from "@prisma/client";
import { prisma } from "./prisma";

export type AssistantIntent = "REVENUE" | "AVERAGE_ORDER_VALUE" | "TOP_MENU_ITEM" | "ORDER_TYPE";

export type AssistantResult = {
  answer: string;
  intent: AssistantIntent;
  period: { fromDate: string; toDate: string };
  highlights: { label: string; value: string }[];
};

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function detectAssistantIntent(question: string): AssistantIntent | null {
  const normalized = question.toLowerCase();
  if (normalized.includes("revenue") || normalized.includes("sales") || normalized.includes("income")) return "REVENUE";
  if (normalized.includes("average") || normalized.includes("ticket") || normalized.includes("order value")) return "AVERAGE_ORDER_VALUE";
  if (normalized.includes("order type") || normalized.includes("delivery") || normalized.includes("takeaway") || normalized.includes("dine-in")) return "ORDER_TYPE";
  if (normalized.includes("menu") || normalized.includes("dish") || normalized.includes("item") || normalized.includes("sold")) return "TOP_MENU_ITEM";
  return null;
}

export async function answerBusinessQuestion(question: string, intent: AssistantIntent): Promise<AssistantResult> {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  const orders = await prisma.order.findMany({
    where: { createdAt: { gte: start, lte: end }, paymentStatus: "PAID", status: { not: OrderStatus.CANCELLED } },
    select: { total: true, orderType: true, items: { select: { quantity: true, menuItem: { select: { name: true } } } } },
  });

  const revenue = orders.reduce((sum, order) => sum + Number(order.total), 0);
  const averageOrderValue = orders.length ? revenue / orders.length : 0;
  const dishes = new Map<string, number>();
  const types = new Map<string, number>();
  for (const order of orders) {
    types.set(order.orderType, (types.get(order.orderType) ?? 0) + 1);
    for (const item of order.items) dishes.set(item.menuItem.name, (dishes.get(item.menuItem.name) ?? 0) + item.quantity);
  }
  const topDish = [...dishes.entries()].sort(([, left], [, right]) => right - left)[0];
  const topType = [...types.entries()].sort(([, left], [, right]) => right - left)[0];
  const money = (value: number) => `$${value.toFixed(2)}`;
  const period = { fromDate: dayKey(start), toDate: dayKey(end) };
  const highlights = [
    { label: "Paid orders", value: String(orders.length) },
    { label: "Revenue", value: money(revenue) },
    { label: "Average order", value: money(averageOrderValue) },
  ];

  let answer = "No paid order data was found for the last 30 days.";
  if (orders.length) {
    if (intent === "REVENUE") answer = `Revenue was ${money(revenue)} across ${orders.length} paid orders in the last 30 days.`;
    if (intent === "AVERAGE_ORDER_VALUE") answer = `The average order value was ${money(averageOrderValue)} across ${orders.length} paid orders in the last 30 days.`;
    if (intent === "TOP_MENU_ITEM") answer = topDish ? `${topDish[0]} was the top-selling menu item with ${topDish[1]} units sold in the last 30 days.` : "No menu item sales were found in the last 30 days.";
    if (intent === "ORDER_TYPE") answer = topType ? `${topType[0].replaceAll("_", " ")} was the most popular order type with ${topType[1]} orders in the last 30 days.` : "No order type data was found in the last 30 days.";
  }

  return { answer, intent, period, highlights };
}