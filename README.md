# 🌊 Dive Centre Manager (Multi-Property Edition)

A full-stack web application designed and built in strict accordance with the **Dive Centre Manager Front-Desk Operations Handbook (v1.0)** and multi-property enterprise requirements.

---

## 🚀 System Architecture

- **Backend**: Node.js, Express, TypeScript, Prisma ORM, SQLite (`file:./dev.db`), ExcelJS, JWT, Bcrypt, Helmet, Express-Rate-Limit, Zod.
- **Frontend**: Vite, React 18, TypeScript, Tailwind CSS, Lucide Icons, Recharts.
- **Portals**: Multi-property tenant isolation with Role-Based Access Control (**Global Admin**, **Property Manager**, **Centre Staff**).

---

## 🔑 Demo User Accounts

| Role | Email | Password | Permissions & Scope |
|---|---|---|---|
| **👑 Global Admin** | `admin@sundiving.com` | `AdminPassword123!` | Manages all properties, creates users, sets passwords, unlocks accounts, freezes/locks months, views audit change log. |
| **🏢 Property Manager** | `manager@sundiving.com` | `ManagerPass123!` | Assigned to multiple properties (Malé & Ari Atolls), manages catalogue, staff rosters, views reports, locks months. |
| **🤿 Centre Staff (Malé)** | `staff@sundiving.com` | `StaffPass123!` | Tied strictly to **Sun Diving - Malé Atoll**. Centre switcher disabled per handbook. Writes bills, records presence, views centre reports. |
| **🏝️ Centre Staff (Ari)** | `staff.ari@sundiving.com` | `StaffPass123!` | Tied strictly to **Sun Diving - Ari Atoll**. Isolated data scope. |

---

## 📋 PDF Requirement Mapping & Features

### 1. Signing in & Getting Around (PDF Page 2)
- Sign in with email and administrator-set password.
- **No self-service reset**: Passwords are administrator-provisioned.
- **Account Lockout**: 5 consecutive incorrect passwords temporarily locks the account. Administrators can manually unlock accounts with one click.
- **Tenancy Scoping**: Centre staff accounts are locked to their specific dive centre; property switcher is disabled for them.
- Top bar carries active centre badge, user name, role badge, light/dark theme toggle, and Sign Out.

### 2. Home Dashboard (PDF Page 2)
- Shows current day revenue, today's bill count, and gross figures.
- **Daily Turnover Chart**: Toggleable between **Line Chart** and **Bar Chart**.
- **Running Totals**: Month-to-date turnover, service charge, tax, tip, and average bill check.
- Real-time updates as bills are saved.

### 3. Writing a Bill (`New Bill`) (PDF Pages 3 & 4)
- **Split Layout**: Left half catalogue with category chips & search; right half bill builder.
- **Check Numbers**: Pre-filled from the last saved bill, editable via `+ / -` stepper to match the Micros check. Validates unique numbers per centre.
- **Smart Room Auto-fill**: Typing the room number automatically detects if a bill was created for that room today and offers a 1-click auto-fill for guest name, departure date, and nationality.
- **Running Totals Flow**:
  $$\text{Gross} \longrightarrow -\text{Discount} \longrightarrow +\text{Service Charge (10\%)} \longrightarrow +\text{Tax (16\%)} \longrightarrow +\text{Tip} \longrightarrow \text{Net Total}$$
  *(Note: Service charge is never paid to staff and never part of commission).*
- **Personal Commission on a Line**: If an activity pays a commission (e.g., photo shoot, course sale, guided dive), dropdown selectors for seller, guide, instructor, photo, or video appear on that line.
- **Tip Distribution**: Select which staff members split the guest's tip equally.

### 4. Finding & Fixing Bills (`Bills`) (PDF Page 4)
- Filter by date range, search query (room, guest, check number), and status (`ALL`, `ACTIVE`, `REBATED`, `DELETED`).
- Modal bill inspection with printable receipt layout.
- **Three Handbook Actions**:
  1. **Re-date**: Moves bill to another business date while preserving check number.
  2. **Rebate**: Reverses bill with a required reason. Original stays on record; rebated bills earn **no commission**.
  3. **Delete**: Soft deletes the bill, removes it from revenue totals, and **releases the check number** for reuse.
- All actions are written to the **Administrator's Change Log**.

### 5. Recording Attendance (`Presence`) (PDF Page 5)
- Attendance drives daily commission pool distributions.
- **Filtered Roster**: Only dive-centre staff appear (receptionists and non-diving staff excluded).
- **Employment Filtering**: Staff appear only from their hire date and drop off after their leaving date.
- **Calendar Day Indicators**:
  - 🟢 **Recorded**: Everyone employed that day is marked.
  - 🟡 **Partial**: Some, but not all, are marked.
  - 🔴 **Missing**: Past day with nothing recorded.
  - **"N days missing this month"** counter badge at the top.
- **Bulk Action**: *"All present"* button to mark all staff present with one click.
- **Commission Rules by Status**:
  - `Present`: Counts in full.
  - `Off` / `Off (half day)`: Counts in full.
  - `Annual leave`, `Sick`, `Absent`, `Emergency leave`: Excluded from pools.

### 6. Reporting, Commission & Payroll Lock (PDF Pages 6 & 7)
- **Headline Numbers**: Turnover, service charge, tax, bill count, average bill, and total commission.
- **Charts with Instant CSV Export**:
  - Revenue by Category
  - Revenue by Guest Nationality
  - Top Items by Revenue
  - Revenue by Weekday
  - Daily Trends
- **5 Commission Channels (PDF Page 7)**:
  1. **Course Pool**: Shared equally among sharing positions present that day (Base Leader, Asst Base Leader, Instructor).
  2. **Dive Pool**: Shared equally among all dive staff present that day.
  3. **Base-Leader Override**: Extra 10% of total pool paid to Base Leader(s) regardless of attendance.
  4. **Tips**: Split equally among picked staff on the bill.
  5. **Personal**: Fixed per-line amount to the credited staff member.
- **"Who Did What" Table**: Complete line-item audit of personal commissions.
- **Payroll Freeze (Month Lock)**: Administrator can freeze a month for payroll. Once locked, figures cannot change, bills cannot be edited, and Recompute is disabled.
- **Excel Exports (.xlsx)**:
  - **Daily Report**: Download single-day workbook.
  - **Monthly Payroll Workbook**: Download full multi-sheet Excel workbook (Overview, Bills, Staff Commissions, Personal Detail, Attendance Register).

---

## 🔒 Security Architecture

1. **Helmet & Security Headers**: Content security policy, XSS protection, MIME type sniffing protection.
2. **Rate Limiting**:
   - `authLimiter`: Max 20 login attempts per 5 minutes per IP to block brute-force attacks.
   - `apiLimiter`: 1,000 requests per 15 minutes per IP.
3. **Account Lockout Policy**: 5 consecutive wrong passwords locks the account for 15 minutes.
4. **Tenant Isolation**: Every database operation is scoped by `propertyId`. Centre staff cannot view or alter other dive centres.
5. **Auditing**: Sensitive operations (re-dates, rebates, deletions, unlocks, password resets) are tracked in `AuditLog` with IP addresses.

---

## 💻 Running the Application

### Backend:
```bash
cd backend
npm install
npx prisma db push
npx tsx src/seed.ts
npm run dev
# Running on http://localhost:5001
```

### Frontend:
```bash
cd frontend
npm install
npm run dev
# Running on http://localhost:5173
```
