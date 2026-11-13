import { Router } from 'express';
import {requireAuth,loadMembership,requireOrgType,requireRole,} from '../../middlewares/auth';
import {getIpDailyRevenue,getIpDailyRevenueForParty,triggerDailyRevenueAggregation,} from '../controllers/IpDailyRevenue';

const router = Router();

/**
 * IP DASHBOARD:
 * Read-only daily revenue for authenticated IP Party.
 * GET /api/ip/revenue/daily?date=YYYY-MM-DD
 */
router.get('/daily',requireAuth,loadMembership,requireOrgType('IP_PARTY'),getIpDailyRevenue);

/**
 * COMPANY DASHBOARD:
 * View daily revenue for a specific IP Party.
 * GET /api/ip/revenue/:ipOrgId/daily?date=YYYY-MM-DD
 */
router.get('/:ipOrgId/daily',requireAuth,loadMembership,requireOrgType('COMPANY'),requireRole('OWNER', 'ADMIN', 'MANAGER'),getIpDailyRevenueForParty);

/**
 * COMPANY DASHBOARD / INTERNAL:
 * On-demand aggregation and reconciliation trigger.
 * POST /api/ip/revenue/daily/aggregate
 * (CRITICAL : JSUT FOR TESTING , REMOVE AFTER PROD DEPLOYMENT)
 */
router.post('/daily/aggregate',requireAuth,loadMembership,requireOrgType('COMPANY'),requireRole('OWNER', 'ADMIN'),triggerDailyRevenueAggregation);

export default router;

