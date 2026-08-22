import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import { PrismaClient } from "@prisma/client"
import admin from "./firebaseAdmin";
import { Decimal } from "@prisma/client/runtime/library";
import inventoryRoutes from "./inventoryRoutes";
import employeesRoutes from "./employeesRoutes";
dotenv.config();

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

//Test Route
app.get('/', (_req, res)=>{
    res.send("Backend is running")
})

//user-create
app.post('/auth/user-create', async(req, res)=>{
    const {token, name, phone} = req.body
    

    try{
        const decoded = await admin.auth().verifyIdToken(token)
        const email = decoded.email
        const uid = decoded.uid

        console.log(decoded, email, uid)
        if (!email || !uid) {
        return res.status(400).json({ error: "Invalid Firebase token data" });
        }

        const user = await prisma.user.upsert({
            where:{
                email: email
            },
            update: {name, phone},
            create: {
                email,
                firebaseUid: uid!,
                name: name,
                phone: phone
            }
        })
        console.log(user)
        res.json({message: "User saved", user})

    }catch (err: any) {
        console.error("🔥 FIREBASE VERIFY FAILED FULL ERROR:");
        console.error(err);
        console.error("MESSAGE:", err?.message);

        return res.status(401).json({
            error: "Invalid Firebase token",
            message: err?.message,
        });
    }
})

//menu-create
app.post('/menu/create', async(req, res)=>{
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
app.get('/menu/allergens', async(req, res)=>{
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
app.get('/menu/categories', async (req, res) => {
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
app.get('/menu/all/categories', async (req, res) => {
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
app.put('/menu/category/:id', async (req, res) => {
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
app.patch('/menu/category/:id', async (req, res) => {
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
app.post('/menu/category/create', async (req, res) => {
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

//empolyee----------------------------
app.post('/admin/staff/create', async(req, res)=>{
  try {
      const { name,email,role,title,phone, image, systemAccess,
      } = req.body;

      const staff = await prisma.staff.create({
        data: {
          name,
          email,
          role,
          title,
          phone: phone || '',
          avatar: image || null,
          systemAccess,
        },
      });

      res.status(201).json({
        success: true,
        message: "Staff created successfully",
        data: staff,
      });
  } catch (error) {
      console.log(error);

      res.status(500).json({
        success: false,
        message: "Something went wrong",
      });
  }
})

//get-employee
app.get('/admin/staff/all', async(req, res) => {
  try {
    const staff = await prisma.staff.findMany({
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Transform to match frontend Employee type
    const transformedStaff = staff.map(emp => ({
      id: emp.id,
      name: emp.name,
      email: emp.email,
      role: emp.role,
      title: emp.title,
      phone: emp.phone || "",
      img: emp.avatar || "https://via.placeholder.com/56", // Default image
      online: emp.online || false,
      location: emp.location || "Not checked in",
      systemAccess: emp.systemAccess
    }));

    res.status(200).json({
      success: true,
      data: transformedStaff,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch staff",
    });
  }
});

//inventory management
app.use(inventoryRoutes);

//employee management
app.use("/employees", employeesRoutes);

// Server start 
app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
})

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});