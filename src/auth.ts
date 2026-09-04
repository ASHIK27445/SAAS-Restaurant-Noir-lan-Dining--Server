import { NextFunction, Request, Response } from "express";
import { AccessModule, RoleEnum } from "@prisma/client";
import admin from "./firebaseAdmin";
import { prisma } from "./prisma";

export type AuthenticatedUser = {
  id: string;
  firebaseUid: string;
  email: string;
  role: RoleEnum;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedUser;
    }
  }
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MANAGER_MODULES = new Set<AccessModule>([
  AccessModule.SUPPLIERS,
  AccessModule.INVENTORY,
  AccessModule.EMPLOYEES,
  AccessModule.ORDERS,
  AccessModule.ATTENDANCE,
  AccessModule.USERS,
  AccessModule.POS,
]);

export function isStrongPassword(password: unknown): password is string {
  return typeof password === "string"
    && password.length >= 6
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /[0-9]/.test(password);
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Firebase ID token is required" });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(header.slice(7));
    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } });
    if (!user || !user.isActive) {
      if (req.path === "/auth/user-create") return next();
      return res.status(403).json({ success: false, message: "Account is not provisioned or is inactive" });
    }
    req.auth = { id: user.id, firebaseUid: user.firebaseUid, email: user.email, role: user.role };
    return next();
  } catch (error) {
    console.error("Firebase authentication failed", error);
    return res.status(401).json({ success: false, message: "Invalid or expired Firebase ID token" });
  }
}

function moduleForRequest(req: Request): AccessModule | null {
  const path = `${req.baseUrl}${req.path}`;
  if (path.startsWith("/auth")) return AccessModule.USERS;
  if (path.startsWith("/admin/staff") || path.startsWith("/employees/staff")) return AccessModule.EMPLOYEES;
  if (path.startsWith("/employees/attendance") || path.startsWith("/employees/wages") || path.startsWith("/employees/open-shifts")) return AccessModule.ATTENDANCE;
  if (path.startsWith("/inventory") || path.startsWith("/inventory-usage")) return AccessModule.INVENTORY;
  if (path.startsWith("/suppliers") || path.startsWith("/supplier-contacts") || path.startsWith("/purchase-orders")) return AccessModule.SUPPLIERS;
  if (path.startsWith("/menu")) return AccessModule.MENU;
  if (path.startsWith("/orders")) return AccessModule.ORDERS;
  if (path.startsWith("/settings")) return AccessModule.POS;
  return null;
}

export async function authorizeRequest(req: Request, res: Response, next: NextFunction) {
  if (req.path === "/auth/user-create") return next();
  if (!req.auth) return res.status(401).json({ success: false, message: "Authentication required" });
  if (req.path === "/auth/me") return next();
  if (req.auth.role === RoleEnum.Admin) return next();
  const path = `${req.baseUrl}${req.path}`;
  if (req.auth.role === RoleEnum.Customer
    && ((req.method === "POST" && (path === "/orders/customer-create" || path === "/orders/customer-promo"))
      || (req.method === "GET" && path === "/orders/my-orders"))) {
    return next();
  }
  if (req.auth.role === RoleEnum.DemoAdmin) {
    return READ_METHODS.has(req.method)
      ? next()
      : res.status(403).json({ success: false, message: "Demo Admin accounts are read-only" });
  }

  const module = moduleForRequest(req);
  if (!module) return res.status(403).json({ success: false, message: "This operation is not authorized" });
  if (req.auth.role === RoleEnum.Manager && MANAGER_MODULES.has(module)) return next();
  if ((req.auth.role === RoleEnum.Cashier || req.auth.role === RoleEnum.Supplier || req.auth.role === RoleEnum.Accountant) && module === AccessModule.POS) return next();
  if ((req.auth.role === RoleEnum.Supplier || req.auth.role === RoleEnum.Accountant) && module === AccessModule.SUPPLIERS) return next();

  const grant = await prisma.accessGrant.findUnique({
    where: { userId_module: { userId: req.auth.id, module } },
  });
  if (grant?.status === "APPROVED") return next();

  return res.status(403).json({ success: false, message: `Access to ${module.toLowerCase()} is not approved` });
}

export function requireRole(...roles: RoleEnum[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ success: false, message: "Insufficient role" });
    }
    return next();
  };
}
