import { AttendanceStatus, RecurringType, TaskStatus } from "@prisma/client";
import { prisma } from "../src/prisma/prisma.js";
import { resolveTaskInstanceWindow } from "../src/cron/taskInstanceWindow.js";

const DEMO_MANAGER_EMAIL = "demo.manager@cleanops.local";
const DEMO_MANAGER_PASSWORD = "DemoManager123!";

type DemoStaffConfig = {
  slug: string;
  name: string;
  shift: [number, number, number, number];
  locationKey: string;
};

type DemoScenario =
  | "checked_out_clean"
  | "checked_out_late"
  | "late_in_progress"
  | "checked_in_active"
  | "absent_started"
  | "shift_not_started";

const demoStaffConfigs: DemoStaffConfig[] = [
  { slug: "ayesha", name: "Ayesha Khan", shift: [8, 0, 16, 0], locationKey: "tower" },
  { slug: "bilal", name: "Bilal Ahmed", shift: [9, 0, 17, 0], locationKey: "tower" },
  { slug: "hira", name: "Hira Malik", shift: [20, 0, 4, 0], locationKey: "tower" },
  { slug: "omar", name: "Omar Farooq", shift: [10, 0, 18, 0], locationKey: "mall" },
  { slug: "sana", name: "Sana Iqbal", shift: [12, 0, 20, 0], locationKey: "mall" },
  { slug: "yusuf", name: "Yusuf Ali", shift: [21, 0, 5, 0], locationKey: "mall" },
  { slug: "zainab", name: "Zainab Noor", shift: [7, 0, 15, 0], locationKey: "medical" },
  { slug: "hamza", name: "Hamza Sheikh", shift: [14, 0, 22, 0], locationKey: "medical" },
  { slug: "mariam", name: "Mariam Siddiqui", shift: [6, 0, 14, 0], locationKey: "hotel" },
  { slug: "farhan", name: "Farhan Raza", shift: [15, 0, 23, 0], locationKey: "hotel" },
  { slug: "nida", name: "Nida Javed", shift: [22, 0, 6, 0], locationKey: "hotel" },
  { slug: "saad", name: "Saad Qureshi", shift: [8, 30, 16, 30], locationKey: "campus" },
  { slug: "laiba", name: "Laiba Tariq", shift: [11, 0, 19, 0], locationKey: "campus" },
  { slug: "daniyal", name: "Daniyal Hussain", shift: [19, 0, 3, 0], locationKey: "campus" },
  { slug: "iqra", name: "Iqra Rehman", shift: [7, 30, 15, 30], locationKey: "warehouse" },
  { slug: "usman", name: "Usman Khalid", shift: [13, 0, 21, 0], locationKey: "warehouse" },
  { slug: "mehak", name: "Mehak Aslam", shift: [18, 0, 2, 0], locationKey: "warehouse" },
  { slug: "rafay", name: "Rafay Nadeem", shift: [9, 0, 17, 0], locationKey: "medical" },
];

const demoLocationConfigs = [
  {
    key: "tower",
    name: "Demo - Corporate Tower",
    address: "14 Blue Avenue, Business District",
    latitude: "33.6844",
    longitude: "73.0479",
    radiusMeters: 140,
  },
  {
    key: "mall",
    name: "Demo - City Mall Wing",
    address: "22 Market Road, Central Plaza",
    latitude: "33.7001",
    longitude: "73.0551",
    radiusMeters: 180,
  },
  {
    key: "medical",
    name: "Demo - Medical Block",
    address: "5 Garden Street, East Medical Complex",
    latitude: "33.6712",
    longitude: "73.0218",
    radiusMeters: 160,
  },
  {
    key: "hotel",
    name: "Demo - Riverside Hotel",
    address: "44 Canal View Road, North Quarter",
    latitude: "33.6922",
    longitude: "73.0341",
    radiusMeters: 150,
  },
  {
    key: "campus",
    name: "Demo - University Campus",
    address: "7 Knowledge Park, West Sector",
    latitude: "33.6481",
    longitude: "73.0712",
    radiusMeters: 220,
  },
  {
    key: "warehouse",
    name: "Demo - Logistics Warehouse",
    address: "81 Freight Link Road, Industrial Zone",
    latitude: "33.6154",
    longitude: "73.0893",
    radiusMeters: 200,
  },
] as const;

