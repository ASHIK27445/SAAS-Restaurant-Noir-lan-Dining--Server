import { Router } from "express";
import { ReservationStatus, RoleEnum } from "@prisma/client";
import { authenticate, requireRole } from "./auth";
import { prisma } from "./prisma";

const router = Router();

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

router.post("/", async (req, res) => {
  const { guestName, email, phone, reservationDate, reservationTime, guestCount, specialRequest } = req.body as {
    guestName?: string; email?: string; phone?: string; reservationDate?: string; reservationTime?: string; guestCount?: number; specialRequest?: string;
  };
  const requestedGuestCount = Number(guestCount ?? 0);
  if (!guestName?.trim() || !email?.trim() || !phone?.trim() || !validDate(reservationDate) || !reservationTime || !Number.isInteger(requestedGuestCount) || requestedGuestCount < 1 || requestedGuestCount > 20) {
    return res.status(400).json({ success: false, message: "Name, email, phone, date, time, and guest count are required" });
  }
  const date = new Date(`${reservationDate}T00:00:00.000Z`);
  if (date < new Date(Date.now() - 86400000)) return res.status(400).json({ success: false, message: "Reservation date cannot be in the past" });
  const reservation = await prisma.reservation.create({ data: { guestName: guestName.trim(), email: email.trim().toLowerCase(), phone: phone.trim(), reservationDate: date, reservationTime: reservationTime.trim(), guestCount: requestedGuestCount, specialRequest: specialRequest?.trim() || null } });
  return res.status(201).json({ success: true, message: "Your reservation request has been received. We will confirm it shortly.", data: { id: reservation.id } });
});

router.use(authenticate, requireRole(RoleEnum.Admin));

router.get("/admin", async (_req, res) => {
  const reservations = await prisma.reservation.findMany({ orderBy: [{ reservationDate: "asc" }, { reservationTime: "asc" }, { createdAt: "desc" }] });
  return res.json({ success: true, data: reservations });
});

router.patch("/admin/:id", async (req, res) => {
  const { status, adminNote } = req.body as { status?: ReservationStatus; adminNote?: string };
  if (status !== undefined && !Object.values(ReservationStatus).includes(status)) return res.status(400).json({ success: false, message: "Invalid reservation status" });
  const reservation = await prisma.reservation.update({ where: { id: req.params.id }, data: { ...(status !== undefined ? { status } : {}), ...(adminNote !== undefined ? { adminNote: adminNote.trim() || null } : {}) } });
  return res.json({ success: true, data: reservation });
});

export default router;
