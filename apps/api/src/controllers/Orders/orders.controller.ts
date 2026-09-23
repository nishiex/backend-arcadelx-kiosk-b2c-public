import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../utils/db';
import { ApiError } from '../../utils/ApiError';
import { ApiResponse } from '../../utils/ApiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { generateInvoicePDF,INVOICES_DIR } from '../../services/pdf/invoice.pdf';
import { sendEmail } from '../../services/email/email.service';
import { CreateOrderSchema } from '@shared-types/validationSchemas/Orders/order.validation'

const reserveKiosks = async (tx: any,orgId: string,quantity: number,orderId: string) => {
  const availableKiosks = await tx.kiosk.findMany({
    where: {
      currentOrgId: orgId,
      status: 'AVAILABLE',
    },
    orderBy: {
      createdAt: 'asc',
    },
    take: quantity,
    select: {
      id: true,
      machineCode: true,
    },
  });

  if (availableKiosks.length < quantity) throw new ApiError(400,`Insufficient inventory. Available: ${availableKiosks.length}, Requested: ${quantity}.`);
  
  const kioskIds = availableKiosks.map((kiosk: any) => kiosk.id);

  await tx.kiosk.updateMany({
    where: {
      id: {
        in: kioskIds,
      },
      status: 'AVAILABLE',
    },
    data: {
      status: 'RESERVED',
    },
  });

  await tx.orderKiosk.createMany({
    data: kioskIds.map((kioskId: string) => ({
      orderId,
      kioskId,
    })),
  });

  return availableKiosks;
};

