import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { useGetStaff, useCreateStaff, useDeactivateStaff, useEditStaff, getStaffDetailsQueryOptions } from "./queries";
import { useGetLocations } from "../Location/queries";
import { useAssignStaffToLocation } from "../Assignment/queries";
import PageHeader from "@/components/common/PageHeader";
import DataTable from "@/components/common/DataTable";
import StatusBadge from "@/components/common/StatusBadge";
import LoadingSpinner from "@/components/common/LoadingSpinner";
import type { Column } from "@/components/common/DataTable";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Users, Plus, Search, Pencil, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import StatCard from "@/components/common/StatCard";
import FilterBar from "@/components/common/FilterBar";
import { useQueryClient } from "@tanstack/react-query";

interface StaffMember {
  id: number;
  name: string;
  email: string;
  locationId: number | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  isActive: boolean;
}

interface CreateStaffForm {
  name: string;
  email: string;
  password: string;
  locationId?: string;
}

const fmtTime = (d: string | null) => {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const toTimeValue = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const inputCls =
  "flex h-11 w-full rounded-2xl border border-border/80 bg-background/90 px-4 py-2 text-sm shadow-xs outline-none focus:border-primary/60 focus:ring-4 focus:ring-primary/10";

export default function StaffPage() {
  const { data, isLoading } = useGetStaff();
  const locationsQuery = useGetLocations();
  const createStaff = useCreateStaff();
  const deactivateStaff = useDeactivateStaff();
  const editStaffMutation = useEditStaff();
  const assignLocation = useAssignStaffToLocation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "", email: "", shiftStart: "", shiftEnd: "", locationId: "" as string,
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateStaffForm>();

  if (isLoading) return <LoadingSpinner fullScreen />;

  const staff: StaffMember[] = data?.data ?? [];
  const locations = locationsQuery.data?.data ?? [];

  const filtered = staff.filter((s) => {
    const matchesSearch = s.name.toLowerCase().includes(search.toLowerCase()) || s.email.toLowerCase().includes(search.toLowerCase());
    const matchesLocation = locationFilter === "all" ? true : locationFilter === "unassigned" ? s.locationId === null : s.locationId === Number(locationFilter);
    return matchesSearch && matchesLocation;
  });
  const assignedStaffCount = staff.filter((s) => s.locationId !== null).length;
  const activeStaffCount = staff.filter((s) => s.isActive).length;

  const locMap = new Map(locations.map((l: any) => [l.id, l.name]));

  const extractError = (err: any) =>
    err?.response?.data?.message || err?.response?.data?.errors?.map((e: any) => e.message).join(", ") || err?.message || "An error occurred";

  const handleEditOpen = (s: StaffMember) => {
    setEditError(null);
    setEditingStaff(s);
    setEditForm({
      name: s.name, email: s.email,
      shiftStart: toTimeValue(s.shiftStart), shiftEnd: toTimeValue(s.shiftEnd),
      locationId: s.locationId ? String(s.locationId) : "",
    });
  };

  const handleEditSave = async () => {
    if (!editingStaff) return;
    setEditError(null);
    try {
      const payload: Record<string, any> = {};
      if (editForm.name !== editingStaff.name) payload.name = editForm.name;
      if (editForm.email !== editingStaff.email) payload.email = editForm.email;
      if (editForm.shiftStart && editForm.shiftStart !== toTimeValue(editingStaff.shiftStart)) {
        const base = editingStaff.shiftStart ? new Date(editingStaff.shiftStart) : new Date();
        const [h, m] = editForm.shiftStart.split(":").map(Number);
        base.setHours(h, m, 0, 0); payload.shiftStart = base.toISOString();
      }
      if (editForm.shiftEnd && editForm.shiftEnd !== toTimeValue(editingStaff.shiftEnd)) {
        const base = editingStaff.shiftEnd ? new Date(editingStaff.shiftEnd) : new Date();
        const [h, m] = editForm.shiftEnd.split(":").map(Number);
        base.setHours(h, m, 0, 0); payload.shiftEnd = base.toISOString();
      }
      if (Object.keys(payload).length > 0) {
        await new Promise<void>((resolve, reject) => {
          editStaffMutation.mutate({ id: editingStaff.id, data: payload }, { onSuccess: () => resolve(), onError: (err) => reject(err) });
        });
      }
      const newLoc = editForm.locationId ? Number(editForm.locationId) : null;
      if (newLoc && newLoc !== editingStaff.locationId) {
        await new Promise<void>((resolve, reject) => {
          assignLocation.mutate({ staffId: editingStaff.id, locationId: newLoc }, { onSuccess: () => resolve(), onError: (err) => reject(err) });
        });
      }
      setEditingStaff(null);
    } catch (err: unknown) { setEditError(extractError(err)); }
  };

  const columns: Column<StaffMember>[] = [
    {
      key: "name", header: "Name",
      render: (s) => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-50 text-xs font-bold text-teal-700">
            {s.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
          </div>
          <span className="font-medium text-gray-800">{s.name}</span>
        </div>
      ),
    },
    { key: "email", header: "Email", render: (s) => <span className="text-gray-500">{s.email}</span> },
    {
      key: "location", header: "Location",
      render: (s) => s.locationId
        ? <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-medium text-teal-700">{(locMap.get(s.locationId) as string) ?? `#${s.locationId}`}</span>
        : <span className="text-gray-400">Unassigned</span>,
    },
    {
      key: "shift", header: "Shift",
      render: (s) => <span className="text-gray-600">{fmtTime(s.shiftStart)} – {fmtTime(s.shiftEnd)}</span>,
    },
    { key: "status", header: "Status", render: (s) => <StatusBadge status={s.isActive ? "ACTIVE" : "INACTIVE"} /> },
    {
      key: "actions", header: "Actions",
      render: (s) => (
        <div className="flex items-center gap-2">
          <button onClick={(e) => { e.stopPropagation(); handleEditOpen(s); }} className="rounded-lg px-3 py-1.5 text-xs font-medium text-teal-600 transition-colors hover:bg-teal-50"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={(e) => { e.stopPropagation(); if (confirm(`Deactivate ${s.name}?`)) deactivateStaff.mutate(s.id); }} className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-50">Deactivate</button>
        </div>
      ),
    },
  ];

  const onCreateSubmit = (formData: CreateStaffForm) => {
    createStaff.mutate(
      { name: formData.name, email: formData.email, password: formData.password, locationId: formData.locationId ? Number(formData.locationId) : undefined },
      { onSuccess: () => { reset(); setDialogOpen(false); } }
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Staff" subtitle={`${staff.length} team members`} action={
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-2xl px-4">
              <Plus className="h-4 w-4" /> Add Staff
            </Button>
          </DialogTrigger>
          <DialogContent className="border-border/70 bg-card text-card-foreground sm:max-w-xl">
            <DialogHeader><DialogTitle>Add Staff Member</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit(onCreateSubmit)} className="space-y-4 pt-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Full Name</label>
                <Input {...register("name", { required: "Name is required" })} placeholder="John Smith" />
                {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>}
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Email</label>
                <Input type="email" {...register("email", { required: "Email is required" })} placeholder="john@company.com" />
                {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>}
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Password</label>
                <Input type="password" {...register("password", { required: "Password is required" })} placeholder="••••••••" />
                {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password.message}</p>}
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Location (optional)</label>
                <select {...register("locationId")} className={inputCls}>
                  <option value="">No location</option>
                  {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" className="flex-1 rounded-2xl" onClick={() => { reset(); setDialogOpen(false); }}>Cancel</Button>
                <Button type="submit" disabled={createStaff.isPending} className="flex-1 rounded-2xl">{createStaff.isPending ? "Creating..." : "Create staff"}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      } />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Team members" value={staff.length} icon={Users} />
        <StatCard label="Assigned to location" value={assignedStaffCount} icon={MapPin} tone="sky" />
        <StatCard label="Active staff" value={activeStaffCount} icon={Plus} tone="emerald" />
      </div>

      <FilterBar>
        <div className="relative max-w-sm sm:max-w-none">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search staff by name or email..." className="pl-10" />
        </div>
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className={`${inputCls} appearance-none pl-10 pr-8`}>
            <option value="all">All Locations</option>
            <option value="unassigned">Unassigned</option>
            {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      </FilterBar>

      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(s) => s.id}
        emptyIcon={<Users className="h-12 w-12" />}
        emptyMessage="No staff members found."
        onRowHover={(s) => {
          queryClient.prefetchQuery(getStaffDetailsQueryOptions(s.id));
        }}
        onRowClick={(s) => navigate(`/staff/${s.id}`)}
      />

      {editingStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4" onClick={() => setEditingStaff(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[1.75rem] border border-border/70 bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-5 text-lg font-bold text-foreground">Edit Staff</h2>
            <div className="space-y-4">
              <div><label className="mb-1.5 block text-sm font-medium text-foreground">Name</label><Input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
              <div><label className="mb-1.5 block text-sm font-medium text-foreground">Email</label><Input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} /></div>
              <div><label className="mb-1.5 block text-sm font-medium text-foreground">Location</label>
                <select value={editForm.locationId} onChange={(e) => setEditForm({ ...editForm, locationId: e.target.value })} className={inputCls}>
                  <option value="">Unassigned</option>
                  {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="mb-1.5 block text-sm font-medium text-foreground">Shift Start</label><Input type="time" value={editForm.shiftStart} onChange={(e) => setEditForm({ ...editForm, shiftStart: e.target.value })} /></div>
                <div><label className="mb-1.5 block text-sm font-medium text-foreground">Shift End</label><Input type="time" value={editForm.shiftEnd} onChange={(e) => setEditForm({ ...editForm, shiftEnd: e.target.value })} /></div>
              </div>
              {editError && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{editError}</div>}
              <div className="flex gap-3 pt-3">
                <Button onClick={() => setEditingStaff(null)} variant="outline" className="flex-1 rounded-2xl">Cancel</Button>
                <Button onClick={handleEditSave} disabled={editStaffMutation.isPending || assignLocation.isPending || !editForm.name.trim() || !editForm.email.trim()} className="flex-1 rounded-2xl">{editStaffMutation.isPending || assignLocation.isPending ? "Saving..." : "Save changes"}</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
