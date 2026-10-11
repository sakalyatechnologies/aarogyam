/**
 * Settings → Roles & access: what each role can see and do. A grid of roles × permission groups
 * for the overview, then one role's permissions to edit, with presets, reset to default, a
 * confirmation listing every change, and who changed the role last. Needs `roles.manage`; the
 * API enforces every rule shown here (owner role fixed, not your own role, nothing you lack).
 */

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { PERMISSIONS, apiErrorOf, type AccessCatalogue, type CataloguePermission, type PermissionScope, type Role, type RoleChange, type RoleDetail, type RolePermission } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDateTime } from "@aarogyam/app-kit";
import { Button, Dialog, Field, Pill, Select, Skeleton, TextInput, useToast } from "@sakalya/ui";

import { Toggle } from "../../components/mk/index.js";
import { useClinic } from "../../clinic.js";
import { useNewLook } from "../../lib/new-look.js";
import { useAccessCatalogue, useCreateRole, useDeleteRole, useRole, useRoles, useSetRolePermissions } from "../../queries.js";

/** The groups the editor shows, in order, and the catalogue modules in each. */
export const PERMISSION_GROUPS: readonly { id: string; label: string; modules: readonly string[]; hint?: string }[] = [
  { id: "patients", label: "Patients", modules: ["patients"] },
  { id: "clinical", label: "Clinical", modules: ["clinical"] },
  { id: "appointments", label: "Appointments", modules: ["appointments"] },
  { id: "prescriptions", label: "Prescriptions", modules: ["prescriptions"] },
  {
    id: "money",
    label: "Billing & money",
    modules: ["billing", "finance", "expenses"],
    hint: "Finance and money: bills, payments, balances and the clinic's revenue. By default only the owner and finance roles see revenue.",
  },
  { id: "stock", label: "Stock", modules: ["inventory"] },
  { id: "reports", label: "Reports", modules: ["reports", "analytics"] },
  { id: "staff", label: "Staff & settings", modules: ["staff", "settings", "audit", "roles"] },
];

/** The standard roles offered as presets. */
const PRESETS = ["doctor", "front_desk", "assistant", "finance"] as const;

const SCOPE_LABEL: Record<PermissionScope, string> = {
  all: "All records",
  own: "Only their own",
  assigned: "Only assigned to them",
};

type Draft = ReadonlyMap<string, PermissionScope>;

function draftOf(permissions: readonly RolePermission[]): Draft {
  return new Map(permissions.map((p) => [p.key, p.scope]));
}

function sameDraft(a: Draft, b: Draft): boolean {
  return a.size === b.size && [...a].every(([key, scope]) => b.get(key) === scope);
}

function groupOf(permission: CataloguePermission) {
  return PERMISSION_GROUPS.find((group) => group.modules.includes(permission.module));
}

/** What a change does, in words: "Gave …", "Took away …", "Narrowed …". */
export function describeChange(before: Draft, after: Draft, catalogue: AccessCatalogue): string[] {
  const label = (key: string) => catalogue.permissions.find((p) => p.key === key)?.description ?? key;
  const lines: string[] = [];
  for (const [key, scope] of after) {
    const was = before.get(key);
    if (was === undefined) {
      lines.push(`Give: ${label(key)}${scope === "all" ? "" : ` (${SCOPE_LABEL[scope].toLowerCase()})`}`);
    } else if (was !== scope) {
      lines.push(`Change: ${label(key)}, from ${SCOPE_LABEL[was].toLowerCase()} to ${SCOPE_LABEL[scope].toLowerCase()}`);
    }
  }
  for (const key of before.keys()) {
    if (!after.has(key)) lines.push(`Take away: ${label(key)}`);
  }
  return lines;
}

/**
 * New look: the plain-language matrix, with the detailed editor one click away under "Advanced".
 * The old look shows the detailed editor alone, unchanged.
 */