export const createOrder = asyncHandler(async (req: Request, res: Response) => {
  const { type, targetOrgId, quantity } = CreateOrderSchema.parse(req.body);
  const currentOrgId = req.membership!.organizationId;
  const currentOrgType = req.membership!.type;

  // 1. RBAC Gate: Partners cannot initiate orders of any kind
  if (currentOrgType === 'PARTNER') throw new ApiError(403, 'Partners are not authorized to create or request orders');

  // Determine direction based on action type
  const parentOrgId = type === 'REQUEST' ? targetOrgId : currentOrgId;
  const childOrgId = type === 'REQUEST' ? currentOrgId : targetOrgId;

  // 2. Active Agreement Gate
  const agreement = await prisma.agreement.findFirst({
    where: {
      parentOrgId,
      childOrgId,
      status: 'ACTIVE'
    },
    include: {
      parentOrg: true,
      childOrg: true
    }
  });

  if (!agreement) throw new ApiError(403, 'Cannot create order: No active agreement exists between these organizations');

  // 3. Financial Math (Inherited strictly from the agreement)
  const depositPerMachine = Number(agreement.depositAmountPerMachine);
  const nonRefundablePerMachine = Number(agreement.nonRefundableAmountPerMachine);

  const totalDeposit = depositPerMachine * quantity;
  const totalNonRefundable = nonRefundablePerMachine * quantity;
  const taxAmount = totalNonRefundable * 0.18; // 18% GST only on non-refundable
  const grandTotal = totalDeposit + totalNonRefundable + taxAmount;

 // 4 & 5. Generate Order Number and Save to Database (Wrapped in Transaction)
  const currentYear = new Date().getFullYear();
  
  const order = await prisma.$transaction(async (tx) => {
  // For ALLOCATION, inventory must be available immediately.
  if (type === 'ALLOCATION') {
    const availableCount = await tx.kiosk.count({
      where: {
        currentOrgId: parentOrgId,
        status: 'AVAILABLE',
      },
    });

    if (availableCount < quantity) throw new ApiError(400,`Insufficient inventory. Available: ${availableCount}, Requested: ${quantity}.`);
  }

  const currentYear = new Date().getFullYear();

  const lastOrder = await tx.order.findFirst({
    where: {
      orderNumber: {
        startsWith: `ORD-${currentYear}-`,
      },
    },
    orderBy: {
      orderNumber: 'desc',
    },
    select: {
      orderNumber: true,
    },
  });

  let nextSeq = 1;

  if (lastOrder) {
    const lastSeq = parseInt(
      lastOrder.orderNumber.split('-')[2]!,
      10
    );
    nextSeq = lastSeq + 1;
  }

  const orderNumber = `ORD-${currentYear}-${String(nextSeq).padStart(5, '0')}`;

  const createdOrder = await tx.order.create({
    data: {
      orderNumber,
      type,
      status: type === 'ALLOCATION' ? 'APPROVED' : 'UNDER_REVIEW',
      parentOrgId,
      childOrgId,
      agreementId: agreement.id,
      quantity,
      depositPerMachine,
      nonRefundablePerMachine,
      totalDeposit,
      totalNonRefundable,
      taxAmount,
      grandTotal,
    },
  });

  // ALLOCATION reserves immediately.
  if (type === 'ALLOCATION') {
    await reserveKiosks(
      tx,
      parentOrgId,
      quantity,
      createdOrder.id
    );
  }

  return createdOrder;
});
  // If it is just a request, stop here. The Company will generate the invoice upon approval.
  if (type === 'REQUEST') {
    return res.status(201).json(new ApiResponse(201, { order }, 'Order requested successfully. Pending approval.'));
  }
  
  // If the Parent is actively allocating machines, generate and send the invoice immediately.
  // 6. Generate the physical PDF on the VPS
  const invoiceFilename = await generateInvoicePDF({
    orderNumber:order.orderNumber,
    parentOrgName: agreement.parentOrg.name,
    childOrgName: agreement.childOrg.name,
    quantity,
    depositPerMachine,
    nonRefundablePerMachine,
    totalDeposit,
    totalNonRefundable,
    taxAmount,
    grandTotal,
    date: order.createdAt
  });
const invoiceUrl = `/orders/${order.id}/invoice`;; // To be served via Express static files

  // 7. Update Order with the invoice URL
  await prisma.order.update({
    where: { id: order.id },
    data: { invoiceUrl,
            invoiceFilename,
     }
  });

  // 8. Dispatch Email with the generated PDF attached
  const pdfBuffer = fs.readFileSync(path.join(INVOICES_DIR, invoiceFilename));
  
  //find the childOrganization email to send him the reciept
  const organization = await prisma.organization.findUnique({
  where: {
    id: childOrgId,
  },
  select: {
    owner: {
      select: {
        email: true,
      },
    },
  },
});

const ChildEmail = organization?.owner?.email;

  await sendEmail({
    to: ChildEmail!, // Assuming child gets the invoice to pay/review
    subject: `New ArcadeLX Order Invoice: ${order.orderNumber}`,
    text: `An order for ${quantity} kiosks has been drafted. The grand total is ₹${grandTotal.toFixed(2)}. Please review the attached invoice.`,
    html: `<h3>Order ${order.orderNumber} Drafted</h3><p>An order for <b>${quantity}</b> kiosks has been created. Total amount: <b>₹${grandTotal.toFixed(2)}</b>.</p>`,
    attachment: {
      filename: invoiceFilename,
      base64Content: pdfBuffer.toString('base64'),
      contentType: 'application/pdf'
    }
  });

  res.status(201).json(new ApiResponse(201, { order: { ...order, invoiceUrl } }, 'Order created and invoice generated successfully'));
});

