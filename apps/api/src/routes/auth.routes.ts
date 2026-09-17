import { Router } from 'express';
import { registerOrganization, joinOrganization, login ,refresh,getMe,changePassword,forgotPassword,verifyResetOtp,completeForgotPassword } from '../controllers/auth.controller';
import { requireAuth,loadMembership,requireCanCreateOrganization, } from '../middlewares/auth';

const router = Router();
router.post('/register',requireAuth,loadMembership,requireCanCreateOrganization,registerOrganization);

router.post('/join', joinOrganization);

router.post('/login', login);

router.post('/refresh', refresh);

router.get('/me', requireAuth, getMe);

router.post("/change-password",requireAuth,changePassword);

router.post("/forgot-password",forgotPassword);
router.post("/verify-reset-otp", verifyResetOtp);
router.post("/reset-password", completeForgotPassword);


export default router;