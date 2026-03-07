import { useCallback, useState } from "react";
import { z } from "zod";

export interface UseFieldValidationOptions<T> {
  schema?: z.ZodType<T>;
  validateOn?: "blur" | "change" | "both";
}

export interface UseFieldValidationResult<T> {
  error: string | undefined;
  validate: (value: T) => boolean;
  clearError: () => void;
}

/**
 * Optional Zod validation for form fields.
 * Schema is optional by default; validation only runs when schema is provided.
 */
export function useFieldValidation<T>(
  _value: T,
  options: UseFieldValidationOptions<T> = {}
): UseFieldValidationResult<T> {
  const { schema } = options;
  const [error, setError] = useState<string | undefined>();

  const validate = useCallback(
    (val: T): boolean => {
      if (!schema) {
        setError(undefined);
        return true;
      }
      const result = schema.safeParse(val);
      if (result.success) {
        setError(undefined);
        return true;
      }
      const firstIssue = result.error.issues[0];
      setError(firstIssue?.message ?? "Invalid value");
      return false;
    },
    [schema]
  );

  const clearError = useCallback(() => setError(undefined), []);

  return { error, validate, clearError };
}

/**
 * Builds a Zod number schema from min/max when provided.
 * Returns undefined when no constraints are specified.
 */
export function buildNumberSchema(
  min?: number,
  max?: number,
  step?: number
): z.ZodNumber | undefined {
  if (min === undefined && max === undefined) return undefined;
  let schema = z.number();
  if (min !== undefined) schema = schema.min(min);
  if (max !== undefined) schema = schema.max(max);
  if (step !== undefined && step > 0) {
    schema = schema.refine(
      (n) => Math.abs((n - (min ?? 0)) % step) < 1e-10,
      `Must be a multiple of ${step}`
    );
  }
  return schema;
}
