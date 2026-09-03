import { Router } from "express";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "./prisma";

const router = Router();

//menu-create
router.post('/create', async(req, res)=>{
    try {
        
        const {name,description,price,sku,calories,kitchenNotes, image,dietary = {},
        allergens = [], categoryId} = req.body;
        
        const menuItem = await prisma.menuItem.create({
        data: {
        name,
        description,

        // ✅ decimal safe
        price: new Decimal(price.toString()),

        sku,
        calories,
        kitchenNotes,
        image, 
        dietaryType: {
        set: [
            ...(dietary?.vegan ? ["VEGAN" as const] : []),
            ...(dietary?.vegetarian ? ["VEGETARIAN" as const] : []),
            ...(dietary?.glutenFree ? ["GLUTEN_FREE" as const] : []),
        ],
        },

        allergens: {
          create: (allergens || []).map((allergenId: string) => ({
            allergen: {
              connect: {
                id: allergenId,
              },
            },
          })),
        },

        category: {
              connect: {
                id: categoryId, // 👈 MUST COME from frontend
              },
        },

    
      },
    });

    console.log(menuItem)
    res.json(menuItem)
    } catch (err: any) {
        res.status(500).json({
      error: err.message,
    });
    }
})

//get-allergens
router.get('/allergens', async(req, res)=>{
  try {
    const allergens = await prisma.allergen.findMany({
      select: {
        id: true,
        name: true,
      }
    })

    res.status(200).json({
      success: true,
      message: "Allergens fetched successfully",
      data: allergens,
    })
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch allergens",
    })
  }
})

//get-category
router.get('/categories', async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      where: { 
        isActive: true  // শুধু active categories
      },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
      }
    });
    
    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categories'
    });
  }
})

// GET /menu/categories all
router.get('/all/categories', async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      include: {
        _count: {
          select: { menuItems: true }
        }
      },
      orderBy: { sortOrder: 'asc' }
    });
    
    res.json({ success: true, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch categories' });
  }
});

// PUT /menu/category/:id
router.put('/category/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, isActive, image, sortOrder } = req.body;
    
    // Check if name already exists (excluding current category)
    const existingCategory = await prisma.category.findFirst({
      where: {
        name: name,
        id: { not: id }
      }
    });
    
    if (existingCategory) {
      return res.status(409).json({
        success: false,
        message: "Category name already exists"
      });
    }
    
    const category = await prisma.category.update({
      where: { id },
      data: {
        name,
        description: description || null,
        isActive,
        image: image || null,
        sortOrder: sortOrder || 0,
      }
    });
    
    res.json({
      success: true,
      message: "Category updated successfully",
      data: category
    });
  } catch (error) {
    console.error("Error updating category:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update category"
    });
  }
});

// PATCH /menu/category/:id
router.patch('/category/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    
    const category = await prisma.category.update({
      where: { id },
      data: { isActive }
    });
    
    res.json({ success: true, data: category });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update category' });
  }
});

