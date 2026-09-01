import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import MultiSelectChecklist from "@/components/common/MultiSelectChecklist";

export type TenantRoleValue = "admin" | "member" | "guest";

export interface TenantOption {
  id: string;
  name: string;
}

export interface TenantAssignment {
  tenant_id: string;
  role: TenantRoleValue;
}

const ROLES: { value: TenantRoleValue; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
  { value: "guest", label: "Guest" },
];

/** Multi-select tenant membership editor with a role per selected tenant. */
export function TenantAssigner({
  tenants,
  value,
  onChange,
  label = "Tenant",
}: {
  tenants: TenantOption[];
  value: TenantAssignment[];
  onChange: (v: TenantAssignment[]) => void;
  label?: string;
}) {
  const selectedIds = value.map((v) => v.tenant_id);
  const nameOf = (id: string) => tenants.find((t) => t.id === id)?.name || "Unknown company";

  const setSelected = (ids: string[]) => {
    const next: TenantAssignment[] = ids.map(
      (id) => value.find((v) => v.tenant_id === id) || { tenant_id: id, role: "member" },
    );
    onChange(next);
  };

  return (
    <div>
      <Label>{label}</Label>
      <MultiSelectChecklist
        options={tenants.map((t) => ({ value: t.id, label: t.name }))}
        selected={selectedIds}
        onChange={setSelected}
        allLabel="No company"
        emptyLabel="No companies"
        searchable
      />
      {value.length > 0 && (
        <div className="mt-2 space-y-2">
          {value.map((assignment) => (
            <div
              key={assignment.tenant_id}
              className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5"
            >
              <span className="flex-1 text-sm truncate">{nameOf(assignment.tenant_id)}</span>
              <Select
                value={assignment.role}
                onValueChange={(r) =>
                  onChange(
                    value.map((v) =>
                      v.tenant_id === assignment.tenant_id ? { ...v, role: r as TenantRoleValue } : v,
                    ),
                  )
                }
              >
                <SelectTrigger className="h-8 w-[120px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => onChange(value.filter((v) => v.tenant_id !== assignment.tenant_id))}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default TenantAssigner;
