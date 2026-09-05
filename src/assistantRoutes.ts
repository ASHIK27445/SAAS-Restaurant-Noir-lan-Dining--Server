import { Router } from "express";
import { RoleEnum } from "@prisma/client";
import { requireRole } from "./auth";
import { answerBusinessQuestion, detectAssistantIntent } from "./assistantService";

const router = Router();

router.post("/ask", requireRole(RoleEnum.Admin, RoleEnum.Manager, RoleEnum.DemoAdmin), async (req, res) => {
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!question || question.length > 240) {
    return res.status(400).json({ success: false, message: "A question up to 240 characters is required" });
  }

  const intent = detectAssistantIntent(question);
  if (!intent) {
    return res.status(400).json({ success: false, message: "Try asking about revenue, top menu items, average order value, or order type" });
  }

  try {
    const data = await answerBusinessQuestion(question, intent);
    return res.json({ success: true, data });
  } catch (error) {
    console.error("Failed to answer business assistant question", error);
    return res.status(500).json({ success: false, message: "Failed to answer business question" });
  }
});

export default router;