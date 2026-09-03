import { Router } from "express";
import { GalleryCategory, RoleEnum } from "@prisma/client";
import { authenticate, requireRole } from "./auth";
import { prisma } from "./prisma";

const router = Router();

router.use(authenticate, requireRole(RoleEnum.Admin));

router.get("/", async (_req, res) => {
  const images = await prisma.galleryImage.findMany({
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
  });
  return res.json({ success: true, data: images });
});

router.post("/", async (req, res) => {
  const { title, imageUrl, altText, category, sortOrder, isActive } = req.body as {
    title?: string; imageUrl?: string; altText?: string; category?: GalleryCategory; sortOrder?: number; isActive?: boolean;
  };
  if (!title?.trim() || !imageUrl?.trim() || !category || !Object.values(GalleryCategory).includes(category)) {
    return res.status(400).json({ success: false, message: "Title, image URL, and a valid gallery category are required" });
  }
  const requestedSortOrder = typeof sortOrder === "number" && Number.isInteger(sortOrder) ? sortOrder : 0;
  const image = await prisma.galleryImage.create({
    data: { title: title.trim(), imageUrl: imageUrl.trim(), altText: altText?.trim() || null, category, sortOrder: requestedSortOrder, isActive: isActive !== false },
  });
  return res.status(201).json({ success: true, data: image });
});

router.patch("/:id", async (req, res) => {
  const { title, imageUrl, altText, category, sortOrder, isActive } = req.body as {
    title?: string; imageUrl?: string; altText?: string; category?: GalleryCategory; sortOrder?: number; isActive?: boolean;
  };
  if (category !== undefined && !Object.values(GalleryCategory).includes(category)) return res.status(400).json({ success: false, message: "Invalid gallery category" });
  const image = await prisma.galleryImage.update({ where: { id: req.params.id }, data: {
    ...(title !== undefined ? { title: title.trim() } : {}),
    ...(imageUrl !== undefined ? { imageUrl: imageUrl.trim() } : {}),
    ...(altText !== undefined ? { altText: altText.trim() || null } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(sortOrder !== undefined ? { sortOrder } : {}),
    ...(isActive !== undefined ? { isActive } : {}),
  } });
  return res.json({ success: true, data: image });
});

router.delete("/:id", async (req, res) => {
  await prisma.galleryImage.delete({ where: { id: req.params.id } });
  return res.json({ success: true, message: "Gallery image deleted" });
});

export default router;
