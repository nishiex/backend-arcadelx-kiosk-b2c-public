import { Router } from 'express';
import { registerOrganization, joinOrganization, login ,refresh,getMe } from '../controllers/auth.controller';
import { requireAuth, } from '../middlewares/auth';

const router = Router();

router.post('/register', registerOrganization);
router.post('/join', joinOrganization);
router.post('/login', login);
router.post("/refresh",refresh)
// For Frontend
router.get('/me', requireAuth, getMe);


export default router;