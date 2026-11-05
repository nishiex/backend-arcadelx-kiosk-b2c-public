import {Router} from "express";
import { generateInviteCode,getActiveMembers,getPendingRequests,handleJoinRequest,updateMemberRole,removeMember } from "../controllers/membership.controller";
import {requireAuth,loadMembership,requireRole,requireOrgType,} from "../middlewares/auth";

const router = Router();

router.use(requireAuth, loadMembership);

//ONLY THE COMPANY CAN CREATE MEMBERS
router.use(requireOrgType("COMPANY"),requireRole("OWNER", "ADMIN"));

router.post("/generateInviteCode", generateInviteCode);

router.get("/", getActiveMembers);

router.get("/requests", getPendingRequests);

router.post("/requests/:membershipId",handleJoinRequest);

router.patch("/:membershipId/role",updateMemberRole);

router.delete("/:membershipId",removeMember);

export default router;

