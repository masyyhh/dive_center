import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Clearing existing data...');
  await prisma.auditLog.deleteMany({});
  await prisma.monthLock.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.billItem.deleteMany({});
  await prisma.bill.deleteMany({});
  await prisma.item.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.staffMember.deleteMany({});
  await prisma.userProperty.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.property.deleteMany({});

  console.log('Seeding properties...');
  const propertyMale = await prisma.property.create({
    data: {
      code: 'SUN-MLE',
      name: 'Sun Diving - Malé Atoll',
      location: 'North Malé Atoll, Maldives',
      currency: 'USD',
      currencySymbol: '$',
      taxRate: 16.0,          // 16% TGST
      serviceChargeRate: 10.0, // 10% Service Charge
      nextCheckNumber: 1005,
    },
  });

  const propertyAri = await prisma.property.create({
    data: {
      code: 'SUN-ARI',
      name: 'Sun Diving - Ari Atoll',
      location: 'South Ari Atoll, Maldives',
      currency: 'USD',
      currencySymbol: '$',
      taxRate: 16.0,
      serviceChargeRate: 10.0,
      nextCheckNumber: 2001,
    },
  });

  console.log('Seeding users...');
  const salt = await bcrypt.genSalt(10);
  const adminPasswordHash = await bcrypt.hash('AdminPassword123!', salt);
  const managerPasswordHash = await bcrypt.hash('ManagerPass123!', salt);
  const staffPasswordHash = await bcrypt.hash('StaffPass123!', salt);

  // Global Admin
  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@sundiving.com',
      name: 'Alexander Croft (Global Admin)',
      passwordHash: adminPasswordHash,
      role: 'GLOBAL_ADMIN',
    },
  });

  // Property Manager
  const managerUser = await prisma.user.create({
    data: {
      email: 'manager@sundiving.com',
      name: 'Marcus Vance (Base Manager)',
      passwordHash: managerPasswordHash,
      role: 'PROPERTY_MANAGER',
      assignedProperties: {
        create: [
          { propertyId: propertyMale.id },
          { propertyId: propertyAri.id },
        ],
      },
    },
  });

  // Centre Staff for Malé
  const staffMale = await prisma.user.create({
    data: {
      email: 'staff@sundiving.com',
      name: 'Aishath Laila (Front Desk)',
      passwordHash: staffPasswordHash,
      role: 'CENTRE_STAFF',
      assignedProperties: {
        create: [{ propertyId: propertyMale.id }],
      },
    },
  });

  // Centre Staff for Ari
  const staffAri = await prisma.user.create({
    data: {
      email: 'staff.ari@sundiving.com',
      name: 'Hassan Rauf (Front Desk Ari)',
      passwordHash: staffPasswordHash,
      role: 'CENTRE_STAFF',
      assignedProperties: {
        create: [{ propertyId: propertyAri.id }],
      },
    },
  });

  console.log('Seeding staff members for Malé...');
  const staffListMale = await Promise.all([
    prisma.staffMember.create({
      data: {
        propertyId: propertyMale.id,
        name: 'Ahmed Razee',
        email: 'ahmed@sundiving.com',
        roleTitle: 'Base Leader',
        isDiveStaff: true,
        isCoursePoolSharing: true,
        isDivePoolSharing: true,
        isBaseLeaderOverride: true,
        hireDate: '2024-01-01',
      },
    }),
    prisma.staffMember.create({
      data: {
        propertyId: propertyMale.id,
        name: 'Sarah Jenkins',
        email: 'sarah@sundiving.com',
        roleTitle: 'Assistant Base Leader',
        isDiveStaff: true,
        isCoursePoolSharing: true,
        isDivePoolSharing: true,
        isBaseLeaderOverride: false,
        hireDate: '2024-02-15',
      },
    }),
    prisma.staffMember.create({
      data: {
        propertyId: propertyMale.id,
        name: 'Marco Rossi',
        email: 'marco@sundiving.com',
        roleTitle: 'Instructor',
        isDiveStaff: true,
        isCoursePoolSharing: true,
        isDivePoolSharing: true,
        isBaseLeaderOverride: false,
        hireDate: '2024-06-01',
      },
    }),
    prisma.staffMember.create({
      data: {
        propertyId: propertyMale.id,
        name: 'Elena Petrova',
        email: 'elena@sundiving.com',
        roleTitle: 'Instructor',
        isDiveStaff: true,
        isCoursePoolSharing: true,
        isDivePoolSharing: true,
        isBaseLeaderOverride: false,
        hireDate: '2024-08-10',
      },
    }),
    prisma.staffMember.create({
      data: {
        propertyId: propertyMale.id,
        name: 'Ibrahim Naeem',
        email: 'naeem@sundiving.com',
        roleTitle: 'Divemaster',
        isDiveStaff: true,
        isCoursePoolSharing: false,
        isDivePoolSharing: true,
        isBaseLeaderOverride: false,
        hireDate: '2025-01-15',
      },
    }),
    prisma.staffMember.create({
      data: {
        propertyId: propertyMale.id,
        name: 'David Kim',
        email: 'david@sundiving.com',
        roleTitle: 'Underwater Photographer',
        isDiveStaff: true,
        isCoursePoolSharing: false,
        isDivePoolSharing: true,
        isBaseLeaderOverride: false,
        hireDate: '2025-03-01',
      },
    }),
    // Non-dive staff member (Receptionist) - excluded from presence and pools per PDF Page 5
    prisma.staffMember.create({
      data: {
        propertyId: propertyMale.id,
        name: 'Fatima Zahra',
        email: 'fatima@sundiving.com',
        roleTitle: 'Receptionist',
        isDiveStaff: false,
        isCoursePoolSharing: false,
        isDivePoolSharing: false,
        isBaseLeaderOverride: false,
        hireDate: '2024-05-01',
      },
    }),
  ]);

  console.log('Seeding categories and items for Malé...');
  const catDives = await prisma.category.create({
    data: { propertyId: propertyMale.id, name: 'Dives', sortOrder: 1 },
  });
  const catCourses = await prisma.category.create({
    data: { propertyId: propertyMale.id, name: 'Courses', sortOrder: 2 },
  });
  const catPhoto = await prisma.category.create({
    data: { propertyId: propertyMale.id, name: 'Photo & Video', sortOrder: 3 },
  });
  const catRentals = await prisma.category.create({
    data: { propertyId: propertyMale.id, name: 'Rentals', sortOrder: 4 },
  });
  const catRetail = await prisma.category.create({
    data: { propertyId: propertyMale.id, name: 'Retail', sortOrder: 5 },
  });

  const itemSingleDive = await prisma.item.create({
    data: {
      propertyId: propertyMale.id,
      categoryId: catDives.id,
      code: 'DIVE-01',
      name: 'Single Boat Dive',
      price: 85.0,
      poolType: 'DIVE_POOL',
      poolContribution: 10.0,
      personalRoles: 'seller,guide',
      personalRatesJson: JSON.stringify({ seller: 5, guide: 10 }),
    },
  });

  const itemTwoTank = await prisma.item.create({
    data: {
      propertyId: propertyMale.id,
      categoryId: catDives.id,
      code: 'DIVE-02',
      name: '2-Tank Morning Boat Dive',
      price: 155.0,
      poolType: 'DIVE_POOL',
      poolContribution: 18.0,
      personalRoles: 'seller,guide',
      personalRatesJson: JSON.stringify({ seller: 8, guide: 15 }),
    },
  });

  const itemNightDive = await prisma.item.create({
    data: {
      propertyId: propertyMale.id,
      categoryId: catDives.id,
      code: 'DIVE-03',
      name: 'Night Dive with Torch',
      price: 95.0,
      poolType: 'DIVE_POOL',
      poolContribution: 12.0,
      personalRoles: 'seller,guide',
      personalRatesJson: JSON.stringify({ seller: 5, guide: 12 }),
    },
  });

  const itemDSD = await prisma.item.create({
    data: {
      propertyId: propertyMale.id,
      categoryId: catCourses.id,
      code: 'CRS-DSD',
      name: 'Discover Scuba Diving',
      price: 140.0,
      poolType: 'COURSE_POOL',
      poolContribution: 25.0,
      personalRoles: 'seller,instructor',
      personalRatesJson: JSON.stringify({ seller: 15, instructor: 30 }),
    },
  });

  const itemOWD = await prisma.item.create({
    data: {
      propertyId: propertyMale.id,
      categoryId: catCourses.id,
      code: 'CRS-OWD',
      name: 'PADI Open Water Diver',
      price: 580.0,
      poolType: 'COURSE_POOL',
      poolContribution: 80.0,
      personalRoles: 'seller,instructor',
      personalRatesJson: JSON.stringify({ seller: 40, instructor: 90 }),
    },
  });

  const itemAOW = await prisma.item.create({
    data: {
      propertyId: propertyMale.id,
      categoryId: catCourses.id,
      code: 'CRS-AOW',
      name: 'PADI Advanced Open Water',
      price: 420.0,
      poolType: 'COURSE_POOL',
      poolContribution: 55.0,
      personalRoles: 'seller,instructor',
      personalRatesJson: JSON.stringify({ seller: 25, instructor: 60 }),
    },
  });

  const itemPhoto = await prisma.item.create({
    data: {
      propertyId: propertyMale.id,
      categoryId: catPhoto.id,
      code: 'PHOTO-01',
      name: 'Underwater Photo Shoot (15 HD Photos)',
      price: 160.0,
      poolType: 'NONE',
      poolContribution: 0.0,
      personalRoles: 'seller,photo',
      personalRatesJson: JSON.stringify({ seller: 15, photo: 50 }),
    },
  });

  const itemEquipment = await prisma.item.create({
    data: {
      propertyId: propertyMale.id,
      categoryId: catRentals.id,
      code: 'RENT-SET',
      name: 'Full Equipment Rental Set (Daily)',
      price: 35.0,
      poolType: 'NONE',
      poolContribution: 0.0,
    },
  });

  const itemRashguard = await prisma.item.create({
    data: {
      propertyId: propertyMale.id,
      categoryId: catRetail.id,
      code: 'RET-RASH',
      name: 'Sun Diving UV Rashguard',
      price: 45.0,
      poolType: 'NONE',
      poolContribution: 0.0,
      personalRoles: 'seller',
      personalRatesJson: JSON.stringify({ seller: 5 }),
    },
  });

  console.log('Seeding attendance for current month (Oct 2026)...');
  const diveStaffOnly = staffListMale.filter((s) => s.isDiveStaff);
  const today = '2026-10-20';

  // Seed attendance for past days of October 2026
  const pastDays = [
    '2026-10-15',
    '2026-10-16',
    '2026-10-17',
    '2026-10-18',
    '2026-10-19',
    '2026-10-20',
  ];

  for (const date of pastDays) {
    for (const s of diveStaffOnly) {
      let status = 'PRESENT';
      if (date === '2026-10-17' && s.name === 'Marco Rossi') {
        status = 'OFF'; // Off counts toward commission in full!
      } else if (date === '2026-10-18' && s.name === 'Elena Petrova') {
        status = 'SICK'; // Sick is excluded from pool
      }
      await prisma.attendance.create({
        data: {
          propertyId: propertyMale.id,
          staffMemberId: s.id,
          date,
          status,
        },
      });
    }
  }

  console.log('Seeding sample bills for Malé...');
  const ahmed = diveStaffOnly.find((s) => s.name === 'Ahmed Razee')!;
  const marco = diveStaffOnly.find((s) => s.name === 'Marco Rossi')!;
  const elena = diveStaffOnly.find((s) => s.name === 'Elena Petrova')!;
  const naeem = diveStaffOnly.find((s) => s.name === 'Ibrahim Naeem')!;
  const david = diveStaffOnly.find((s) => s.name === 'David Kim')!;

  // Bill 1: Room 304 - 2-Tank dive + Photo Shoot
  const bill1Gross = 155.0 + 160.0; // 315.00
  const bill1Discount = 0.0;
  const bill1SC = (bill1Gross - bill1Discount) * 0.10; // 31.50
  const bill1Tax = (bill1Gross - bill1Discount + bill1SC) * 0.16; // 55.44
  const bill1Tip = 20.00;
  const bill1Net = bill1Gross - bill1Discount + bill1SC + bill1Tax + bill1Tip; // 421.94

  const bill1 = await prisma.bill.create({
    data: {
      propertyId: propertyMale.id,
      checkNumber: 1001,
      businessDate: '2026-10-19',
      guestName: 'Julian & Sophia Weber',
      roomNumber: '304',
      departureDate: '2026-10-24',
      nationality: 'Germany',
      grossAmount: bill1Gross,
      discountAmount: bill1Discount,
      serviceChargeAmount: bill1SC,
      taxAmount: bill1Tax,
      tipAmount: bill1Tip,
      netAmount: bill1Net,
      tipStaffIdsJson: JSON.stringify([ahmed.id, naeem.id]),
      status: 'ACTIVE',
      createdById: staffMale.id,
      items: {
        create: [
          {
            itemId: itemTwoTank.id,
            itemName: itemTwoTank.name,
            categoryName: 'Dives',
            quantity: 1,
            unitPrice: 155.0,
            discountPercent: 0,
            lineTotal: 155.0,
            sellerStaffId: marco.id,
            guideStaffId: naeem.id,
            personalCommissionsJson: JSON.stringify({ seller: 8, guide: 15 }),
            totalPersonalCommission: 23.0,
          },
          {
            itemId: itemPhoto.id,
            itemName: itemPhoto.name,
            categoryName: 'Photo & Video',
            quantity: 1,
            unitPrice: 160.0,
            discountPercent: 0,
            lineTotal: 160.0,
            sellerStaffId: marco.id,
            photoStaffId: david.id,
            personalCommissionsJson: JSON.stringify({ seller: 15, photo: 50 }),
            totalPersonalCommission: 65.0,
          },
        ],
      },
    },
  });

  // Bill 2: Discover Scuba Diving for Room 112 (Today)
  const bill2Gross = 280.0; // 2 guests * 140
  const bill2Discount = 28.0; // 10% discount
  const bill2SC = (bill2Gross - bill2Discount) * 0.10; // 25.20
  const bill2Tax = (bill2Gross - bill2Discount + bill2SC) * 0.16; // 44.35
  const bill2Tip = 15.00;
  const bill2Net = bill2Gross - bill2Discount + bill2SC + bill2Tax + bill2Tip; // 336.55

  await prisma.bill.create({
    data: {
      propertyId: propertyMale.id,
      checkNumber: 1002,
      businessDate: '2026-10-20',
      guestName: 'Liam Chen',
      roomNumber: '112',
      departureDate: '2026-10-25',
      nationality: 'Singapore',
      grossAmount: bill2Gross,
      discountAmount: bill2Discount,
      serviceChargeAmount: bill2SC,
      taxAmount: bill2Tax,
      tipAmount: bill2Tip,
      netAmount: bill2Net,
      tipStaffIdsJson: JSON.stringify([elena.id]),
      status: 'ACTIVE',
      createdById: staffMale.id,
      items: {
        create: [
          {
            itemId: itemDSD.id,
            itemName: itemDSD.name,
            categoryName: 'Courses',
            quantity: 2,
            unitPrice: 140.0,
            discountPercent: 10.0,
            lineTotal: 252.0,
            sellerStaffId: ahmed.id,
            instructorStaffId: elena.id,
            personalCommissionsJson: JSON.stringify({ seller: 30, instructor: 60 }),
            totalPersonalCommission: 90.0,
          },
        ],
      },
    },
  });

  // Bill 3: Open Water Diver + Equipment for Room 205 (Today)
  const bill3Gross = 580.0 + 35.0; // 615.00
  const bill3Discount = 0.0;
  const bill3SC = bill3Gross * 0.10; // 61.50
  const bill3Tax = (bill3Gross + bill3SC) * 0.16; // 108.24
  const bill3Tip = 30.00;
  const bill3Net = bill3Gross + bill3SC + bill3Tax + bill3Tip; // 814.74

  await prisma.bill.create({
    data: {
      propertyId: propertyMale.id,
      checkNumber: 1003,
      businessDate: '2026-10-20',
      guestName: 'Camille Dupont',
      roomNumber: '205',
      departureDate: '2026-10-28',
      nationality: 'France',
      grossAmount: bill3Gross,
      discountAmount: bill3Discount,
      serviceChargeAmount: bill3SC,
      taxAmount: bill3Tax,
      tipAmount: bill3Tip,
      netAmount: bill3Net,
      tipStaffIdsJson: JSON.stringify([marco.id, ahmed.id]),
      status: 'ACTIVE',
      createdById: staffMale.id,
      items: {
        create: [
          {
            itemId: itemOWD.id,
            itemName: itemOWD.name,
            categoryName: 'Courses',
            quantity: 1,
            unitPrice: 580.0,
            discountPercent: 0,
            lineTotal: 580.0,
            sellerStaffId: marco.id,
            instructorStaffId: marco.id,
            personalCommissionsJson: JSON.stringify({ seller: 40, instructor: 90 }),
            totalPersonalCommission: 130.0,
          },
          {
            itemId: itemEquipment.id,
            itemName: itemEquipment.name,
            categoryName: 'Rentals',
            quantity: 1,
            unitPrice: 35.0,
            discountPercent: 0,
            lineTotal: 35.0,
          },
        ],
      },
    },
  });

  // Bill 4: Sample rebated bill to illustrate audit trail & rebate
  await prisma.bill.create({
    data: {
      propertyId: propertyMale.id,
      checkNumber: 1004,
      businessDate: '2026-10-18',
      guestName: 'Oliver Smith',
      roomNumber: '401',
      departureDate: '2026-10-21',
      nationality: 'United Kingdom',
      grossAmount: 95.0,
      discountAmount: 0.0,
      serviceChargeAmount: 9.50,
      taxAmount: 16.72,
      tipAmount: 0.0,
      netAmount: 121.22,
      status: 'REBATED',
      rebateReason: 'Guest flight departure rescheduled; dive cancelled ahead of time',
      createdById: staffMale.id,
      items: {
        create: [
          {
            itemId: itemNightDive.id,
            itemName: itemNightDive.name,
            categoryName: 'Dives',
            quantity: 1,
            unitPrice: 95.0,
            discountPercent: 0,
            lineTotal: 95.0,
            sellerStaffId: ahmed.id,
            guideStaffId: naeem.id,
            personalCommissionsJson: JSON.stringify({ seller: 5, guide: 12 }),
            totalPersonalCommission: 17.0,
          },
        ],
      },
    },
  });

  console.log('Seeding initial audit log records...');
  await prisma.auditLog.create({
    data: {
      propertyId: propertyMale.id,
      userId: staffMale.id,
      action: 'BILL_REBATE',
      targetType: 'Bill',
      targetId: '1004',
      details: JSON.stringify({
        checkNumber: 1004,
        guestName: 'Oliver Smith',
        reason: 'Guest flight departure rescheduled; dive cancelled ahead of time',
      }),
      ipAddress: '127.0.0.1',
    },
  });

  console.log('Database seeded successfully!');
  console.log('Accounts created:');
  console.log(' - Global Admin: admin@sundiving.com / AdminPassword123!');
  console.log(' - Property Manager: manager@sundiving.com / ManagerPass123!');
  console.log(' - Centre Staff: staff@sundiving.com / StaffPass123!');
  console.log(' - Centre Staff Ari: staff.ari@sundiving.com / StaffPass123!');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