// DELETE /menu/category/:id
router.delete('/category/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const category = await prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { menuItems: true } } },
    });

    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    if (category._count.menuItems > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete this category while it contains ${category._count.menuItems} menu item${category._count.menuItems === 1 ? '' : 's'}. Move or delete the items first.`,
      });
    }

    await prisma.category.delete({ where: { id } });
    return res.json({ success: true, message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Error deleting category:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete category' });
  }
});

//menu-category-create
router.post('/category/create', async (req, res) => {
    try {
        const { name, description, isActive, image } = req.body;

        if (!name || name.trim() === "") {
            return res.status(400).json({ 
                success: false,
                message: "Category name is required" 
            });
        }

        // Check if category already exists
        const existingCategory = await prisma.category.findUnique({
            where: { name: name.trim() }
        });

        if (existingCategory) {
            return res.status(409).json({
                success: false,
                message: "Category already exists"
            });
        }

        // Increment sortOrder of all existing categories by 1
        await prisma.category.updateMany({
            data: {
                sortOrder: {
                    increment: 1
                }
            }
        });

        // Create new category with sortOrder 0
        const category = await prisma.category.create({
            data: {
                name: name.trim(),
                description: description || null,
                isActive: isActive !== undefined ? isActive : true,
                image: image || null,
                sortOrder: 0,
            },
        });

        return res.status(201).json({
            success: true,
            message: "Category created successfully",
            data: category,
        });
    } catch (error: any) {
        console.error("Error creating category:", error);

        if (error.code === "P2002") {
            return res.status(409).json({
                success: false,
                message: "Category name already exists",
            });
        }

        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
});


// GET /menu/items  ?search=&categoryId=&isActive=
router.get("/items", async (req, res) => {
  try {
    const { search = "", categoryId, isActive } = req.query as Record<string, string>;

    const items = await prisma.menuItem.findMany({
      where: {
        name: { contains: search, mode: "insensitive" },
        ...(categoryId ? { categoryId } : {}),
        ...(isActive !== undefined ? { isActive: isActive === "true" } : {}),
      },
      include: {
        category: true,
        allergens: { include: { allergen: true } },
      },
      orderBy: { name: "asc" },
    });

    res.json({ success: true, data: items });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch menu items" });
  }
});

// GET /menu/items/:id
router.get("/items/:id", async (req, res) => {
  try {
    const item = await prisma.menuItem.findUnique({
      where: { id: req.params.id },
      include: { category: true, allergens: { include: { allergen: true } } },
    });
    if (!item) return res.status(404).json({ success: false, message: "Menu item not found" });
    res.json({ success: true, data: item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch menu item" });
  }
});

// PUT /menu/items/:id
// body: same shape as create — name, description, price, sku, categoryId, calories,
// image, kitchenNotes, isActive, allergens (array of allergen ids), dietary
router.put("/items/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, description, price, sku, categoryId, calories, image,
      kitchenNotes, isActive, allergens, dietary,
    } = req.body as {
      name: string; description: string; price: number; sku: string; categoryId: string;
      calories?: number; image?: string; kitchenNotes?: string; isActive: boolean;
      allergens?: string[]; dietary?: { vegan?: boolean; vegetarian?: boolean; glutenFree?: boolean };
    };

    if (!name || !categoryId || price === undefined) {
      return res.status(400).json({ success: false, message: "name, categoryId and price are required" });
    }

    const dietaryType: ("VEGAN" | "VEGETARIAN" | "GLUTEN_FREE")[] = [];
    if (dietary?.vegan) dietaryType.push("VEGAN");
    if (dietary?.vegetarian) dietaryType.push("VEGETARIAN");
    if (dietary?.glutenFree) dietaryType.push("GLUTEN_FREE");

    const updated = await prisma.$transaction(async (tx) => {
      const item = await tx.menuItem.update({
        where: { id },
        data: {
          name,
          description,
          price: new Decimal(price.toFixed(2)),
          ...(sku ? { sku } : {}),
          categoryId,
          calories: calories ?? null,
          image: image || null,
          kitchenNotes: kitchenNotes || null,
          isActive,
          dietaryType,
        },
      });

      // Replace allergen links entirely — simplest way to keep the join table in sync
      await tx.menuItemAllergen.deleteMany({ where: { menuItemId: id } });
      if (allergens?.length) {
        await tx.menuItemAllergen.createMany({
          data: allergens.map((allergenId) => ({ menuItemId: id, allergenId })),
        });
      }

      return item;
    });

    res.json({ success: true, message: "Menu item updated", data: updated });
  } catch (error: any) {
    console.error(error);
    if (error.code === "P2002") {
      return res.status(409).json({ success: false, message: "Name or SKU already exists" });
    }
    res.status(500).json({ success: false, message: "Failed to update menu item" });
  }
});

// PATCH /menu/items/:id/status  { isActive }
router.patch("/items/:id/status", async (req, res) => {
  try {
    const { isActive } = req.body as { isActive: boolean };
    const item = await prisma.menuItem.update({ where: { id: req.params.id }, data: { isActive } });
    res.json({ success: true, message: "Status updated", data: item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to update status" });
  }
});

// DELETE /menu/items/:id
router.delete("/items/:id", async (req, res) => {
  try {
    await prisma.menuItemAllergen.deleteMany({ where: { menuItemId: req.params.id } });
    await prisma.menuItem.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Menu item deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to delete menu item" });
  }
});

export default router;