export const approveOrder = asyncHandler(async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const currentOrgId = req.membership!.organizationId;

  /* 1. Get the order*/
  const order = await prisma.order.findUnique({
    where: {
      id: orderId as string,
    },
    include: {
      parentOrg: true,
      childOrg: {
        select: {
          name: true,
          owner: {
            select: {
              email: true,
            },
          },
        },
      },
    },
  });

  if (!order) throw new ApiError(404, 'Order not found');

  /*2. Only the parent organization can approve*/
  if (order.parentOrgId !== currentOrgId) throw new ApiError(403, 'Unauthorized to approve this order')

  /* 3. Order must be awaiting approval */
  if (order.status !== 'UNDER_REVIEW') throw new ApiError(400, `Cannot approve an order that is currently ${order.status}`);

  /* 4. Reserve inventory + approve order atomically */
  const approvedOrder = await prisma.$transaction(async (tx) => {

    await reserveKiosks(tx,order.parentOrgId,order.quantity,order.id);

    const updatedOrder = await tx.order.update({
      where: {
        id: order.id,
      },
      data: {
        status: 'APPROVED',
        paymentStatus: 'PENDING',
      },
      include: {
        dispatchedKiosks: {
          include: {
            kiosk: {
              select: {
                id: true,
                machineCode: true,
                status: true,
              },
            },
          },
        },
      },
    });

    return updatedOrder;
  });

  /* 5. Generate invoice AFTER successful inventory reservation
   */
  const invoiceFilename = await generateInvoicePDF({
    orderNumber: approvedOrder.orderNumber,
    parentOrgName: order.parentOrg.name,
    childOrgName: order.childOrg.name,
    quantity: approvedOrder.quantity,
    depositPerMachine: approvedOrder.depositPerMachine,
    nonRefundablePerMachine: approvedOrder.nonRefundablePerMachine,
    totalDeposit: approvedOrder.totalDeposit,
    totalNonRefundable: approvedOrder.totalNonRefundable,
    taxAmount: approvedOrder.taxAmount,
    grandTotal: approvedOrder.grandTotal,
    date: new Date(),
  });

  /* Protected API URL.*/
  const invoiceUrl = `/orders/${approvedOrder.id}/invoice`;

  /* 6. Save invoice URL */
  const updatedOrder = await prisma.order.update({
    where: {
      id: approvedOrder.id,
    },
    data: {
      invoiceUrl,
      invoiceFilename,
    },
  });

  /* 7. Read PDF for email*/
  const pdfBuffer = fs.readFileSync(
    path.join(INVOICES_DIR, invoiceFilename)
  );

  /*8. Email invoice*/
  await sendEmail({
    to: order.childOrg.owner.email,
    subject: `Order Approved: Invoice for ${order.orderNumber}`,
    text: `Your request for ${order.quantity} kiosks has been approved. The grand total is ₹${order.grandTotal.toFixed(2)}. Please review the attached invoice to proceed.`,
    html: `
      <h3>Order ${order.orderNumber} Approved</h3>
      <p>
        Your request for <b>${order.quantity}</b> kiosks has been approved.
        Total amount due:
        <b>₹${order.grandTotal.toFixed(2)}</b>.
      </p>
    `,
    attachment: {
      filename: invoiceFilename,
      base64Content: pdfBuffer.toString('base64'),
      contentType: 'application/pdf',
    },
  });

  /*9. Response*/
  return res.status(200).json(new ApiResponse(200,
      {
        order: updatedOrder,
      },
      'Order approved, kiosks reserved, and invoice dispatched to the client'
    )
  );
});

export const getOrderInvoice = asyncHandler(async (req: Request, res: Response) => {
    const { orderId } = req.params;
    const currentOrgId = req.membership!.organizationId;

    const order = await prisma.order.findUnique({
      where: {
        id: orderId as string,
      },
      select: {
        id: true,
        parentOrgId: true,
        childOrgId: true,
        invoiceFilename: true,
        orderNumber: true,
      },
    });

    if (!order) throw new ApiError(404, 'Order not found');
    
    // Only organizations involved in the order can access the invoice.
    if (order.parentOrgId !== currentOrgId && order.childOrgId !== currentOrgId ) throw new ApiError(403,'Unauthorized to access this invoice');
    

    if (!order.invoiceFilename) throw new ApiError(404,'Invoice has not been generated yet');

    const invoicePath = path.join(INVOICES_DIR,order.invoiceFilename);

    if (!fs.existsSync(invoicePath)) throw new ApiError(404,'Invoice file not found');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',`inline; filename="${order.invoiceFilename}"`);

    return res.sendFile(invoicePath);
  }
);

//Route for Frontend
export const getOrderRequests = asyncHandler(async (req: Request, res: Response) => {
  const currentOrgId = req.membership!.organizationId;
  const { status, type } = req.query;

  // Build dynamic filters based on query params
  const whereClause: any = {
    OR: [
      { parentOrgId: currentOrgId }, // Orders sent to this org for approval
      { childOrgId: currentOrgId }   // Orders created by this org
    ]
  };

  if (status) whereClause.status = status;
  if (type) whereClause.type = type;

  const orders = await prisma.order.findMany({
    where: whereClause,
    include: {
      parentOrg: { select: { id: true, name: true } },
      childOrg: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' }
  });

  res.status(200).json(new ApiResponse(200, { orders }, 'Order requests fetched successfully'));
});

export const markOrderAsPaid = asyncHandler(async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const currentOrgId = req.membership!.organizationId;

  const order = await prisma.order.findUnique({
    where: { id: orderId as string }
  });

  if (!order) throw new ApiError(404, 'Order not found');
  if (order.parentOrgId !== currentOrgId) throw new ApiError(403, 'Unauthorized to modify this order');
  
  // Guardrails
  if (order.status !== 'APPROVED') {
    throw new ApiError(400, `Cannot mark as paid. Order is currently ${order.status}`);
  }
  if (order.paymentStatus === 'PAID') {
    throw new ApiError(400, 'Order is already marked as paid');
  }

  const updatedOrder = await prisma.order.update({
    where: { id: orderId as string},
    data: { paymentStatus: 'PAID' }
  });

  res.status(200).json(new ApiResponse(200, { order: updatedOrder }, 'Payment verified. Order is now ready for dispatch.'));
});

