import { permanentRedirect } from "next/navigation"

/** Keeps bookmarks and links to the former Devices URL working. */
export default function DevicesRedirectPage() {
  permanentRedirect("/device-management")
}
