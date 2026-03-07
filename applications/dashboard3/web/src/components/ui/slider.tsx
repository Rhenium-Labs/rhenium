import * as React from "react";
import { Slider as SliderPrimitive } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const thumbVariants = cva(
  "block size-5 rounded-full border-2 border-primary bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "",
        discord:
          "border-discord-blurple bg-discord-blurple focus-visible:ring-discord-blurple focus-visible:ring-offset-discord-panel",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const Slider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  React.ComponentProps<typeof SliderPrimitive.Root> &
    VariantProps<typeof thumbVariants>
>(({ className, variant = "default", value, defaultValue, ...props }, ref) => {
  const thumbCount = (value ?? defaultValue ?? [0]).length;
  return (
    <SliderPrimitive.Root
      ref={ref}
      data-slot="slider"
      data-variant={variant}
      value={value}
      defaultValue={defaultValue}
      className={cn(
        "relative flex w-full touch-none select-none items-center",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(
          "relative h-2 w-full grow overflow-hidden rounded-full",
          variant === "default" && "bg-primary/20",
          variant === "discord" && "bg-discord-divider"
        )}
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={cn(
            "absolute h-full",
            variant === "default" && "bg-primary",
            variant === "discord" && "bg-discord-blurple"
          )}
        />
      </SliderPrimitive.Track>
      {Array.from({ length: thumbCount }).map((_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          data-slot="slider-thumb"
          data-variant={variant}
          className={cn(thumbVariants({ variant }))}
        />
      ))}
    </SliderPrimitive.Root>
  );
});
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider, thumbVariants };
