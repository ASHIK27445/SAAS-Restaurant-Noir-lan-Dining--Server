import { Router } from "express";
import { Decimal } from "@prisma/client/runtime/library";
import { RoleEnum } from "@prisma/client";
import admin from "./firebaseAdmin";
import { prisma } from "./prisma";

const router = Router();

const ROLE_DEPARTMENT: Record<string, "Kitchen" | "Front of House" | "Administration"> = {
  Chef: "Kitchen",
  SousChef: "Kitchen",
  Waiter: "Front of House",
  Cashier: "Front of House",
  Manager: "Administration",
  Admin: "Administration",
};

// Rounding rule: remainder minutes >= 20 rounds up to the next hour, otherwise rounds down.
// 6h30m -> 7h, 6h20m -> 7h, 6h10m -> 6h.
function roundHours(rawHours: number): number {
  const wholeHours = Math.floor(rawHours);
  const remainderMinutes = (rawHours - wholeHours) * 60;
  return remainderMinutes >= 20 ? wholeHours + 1 : wholeHours;
}

function rawHoursBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
}

function timeStringToHours(time: string): number {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return h + m / 60;
}

function attendanceDateTime(date: string, time: string, after?: Date): Date {
  const value = new Date(`${date}T${time}:00`);
  if (after && value <= after) value.setDate(value.getDate() + 1);
  return value;
}

function dateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

// ───────────── Staff ─────────────

