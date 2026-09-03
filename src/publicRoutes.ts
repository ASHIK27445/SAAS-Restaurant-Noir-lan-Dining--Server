import { Router } from "express";
import { prisma } from "./prisma";

const router = Router();

router.get("/menu", async (_req, res) => {
  try {
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        bucketType: true,
        menuItems: {
          where: { isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true, description: true, price: true, discountPrice: true, image: true },
        },
      },
    });

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
    });
  } catch (error) {
    console.error("Failed to load public menu", error);
    return res.status(500).json({ success: false, message: "Failed to fetch public menu" });
  }
});

export default router;
