import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import admin from "./firebaseAdmin";
import { prisma } from "./prisma";
import inventoryRoutes from "./inventoryRoutes";
import employeesRoutes from "./employeesRoutes";
import ordersRoutes from "./ordersRoutes";
import menuRoutes from "./menuRoutes";
import posSettingsRoutes from "./posSettingsRoutes";
import { AccessGrantStatus, AccessModule, RoleEnum } from "@prisma/client";
import { authenticate, authorizeRequest, isStrongPassword, requireRole } from "./auth";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

//Test Route
app.get('/', (_req, res)=>{
    res.send("Backend is running")
})

// The first administrator must be explicitly allowlisted in the environment.
app.post("/auth/bootstrap-admin", async (req, res) => {
  try {
    const decoded = await admin.auth().verifyIdToken(req.body.token);
    const email = decoded.email?.toLowerCase();
    if (!email || email !== process.env.INITIAL_ADMIN_EMAIL?.toLowerCase()) {
      return res.status(403).json({ success: false, message: "This account is not the initial administrator" });
    }
    const user = await prisma.user.upsert({
      where: { firebaseUid: decoded.uid },
      update: { email, name: req.body.name, phone: req.body.phone, role: RoleEnum.Admin, isActive: true },
      create: { firebaseUid: decoded.uid, email, name: req.body.name, phone: req.body.phone, role: RoleEnum.Admin },
    });
    return res.json({ success: true, user });
  } catch {
    return res.status(401).json({ success: false, message: "Invalid Firebase ID token" });
  }
});

app.post("/auth/user-create", async (req, res) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return res.status(401).json({ success: false, message: "Authentication required" });
    const decoded = await admin.auth().verifyIdToken(header.slice(7));
    const email = decoded.email?.toLowerCase();
    if (!email) return res.status(400).json({ success: false, message: "Firebase account has no email" });
    const user = await prisma.user.upsert({
      where: { firebaseUid: decoded.uid },
      update: { email, name: req.body.name, phone: req.body.phone },
      create: { email, firebaseUid: decoded.uid, name: req.body.name, phone: req.body.phone, role: RoleEnum.Customer },
    });
    return res.json({ success: true, message: "User saved", user });
  } catch {
    return res.status(401).json({ success: false, message: "Invalid Firebase ID token" });
  }
});

app.use(authenticate, authorizeRequest);

app.get("/auth/me", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth!.id }, include: { accessGrants: true } });
  return res.json({ success: true, user });
});

app.get("/auth/users", requireRole(RoleEnum.Admin), async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" }, include: { accessGrants: true } });
  return res.json({ success: true, data: users });
});

app.patch("/auth/users/:id", requireRole(RoleEnum.Admin), async (req, res) => {
  const { name, phone, role, isActive, emailVerificationNeeded } = req.body as { name?: string; phone?: string; role?: RoleEnum; isActive?: boolean; emailVerificationNeeded?: boolean };
  if (role && !Object.values(RoleEnum).includes(role)) {
    return res.status(400).json({ success: false, message: "Invalid role" });
  }
  const userId = req.params.id;
  if (typeof userId !== "string") return res.status(400).json({ success: false, message: "User id is required" });
  const data: { name?: string; phone?: string; role?: RoleEnum; isActive?: boolean; emailVerificationNeeded?: boolean } = {};
  if (name !== undefined) data.name = name;
  if (phone !== undefined) data.phone = phone;
  if (role !== undefined) data.role = role;
  if (isActive !== undefined) data.isActive = isActive;
  if (emailVerificationNeeded !== undefined) data.emailVerificationNeeded = emailVerificationNeeded;
  const user = await prisma.user.update({ where: { id: userId }, data });
  await admin.auth().updateUser(user.firebaseUid, {
    disabled: isActive === false,
    ...(name !== undefined ? { displayName: name } : {}),
  });
  return res.json({ success: true, data: user });
});

app.delete("/auth/users/:id", requireRole(RoleEnum.Admin), async (req, res) => {
  const userId = req.params.id;
  if (typeof userId !== "string") return res.status(400).json({ success: false, message: "User id is required" });
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).json({ success: false, message: "User not found" });
  if (user.id === req.auth!.id) return res.status(400).json({ success: false, message: "You cannot delete your own account" });
  await admin.auth().deleteUser(user.firebaseUid);
  await prisma.user.delete({ where: { id: user.id } });
  return res.json({ success: true, message: "User deleted" });
});