export const dispatchOrder = asyncHandler(async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const currentOrgId = req.membership!.organizationId;

  const order = await prisma.order.findUnique({
    where: {
      id: orderId as string,
    },
    include: {
      dispatchedKiosks: true,
    },
  });

  if (!order) throw new ApiError(404, 'Order not found');

  if (order.parentOrgId !== currentOrgId) throw new ApiError(403,'Unauthorized to dispatch this order');

  if (order.status !== 'APPROVED') throw new ApiError(400,`Cannot dispatch an order that is currently ${order.status}. Must be APPROVED.`);

  if (order.paymentStatus !== 'PAID') throw new ApiError(402,'Cannot dispatch machines. Order payment status must be PAID.');

  const kioskIds = order.dispatchedKiosks.map((orderKiosk) => orderKiosk.kioskId);

  if (kioskIds.length === 0) throw new ApiError(400,'No kiosks are attached to this order');

  const updatedOrder = await prisma.$transaction(async (tx) => {

    const result = await tx.kiosk.updateMany({
      where: {
        id: {
          in: kioskIds,
        },
        status: 'RESERVED',
        currentOrgId: order.parentOrgId,
      },
      data: {
        status: 'ASSIGNED',
      },
    });

    if (result.count !== kioskIds.length) throw new ApiError(400,'Some kiosks are no longer reserved for this order');

    return await tx.order.update({
      where: {
        id: orderId as string,
      },
      data: {
        status: 'DISPATCHED',
      },
    });
  });

  return res.status(200).json(new ApiResponse(200,{order: updatedOrder,},'Order successfully dispatched. Machines are now in transit.'));
});

export const deliverOrder = asyncHandler(async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const currentOrgId = req.membership!.organizationId;
  const currentUserId = req.user!.id;

  const order = await prisma.order.findUnique({
    where: { id: orderId as string },
    include: { dispatchedKiosks: true }
  });

  if (!order) throw new ApiError(404, 'Order not found');
  if (order.parentOrgId !== currentOrgId) throw new ApiError(403, 'Unauthorized to mark this order as delivered');

  // Strict Gate: Must be DISPATCHED before it can be DELIVERED
  if (order.status !== 'DISPATCHED') {
    throw new ApiError(400, `Cannot deliver an order that is currently ${order.status}. Must be DISPATCHED first.`);
  }

  const kioskIds = order.dispatchedKiosks.map(ok => ok.kioskId);

  // The critical write-path for Ownership Transfer
  const deliveredOrder = await prisma.$transaction(async (tx) => {
    
    // 1. Close any currently active assignment history rows for these machines
    await tx.kioskAssignment.updateMany({
      where: {
        kioskId: { in: kioskIds },
        assignedTo: null // null means it is the currently active record
      },
      data: {
        assignedTo: new Date() // Close it by marking the end date
      }
    });

    // 2. Create the brand new assignment history rows transferring it to the Child Org
    const newAssignments = kioskIds.map(kioskId => ({
      kioskId,
      organizationId: order.childOrgId,
      orderId: order.id,
      assignedById: currentUserId
    }));

    await tx.kioskAssignment.createMany({
      data: newAssignments
    });

    // 3. Shift the actual current ownership of the Kiosk and set to AVAILABLE for the child
    await tx.kiosk.updateMany({
      where: { id: { in: kioskIds } },
      data: {
        currentOrgId: order.childOrgId,
        status: 'AVAILABLE', // Now sitting in the Child's inventory ready to be used
        location: null // Clear out any old physical location string
      }
    });

    // 4. Finalize Order Status
    return await tx.order.update({
      where: { id: order.id },
      data: { status: 'DELIVERED' },
      include: { childOrg: { select: { name: true } } }
    });
  });

  res.status(200).json(new ApiResponse(200, { order: deliveredOrder }, `Order delivered! Ownership of ${kioskIds.length} machines successfully transferred to ${deliveredOrder.childOrg.name}.`));
});