import * as React from "react";
import { cn } from "@/lib/utils";

interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: "vertical" | "horizontal";
  "data-invalid"?: boolean;
  "data-disabled"?: boolean;
}

const Field = React.forwardRef<HTMLDivElement, FieldProps>(
  ({ className, orientation = "vertical", "data-invalid": dataInvalid, "data-disabled": dataDisabled, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="field"
      data-orientation={orientation}
      data-invalid={dataInvalid}
      data-disabled={dataDisabled}
      className={cn(
        "flex gap-2",
        orientation === "horizontal"
          ? "flex-row items-center justify-between"
          : "flex-col items-stretch",
        className
      )}
      {...props}
    />
  )
);
Field.displayName = "Field";

const FieldLabel = React.forwardRef<
  HTMLLabelElement,
  React.ComponentProps<"label">
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    data-slot="field-label"
    className={cn(
      "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
      "data-invalid:text-destructive",
      className
    )}
    {...props}
  />
));
FieldLabel.displayName = "FieldLabel";

const FieldDescription = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentProps<"p">
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    data-slot="field-description"
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
FieldDescription.displayName = "FieldDescription";

const FieldGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="field-group"
    className={cn("space-y-4", className)}
    {...props}
  />
));
FieldGroup.displayName = "FieldGroup";

const FieldContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="field-content"
    className={cn("min-w-0 flex-1 space-y-1.5", className)}
    {...props}
  />
));
FieldContent.displayName = "FieldContent";

export { Field, FieldLabel, FieldDescription, FieldGroup, FieldContent };
