import { FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  useFieldValidation,
  buildNumberSchema,
} from "@/lib/useFieldValidation";
import { useCallback, useEffect } from "react";

interface NumberInputProps {
  label: string;
  description?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}

export function NumberInput({
  label,
  description,
  value,
  onChange,
  min,
  max,
  step,
  disabled,
}: NumberInputProps) {
  const schema = buildNumberSchema(min, max, step);
  const { error, validate, clearError } = useFieldValidation(value, { schema });

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const n = Number(e.target.value);
      if (!Number.isNaN(n)) {
        onChange(n);
        if (schema) validate(n);
      }
    },
    [onChange, schema, validate]
  );

  const handleBlur = useCallback(() => {
    if (schema) validate(value);
  }, [schema, validate, value]);

  useEffect(() => {
    if (!schema) clearError();
  }, [schema, clearError]);

  return (
    <div className="space-y-1.5" data-invalid={!!error}>
      <FieldLabel className="text-xs font-medium uppercase tracking-wider text-discord-muted">
        {label}
      </FieldLabel>
      {description && (
        <FieldDescription className="text-discord-muted">
          {description}
        </FieldDescription>
      )}
      <Input
        type="number"
        variant="discord"
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={error ? `${label}-error` : undefined}
      />
      {error && (
        <p id={`${label}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
