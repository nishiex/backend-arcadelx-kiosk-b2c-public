import { Router } from 'express';
import {requireAuth,loadMembership,requireOrgType,requireRole,} from '../../middlewares/auth';
import {getAvailableObservedGameIds,createIpGame,getMyGames,getIpPartyGames,} from '../controllers/IpGame';
import {assignKiosksToIpGame,removeKiosksFromIpGame,getKiosksForIpGame,getIpGamesForKiosk,} from '../controllers/IpGameKiosk';

const router = Router();

// ---------------------------------------------------------------------------
// IP Dashboard (IP_PARTY)
// ---------------------------------------------------------------------------

// GET /api/ip/games/my-games : Get My games , which are registered by the Company
router.get('/games/my-games', requireAuth, loadMembership, requireOrgType('IP_PARTY'), getMyGames);

// ---------------------------------------------------------------------------
// Company Dashboard
// ---------------------------------------------------------------------------

/* GET /api/ip/games/:ipOrgId/available-identifiers : Fetch unassigned game IDs observed in
   incoming transactions for this IP Party's sourceKey. Excludes IDs already registered in IpGames */
router.get(
  '/games/:ipOrgId/available-identifiers',
  requireAuth, loadMembership,
  requireOrgType('COMPANY'),
  requireRole('OWNER', 'ADMIN', 'MANAGER'),
  getAvailableObservedGameIds,
);

// POST /api/ip/games/:ipOrgId/ : Register a game for a specific IP Party from the Company dashboard.
router.post(
  '/games/:ipOrgId/',
  requireAuth, loadMembership,
  requireOrgType('COMPANY'),
  requireRole('OWNER', 'ADMIN'),
  createIpGame,
);

// GET /api/ip/games/:ipOrgId : Company dashboard: View all games registered for a specific IP Party.
router.get(
  '/games/:ipOrgId',
  requireAuth, loadMembership,
  requireOrgType('COMPANY'),
  requireRole('OWNER', 'ADMIN', 'MANAGER'),
  getIpPartyGames,
);

// ---------------------------------------------------------------------------
// Kiosk ↔ IP Game connections
// ---------------------------------------------------------------------------

// POST   /api/ip/games/:ipGameId/kiosks  - Assign kiosks to a game  (Company OWNER/ADMIN)
router.post(
  '/games/:ipGameId/kiosks',
  requireAuth, loadMembership,
  requireOrgType('COMPANY'),
  requireRole('OWNER', 'ADMIN'),
  assignKiosksToIpGame,
);

// DELETE /api/ip/games/:ipGameId/kiosks  - Remove kiosks from a game (Company OWNER/ADMIN)
router.delete(
  '/games/:ipGameId/kiosks',
  requireAuth, loadMembership,
  requireOrgType('COMPANY'),
  requireRole('OWNER', 'ADMIN'),
  removeKiosksFromIpGame,
);

// GET    /api/ip/games/:ipGameId/kiosks  - List kiosks for a game  (Company + IP_PARTY)
router.get(
  '/games/:ipGameId/kiosks',
  requireAuth, loadMembership,
  requireOrgType('COMPANY', 'IP_PARTY'),
  getKiosksForIpGame,
);

// GET    /api/ip/kiosks/:kioskId/games   - List all IP games a kiosk is connected to (Company)
router.get(
  '/kiosks/:kioskId/games',
  requireAuth, loadMembership,
  requireOrgType('COMPANY'),
  getIpGamesForKiosk,
);

export default router;
