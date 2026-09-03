import { Router } from "express";
import { ReviewStatus, RoleEnum } from "@prisma/client";
import { authenticate, requireRole } from "./auth";
import { prisma } from "./prisma";

const router = Router();

function validRating(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

router.get("/home", async (_req, res) => {
  const settings = await prisma.reviewSetting.upsert({ where: { id: "default" }, update: {}, create: {} });
  const reviews = await prisma.review.findMany({
    where: { status: ReviewStatus.APPROVED, showOnHome: true },
    orderBy: [{ homeOrder: "asc" }, { createdAt: "desc" }],
    take: settings.homeReviewLimit,
    select: { id: true, displayName: true, isAnonymous: true, content: true, foodRating: true, serviceRating: true, ambienceRating: true, createdAt: true },
  });
  return res.json({ success: true, data: reviews, limit: settings.homeReviewLimit });
});

router.post("/", async (req, res) => {
  const { displayName, isAnonymous, content, foodRating, serviceRating, ambienceRating } = req.body as {
    displayName?: string;
    isAnonymous?: boolean;
    content?: string;
    foodRating?: number;
    serviceRating?: number;
    ambienceRating?: number;
  };
  if (!content?.trim() || content.trim().length < 20 || content.trim().length > 2000) {
    return res.status(400).json({ success: false, message: "Review must be between 20 and 2000 characters" });
  }
  if (!validRating(foodRating) || !validRating(serviceRating) || !validRating(ambienceRating)) {
    return res.status(400).json({ success: false, message: "All three ratings must be between 1 and 5 stars" });
  }
  const anonymous = isAnonymous !== false;
  const review = await prisma.review.create({
    data: {
      content: content.trim(),
      displayName: anonymous ? null : displayName?.trim() || "Guest",
      isAnonymous: anonymous,
      foodRating,
      serviceRating,
      ambienceRating,
    },
  });
  return res.status(201).json({ success: true, message: "Thank you. Your review is awaiting moderation.", data: { id: review.id } });
});

router.use(authenticate, requireRole(RoleEnum.Admin));

router.get("/admin", async (_req, res) => {
  const [reviews, settings] = await Promise.all([
    prisma.review.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }] }),
    prisma.reviewSetting.upsert({ where: { id: "default" }, update: {}, create: {} }),
  ]);
  return res.json({ success: true, data: reviews, settings });
});

router.patch("/admin/settings", async (req, res) => {
  const limit = Number(req.body.homeReviewLimit);
  if (!Number.isInteger(limit) || limit < 0 || limit > 20) {
    return res.status(400).json({ success: false, message: "Homepage review limit must be between 0 and 20" });
  }
  const settings = await prisma.reviewSetting.upsert({ where: { id: "default" }, update: { homeReviewLimit: limit }, create: { homeReviewLimit: limit } });
  return res.json({ success: true, data: settings });
});

router.patch("/admin/:id", async (req, res) => {
  const { status, showOnHome, homeOrder } = req.body as { status?: ReviewStatus; showOnHome?: boolean; homeOrder?: number };
  if (status !== undefined && !Object.values(ReviewStatus).includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid review status" });
  }
  if (homeOrder !== undefined && (!Number.isInteger(homeOrder) || homeOrder < 0)) {
    return res.status(400).json({ success: false, message: "Homepage order must be a positive integer" });
  }
  const review = await prisma.review.update({ where: { id: req.params.id }, data: {
    ...(status !== undefined ? { status, ...(status !== ReviewStatus.APPROVED ? { showOnHome: false } : {}) } : {}),
    ...(showOnHome !== undefined ? { showOnHome } : {}),
    ...(homeOrder !== undefined ? { homeOrder } : {}),
  } });
  return res.json({ success: true, data: review });
});

export default router;
