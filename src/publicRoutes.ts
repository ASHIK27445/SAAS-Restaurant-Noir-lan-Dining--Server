import { Router } from "express";
import { prisma } from "./prisma";

const router = Router();

router.get("/menu", async (_req, res) => {
  try {
    const categorySelect = {
      id: true,
      name: true,
      description: true,
      bucketType: true,
      menuItems: {
        where: { isActive: true },
        orderBy: { name: "asc" as const },
        select: { id: true, name: true, description: true, price: true, discountPrice: true, image: true },
      },
    } as const;
    const [categories, specials] = await Promise.all([
      prisma.category.findMany({
        where: { isActive: true, NOT: { name: { contains: "special", mode: "insensitive" } } },
        orderBy: { sortOrder: "asc" },
        select: categorySelect,
      }),
      prisma.category.findMany({
        where: { isActive: true, name: { contains: "special", mode: "insensitive" } },
        orderBy: { sortOrder: "asc" },
        select: categorySelect,
      }),
    ]);

    return res.json({
      success: true,
      data: categories.map((category) => ({
        ...category,
        menuItems: category.menuItems.map((item) => ({
          ...item,
          price: Number(item.discountPrice ?? item.price),
          originalPrice: item.discountPrice ? Number(item.price) : null,
        })),
      })),
      specials: specials.map((category) => ({
        ...category,
        menuItems: category.menuItems.map((item) => ({
          ...item,
          price: Number(item.discountPrice ?? item.price),
          originalPrice: item.discountPrice ? Number(item.price) : null,
        })),
      })),
    });
  } catch (error) {
    console.error("Failed to load public menu", error);
    return res.status(500).json({ success: false, message: "Failed to fetch public menu" });
  }
});

router.get("/gallery", async (_req, res) => {
  try {
    const images = await prisma.galleryImage.findMany({
      where: { isActive: true },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
      select: { id: true, title: true, imageUrl: true, altText: true, category: true, sortOrder: true },
    });
    return res.json({ success: true, data: images });
  } catch (error) {
    console.error("Failed to load public gallery", error);
    return res.status(500).json({ success: false, message: "Failed to fetch public gallery" });
  }
});

export default router;
