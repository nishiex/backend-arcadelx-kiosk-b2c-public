import Mailjet from "node-mailjet";

const mailjet = Mailjet.apiConnect(process.env.MAILJET_API_KEY!,process.env.MAILJET_SECRET_KEY!);

type SendEmailParams = {
  to: string;
  toName?: string;
  subject: string;
  text: string;
  html: string;
};

export const sendEmail = async ({to,toName,subject,text,html,}: SendEmailParams) => {
  const request = await mailjet.post("send", { version: "v3.1" })
    .request({
      Messages: [
        {
          From: {
            Email: process.env.MAIL_FROM_EMAIL!,
            Name: process.env.MAIL_FROM_NAME!,
          },

          To: [
            {
              Email: to,
              Name: toName ,
            },
          ],
          Subject: subject,
          TextPart: text,
          HTMLPart: html,
        },
      ],
    });

  return request.body;
};
