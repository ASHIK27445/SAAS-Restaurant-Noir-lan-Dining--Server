import { PrismaClient } from "@prisma/client"
import { Router } from "express";
import { Decimal } from "@prisma/client/runtime/library";

const prisma = new PrismaClient();
const router = Router();

//menu-create
router.post('/menu/create', async(req, res)=>{
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
router.get('/menu/allergens', async(req, res)=>{
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
router.get('/menu/categories', async (req, res) => {
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
router.get('/menu/all/categories', async (req, res) => {
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
router.put('/menu/category/:id', async (req, res) => {
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
router.patch('/menu/category/:id', async (req, res) => {
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

//menu-category-create
router.post('/menu/category/create', async (req, res) => {
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

export default router;