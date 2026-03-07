import { GuildService } from "@/service/guild";
import { X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldLabel } from "@/components/ui/field";
import { BouncingDots } from "@/components/ui/bouncing-dots";

interface RoleSelectProps {
  guildId: string;
  value: string[];
  onChange: (roleIds: string[]) => void;
  label?: string;
  placeholder?: string;
}

function intToHex(color: number): string | undefined {
  if (color === 0) return undefined;
  return `#${color.toString(16).padStart(6, "0")}`;
}

export function RoleSelect({
  guildId,
  value,
  onChange,
  label,
  placeholder = "Add a role...",
}: RoleSelectProps) {
  const { data: roles, isLoading, fetch } = GuildService.useRoles(guildId);
  GuildService.useCachedRoles(guildId);

  const roleMap = new Map(roles?.map((r: { id: string }) => [r.id, r]) ?? []);
  const available = roles?.filter((r: { id: string }) => !value.includes(r.id)) ?? [];

  return (
    <div className="space-y-1.5">
      {label && (
        <FieldLabel className="text-xs font-medium uppercase tracking-wider text-discord-muted">
          {label}
        </FieldLabel>
      )}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((roleId) => {
            const role = roleMap.get(roleId) as { id: string; name: string; color: number } | undefined;
            return (
              <span
                key={roleId}
                className="flex items-center gap-1 rounded-full border border-discord-divider px-2 py-0.5 text-xs font-medium"
                style={{ color: role ? intToHex(role.color) : undefined }}
              >
                {role ? role.name : isLoading ? roleId : `Unknown Role (${roleId})`}
                <button
                  type="button"
                  onClick={() => onChange(value.filter((id) => id !== roleId))}
                  className="rounded-full p-0.5 text-discord-muted transition-colors hover:text-discord-text"
                >
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <Select
        value=""
        onValueChange={(v) => {
          if (v) onChange([...value, v]);
        }}
        onOpenChange={(open) => { if (open) fetch(); }}
        disabled={!!roles && !isLoading && available.length === 0}
      >
        <SelectTrigger variant="discord" className="w-full">
          <SelectValue
            placeholder={
              isLoading
                ? <BouncingDots />
                : available.length === 0
                  ? "All roles selected"
                  : placeholder
            }
          />
        </SelectTrigger>
        <SelectContent variant="discord">
          <SelectGroup>
            {isLoading && (
              <div className="flex justify-center py-2">
                <BouncingDots />
              </div>
            )}
            {available.map((role: { id: string; name: string }) => (
              <SelectItem key={role.id} variant="discord" value={role.id}>
                {role.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
