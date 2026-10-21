import { env } from "../../config/env";

type WhatsappOtpParams = {
  phone: string;
  otp: string;
};

const twilioBaseUrl = "https://api.twilio.com/2010-04-01/Accounts";

export const sendWhatsappOtp = async ({ phone, otp }: WhatsappOtpParams): Promise<void> => {
  const { TWILIO_ACCOUNT_SID: accountSid, TWILIO_AUTH_TOKEN: authToken, TWILIO_WHATSAPP_FROM: from } = env;

  if (!accountSid || !authToken || !from) {
    throw new Error("WhatsApp OTP provider is not configured");
  }

  const body = new URLSearchParams({
    To: `whatsapp:${phone}`,
    From: `whatsapp:${from}`,
    Body: `Your ArcadeLX verification code is ${otp}. It expires in 10 minutes.`,
  });

  const response = await fetch(`${twilioBaseUrl}/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`WhatsApp OTP provider rejected the message (${response.status})`);
  }
};
