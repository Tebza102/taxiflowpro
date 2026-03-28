import { mockSnapshot } from "../data/mockData";
import { hasSupabaseConfig, supabase } from "./supabaseClient";

const normalizeRecords = (rows, fallback) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return fallback;
  }

  return rows;
};

const adaptProfile = (row) => {
  if (!row) {
    return mockSnapshot.profile;
  }

  return {
    ...mockSnapshot.profile,
    fleetName: row.fleet_name ?? mockSnapshot.profile.fleetName,
    legalEntity: row.legal_entity ?? mockSnapshot.profile.legalEntity,
    district: row.district ?? mockSnapshot.profile.district,
    installReadiness:
      row.install_readiness ?? mockSnapshot.profile.installReadiness,
    nextBankingWindow:
      row.next_banking_window ?? mockSnapshot.profile.nextBankingWindow,
    serviceIntervalKm:
      row.service_interval_km ?? mockSnapshot.profile.serviceIntervalKm,
    monthlyTarget: row.monthly_target ?? mockSnapshot.profile.monthlyTarget,
  };
};

const adaptQueue = (rows) =>
  rows.map((row) => ({
    id: row.id,
    driver: row.driver_name ?? row.driver_id ?? "Driver",
    route: row.route ?? "Route pending",
    vehicle: row.vehicle_registration ?? row.vehicle_id ?? "Vehicle",
    submittedAt: row.submitted_at
      ? new Date(row.submitted_at).toLocaleTimeString("en-ZA", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "--:--",
    claimed: Number(row.claimed_amount ?? 0),
    counted: Number(row.counted_amount ?? 0),
    shortage: Number(row.shortage_amount ?? 0),
    gapKm: Number(row.gap_km ?? 0),
    status: row.status ?? "Submitted",
  }));

const adaptVehicles = (rows) =>
  rows.map((row) => ({
    id: row.id,
    registration: row.registration,
    model: row.model,
    route: row.route ?? "Route pending",
    status: row.status ?? "active",
    utilisation: row.utilisation ?? 0,
    currentOdometer: row.current_odometer ?? 0,
    lastServiceOdo: row.last_service_odo ?? row.current_odometer ?? 0,
    serviceIntervalKm: row.service_interval_km ?? mockSnapshot.profile.serviceIntervalKm,
    permitExpiryDate: row.permit_expiry_date ?? null,
    discExpiryDate: row.disc_expiry_date ?? null,
    assignedDriverId: row.assigned_driver_id ?? null,
    archivedAt: row.archived_at ?? null,
  }));

const adaptDocuments = (rows) =>
  rows.map((row) => ({
    subject: row.subject_name ?? row.subject_id ?? row.subject_type,
    document: row.document_type,
    daysLeft: Number(row.days_left ?? 0),
    stage: row.stage ?? "Watch",
    owner: row.owner_role ?? "Manager",
    action: row.action_required ?? "Review renewal status.",
  }));

const adaptDrivers = (rows) =>
  rows.map((row) => ({
    staffId: row.id ?? row.staff_id ?? row.employee_code ?? row.full_name,
    name: row.full_name,
    route: row.route ?? "Route pending",
    shiftStatus: row.shift_status ?? "Available",
    avgShiftRevenue: Number(row.avg_shift_revenue ?? 0),
    cashAccuracy: Number(row.cash_accuracy ?? 0),
    prdpExpiryDate: row.prdp_expiry_date ?? null,
    role: row.role ?? "Driver",
  }));

const adaptDefects = (rows) =>
  rows.map((row) => ({
    id: row.id,
    vehicleId: row.vehicle_id ?? null,
    category: row.category ?? row.component ?? "Other",
    vehicle: row.vehicle_registration ?? row.vehicle_id ?? "Vehicle",
    issue: row.issue,
    detail: row.detail ?? row.notes ?? row.issue,
    severity: row.severity,
    reportedAt: row.reported_at ?? null,
    reportedByStaffId: row.reported_by_staff_id ?? row.reported_by ?? null,
    status: row.status ?? "open",
    costEstimate: Number(row.cost_estimate ?? 0),
    repairCost: row.repair_cost != null ? Number(row.repair_cost) : null,
    resolvedAt: row.resolved_at ?? null,
    resolvedExpenseId: row.resolved_expense_id ?? null,
  }));

export const repository = {
  backendMode: hasSupabaseConfig ? "supabase" : "mock",
  async loadSnapshot() {
    if (!hasSupabaseConfig || !supabase) {
      return mockSnapshot;
    }

    try {
      const [
        profileResult,
        queueResult,
        vehicleResult,
        documentResult,
        driverResult,
        defectResult,
      ] = await Promise.all([
        supabase.from("fleet_profiles").select("*").limit(1).maybeSingle(),
        supabase
          .from("shift_reconciliations")
          .select("*")
          .order("submitted_at", { ascending: false })
          .limit(6),
        supabase.from("vehicles").select("*").order("registration"),
        supabase
          .from("compliance_dashboard")
          .select("*")
          .order("days_left")
          .limit(10),
        supabase.from("personnel_profiles").select("*").order("full_name"),
        supabase
          .from("defect_reports")
          .select("*")
          .order("reported_at", { ascending: false })
          .limit(8),
      ]);

      if (
        profileResult.error ||
        queueResult.error ||
        vehicleResult.error ||
        documentResult.error ||
        driverResult.error ||
        defectResult.error
      ) {
        return mockSnapshot;
      }

      return {
        ...mockSnapshot,
        profile: adaptProfile(profileResult.data),
        verificationQueue: normalizeRecords(
          adaptQueue(queueResult.data ?? []),
          mockSnapshot.verificationQueue,
        ),
        vehicles: normalizeRecords(
          adaptVehicles(vehicleResult.data ?? []),
          mockSnapshot.vehicles,
        ),
        documents: normalizeRecords(
          adaptDocuments(documentResult.data ?? []),
          mockSnapshot.documents,
        ),
        drivers: normalizeRecords(
          adaptDrivers(driverResult.data ?? []),
          mockSnapshot.drivers,
        ),
        defects: normalizeRecords(
          adaptDefects(defectResult.data ?? []),
          mockSnapshot.defects,
        ),
      };
    } catch {
      return mockSnapshot;
    }
  },
};
