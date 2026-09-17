import { Router } from 'express';
import { registerOrganization, joinOrganization, login ,refresh,getMe,resetPassword } from '../controllers/auth.controller';
import { requireAuth,loadMembership,requireCanCreateOrganization, } from '../middlewares/auth';

const router = Router();
router.post('/register',requireAuth,loadMembership,requireCanCreateOrganization,registerOrganization);

router.post('/join', joinOrganization);

router.post('/login', login);

router.post('/refresh', refresh);

router.get('/me', requireAuth, getMe);

router.post("/reset-password", resetPassword);

export default router;