router.get("/staff", async (req, res) => {
  try {
    const { search = "", role } = req.query as Record<string, string>;
    const staff = await prisma.staff.findMany({
      where: {
        name: { contains: search, mode: "insensitive" },
        ...(role ? { role: role as any } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    const data = staff.map((s) => ({ ...s, department: ROLE_DEPARTMENT[s.role] ?? "Administration" }));
    res.json({ success: true, data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch staff" });
  }
});

router.get("/staff/all/list", async (_req, res) => {
  try {
    const staff = await prisma.staff.findMany({ orderBy: { createdAt: "desc" } });
    const data = staff.map((emp) => ({
      id: emp.id,
      name: emp.name,
      email: emp.email,
      role: emp.role,
      title: emp.title,
      phone: emp.phone || "",
      img: emp.avatar || "https://via.placeholder.com/56",
      online: emp.online || false,
      location: emp.location || "Not checked in",
      systemAccess: emp.systemAccess,
      hourlyRate: emp.hourlyRate,
      scheduleStartTime: emp.scheduleStartTime,
      scheduleEndTime: emp.scheduleEndTime,
      scheduleLabel: emp.scheduleLabel,
      department: ROLE_DEPARTMENT[emp.role] ?? "Administration",
    }));
    res.json({ success: true, data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch staff" });
  }
});

router.get("/staff/:id", async (req, res) => {
  try {
    const staff = await prisma.staff.findUnique({ where: { id: req.params.id } });
    if (!staff) return res.status(404).json({ success: false, message: "Staff not found" });
    res.json({ success: true, data: { ...staff, department: ROLE_DEPARTMENT[staff.role] ?? "Administration" } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch staff member" });
  }
});

router.post("/staff/create", async (req, res) => {
  let firebaseUser: admin.auth.UserRecord | undefined;
  try {
    const { name, email, password, role, title, phone, image, systemAccess, hourlyRate, scheduleStartTime, scheduleEndTime, scheduleLabel } = req.body;

    if (!name || !email || !password || !role || role === RoleEnum.Customer || !title || password.length < 8) {
      return res.status(400).json({ success: false, message: "name, email, password (8+ characters), role and title are required" });
    }
    if (role === RoleEnum.Admin && req.auth?.role !== RoleEnum.Admin) {
      return res.status(403).json({ success: false, message: "Only an Admin can create an Admin account" });
    }

    firebaseUser = await admin.auth().createUser({ email, password, displayName: name });

    const staff = await prisma.$transaction(async (transaction) => {
      const createdStaff = await transaction.staff.create({
        data: {
        name, email, role, title,
        phone: phone || "",
        avatar: image || null,
        systemAccess: systemAccess ?? true,
        hourlyRate: hourlyRate !== undefined ? new Decimal(hourlyRate.toString()) : null,
        scheduleStartTime: scheduleStartTime || null,
        scheduleEndTime: scheduleEndTime || null,
        scheduleLabel: scheduleLabel || null,
        },
      });
      await transaction.user.create({
        data: { email, firebaseUid: firebaseUser!.uid, name, phone: phone || "", role },
      });
      if (hourlyRate !== undefined) {
        await transaction.rateHistory.create({
          data: { staffId: createdStaff.id, rate: new Decimal(hourlyRate.toString()), effectiveFrom: new Date(), effectiveTo: null },
        });
      }
      return createdStaff;
    });

    res.status(201).json({ success: true, message: "Staff created successfully", data: staff });
  } catch (error: any) {
    console.error(error);
    if (firebaseUser) await admin.auth().deleteUser(firebaseUser.uid).catch(() => undefined);
    if (error.code === "P2002") return res.status(409).json({ success: false, message: "Email already exists" });
    if (error.code === "auth/email-already-exists") return res.status(409).json({ success: false, message: "Email already exists" });
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
});

router.delete("/staff/:id", async (req, res) => {
  try {
    const staff = await prisma.staff.findUnique({ where: { id: req.params.id } });
    if (!staff) return res.status(404).json({ success: false, message: "Staff not found" });
    const user = await prisma.user.findUnique({ where: { email: staff.email } });
    if (user) await admin.auth().updateUser(user.firebaseUid, { disabled: true });
    await prisma.staff.delete({ where: { id: staff.id } });
    if (user) await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    return res.json({ success: true, message: "Staff deleted successfully" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Failed to delete staff" });
  }
});

router.patch("/staff/:id", async (req, res) => {
  try {
    const { name, email, role, title, phone, image, systemAccess, scheduleStartTime, scheduleEndTime, scheduleLabel } = req.body;
    if (!name || !email || !role || !title) {
      return res.status(400).json({ success: false, message: "name, email, role and title are required" });
    }

    const previousStaff = await prisma.staff.findUnique({ where: { id: req.params.id } });
    if (!previousStaff) return res.status(404).json({ success: false, message: "Staff not found" });

    const staff = await prisma.staff.update({
      where: { id: req.params.id },
      data: {
        name,
        email,
        role,
        title,
        phone: phone || "",
        avatar: image || null,
        systemAccess: systemAccess ?? true,
        scheduleStartTime: scheduleStartTime || null,
        scheduleEndTime: scheduleEndTime || null,
        scheduleLabel: scheduleLabel || null,
      },
    });

    const user = await prisma.user.findUnique({ where: { email: previousStaff.email } });
    if (user) {
      await prisma.user.update({ where: { id: user.id }, data: { role, name, phone: phone || "" } });
      if (email !== previousStaff.email) await admin.auth().updateUser(user.firebaseUid, { email });
    }

    res.json({ success: true, message: "Staff updated successfully", data: staff });
  } catch (error: any) {
    console.error(error);
    if (error.code === "P2002") return res.status(409).json({ success: false, message: "Email already exists" });
    if (error.code === "P2025") return res.status(404).json({ success: false, message: "Staff not found" });
    res.status(500).json({ success: false, message: "Failed to update staff" });
  }
});

// PATCH /employees/staff/:id/schedule  { scheduleStartTime, scheduleEndTime, scheduleLabel }
router.patch("/staff/:id/schedule", async (req, res) => {
  try {
    const { scheduleStartTime, scheduleEndTime, scheduleLabel } = req.body;
    const staff = await prisma.staff.update({
      where: { id: req.params.id },
      data: { scheduleStartTime, scheduleEndTime, scheduleLabel },
    });
    res.json({ success: true, message: "Schedule updated", data: staff });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to update schedule" });
  }
});

router.patch("/staff/:id/rate", async (req, res) => {
  try {
    const { id } = req.params;
    const { rate } = req.body as { rate: number };
    if (typeof rate !== "number" || rate < 0) {
      return res.status(400).json({ success: false, message: "rate must be a non-negative number" });
    }
    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const open = await tx.rateHistory.findFirst({ where: { staffId: id, effectiveTo: null }, orderBy: { effectiveFrom: "desc" } });
      if (open) await tx.rateHistory.update({ where: { id: open.id }, data: { effectiveTo: now } });
      await tx.rateHistory.create({ data: { staffId: id, rate: new Decimal(rate.toString()), effectiveFrom: now, effectiveTo: null } });
      return tx.staff.update({ where: { id }, data: { hourlyRate: new Decimal(rate.toString()) } });
    });
    res.json({ success: true, message: "Rate updated", data: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to update rate" });
  }
});

router.get("/staff/:id/rate-history", async (req, res) => {
  try {
    const history = await prisma.rateHistory.findMany({ where: { staffId: req.params.id }, orderBy: { effectiveFrom: "desc" } });
    res.json({ success: true, data: history });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch rate history" });
  }
});

// ───────────── Open Shifts (overtime / events only) ─────────────

router.get("/open-shifts", async (req, res) => {
  try {
    const { startDate, endDate } = req.query as Record<string, string>;
    const shifts = await prisma.openShift.findMany({
      where: startDate && endDate ? { date: { gte: dateOnly(startDate), lte: dateOnly(endDate) } } : {},
      include: { assignments: { include: { staff: true } } },
      orderBy: { date: "asc" },
    });
    res.json({ success: true, data: shifts });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch open shifts" });
  }
});

// POST /employees/open-shifts/create
// body: { date, startTime, endTime, label, role, staffIds: string[] }
router.post("/open-shifts/create", async (req, res) => {
  try {
    const { date, startTime, endTime, label, role, staffIds } = req.body as {
      date: string; startTime: string; endTime: string; label: string; role: string; staffIds?: string[];
    };
    if (!date || !startTime || !endTime || !label || !role) {
      return res.status(400).json({ success: false, message: "date, startTime, endTime, label and role are required" });
    }

    const ids = staffIds ?? [];
    const staffMembers = ids.length ? await prisma.staff.findMany({ where: { id: { in: ids } } }) : [];

    const shift = await prisma.openShift.create({
      data: {
        date: dateOnly(date), startTime, endTime, label, role,
        assignments: {
          create: staffMembers.map((s) => ({ staffId: s.id, rateAtAssignment: s.hourlyRate ?? new Decimal(0) })),
        },
      },
      include: { assignments: { include: { staff: true } } },
    });

    res.status(201).json({ success: true, message: "Open shift created", data: shift });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to create open shift" });
  }
});

router.post("/open-shifts/:id/assign", async (req, res) => {
  try {
    const { id } = req.params;
    const { staffIds } = req.body as { staffIds: string[] };
    if (!staffIds?.length) return res.status(400).json({ success: false, message: "staffIds is required" });

    const staffMembers = await prisma.staff.findMany({ where: { id: { in: staffIds } } });
    await prisma.$transaction(
      staffMembers.map((s) =>
        prisma.openShiftAssignment.upsert({
          where: { openShiftId_staffId: { openShiftId: id, staffId: s.id } },
          create: { openShiftId: id, staffId: s.id, rateAtAssignment: s.hourlyRate ?? new Decimal(0) },
          update: {},
        })
      )
    );

    const shift = await prisma.openShift.findUnique({ where: { id }, include: { assignments: { include: { staff: true } } } });
    res.json({ success: true, message: "Staff assigned", data: shift });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to assign staff" });
  }
});

router.delete("/open-shifts/:id", async (req, res) => {
  try {
    await prisma.openShift.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Open shift deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to delete open shift" });
  }
});

// ───────────── Daily Attendance ─────────────

// GET /employees/attendance?date=YYYY-MM-DD
// Returns one row per non-Admin staff member for the day — creates a blank row on the
// fly (not persisted until a checkbox is actually ticked) so the table always shows
// everyone, even staff with no attendance yet today.
router.get("/attendance", async (req, res) => {
  try {
    const dateStr = req.query.date as string;
    if (!dateStr) return res.status(400).json({ success: false, message: "date is required" });
    const date = dateOnly(dateStr);

    const staff = await prisma.staff.findMany({ where: { role: { not: "Admin" } }, orderBy: { name: "asc" } });

    const existing = await prisma.dailyAttendance.findMany({
      where: { date },
      include: { openShiftAssignment: { include: { openShift: true } } },
    });
    const byStaffId = new Map(existing.map((e) => [e.staffId, e]));

    // Which staff have an open shift assignment today (so checkbox 3 can be shown)
    const todaysOpenAssignments = await prisma.openShiftAssignment.findMany({
      where: { openShift: { date } },
      include: { openShift: true },
    });
    const openAssignmentByStaffId = new Map(todaysOpenAssignments.map((a) => [a.staffId, a]));

    const data = staff.map((s) => {
      const row = byStaffId.get(s.id);
      const openAssignment = openAssignmentByStaffId.get(s.id);
      return {
        id: row?.id ?? null,
        staffId: s.id,
        staffName: s.name,
        staffRole: s.role,
        scheduleLabel: s.scheduleLabel,
        scheduleStartTime: s.scheduleStartTime,
        scheduleEndTime: s.scheduleEndTime,
        checkIn: row?.checkIn ?? null,
        checkOut: row?.checkOut ?? null,
        regularHours: row?.regularHours ?? null,
        regularWage: row?.regularWage ?? null,
        hasOpenShiftToday: !!openAssignment,
        openShiftAssignmentId: openAssignment?.id ?? row?.openShiftAssignmentId ?? null,
        openShiftLabel: openAssignment?.openShift.label ?? row?.openShiftAssignment?.openShift.label ?? null,
        openShiftAttended: row?.openShiftAttended ?? false,
        openShiftHours: row?.openShiftHours ?? null,
        openShiftWage: row?.openShiftWage ?? null,
        bonus: row?.bonus ?? 0,
        totalWage: row?.totalWage ?? null,
      };
    });

    res.json({ success: true, data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch attendance" });
  }
});

// POST /employees/attendance/check-in  { staffId, date }
router.post("/attendance/check-in", async (req, res) => {
  try {
    const { staffId, date } = req.body as { staffId: string; date: string };
    const staff = await prisma.staff.findUnique({ where: { id: staffId } });
    if (!staff) return res.status(404).json({ success: false, message: "Staff not found" });

    const now = new Date();
    const attendance = await prisma.dailyAttendance.upsert({
      where: { staffId_date: { staffId, date: dateOnly(date) } },
      create: { staffId, date: dateOnly(date), checkIn: now, rateUsed: staff.hourlyRate },
      update: { checkIn: now, rateUsed: staff.hourlyRate },
    });

    await prisma.staff.update({ where: { id: staffId }, data: { online: true } });

    res.json({ success: true, message: "Checked in", data: attendance });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to check in" });
  }
});

// POST /employees/attendance/check-out  { staffId, date }
router.post("/attendance/check-out", async (req, res) => {
  try {
    const { staffId, date } = req.body as { staffId: string; date: string };

    const attendance = await prisma.dailyAttendance.findUnique({ where: { staffId_date: { staffId, date: dateOnly(date) } } });
    if (!attendance?.checkIn) return res.status(400).json({ success: false, message: "Staff has not checked in yet" });
    if (attendance.checkOut) return res.status(400).json({ success: false, message: "Already checked out" });

    const checkOut = new Date();
    const rawHours = rawHoursBetween(attendance.checkIn, checkOut);
    const hours = roundHours(rawHours);
    const rate = Number(attendance.rateUsed ?? 0);
    const wage = Math.round(hours * rate * 100) / 100;
    const totalWage = Math.round((wage + Number(attendance.openShiftWage ?? 0) + Number(attendance.bonus)) * 100) / 100;

    const updated = await prisma.dailyAttendance.update({
      where: { id: attendance.id },
      data: {
        checkOut,
        regularHours: new Decimal(hours.toString()),
        regularWage: new Decimal(wage.toString()),
        totalWage: new Decimal(totalWage.toString()),
      },
    });

    await prisma.staff.update({ where: { id: staffId }, data: { online: false } });

    res.json({ success: true, message: "Checked out", data: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to check out" });
  }
});

router.patch("/attendance/times", async (req, res) => {
  try {
    const { staffId, date, checkIn, checkOut } = req.body as { staffId: string; date: string; checkIn?: string; checkOut?: string };
    if (!staffId || !date || (checkIn !== undefined && !/^\d{2}:\d{2}$/.test(checkIn)) || (checkOut !== undefined && !/^\d{2}:\d{2}$/.test(checkOut))) {
      return res.status(400).json({ success: false, message: "staffId, date, checkIn and checkOut are required" });
    }

    const existing = await prisma.dailyAttendance.findUnique({ where: { staffId_date: { staffId, date: dateOnly(date) } } });
    const staff = await prisma.staff.findUnique({ where: { id: staffId } });
    if (!staff) return res.status(404).json({ success: false, message: "Staff not found" });

    const checkInDate: Date | null = checkIn ? attendanceDateTime(date, checkIn) : existing?.checkIn ?? null;
    const checkOutDate: Date | null = checkOut ? attendanceDateTime(date, checkOut, checkInDate ?? undefined) : existing?.checkOut ?? null;
    if (!checkInDate && !checkOutDate) return res.status(400).json({ success: false, message: "At least one attendance time is required" });
    if (checkInDate && checkOutDate && (Number.isNaN(checkInDate.getTime()) || Number.isNaN(checkOutDate.getTime()) || checkOutDate <= checkInDate)) return res.status(400).json({ success: false, message: "Check-out must be after check-in" });

    const hours = checkInDate && checkOutDate ? roundHours(rawHoursBetween(checkInDate, checkOutDate)) : null;
    const rate = Number(existing?.rateUsed ?? staff.hourlyRate ?? 0);
    const regularWage = hours === null ? null : Math.round(hours * rate * 100) / 100;
    const totalWage = regularWage === null ? Number(existing?.totalWage ?? 0) : Math.round((regularWage + Number(existing?.openShiftWage ?? 0) + Number(existing?.bonus ?? 0)) * 100) / 100;
    const attendance = await prisma.dailyAttendance.upsert({
      where: { staffId_date: { staffId, date: dateOnly(date) } },
      create: { staffId, date: dateOnly(date), checkIn: checkInDate, checkOut: checkOutDate, rateUsed: staff.hourlyRate, regularHours: hours === null ? null : new Decimal(hours.toString()), regularWage: regularWage === null ? null : new Decimal(regularWage.toString()), totalWage: hours === null ? null : new Decimal(totalWage.toString()) },
      update: { ...(checkIn ? { checkIn: checkInDate } : {}), ...(checkOut ? { checkOut: checkOutDate } : {}), ...(hours === null ? {} : { regularHours: new Decimal(hours.toString()), regularWage: new Decimal(regularWage!.toString()), totalWage: new Decimal(totalWage.toString()) }) },
    });

    res.json({ success: true, message: "Attendance times updated", data: attendance });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to update attendance times" });
  }
});

// POST /employees/attendance/open-shift-toggle  { staffId, date, attended: boolean, openShiftAssignmentId }
// Checkbox 3 — hours come from the OpenShift's fixed startTime/endTime, not manual clock.
router.post("/attendance/open-shift-toggle", async (req, res) => {
  try {
    const { staffId, date, attended, openShiftAssignmentId } = req.body as {
      staffId: string; date: string; attended: boolean; openShiftAssignmentId: string;
    };

    const assignment = await prisma.openShiftAssignment.findUnique({
      where: { id: openShiftAssignmentId },
      include: { openShift: true },
    });
    if (!assignment) return res.status(404).json({ success: false, message: "Open shift assignment not found" });

    let openShiftHours = 0;
    let openShiftWage = 0;
    if (attended) {
      const rawHours = timeStringToHours(assignment.openShift.endTime) - timeStringToHours(assignment.openShift.startTime);
      openShiftHours = roundHours(rawHours < 0 ? rawHours + 24 : rawHours);
      openShiftWage = Math.round(openShiftHours * Number(assignment.rateAtAssignment) * 100) / 100;
    }

    const existing = await prisma.dailyAttendance.findUnique({ where: { staffId_date: { staffId, date: dateOnly(date) } } });
    const regularWage = Number(existing?.regularWage ?? 0);
    const bonus = Number(existing?.bonus ?? 0);
    const totalWage = Math.round((regularWage + openShiftWage + bonus) * 100) / 100;

    const attendance = await prisma.dailyAttendance.upsert({
      where: { staffId_date: { staffId, date: dateOnly(date) } },
      create: {
        staffId, date: dateOnly(date),
        openShiftAssignmentId, openShiftAttended: attended,
        openShiftHours: attended ? new Decimal(openShiftHours.toString()) : null,
        openShiftWage: attended ? new Decimal(openShiftWage.toString()) : null,
        totalWage: new Decimal(totalWage.toString()),
      },
      update: {
        openShiftAssignmentId, openShiftAttended: attended,
        openShiftHours: attended ? new Decimal(openShiftHours.toString()) : null,
        openShiftWage: attended ? new Decimal(openShiftWage.toString()) : null,
        totalWage: new Decimal(totalWage.toString()),
      },
    });

    res.json({ success: true, message: "Open shift attendance updated", data: attendance });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to update open shift attendance" });
  }
});

// PATCH /employees/attendance/bonus  { staffId, date, bonus }
// Can be set same-day or retroactively (e.g. end of month).
router.patch("/attendance/bonus", async (req, res) => {
  try {
    const { staffId, date, bonus } = req.body as { staffId: string; date: string; bonus: number };
    if (typeof bonus !== "number" || bonus < 0) {
      return res.status(400).json({ success: false, message: "bonus must be a non-negative number" });
    }

    const existing = await prisma.dailyAttendance.findUnique({ where: { staffId_date: { staffId, date: dateOnly(date) } } });
    const regularWage = Number(existing?.regularWage ?? 0);
    const openShiftWage = Number(existing?.openShiftWage ?? 0);
    const totalWage = Math.round((regularWage + openShiftWage + bonus) * 100) / 100;

    const attendance = await prisma.dailyAttendance.upsert({
      where: { staffId_date: { staffId, date: dateOnly(date) } },
      create: { staffId, date: dateOnly(date), bonus: new Decimal(bonus.toString()), totalWage: new Decimal(totalWage.toString()) },
      update: { bonus: new Decimal(bonus.toString()), totalWage: new Decimal(totalWage.toString()) },
    });

    res.json({ success: true, message: "Bonus updated", data: attendance });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to update bonus" });
  }
});

// ───────────── Wage Reports ─────────────

// GET /employees/wages/daily?date=YYYY-MM-DD  — same shape as /attendance, kept as an alias
router.get("/wages/daily", async (req, res) => {
  const date = encodeURIComponent(String(req.query.date ?? ""));
  res.redirect(307, `/employees/attendance?date=${date}`);
});

// GET /employees/wages/weekly?startDate=YYYY-MM-DD  (7-day window starting startDate)
router.get("/wages/weekly", async (req, res) => {
  try {
    const startDate = req.query.startDate as string;
    if (!startDate) return res.status(400).json({ success: false, message: "startDate is required" });
    const start = dateOnly(startDate);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);

    const rows = await prisma.dailyAttendance.findMany({
      where: { date: { gte: start, lte: end } },
      include: { staff: true },
    });

    const byStaff = new Map<string, { staffId: string; staffName: string; totalHours: number; totalWage: number; daysWorked: number }>();
    for (const r of rows) {
      const entry = byStaff.get(r.staffId) ?? { staffId: r.staffId, staffName: r.staff.name, totalHours: 0, totalWage: 0, daysWorked: 0 };
      entry.totalHours += Number(r.regularHours ?? 0) + Number(r.openShiftHours ?? 0);
      entry.totalWage += Number(r.totalWage ?? 0);
      if (r.checkIn) entry.daysWorked += 1;
      byStaff.set(r.staffId, entry);
    }

    const data = [...byStaff.values()].map((e) => ({
      ...e, totalHours: Math.round(e.totalHours * 100) / 100, totalWage: Math.round(e.totalWage * 100) / 100,
    })).sort((a, b) => b.totalWage - a.totalWage);

    const grandTotalWage = data.reduce((s, d) => s + d.totalWage, 0);
    const grandTotalHours = data.reduce((s, d) => s + d.totalHours, 0);

    res.json({ success: true, data, meta: { grandTotalWage, grandTotalHours, startDate: start, endDate: end } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch weekly wage report" });
  }
});

// GET /employees/wages/monthly?year=2026&month=1
router.get("/wages/monthly", async (req, res) => {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (!year || !month) return res.status(400).json({ success: false, message: "year and month are required" });

    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    const rows = await prisma.dailyAttendance.findMany({
      where: { date: { gte: monthStart, lte: monthEnd } },
      include: { staff: true },
    });

    const byStaff = new Map<string, { staffId: string; staffName: string; totalHours: number; totalWage: number; daysWorked: number }>();
    for (const r of rows) {
      const entry = byStaff.get(r.staffId) ?? { staffId: r.staffId, staffName: r.staff.name, totalHours: 0, totalWage: 0, daysWorked: 0 };
      entry.totalHours += Number(r.regularHours ?? 0) + Number(r.openShiftHours ?? 0);
      entry.totalWage += Number(r.totalWage ?? 0);
      if (r.checkIn) entry.daysWorked += 1;
      byStaff.set(r.staffId, entry);
    }

    const data = [...byStaff.values()].map((e) => ({
      ...e, totalHours: Math.round(e.totalHours * 100) / 100, totalWage: Math.round(e.totalWage * 100) / 100,
    })).sort((a, b) => b.totalWage - a.totalWage);

    const grandTotalWage = data.reduce((s, d) => s + d.totalWage, 0);
    const grandTotalHours = data.reduce((s, d) => s + d.totalHours, 0);

    res.json({ success: true, data, meta: { grandTotalWage, grandTotalHours } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch monthly wage report" });
  }
});

// GET /employees/wages/yearly?year=2026
router.get("/wages/yearly", async (req, res) => {
  try {
    const year = Number(req.query.year);
    if (!year) return res.status(400).json({ success: false, message: "year is required" });

    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    const rows = await prisma.dailyAttendance.findMany({ where: { date: { gte: yearStart, lte: yearEnd } } });

    // Per-month breakdown (for a chart) + grand totals
    const byMonth = new Map<number, { month: number; totalHours: number; totalWage: number }>();
    for (let m = 1; m <= 12; m++) byMonth.set(m, { month: m, totalHours: 0, totalWage: 0 });

    for (const r of rows) {
      const m = r.date.getUTCMonth() + 1;
      const entry = byMonth.get(m)!;
      entry.totalHours += Number(r.regularHours ?? 0) + Number(r.openShiftHours ?? 0);
      entry.totalWage += Number(r.totalWage ?? 0);
    }

    const monthly = [...byMonth.values()].map((e) => ({
      ...e, totalHours: Math.round(e.totalHours * 100) / 100, totalWage: Math.round(e.totalWage * 100) / 100,
    }));

    const grandTotalWage = monthly.reduce((s, m) => s + m.totalWage, 0);
    const grandTotalHours = monthly.reduce((s, m) => s + m.totalHours, 0);

    res.json({ success: true, data: monthly, meta: { grandTotalWage, grandTotalHours } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch yearly wage report" });
  }
});

export default router;