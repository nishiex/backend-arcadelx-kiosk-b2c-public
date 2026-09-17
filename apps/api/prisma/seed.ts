
// to  be changed by actual values in PROD

import bcrypt from "bcryptjs";
import { prisma } from "../src/utils/db";

async function main() {
  const companyEmail = "nileegames@gmail.com";
  const companyPassword = "Nilee@123";

  // Don't create another company if one already exists
  const existingCompany = await prisma.organization.findFirst({
    where: {
      type: "COMPANY",
    },
  });

  if (existingCompany) {
    console.log("Company already exists:", existingCompany.id);
    return
}

  const passwordHash = await bcrypt.hash(companyPassword, 10);

  const { user, organization } = await prisma.$transaction(
    async (tx) => {
      const user = await tx.user.create({
        data: {
          name: "Anand Jha",
          email: companyEmail,
          passwordHash,
        },
      });

      const organization = await tx.organization.create({
        data: {
          name: "NileeGames test",
          type: "COMPANY",
          state: "Maharashtra",
          city: "Mumbai",
          pincode: 400092,
          address: "508, 5th Floor, Fly Edge Building,Swami Vivekanand Road, Meghdoot, Hari Om Nagar,Borivali West, Mumbai, Maharashtra",
          ownerId: user.id,
        },
      });

      await tx.membership.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: "OWNER",
          status: "ACTIVE",
        },
      });

      return {
        user,
        organization,
      };
    }
  );

  console.log("=================================");
  console.log("Company seeded successfully");
  console.log("=================================");
  console.log("Company ID:", organization.id);
  console.log("User ID:", user.id);
  console.log("Email:", companyEmail);
  console.log("Password:", companyPassword);
  console.log("=================================");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
