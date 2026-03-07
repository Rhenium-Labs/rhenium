import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";

interface ToggleSwitchProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}

export function ToggleSwitch({
  label,
  description,
  checked,
  onChange,
  disabled,
  id,
}: ToggleSwitchProps) {
  const switchId = id ?? `toggle-${label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <Field
      orientation="horizontal"
      className="rounded-lg border border-discord-divider bg-discord-panel p-4"
    >
      <FieldContent>
        <FieldLabel htmlFor={switchId} className="text-discord-text">
          {label}
        </FieldLabel>
        {description && (
          <FieldDescription className="text-discord-muted">
            {description}
          </FieldDescription>
        )}
      </FieldContent>
      <Switch
        id={switchId}
        variant="discord"
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
      />
    </Field>
  );
}
