CREATE TYPE "PaymentMethod" AS ENUM ('RAZORPAY', 'CASH');

ALTER TABLE "Order"
  ADD COLUMN "paymentMethod" "PaymentMethod",
  ADD COLUMN "cashPaymentRequestedAt" TIMESTAMP(3);
