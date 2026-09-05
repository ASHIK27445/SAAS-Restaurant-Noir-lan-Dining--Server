import { Router } from "express";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "./prisma";

const router = Router();

function unitGroup(unit: string) {
  const normalized = unit.trim().toLowerCase();
  if (["g", "gram", "grams"].includes(normalized)) return { group: "mass", factor: 1 };
  if (["kg", "kilogram", "kilograms"].includes(normalized)) return { group: "mass", factor: 1000 };
  if (["ml", "milliliter", "milliliters"].includes(normalized)) return { group: "volume", factor: 1 };
  if (["l", "liter", "liters", "litre", "litres"].includes(normalized)) return { group: "volume", factor: 1000 };
  if (["unit", "units", "piece", "pieces", "pc", "pcs"].includes(normalized)) return { group: "count", factor: 1 };
  return { group: normalized, factor: 1 };
}

function convertQuantity(quantity: number, fromUnit: string, toUnit: string) {
  const from = unitGroup(fromUnit);
  const to = unitGroup(toUnit);
  if (from.group !== to.group) return null;
  return quantity * from.factor / to.factor;
}

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
    const { name, description, isActive, image, sortOrder, bucketType } = req.body;
    
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
        ...(bucketType ? { bucketType } : {}),
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

// GET /menu/items/:id/recipes
router.get("/items/:id/recipes", async (req, res) => {
  try {
    const recipes = await prisma.menuRecipe.findMany({
      where: { menuItemId: req.params.id },
      include: { ingredients: { include: { mapping: { include: { inventoryItem: true } } } } },
      orderBy: { version: "desc" },
    });
    res.json({ success: true, data: recipes });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch recipes" });
  }
});

// POST /menu/items/:id/recipes
// Creates a new immutable recipe definition version and activates it.
router.post("/items/:id/recipes", async (req, res) => {
  try {
    const { ingredients, changeNote } = req.body as {
      ingredients?: { ingredientName: string; quantity: number; unit: string }[];
      changeNote?: string;
    };
    if (!Array.isArray(ingredients) || ingredients.length === 0) {
      return res.status(400).json({ success: false, message: "At least one ingredient is required" });
    }
    if (ingredients.some((ingredient) => !ingredient.ingredientName?.trim() || !ingredient.unit || Number(ingredient.quantity) <= 0)) {
      return res.status(400).json({ success: false, message: "Each recipe ingredient needs a name, unit, and positive quantity" });
    }
    if (new Set(ingredients.map((ingredient) => ingredient.ingredientName.trim().toLowerCase())).size !== ingredients.length) {
      return res.status(400).json({ success: false, message: "An ingredient can only be added once per recipe" });
    }

    const recipe = await prisma.$transaction(async (tx) => {
      const menuItem = await tx.menuItem.findUnique({ where: { id: req.params.id }, select: { id: true } });
      if (!menuItem) throw new Error("MENU_ITEM_NOT_FOUND");
      const latest = await tx.menuRecipe.findFirst({ where: { menuItemId: req.params.id }, orderBy: { version: "desc" }, select: { version: true } });
      const version = (latest?.version ?? 0) + 1;
      await tx.menuRecipe.updateMany({ where: { menuItemId: req.params.id, isActive: true }, data: { isActive: false } });
      return tx.menuRecipe.create({
        data: {
          menuItemId: req.params.id,
          version,
          isActive: true,
          changeNote: changeNote?.trim() || null,
          ingredients: {
            create: ingredients.map((ingredient) => ({
              ingredientName: ingredient.ingredientName.trim(),
              quantity: new Decimal(Number(ingredient.quantity).toFixed(3)),
              unit: ingredient.unit.trim(),
            })),
          },
        },
        include: { ingredients: { include: { mapping: { include: { inventoryItem: true } } } } },
      });
    });
    return res.status(201).json({ success: true, data: recipe });
  } catch (error: any) {
    console.error(error);
    if (error.message === "MENU_ITEM_NOT_FOUND") return res.status(404).json({ success: false, message: "Menu item not found" });
    return res.status(500).json({ success: false, message: "Failed to save recipe" });
  }
});

// PUT /menu/items/:id/recipes/:recipeId/mappings
router.put("/items/:id/recipes/:recipeId/mappings", async (req, res) => {
  try {
    const mappings = req.body?.mappings as { recipeIngredientId: string; inventoryItemId: string }[];
    if (!Array.isArray(mappings)) return res.status(400).json({ success: false, message: "Mappings are required" });

    const result = await prisma.$transaction(async (tx) => {
      const recipe = await tx.menuRecipe.findFirst({ where: { id: req.params.recipeId, menuItemId: req.params.id }, include: { ingredients: true } });
      if (!recipe) throw new Error("RECIPE_NOT_FOUND");
      const inventoryItems = await tx.inventoryItem.findMany({ where: { id: { in: mappings.map((mapping) => mapping.inventoryItemId) } } });
      if (inventoryItems.length !== mappings.length) throw new Error("INVENTORY_ITEM_NOT_FOUND");
      const ingredientIds = new Set(recipe.ingredients.map((ingredient) => ingredient.id));
      if (mappings.some((mapping) => !ingredientIds.has(mapping.recipeIngredientId))) throw new Error("INGREDIENT_NOT_FOUND");

      const mappingData = mappings.map((mapping) => {
        const ingredient = recipe.ingredients.find((item) => item.id === mapping.recipeIngredientId)!;
        const inventoryItem = inventoryItems.find((item) => item.id === mapping.inventoryItemId)!;
        const convertedQuantity = convertQuantity(Number(ingredient.quantity), ingredient.unit, inventoryItem.unit);
        if (convertedQuantity === null) throw new Error("UNIT_MISMATCH");
        const cost = convertedQuantity * Number(inventoryItem.costPerUnit);
        return { recipeIngredientId: ingredient.id, inventoryItemId: inventoryItem.id, unitPriceSnapshot: new Decimal(Number(inventoryItem.costPerUnit).toFixed(2)), ingredientCost: new Decimal(cost.toFixed(2)) };
      });
      await tx.menuRecipeMapping.deleteMany({ where: { recipeIngredientId: { in: recipe.ingredients.map((ingredient) => ingredient.id) } } });
      if (mappingData.length > 0) await tx.menuRecipeMapping.createMany({ data: mappingData });
      return tx.menuRecipe.findUnique({ where: { id: recipe.id }, include: { ingredients: { include: { mapping: { include: { inventoryItem: true } } } } } });
    }, { maxWait: 10_000, timeout: 30_000 });
    return res.json({ success: true, data: result });
  } catch (error: any) {
    if (error.message === "RECIPE_NOT_FOUND") return res.status(404).json({ success: false, message: "Recipe not found" });
    if (error.message === "INVENTORY_ITEM_NOT_FOUND") return res.status(404).json({ success: false, message: "One or more inventory items not found" });
    if (error.message === "INGREDIENT_NOT_FOUND") return res.status(400).json({ success: false, message: "Mapping contains an ingredient outside this recipe" });
    if (error.message === "UNIT_MISMATCH") return res.status(400).json({ success: false, message: "Recipe unit and inventory unit are not compatible" });
    console.error(error);
    return res.status(500).json({ success: false, message: "Failed to save ingredient mapping" });
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