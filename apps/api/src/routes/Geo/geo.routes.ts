import { Router } from "express";
import { getPincodeLocation } from "../../controllers/Geo/pincode.controller";

const router = Router();

// Public: the address fields exist on forms used before/without a session, and
// the response carries only the public state/district for a PIN code.
router.get("/pincode/:pincode", getPincodeLocation);

export default router;
