import * as React from "react";
import { ChevronDownIcon, CheckIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

const triggerVariants = cva(
  "flex h-9 w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm shadow-xs transition-colors focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 [&>span]:flex [&>span]:items-center [&>span]:gap-2",
  {
    variants: {
      variant: {
        default:
          "border-input bg-background ring-ring focus:ring-offset-background [&>svg]:text-muted-foreground",
        discord:
          "border-discord-divider bg-discord-sidebar text-discord-text ring-discord-blurple focus:ring-offset-discord-panel [&>svg]:text-discord-muted",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const contentVariants = cva(
  "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
  {
    variants: {
      variant: {
        default: "border-input bg-popover text-popover-foreground",
        discord:
          "border-discord-divider bg-discord-panel text-discord-text",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const itemVariants = cva(
  "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4",
  {
    variants: {
      variant: {
        default: "pl-8 pr-8 focus:bg-accent focus:text-accent-foreground",
        discord: "px-2 focus:bg-discord-hover",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

interface SelectTriggerProps
  extends React.ComponentProps<typeof SelectPrimitive.Trigger>,
    VariantProps<typeof triggerVariants> {}

const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  SelectTriggerProps
>(({ className, variant = "default", children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    data-slot="select-trigger"
    data-variant={variant}
    className={cn(triggerVariants({ variant }), className)}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDownIcon className="size-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

interface SelectContentProps
  extends React.ComponentProps<typeof SelectPrimitive.Content>,
    VariantProps<typeof contentVariants> {}

const SelectContent = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  SelectContentProps
>(
  (
    { className, variant = "default", children, position = "popper", ...props },
    ref
  ) => (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        data-slot="select-content"
        data-variant={variant}
        position={position}
        className={cn(contentVariants({ variant }), className)}
        {...props}
      >
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-(--radix-select-trigger-height) w-full min-w-(--radix-select-trigger-width)"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
);
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Label>,
  React.ComponentProps<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    data-slot="select-label"
    className={cn("px-2 py-1.5 text-sm font-medium", className)}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

interface SelectItemProps
  extends React.ComponentProps<typeof SelectPrimitive.Item>,
    VariantProps<typeof itemVariants> {}

const SelectItem = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  SelectItemProps
>(({ className, variant = "default", children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    data-slot="select-item"
    data-variant={variant}
    className={cn(itemVariants({ variant }), className)}
    {...props}
  >
    {variant !== "discord" && (
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
    )}
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Separator>,
  React.ComponentProps<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    data-slot="select-separator"
    className={cn("-mx-1 my-1 h-px bg-border", className)}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  triggerVariants,
  contentVariants,
  itemVariants,
};
