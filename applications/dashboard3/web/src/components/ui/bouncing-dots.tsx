export function BouncingDots() {
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="size-1.5 animate-bounce rounded-full bg-discord-muted [animation-delay:0ms]" />
      <span className="size-1.5 animate-bounce rounded-full bg-discord-muted [animation-delay:150ms]" />
      <span className="size-1.5 animate-bounce rounded-full bg-discord-muted [animation-delay:300ms]" />
    </span>
  );
}
