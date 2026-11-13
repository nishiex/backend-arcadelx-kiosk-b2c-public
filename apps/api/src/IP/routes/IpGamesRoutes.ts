import { Router } from 'express';
import {requireAuth,loadMembership,requireOrgType,requireRole,} from '../../middlewares/auth';
import {getAvailableObservedGameIds,createIpGame,getMyGames,getIpPartyGames,} from '../controllers/IpGame';

const router = Router();
// Company Dashboard
/* GET /api/ip/games/:ipOrgId/available-identifiers : Fetch unassigned game IDs observed in incoming transactions for this IP Party's sourceKey.//
  Excludes IDs already registered in IpGames
 */
// IP Dashboard 
// GET /api/ip/games/my-games : Get My games , which are registerd by the Company
router.get('/games/my-games',requireAuth,loadMembership,requireOrgType('IP_PARTY'),getMyGames);

router.get('/games/:ipOrgId/available-identifiers',requireAuth,loadMembership,requireOrgType('COMPANY'),requireRole('OWNER', 'ADMIN', 'MANAGER'),getAvailableObservedGameIds);

// POST /api/ip/games/:ipOrgId/ :  Register a game for a specific IP Party from the Company dashboard.
router.post('/games/:ipOrgId/',requireAuth,loadMembership,requireOrgType('COMPANY'),requireRole('OWNER', 'ADMIN'),createIpGame);

//  GET /api/ip/games/:ipOrgId: Company dashboard: View all games registered for a specific IP Party.
router.get('/games/:ipOrgId',requireAuth,loadMembership,requireOrgType('COMPANY'),requireRole('OWNER', 'ADMIN', 'MANAGER'),getIpPartyGames);


export default router;
