import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

// POST /inquiry/get-started  { email }
router.post("/get-started", async (req, res) => {
  try {
    const { email } = req.body as { email: string };

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "A valid email is required" });
    }

    const inquiry = await prisma.inquiry.create({
      data: { email, type: "GET_STARTED" },
    });

    res.status(201).json({ success: true, message: "Thanks — we'll be in touch", data: inquiry });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
});

// POST /inquiry/book-a-demo  { email }
router.post("/book-a-demo", async (req, res) => {
  try {
    const { email } = req.body as { email: string };

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "A valid email is required" });
    }

    const inquiry = await prisma.inquiry.create({
      data: { email, type: "BOOK_A_DEMO" },
    });

    res.status(201).json({ success: true, message: "Thanks — we'll reach out to schedule your demo", data: inquiry });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
});

// GET /inquiry/all  ?type=GET_STARTED|BOOK_A_DEMO  (for an internal admin view later)
router.get("/all", async (req, res) => {
  try {
    const { type } = req.query as Record<string, string>;
    const inquiries = await prisma.inquiry.findMany({
      where: type ? { type: type as any } : {},
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: inquiries });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch inquiries" });
  }
});

export default router;