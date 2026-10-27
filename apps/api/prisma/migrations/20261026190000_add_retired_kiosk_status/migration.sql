-- Keep deactivated kiosk records and assignment history while supporting the RETIRED status.
ALTER TYPE "KioskStatus" ADD VALUE IF NOT EXISTS 'RETIRED';