app.get("/auth/access-grants", requireRole(RoleEnum.Admin, RoleEnum.Manager), async (_req, res) => {
  const grants = await prisma.accessGrant.findMany({ include: { user: true }, orderBy: { createdAt: "desc" } });
  return res.json({ success: true, data: grants });
});

app.post("/auth/access-grants", requireRole(RoleEnum.Admin, RoleEnum.Manager), async (req, res) => {
  const { userId, module } = req.body as { userId?: string; module?: AccessModule };
  if (!userId || !module || !Object.values(AccessModule).includes(module)) {
    return res.status(400).json({ success: false, message: "userId and a valid module are required" });
  }
  const isAdmin = req.auth!.role === RoleEnum.Admin;
  const grant = await prisma.accessGrant.upsert({
    where: { userId_module: { userId, module } },
    update: { status: isAdmin ? AccessGrantStatus.APPROVED : AccessGrantStatus.PENDING, requestedBy: req.auth!.id, approvedBy: isAdmin ? req.auth!.id : null, approvedAt: isAdmin ? new Date() : null },
    create: { userId, module, requestedBy: req.auth!.id, status: isAdmin ? AccessGrantStatus.APPROVED : AccessGrantStatus.PENDING, approvedBy: isAdmin ? req.auth!.id : null, approvedAt: isAdmin ? new Date() : null },
  });
  return res.status(201).json({ success: true, data: grant });
});

app.patch("/auth/access-grants/:id", requireRole(RoleEnum.Admin), async (req, res) => {
  const { status } = req.body as { status?: "APPROVED" | "REJECTED" };
  if (!status || ![AccessGrantStatus.APPROVED, AccessGrantStatus.REJECTED].includes(status)) {
    return res.status(400).json({ success: false, message: "status must be APPROVED or REJECTED" });
  }
  const grantId = req.params.id;
  if (typeof grantId !== "string") return res.status(400).json({ success: false, message: "Grant id is required" });
  const grant = await prisma.accessGrant.update({ where: { id: grantId }, data: { status: status as AccessGrantStatus, approvedBy: req.auth!.id, approvedAt: new Date() } });
  return res.json({ success: true, data: grant });
});

app.patch("/auth/users/:uid/password", requireRole(RoleEnum.Admin), async (req, res) => {
  if (!isStrongPassword(req.body.password)) {
    return res.status(400).json({ success: false, message: "password must be 6+ characters with lowercase, uppercase, and number" });
  }
  const uid = req.params.uid;
  if (typeof uid !== "string") return res.status(400).json({ success: false, message: "Firebase uid is required" });
  await admin.auth().updateUser(uid, { password: req.body.password });
  return res.json({ success: true, message: "Password updated" });
});

app.use("/menu", menuRoutes)

//empolyee----------------------------
app.post('/admin/staff/create', async(req, res)=>{
  let firebaseUser: admin.auth.UserRecord | undefined;
  try {
      const { name,email,role,title,phone, image, systemAccess,
        password,
      } = req.body;

      if (!name || !email || !role || !title || role === RoleEnum.Customer || !isStrongPassword(password)) {
        return res.status(400).json({ success: false, message: "name, email, password (6+ characters with lowercase, uppercase and number), role and title are required" });
      }
      if (role === RoleEnum.Admin && req.auth?.role !== RoleEnum.Admin) {
        return res.status(403).json({ success: false, message: "Only an Admin can create an Admin account" });
      }

      firebaseUser = await admin.auth().createUser({ email, password, displayName: name });

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
      await prisma.user.create({
        data: { email, firebaseUid: firebaseUser.uid, name, phone: phone || "", role },
      });

      res.status(201).json({
        success: true,
        message: "Staff created successfully",
        data: staff,
      });
  } catch (error) {
      console.log(error);
      if (firebaseUser) await admin.auth().deleteUser(firebaseUser.uid).catch(() => undefined);

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
app.use("/settings", posSettingsRoutes);

// Server start 
app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
})

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});