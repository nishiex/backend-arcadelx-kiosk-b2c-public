import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import { isPincodeFormat, lookupPincode } from "../../services/pincode.service";

/**
 * Resolve one PIN code to its state and district for the registration forms.
 * Public on purpose: the same fields exist on organization forms that are
 * reached before a session exists, and the response contains no user data.
 */
export const getPincodeLocation = asyncHandler(async (req, res) => {
  const pincode = req.params.pincode;
  if (typeof pincode !== "string" || !isPincodeFormat(pincode)) {
    throw new ApiError(400, "Enter a valid 6-digit PIN code");
  }
  const location = await lookupPincode(pincode);
  if (!location) {
    throw new ApiError(404, "No location found for this PIN code");
  }
  res
    .status(200)
    .json(new ApiResponse(200, { location }, "PIN code location fetched"));
});