const templateBlueprints = [
  { suffix: "Entry Sweep", startOffset: 20, duration: 30 },
  { suffix: "Reception Sanitization", startOffset: 75, duration: 35 },
  { suffix: "Washroom Audit", startOffset: 135, duration: 30 },
  { suffix: "Corridor Mopping", startOffset: 195, duration: 40 },
  { suffix: "Bins and Supplies Round", startOffset: 255, duration: 30 },
  { suffix: "Glass Spot Clean", startOffset: 315, duration: 35 },
  { suffix: "Final Inspection", startOffset: 380, duration: 30 },
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

const getArgValue = (name: string) => {
  const match = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
};

const startOfUtcDay = (date = new Date()) => {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  return result;
};

const withUtcTime = (day: Date, hour: number, minute: number, dayOffset = 0) => {
  const result = new Date(day);
  result.setUTCDate(result.getUTCDate() + dayOffset);
  result.setUTCHours(hour, minute, 0, 0);
  return result;
};

const shiftWindowForDay = (day: Date, shift: [number, number, number, number]) => {
  const [startHour, startMinute, endHour, endMinute] = shift;
  const shiftStart = withUtcTime(day, startHour, startMinute);
  let shiftEnd = withUtcTime(day, endHour, endMinute);

  if (shiftEnd <= shiftStart) {
    shiftEnd = withUtcTime(day, endHour, endMinute, 1);
  }

  return { shiftStart, shiftEnd };
};

const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60 * 1000);

const makeTaskTitle = (staffName: string, suffix: string) => `Demo: ${staffName} ${suffix}`;
const attendanceKey = (staffId: number, day: Date) => `${staffId}:${startOfUtcDay(day).toISOString()}`;
const todayScenarios: DemoScenario[] = [
  "checked_out_clean",
  "late_in_progress",
  "absent_started",
  "checked_in_active",
  "checked_out_late",
  "shift_not_started",
  "checked_out_clean",
  "absent_started",
  "checked_in_active",
  "checked_out_late",
  "late_in_progress",
  "checked_out_clean",
  "absent_started",
  "checked_in_active",
  "checked_out_late",
  "shift_not_started",
  "checked_out_clean",
  "late_in_progress",
];

