import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

const prisma = new PrismaClient();
const router = Router();

router.get("/pos-settings", async (_req, res) => {
  try {
    let setting = await prisma.posSetting.findFirst({ orderBy: { updatedAt: "desc" } });
    if (!setting) setting = await prisma.posSetting.create({ data: {} });
    res.json({ success: true, data: setting });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch POS settings" });
  }
});

router.patch("/pos-settings", async (req, res) => {
  try {
    const existing = await prisma.posSetting.findFirst({ orderBy: { updatedAt: "desc" } });
    const data = {
      taxRate: new Decimal(String(Math.max(0, Number(req.body.taxRate ?? 8)))),
      serviceCharge: new Decimal(String(Math.max(0, Number(req.body.serviceCharge ?? 0)))),
      autoPrintReceipt: Boolean(req.body.autoPrintReceipt),
    };
    const setting = existing
      ? await prisma.posSetting.update({ where: { id: existing.id }, data })
      : await prisma.posSetting.create({ data });
    res.json({ success: true, data: setting });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to update POS settings" });
  }
});

router.get("/promo-codes", async (_req, res) => {
  try {
    const promos = await prisma.promoCode.findMany({ orderBy: { createdAt: "desc" } });
    res.json({ success: true, data: promos });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch promo codes" });
  }
});

router.post("/promo-codes", async (req, res) => {
  try {
    const { code, discountPercent, usageLimit, isActive = true, showInPos = true } = req.body;
    const promo = await prisma.promoCode.create({
      data: {
        code: String(code).trim().toUpperCase(),
        discountPercent: new Decimal(String(discountPercent)),
        usageLimit: usageLimit === null || usageLimit === "" || usageLimit === undefined ? null : Number(usageLimit),
        isActive: Boolean(isActive),
        showInPos: Boolean(showInPos),
      },
    });
    res.status(201).json({ success: true, data: promo });
  } catch (error) {
    console.error(error);
    res.status(400).json({ success: false, message: "Failed to create promo code" });
  }
});

router.patch("/promo-codes/:id", async (req, res) => {
  try {
    const { code, discountPercent, usageLimit, isActive, showInPos } = req.body;
    const promo = await prisma.promoCode.update({
      where: { id: req.params.id },
      data: {
        ...(code !== undefined ? { code: String(code).trim().toUpperCase() } : {}),
        ...(discountPercent !== undefined ? { discountPercent: new Decimal(String(discountPercent)) } : {}),
        ...(usageLimit !== undefined ? { usageLimit: usageLimit === null || usageLimit === "" ? null : Number(usageLimit) } : {}),
        ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
        ...(showInPos !== undefined ? { showInPos: Boolean(showInPos) } : {}),
      },
    });
    res.json({ success: true, data: promo });
  } catch (error) {
    console.error(error);
    res.status(400).json({ success: false, message: "Failed to update promo code" });
  }
});

router.delete("/promo-codes/:id", async (req, res) => {
  try {
    await prisma.promoCode.delete({ where: { id: req.params.id } });
    res.json({ success: true, data: null });
  } catch (error) {
    console.error(error);
    res.status(400).json({ success: false, message: "Failed to delete promo code" });
  }
});

export default router;
