import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import { PrismaClient } from "@prisma/client"
import admin from "./firebaseAdmin";
import inventoryRoutes from "./inventoryRoutes";
import employeesRoutes from "./employeesRoutes";
import ordersRoutes from "./ordersRoutes";
import menuRoutes from "./menuRoutes";

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

//menu--------------------------------
app.use("/menu", menuRoutes)

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

//order management
app.use("/orders", ordersRoutes);

// Server start 
app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
})

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});