export function RolesPanel() {
  const [newLook] = useNewLook();
  const [params] = useSearchParams();
  const [advanced, setAdvanced] = useState(params.has("role"));
  if (!newLook) {
    return <AdvancedRoles />;
  }
  return (
    <div className="flex flex-col gap-6">
      <SimpleRolesMatrix />
      <div>
        <button
          type="button"
          className="mk-link text-sm font-semibold"
          aria-expanded={advanced}
          onClick={() => {
            setAdvanced((open) => !open);
          }}
        >
          {advanced ? "Hide advanced roles editor" : "Advanced: fine control over each permission"}
        </button>
      </div>
      {advanced ? <AdvancedRoles /> : null}
    </div>
  );
}

function AdvancedRoles() {
  const roles = useRoles();
  const catalogue = useAccessCatalogue();
  const [params, setParams] = useSearchParams();
  const requested = params.get("role");
  const items = roles.data?.items ?? [];
  const selected = items.find((role) => role.key === requested)?.key ?? items.find((role) => role.key !== "owner")?.key;

  if (roles.isPending || catalogue.isPending) {
    return <Skeleton shape="block" />;
  }
  if (roles.isError || catalogue.isError) {
    return (
      <ApiErrorNotice
        title="Couldn't load roles and access"
        error={roles.error ?? catalogue.error}
        onRetry={() => {
          void roles.refetch();
          void catalogue.refetch();
        }}
      />
    );
  }
  const choose = (key: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", "roles");
    next.set("role", key);
    setParams(next, { replace: true });
  };
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">
        Choose what each role can see and do. Changes apply to everyone with the role on their next click. The owner role always has full access.
      </p>
      <RolesGrid roles={items} catalogue={catalogue.data} selected={selected} onSelect={choose} />
      {selected === undefined ? null : <RoleEditor key={selected} roleKey={selected} catalogue={catalogue.data} onDeleted={() => { choose("owner"); }} />}
      <NewRoleForm catalogue={catalogue.data} onCreated={choose} />
    </div>
  );
}

