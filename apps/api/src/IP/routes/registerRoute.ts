import { Router } from 'express';
import { requireAuth, loadMembership, requireOrgType, requireRole } from '../../middlewares/auth';
import { registerIpParty, changeIpPercentage, getIpParties } from '../controllers/RegisterIp';
import { getIpDailyRevenue, getIpDailyRevenueForParty } from '../controllers/IpDailyRevenue';

const router = Router();

// POST /api/ip/register : Onboard a new IP Party with Owner User, Membership, Profile, and Active Agreement in a single atomic transaction. 
router.post('/register', requireAuth, loadMembership, requireOrgType('COMPANY'), requireRole('OWNER', 'ADMIN'), registerIpParty);

// GET /api/ip/parties : List registered IP Parties with active agreements, profiles
router.get('/parties', requireAuth, loadMembership, requireOrgType('COMPANY'), requireRole('OWNER', 'ADMIN', 'MANAGER'), getIpParties);

// GET /api/ip/revenue/daily : IP Dashboard read-only daily revenue
router.get('/revenue/daily', requireAuth, loadMembership, requireOrgType('IP_PARTY'), getIpDailyRevenue);

// GET /api/ip/:ipOrgId/revenue/daily : Company Dashboard view IP Party daily revenue
router.get('/:ipOrgId/revenue/daily', requireAuth, loadMembership, requireOrgType('COMPANY'), requireRole('OWNER', 'ADMIN', 'MANAGER'), getIpDailyRevenueForParty);

// PATCH /api/ip/:ipOrgId/percentage : Adjust IP royalty percentage. Atomically terminates prior agreement and creates new active agreement.
router.patch('/:ipOrgId/percentage', requireAuth, loadMembership, requireOrgType('COMPANY'), requireRole('OWNER', 'ADMIN'), changeIpPercentage);

export default router;
