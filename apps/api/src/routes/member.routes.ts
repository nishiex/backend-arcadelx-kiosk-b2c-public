import {Router} from "express";
import { generateInviteCode,getPendingRequests,handleJoinRequest,updateMemberRole,removeMember } from "../controllers/membership.controller";
import { requireAuth,loadMembership,requireRole } from "../middlewares/auth";

const router = Router()

// All routes here require the user to be authenticated and have an active membership
router.use(requireAuth,loadMembership)
router.use(requireRole("OWNER","ADMIN"));

router.post("/generateInviteCode", generateInviteCode)
router.get("/requests",getPendingRequests);
router.post('/requests/:membershipId', handleJoinRequest);
router.patch('/:membershipId/role', updateMemberRole);
router.delete('/:membershipId', removeMember);

export default router;