/** Roles across, permission groups down; each cell says how much of the group the role has. */
function RolesGrid({ roles, catalogue, selected, onSelect }: { roles: readonly Role[]; catalogue: AccessCatalogue; selected: string | undefined; onSelect: (key: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label="Roles and what they can do">
        <thead>
          <tr>
            <th scope="col" className="py-2 pr-3 text-left font-semibold text-muted">
              Area
            </th>
            {roles.map((role) => (
              <th key={role.key} scope="col" className="px-2 py-2 text-left">
                <button
                  type="button"
                  className={`font-semibold ${role.key === selected ? "text-primary underline" : "text-text"}`}
                  aria-pressed={role.key === selected}
                  onClick={() => {
                    onSelect(role.key);
                  }}
                >
                  {role.name}
                </button>
                <span className="block text-xs font-normal text-muted">
                  {role.member_count} {role.member_count === 1 ? "person" : "people"}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {PERMISSION_GROUPS.map((group) => {
            const inGroup = catalogue.permissions.filter((p) => group.modules.includes(p.module));
            return (
              <tr key={group.id}>
                <th scope="row" className="py-2 pr-3 text-left font-medium text-text">
                  {group.label}
                </th>
                {roles.map((role) => {
                  const held = inGroup.filter((p) => role.permissions.some((r) => r.key === p.key)).length;
                  const text = held === 0 ? "None" : held === inGroup.length ? "Full" : `${String(held)} of ${String(inGroup.length)}`;
                  return (
                    <td key={role.key} className="px-2 py-2">
                      <Pill tone={held === 0 ? "neutral" : held === inGroup.length ? "success" : "warning"}>{text}</Pill>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RoleEditor({ roleKey, catalogue, onDeleted }: { roleKey: string; catalogue: AccessCatalogue; onDeleted: () => void }) {
  const role = useRole(roleKey);
  if (role.isPending) {
    return <Skeleton shape="block" />;
  }
  if (role.isError) {
    return <ApiErrorNotice title="Couldn't load that role" error={role.error} onRetry={() => void role.refetch()} />;
  }
  // A new change (or another role) starts the form afresh from what is saved.
  return <RoleForm key={`${role.data.key}:${role.data.history[0]?.id ?? "initial"}`} role={role.data} catalogue={catalogue} onDeleted={onDeleted} />;
}

function RoleForm({ role, catalogue, onDeleted }: { role: RoleDetail; catalogue: AccessCatalogue; onDeleted: () => void }) {
  const { session } = useClinic();
  const save = useSetRolePermissions();
  const remove = useDeleteRole();
  const toast = useToast();
  const saved = useMemo(() => draftOf(role.permissions), [role.permissions]);
  const [draft, setDraft] = useState<Draft>(saved);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const own = session.membership.role_key === role.key;
  const readOnly = !role.editable || own;
  const changes = describeChange(saved, draft, catalogue);
  const dirty = !sameDraft(saved, draft);

  const set = (key: string, scope: PermissionScope | undefined) => {
    setDraft((prev) => {
      const next = new Map(prev);
      if (scope === undefined) next.delete(key);
      else next.set(key, scope);
      return next;
    });
  };
  const apply = (permissions: readonly RolePermission[]) => {
    setDraft(draftOf(permissions));
  };
  const submit = () => {
    save.mutate(
      { key: role.key, update: { permissions: [...draft].map(([key, scope]) => ({ key, scope })) } },
      {
        onSuccess: () => {
          setConfirming(false);
          toast.show({ title: `Saved access for ${role.name}`, tone: "success" });
        },
        onError: (thrown) => {
          setConfirming(false);
          toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't save that. Please try again.", tone: "danger" });
        },
      },
    );
  };

  return (
    <section aria-labelledby="role-editor-title" className="flex flex-col gap-4 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="role-editor-title" className="text-base font-bold text-text">
            {role.name}
          </h3>
          <p className="text-sm text-muted">
            {role.member_count} {role.member_count === 1 ? "person has" : "people have"} this role{role.is_template ? " · standard role" : " · custom role"}
          </p>
          <LastChange change={role.history[0]} catalogue={catalogue} />
        </div>
        {readOnly ? null : (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Presets">
            {PRESETS.map((key) => {
              const template = catalogue.templates.find((t) => t.key === key);
              return template === undefined ? null : (
                <Button
                  key={key}
                  variant="secondary"
                  onClick={() => {
                    apply(template.permissions);
                  }}
                >
                  Like {template.name}
                </Button>
              );
            })}
            {role.default_permissions.length > 0 ? (
              <Button
                variant="secondary"
                onClick={() => {
                  apply(role.default_permissions);
                }}
              >
                Reset to default
              </Button>
            ) : null}
          </div>
        )}
      </div>
      {!role.editable ? (
        <p className="text-sm font-medium text-text">The owner role always has full access, so it can't be changed.</p>
      ) : own ? (
        <p className="text-sm font-medium text-text">This is your own role. Ask an owner to change it.</p>
      ) : null}

      {PERMISSION_GROUPS.map((group) => {
        const permissions = catalogue.permissions.filter((p) => groupOf(p)?.id === group.id);
        if (permissions.length === 0) return null;
        return (
          <fieldset key={group.id} className={`flex flex-col gap-1 rounded-lg p-3 ${group.id === "money" ? "border-2 border-warning" : "border border-border"}`}>
            <legend className="px-1 text-sm font-bold text-text">{group.label}</legend>
            {group.hint === undefined ? null : <p className="text-xs text-muted">{group.hint}</p>}
            {permissions.map((permission) => {
              const scope = draft.get(permission.key);
              return (
                <div key={permission.key} className="flex flex-wrap items-center justify-between gap-3 py-1.5">
                  <span className="text-sm text-text">{permission.description}</span>
                  <span className="flex items-center gap-3">
                    {scope !== undefined && permission.scopes.length > 1 ? (
                      <Select
                        aria-label={`How far: ${permission.description}`}
                        disabled={readOnly}
                        options={permission.scopes.map((s) => ({ value: s, label: SCOPE_LABEL[s] }))}
                        value={scope}
                        onValueChange={(value) => {
                          const chosen = permission.scopes.find((s) => s === value);
                          if (chosen !== undefined) set(permission.key, chosen);
                        }}
                      />
                    ) : null}
                    <Toggle
                      checked={scope !== undefined}
                      disabled={readOnly}
                      label={permission.description}
                      onChange={(next) => {
                        set(permission.key, next ? "all" : undefined);
                      }}
                    />
                  </span>
                </div>
              );
            })}
          </fieldset>
        );
      })}
      <p className="text-xs text-muted">"Only their own" and "Only assigned to them" are saved now; each area applies them as it adds support, until then they reach all records.</p>

      {readOnly ? null : (
        <div className="flex flex-wrap justify-between gap-2">
          {role.is_template ? (
            <span />
          ) : (
            <Button
              variant="secondary"
              disabled={role.member_count > 0}
              onClick={() => {
                setDeleting(true);
              }}
            >
              {role.member_count > 0 ? "Move people off this role to remove it" : "Remove role"}
            </Button>
          )}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={!dirty}
              onClick={() => {
                setDraft(saved);
              }}
            >
              Undo changes
            </Button>
            <Button
              disabled={!dirty || save.isPending}
              onClick={() => {
                setConfirming(true);
              }}
            >
              Save changes
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Change access for ${role.name}?`}
        description={`This applies at once to the ${String(role.member_count)} ${role.member_count === 1 ? "person" : "people"} with this role.`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
            <Button onClick={submit} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <ul className="list-disc pl-5 text-sm text-text">
          {changes.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Dialog>
      <Dialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Remove ${role.name}?`}
        description="Nobody has this role. Its change history is kept."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setDeleting(false);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate(role.key, {
                  onSuccess: () => {
                    setDeleting(false);
                    toast.show({ title: `Removed ${role.name}`, tone: "success" });
                    onDeleted();
                  },
                  onError: (thrown) => {
                    setDeleting(false);
                    toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't remove that role.", tone: "danger" });
                  },
                });
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </section>
  );
}

/** "Last changed by Asha on 5 Oct, 10:30: gave …, took away …". */
function LastChange({ change, catalogue }: { change: RoleChange | undefined; catalogue: AccessCatalogue }) {
  if (change === undefined) {
    return <p className="text-xs text-muted">Not changed since the clinic was set up.</p>;
  }
  const what = change.action === "created" ? ["Created"] : describeChange(draftOf(change.before), draftOf(change.after), catalogue);
  return (
    <p className="text-xs text-muted">
      Last changed by <b>{change.changed_by_name ?? "someone who has left"}</b> on {formatDateTime(change.at)}
      {what.length === 0 ? "" : `: ${what.join("; ")}`}
    </p>
  );
}

function NewRoleForm({ catalogue, onCreated }: { catalogue: AccessCatalogue; onCreated: (key: string) => void }) {
  const create = useCreateRole();
  const toast = useToast();
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("assistant");
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      aria-label="New role"
      onSubmit={(event) => {
        event.preventDefault();
        setError(undefined);
        create.mutate(
          { name, template_key: template },
          {
            onSuccess: (created) => {
              setName("");
              toast.show({ title: `Created ${created.name}`, tone: "success" });
              onCreated(created.key);
            },
            onError: (thrown) => {
              setError(apiErrorOf(thrown)?.message ?? "Couldn't create that role.");
            },
          },
        );
      }}
    >
      <Field label="New role">
        <TextInput
          value={name}
          placeholder="Senior nurse"
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </Field>
      <Field label="Starts like">
        <Select options={catalogue.templates.filter((t) => t.key !== "owner").map((t) => ({ value: t.key, label: t.name }))} value={template} onValueChange={setTemplate} />
      </Field>
      <Button type="submit" variant="secondary" disabled={name.trim() === "" || create.isPending}>
        Add role
      </Button>
      {error === undefined ? null : (
        <p role="alert" className="w-full text-sm font-medium text-danger-text">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * The simple matrix's mapping: each plain-language area is a fixed group of detailed permission keys
 * (documented in docs/decisions.md, "Simple roles matrix"). A cell is On when the role holds every key,
 * Partial when some, Off when none. Keys in no group (patients.delete, support.grant, intake.write,
 * root.everything) are never touched by the matrix; they stay as the detailed editor left them.
 */
export const SIMPLE_AREAS: readonly { id: string; label: string; keys: readonly string[] }[] = [
  { id: "patients", label: "Patients", keys: ["patients.read", "patients.write"] },
  { id: "clinical", label: "Clinical notes and chart", keys: ["clinical.read", "clinical.write"] },
  { id: "prescriptions", label: "Prescriptions", keys: ["prescriptions.issue"] },
  { id: "appointments", label: "Appointments and queue", keys: ["appointments.read", "appointments.write"] },
  { id: "billing", label: "Billing and payments", keys: ["billing.read", "billing.write", "expenses.write"] },
  { id: "money", label: "Money reports", keys: ["finance.view", "analytics.view", "reports.export"] },
  { id: "stock", label: "Stock", keys: ["inventory.read", "inventory.manage"] },
  { id: "labs", label: "Labs", keys: ["labs.read", "labs.write"] },
  { id: "messages", label: "Messages", keys: ["messages.send", "chat.use", "patients.contact", "campaigns.manage"] },
  { id: "settings", label: "Settings and team", keys: ["settings.manage", "staff.manage", "roles.manage", "audit.view"] },
];

export type AreaState = "on" | "partial" | "off";
type Area = (typeof SIMPLE_AREAS)[number];

/** The area's keys that this clinic's catalogue knows (an unknown key is left out, not guessed). */
function areaKeys(area: Area, known: ReadonlySet<string>): string[] {
  return area.keys.filter((key) => known.has(key));
}

/** How much of an area a set of permissions holds. */
export function areaState(held: readonly RolePermission[], area: Area, known: ReadonlySet<string>): AreaState {
  const keys = areaKeys(area, known);
  const count = keys.filter((key) => held.some((p) => p.key === key)).length;
  return count === 0 ? "off" : count === keys.length ? "on" : "partial";
}

/**
 * The full permission list after switching an area on or off. On adds the missing keys (scope "all", or
 * the first scope the catalogue allows) and keeps any scope already chosen; off removes the area's keys.
 * Everything outside the area is kept exactly.
 */
export function setArea(held: readonly RolePermission[], area: Area, on: boolean, catalogue: AccessCatalogue): RolePermission[] {
  const known = new Set(catalogue.permissions.map((p) => p.key));
  const keys = new Set(areaKeys(area, known));
  const rest = held.filter((p) => !keys.has(p.key) || on);
  if (!on) return rest;
  const added = [...keys]
    .filter((key) => !held.some((p) => p.key === key))
    .map((key): RolePermission => {
      const scopes = catalogue.permissions.find((p) => p.key === key)?.scopes ?? [];
      return { key, scope: scopes.includes("all") ? "all" : (scopes[0] ?? "all") };
    });
  return [...rest, ...added].sort((a, b) => a.key.localeCompare(b.key));
}

const STATE_TEXT: Record<AreaState, string> = { on: "On", partial: "Partial", off: "Off" };
const STATE_STYLE: Record<AreaState, string> = {
  on: "bg-primary text-on-primary",
  partial: "bg-warning-soft text-text border border-warning",
  off: "bg-surface-muted text-muted",
};

type Undo = { roleKey: string; roleName: string; text: string; before: readonly RolePermission[] };

/** Roles across, plain-language areas down, one switch per cell. Each change saves at once and can be undone. */
function SimpleRolesMatrix() {
  const roles = useRoles();
  const catalogue = useAccessCatalogue();
  const { session, can } = useClinic();
  const save = useSetRolePermissions();
  const toast = useToast();
  const [undo, setUndo] = useState<Undo | undefined>(undefined);

  if (roles.isPending || catalogue.isPending) {
    return <Skeleton shape="block" />;
  }
  if (roles.isError || catalogue.isError) {
    return (
      <ApiErrorNotice
        title="Couldn't load roles and access"
        error={roles.error ?? catalogue.error}
        onRetry={() => {
          void roles.refetch();
          void catalogue.refetch();
        }}
      />
    );
  }
  const known = new Set(catalogue.data.permissions.map((p) => p.key));
  const send = (roleKey: string, permissions: readonly RolePermission[], onDone: () => void) => {
    save.mutate(
      { key: roleKey, update: { permissions: permissions.map(({ key, scope }) => ({ key, scope })) } },
      {
        onSuccess: onDone,
        onError: (thrown) => {
          toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't save that. Please try again.", tone: "danger" });
        },
      },
    );
  };
  const toggle = (role: Role, area: Area, state: AreaState) => {
    const on = state !== "on"; // Off and Partial both turn the whole group on.
    const text = `${role.name}: ${area.label} ${on ? "on" : "off"}`;
    send(role.key, setArea(role.permissions, area, on, catalogue.data), () => {
      setUndo({ roleKey: role.key, roleName: role.name, text, before: role.permissions });
      toast.show({ title: `Saved. ${text}`, tone: "success" });
    });
  };
  const revert = (change: Undo) => {
    send(change.roleKey, change.before, () => {
      setUndo(undefined);
      toast.show({ title: `Undone. ${change.roleName} is back as it was`, tone: "success" });
    });
  };

  return (
    <section aria-labelledby="simple-roles-title" className="flex flex-col gap-3">
      <div>
        <h3 id="simple-roles-title" className="text-base font-bold text-text">
          What each role can do
        </h3>
        <p className="text-sm text-muted">Tap a cell to switch an area on or off for everyone with that role. Changes save at once. The owner always has full access.</p>
      </div>
      <div role="status" aria-live="polite" className="min-h-8 text-sm text-text">
        {undo === undefined ? null : (
          <span className="flex flex-wrap items-center gap-3">
            <span>{undo.text}</span>
            <Button
              variant="secondary"
              disabled={save.isPending}
              onClick={() => {
                revert(undo);
              }}
            >
              Undo
            </Button>
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm" aria-label="What each role can do">
          <thead>
            <tr>
              <th scope="col" className="py-2 pr-3 text-left font-semibold text-muted">
                Area
              </th>
              {roles.data.items.map((role) => (
                <th key={role.key} scope="col" className="px-2 py-2 text-center font-semibold text-text">
                  {role.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {SIMPLE_AREAS.map((area) => (
              <tr key={area.id}>
                <th scope="row" className="py-2 pr-3 text-left font-medium text-text">
                  {area.label}
                </th>
                {roles.data.items.map((role) => {
                  const locked = role.key === "owner";
                  const state: AreaState = locked ? "on" : areaState(role.permissions, area, known);
                  const reason = locked
                    ? "The owner always has full access."
                    : role.key === session.membership.role_key
                      ? "This is your own role. Ask an owner to change it."
                      : areaKeys(area, known).some((key) => PERMISSIONS.some((p) => p === key && !can(p)))
                        ? "You can only give access you have yourself."
                        : undefined;
                  return (
                    <td key={role.key} className="px-2 py-2 text-center">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={state === "partial" ? "mixed" : state === "on"}
                        aria-disabled={reason !== undefined}
                        aria-label={`${role.name}: ${area.label}${reason === undefined ? "" : `. ${reason}`}`}
                        title={reason ?? (state === "partial" ? "Some of this is on. Tap to turn all of it on." : undefined)}
                        className={`inline-block min-w-16 rounded-full px-3 py-1 text-xs font-semibold ${STATE_STYLE[state]} ${reason === undefined ? "cursor-pointer" : "cursor-not-allowed opacity-70"}`}
                        onClick={() => {
                          if (reason === undefined && !save.isPending) toggle(role, area, state);
                        }}
                      >
                        {STATE_TEXT[state]}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
