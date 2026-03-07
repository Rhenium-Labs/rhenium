import { GuildService } from "@/service/guild";
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

interface ChannelSelectProps {
  guildId: string;
  value: string | null;
  onChange: (channelId: string | null) => void;
  label?: string;
  placeholder?: string;
  filterTypes?: number[];
}

export function ChannelSelect({
  guildId,
  value,
  onChange,
  label,
  placeholder = "Select a channel",
  filterTypes,
}: ChannelSelectProps) {
  const { data: channels, isLoading, fetch } = GuildService.useChannels(guildId);

  const filtered = filterTypes
    ? channels?.filter((c: { type: number }) => filterTypes.includes(c.type))
    : channels;

  return (
    <div className="space-y-1.5">
      {label && (
        <FieldLabel className="text-xs font-medium uppercase tracking-wider text-discord-muted">
          {label}
        </FieldLabel>
      )}
      <Select
        value={value ?? "__none__"}
        onValueChange={(v) => onChange(v === "__none__" ? null : v)}
        onOpenChange={(open) => { if (open) fetch(); }}
      >
        <SelectTrigger variant="discord" className="w-full">
          <SelectValue placeholder={isLoading ? <BouncingDots /> : placeholder} />
        </SelectTrigger>
        <SelectContent variant="discord">
          <SelectGroup>
            <SelectItem variant="discord" value="__none__">
              {isLoading ? <BouncingDots /> : placeholder}
            </SelectItem>
            {filtered?.map((channel: { id: string; name: string }) => (
              <SelectItem
                key={channel.id}
                variant="discord"
                value={channel.id}
              >
                # {channel.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