async function main() {
  const managerEmailArg = getArgValue("--managerEmail");
  const managerEmail = managerEmailArg ?? DEMO_MANAGER_EMAIL;
  const managerPasswordArg = getArgValue("--managerPassword");
  const managerPassword = managerPasswordArg ?? DEMO_MANAGER_PASSWORD;
  let createdManager = false;

  let manager = await prisma.manager.findUnique({
    where: { email: managerEmail },
  });

  if (!manager) {
    const company = await prisma.company.create({
      data: {
        name: "Hygene Ops Demo Company",
      },
    });

    manager = await prisma.manager.create({
      data: {
        name: "Demo Manager",
        email: managerEmail,
        password: managerPassword,
        companyId: company.id,
      },
    });
    createdManager = true;
  }

  const companyId = manager.companyId;
  const emailPrefix = `demo.cleanops.${companyId}.`;

  const existingDemoLocations = await prisma.location.findMany({
    where: {
      companyId,
      name: { startsWith: "Demo - " },
    },
    select: { id: true },
  });

  const existingDemoStaff = await prisma.staff.findMany({
    where: {
      companyId,
      email: { startsWith: emailPrefix },
    },
    select: { id: true },
  });

  const demoLocationIds = existingDemoLocations.map((location) => location.id);
  const demoStaffIds = existingDemoStaff.map((staff) => staff.id);

  const existingDemoTemplates = await prisma.taskTemplate.findMany({
    where: {
      locationId: { in: demoLocationIds.length ? demoLocationIds : [-1] },
      title: { startsWith: "Demo:" },
    },
    select: { id: true },
  });

  const demoTemplateIds = existingDemoTemplates.map((template) => template.id);

  await prisma.taskInstance.deleteMany({
    where: {
      OR: [
        { templateId: { in: demoTemplateIds.length ? demoTemplateIds : [-1] } },
        { staffId: { in: demoStaffIds.length ? demoStaffIds : [-1] } },
        {
          locationId: { in: demoLocationIds.length ? demoLocationIds : [-1] },
          title: { startsWith: "Demo:" },
        },
      ],
    },
  });

  await prisma.attendance.deleteMany({
    where: {
      staffId: { in: demoStaffIds.length ? demoStaffIds : [-1] },
    },
  });

  await prisma.taskTemplate.deleteMany({
    where: {
      id: { in: demoTemplateIds.length ? demoTemplateIds : [-1] },
    },
  });

  await prisma.staff.deleteMany({
    where: {
      id: { in: demoStaffIds.length ? demoStaffIds : [-1] },
    },
  });

  await prisma.location.deleteMany({
    where: {
      id: { in: demoLocationIds.length ? demoLocationIds : [-1] },
    },
  });

  const locations: Record<string, { id: number; name: string }> = {};

  for (const location of demoLocationConfigs) {
    const { key, ...locationData } = location;
    locations[location.key] = await prisma.location.create({
      data: {
        ...locationData,
        companyId,
      },
    });
  }

  const today = startOfUtcDay();
  const staffRecords = [];

  for (const config of demoStaffConfigs) {
    const [startHour, startMinute, endHour, endMinute] = config.shift;
    const staff = await prisma.staff.create({
      data: {
        name: config.name,
        email: `${emailPrefix}${config.slug}@example.com`,
        password: "DemoStaff123!",
        companyId,
        locationId: locations[config.locationKey].id,
        shiftStart: withUtcTime(today, startHour, startMinute),
        shiftEnd: withUtcTime(today, endHour, endMinute, endHour < startHour || (endHour === startHour && endMinute <= startMinute) ? 1 : 0),
      },
    });

    staffRecords.push({ ...config, record: staff });
  }

  const templateRecords: Array<{
    staffId: number;
    templateId: number;
    title: string;
    shiftStart: Date;
    shiftEnd: Date;
  }> = [];

  for (const [staffIndex, staff] of staffRecords.entries()) {
    const { shiftStart } = shiftWindowForDay(today, staff.shift);
    const templatesForStaff = 6 + (staffIndex % 2);

    for (const blueprint of templateBlueprints.slice(0, templatesForStaff)) {
      const taskShiftStart = addMinutes(shiftStart, blueprint.startOffset);
      const taskShiftEnd = addMinutes(taskShiftStart, blueprint.duration);

      const template = await prisma.taskTemplate.create({
        data: {
          title: makeTaskTitle(staff.name, blueprint.suffix),
          description: `Demo operational task for ${locations[staff.locationKey].name}.`,
          locationId: staff.record.locationId!,
          staffId: staff.record.id,
          shiftStart: taskShiftStart,
          shiftEnd: taskShiftEnd,
          recurringType: RecurringType.DAILY,
          effectiveDate: addMinutes(today, -14 * 24 * 60),
        },
      });

      templateRecords.push({
        staffId: staff.record.id,
        templateId: template.id,
        title: template.title,
        shiftStart: taskShiftStart,
        shiftEnd: taskShiftEnd,
      });
    }
  }

  const attendanceRows = [];
  const attendanceScenarioByDay = new Map<string, DemoScenario>();

  for (let dayOffset = -10; dayOffset <= 0; dayOffset += 1) {
    const day = new Date(today.getTime() + dayOffset * DAY_MS);

    for (const [index, staff] of staffRecords.entries()) {
      const { shiftStart, shiftEnd } = shiftWindowForDay(day, staff.shift);
      let status: AttendanceStatus = AttendanceStatus.CHECKED_OUT;
      let checkInTime: Date | null = addMinutes(shiftStart, 4);
      let checkOutTime: Date | null = addMinutes(shiftEnd, -8);
      let isLateCheckIn = false;
      let lateMinutes: number | null = null;
      let scenario: DemoScenario = "checked_out_clean";
      let expectedStart = shiftStart;
      let expectedEnd = shiftEnd;

      if (dayOffset === 0) {
        scenario = todayScenarios[index] ?? "checked_out_clean";

        switch (scenario) {
          case "checked_out_clean":
            status = AttendanceStatus.CHECKED_OUT;
            checkInTime = addMinutes(shiftStart, 6);
            checkOutTime = addMinutes(shiftEnd, -12);
            break;
          case "late_in_progress":
            status = AttendanceStatus.LATE;
            checkInTime = addMinutes(shiftStart, 22);
            checkOutTime = null;
            isLateCheckIn = true;
            lateMinutes = 22;
            break;
          case "absent_started":
            status = AttendanceStatus.ABSENT;
            checkInTime = null;
            checkOutTime = null;
            break;
          case "checked_in_active":
            status = AttendanceStatus.CHECKED_IN;
            checkInTime = addMinutes(shiftStart, 5);
            checkOutTime = null;
            break;
          case "checked_out_late":
            status = AttendanceStatus.CHECKED_OUT;
            checkInTime = addMinutes(shiftStart, 18);
            checkOutTime = addMinutes(shiftEnd, -15);
            isLateCheckIn = true;
            lateMinutes = 18;
            break;
          case "shift_not_started":
            status = AttendanceStatus.ABSENT;
            checkInTime = null;
            checkOutTime = null;
            expectedStart = addMinutes(new Date(), 150 + index * 4);
            expectedEnd = addMinutes(expectedStart, 8 * 60);
            break;
        }
      } else if ((index + Math.abs(dayOffset)) % 6 === 0) {
        status = AttendanceStatus.ABSENT;
        checkInTime = null;
        checkOutTime = null;
        scenario = "absent_started";
      } else if ((index + Math.abs(dayOffset)) % 4 === 0) {
        status = AttendanceStatus.LATE;
        checkInTime = addMinutes(shiftStart, 19);
        checkOutTime = addMinutes(shiftEnd, -10);
        isLateCheckIn = true;
        lateMinutes = 19;
        scenario = "checked_out_late";
      } else if ((index + Math.abs(dayOffset)) % 5 === 0) {
        status = AttendanceStatus.CHECKED_OUT;
        checkInTime = addMinutes(shiftStart, 5);
        checkOutTime = addMinutes(shiftEnd, -20);
        scenario = "checked_out_clean";
      }

      attendanceScenarioByDay.set(attendanceKey(staff.record.id, day), scenario);

      attendanceRows.push({
        staffId: staff.record.id,
        locationId: staff.record.locationId!,
        date: day,
        expectedStart,
        expectedEnd,
        status,
        checkInTime,
        checkOutTime,
        isLateCheckIn,
        lateMinutes,
      });
    }
  }

  await prisma.attendance.createMany({
    data: attendanceRows,
  });

  const taskRows = [];

  for (let dayOffset = -10; dayOffset <= 0; dayOffset += 1) {
    const day = new Date(today.getTime() + dayOffset * DAY_MS);
    const dayStart = startOfUtcDay(day);

    for (const [index, template] of templateRecords.entries()) {
      const staffRecord = staffRecords.find((staff) => staff.record.id === template.staffId)!;
      const { date, shiftStart, shiftEnd } = resolveTaskInstanceWindow({
        baseDate: dayStart,
        taskShiftStart: template.shiftStart,
        taskShiftEnd: template.shiftEnd,
        staffShiftStart: staffRecord.record.shiftStart,
        staffShiftEnd: staffRecord.record.shiftEnd,
      });

      let status: TaskStatus = TaskStatus.COMPLETED;
      let startedAt: Date | null = addMinutes(shiftStart, 4);
      let completedAt: Date | null = addMinutes(shiftStart, 32);
      let isLate = false;
      let lateMinutes: number | null = null;
      const scenario = attendanceScenarioByDay.get(attendanceKey(template.staffId, dayStart)) ?? "checked_out_clean";
      const taskSlot = index % 7;

      if (scenario === "shift_not_started") {
        status = TaskStatus.PENDING;
        startedAt = null;
        completedAt = null;
      } else if (scenario === "absent_started") {
        status = dayOffset === 0 && taskSlot >= 4 ? TaskStatus.PENDING : TaskStatus.MISSED;
        startedAt = null;
        completedAt = null;
      } else if (scenario === "checked_in_active") {
        if (taskSlot <= 1) {
          status = TaskStatus.COMPLETED;
          startedAt = addMinutes(shiftStart, 5);
          completedAt = addMinutes(shiftStart, 34);
        } else if (taskSlot <= 3) {
          status = TaskStatus.IN_PROGRESS;
          startedAt = addMinutes(shiftStart, 18);
          completedAt = null;
        } else {
          status = TaskStatus.PENDING;
          startedAt = null;
          completedAt = null;
        }
      } else if (scenario === "late_in_progress") {
        if (taskSlot <= 1) {
          status = TaskStatus.COMPLETED;
          startedAt = addMinutes(shiftStart, 22);
          completedAt = addMinutes(shiftStart, 52);
          isLate = true;
          lateMinutes = 22;
        } else if (taskSlot <= 4) {
          status = TaskStatus.IN_PROGRESS;
          startedAt = addMinutes(shiftStart, 28);
          completedAt = null;
          isLate = true;
          lateMinutes = 28;
        } else {
          status = TaskStatus.PENDING;
          startedAt = null;
          completedAt = null;
        }
      } else if (scenario === "checked_out_late") {
        status = TaskStatus.COMPLETED;
        startedAt = addMinutes(shiftStart, 12 + taskSlot);
        completedAt = addMinutes(shiftStart, 42 + taskSlot);
        isLate = true;
        lateMinutes = 12 + taskSlot;
      } else if ((index + Math.abs(dayOffset)) % 7 === 0) {
        status = TaskStatus.NOT_COMPLETED_INTIME;
        startedAt = addMinutes(shiftStart, 10);
        completedAt = null;
        isLate = true;
        lateMinutes = 10;
      } else if ((index + Math.abs(dayOffset)) % 4 === 0) {
        status = TaskStatus.COMPLETED;
        startedAt = addMinutes(shiftStart, 12);
        completedAt = addMinutes(shiftStart, 46);
        isLate = true;
        lateMinutes = 12;
      }

      taskRows.push({
        templateId: template.templateId,
        title: template.title,
        date,
        shiftStart,
        shiftEnd,
        status,
        isLate,
        lateMinutes,
        startedAt,
        completedAt,
        staffId: template.staffId,
        locationId: staffRecord.record.locationId!,
        isActive: true,
      });
    }
  }

  await prisma.taskInstance.createMany({
    data: taskRows,
  });

  console.log("");
  console.log("Demo seed completed.");
  console.log(`Manager email: ${manager.email}`);
  if (createdManager) {
    console.log(`Manager password: ${managerPassword}`);
  } else {
    console.log("Manager password: unchanged (existing manager reused)");
  }
  console.log(`Company ID: ${companyId}`);
  console.log(`Locations created: ${Object.keys(locations).length}`);
  console.log(`Staff created: ${staffRecords.length}`);
  console.log(`Templates created: ${templateRecords.length}`);
  console.log(`Attendance rows created: ${attendanceRows.length}`);
  console.log(`Task instances created: ${taskRows.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
