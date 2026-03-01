import { useState } from "react";
import { LoggingService } from "@/service/logging";
import { useGuild } from "@/contexts/GuildContext";
import { ChannelSelect, DataTable } from "@/components/form";
import { LoadingScreen } from "@/components/LoadingScreen";
import { cn } from "@/lib/utils";
import { Trash2, Plus, Pencil } from "lucide-react";

const ALL_EVENTS = [
	"MessageReportReviewed",
	"BanRequestReviewed",
	"BanRequestResult",
	"QuickPurgeExecuted",
	"QuickPurgeResult",
	"QuickMuteExecuted",
	"QuickMuteResult",
] as const;

type LoggingEvent = (typeof ALL_EVENTS)[number];

export function LoggingPage() {
	const { guildId } = useGuild();
	const { data: webhooks, isLoading, error } = LoggingService.useList(guildId);
	const { mutate: createWebhook, isPending: isCreating } = LoggingService.useCreate(guildId);
	const { mutate: updateWebhook } = LoggingService.useUpdate(guildId);
	const { mutate: deleteWebhook } = LoggingService.useDelete(guildId);

	const [showCreate, setShowCreate] = useState(false);
	const [newChannel, setNewChannel] = useState<string | null>(null);
	const [newEvents, setNewEvents] = useState<LoggingEvent[]>([]);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editEvents, setEditEvents] = useState<LoggingEvent[]>([]);

	if (isLoading) return <LoadingScreen className="relative bg-transparent" />;
	if (error) {
		return <div className="p-6 text-sm text-discord-muted">{error}</div>;
	}

	function handleCreate() {
		if (!newChannel || newEvents.length === 0) return;
		createWebhook({ guildId, data: { channel_id: newChannel, events: newEvents } });
		setShowCreate(false);
		setNewChannel(null);
		setNewEvents([]);
	}

	function handleUpdate(webhookId: string) {
		if (editEvents.length === 0) return;
		updateWebhook({ guildId, webhookId, data: { events: editEvents } });
		setEditingId(null);
		setEditEvents([]);
	}

	function startEdit(webhook: { id: string; events: string[] }) {
		setEditingId(webhook.id);
		setEditEvents(webhook.events as LoggingEvent[]);
	}

	return (
		<div className="flex h-full flex-col overflow-y-auto p-6">
			<div className="mb-4 flex items-center justify-between">
				<div>
					<h2 className="text-lg font-bold text-discord-text">Logging</h2>
					<p className="text-sm text-discord-muted">Manage logging webhooks and event subscriptions.</p>
				</div>
				<button
					type="button"
					onClick={() => setShowCreate(!showCreate)}
					className="flex items-center gap-1.5 rounded-md bg-discord-blurple px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-discord-blurple/80"
				>
					<Plus className="size-4" />
					New Webhook
				</button>
			</div>

			{showCreate && (
				<div className="mb-4 space-y-3 rounded-lg border border-discord-divider bg-discord-panel p-4">
					<ChannelSelect
						guildId={guildId}
						value={newChannel}
						onChange={setNewChannel}
						label="Channel"
						filterTypes={[0]}
					/>
					<EventSelector
						value={newEvents}
						onChange={setNewEvents}
					/>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={handleCreate}
							disabled={isCreating || !newChannel || newEvents.length === 0}
							className="rounded-md bg-discord-success px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-discord-success/80 disabled:opacity-50"
						>
							{isCreating ? "Creating..." : "Create"}
						</button>
						<button
							type="button"
							onClick={() => setShowCreate(false)}
							className="rounded-md px-3 py-1.5 text-sm text-discord-muted hover:text-discord-text"
						>
							Cancel
						</button>
					</div>
				</div>
			)}

			<DataTable
				columns={[
					{ key: "channel_id", header: "Channel", render: (r) => r.channel_id },
					{
						key: "events",
						header: "Events",
						render: (r) =>
							editingId === r.id ? (
								<EventSelector value={editEvents} onChange={setEditEvents} compact />
							) : (
								<div className="flex flex-wrap gap-1">
									{r.events.map((e) => (
										<span key={e} className="rounded bg-discord-sidebar px-1.5 py-0.5 text-xs text-discord-muted">
											{e}
										</span>
									))}
								</div>
							),
					},
					{
						key: "actions",
						header: "",
						className: "w-24",
						render: (r) =>
							editingId === r.id ? (
								<div className="flex gap-1">
									<button
										type="button"
										onClick={() => handleUpdate(r.id)}
										className="rounded px-2 py-1 text-xs text-discord-success hover:underline"
									>
										Save
									</button>
									<button
										type="button"
										onClick={() => setEditingId(null)}
										className="rounded px-2 py-1 text-xs text-discord-muted hover:underline"
									>
										Cancel
									</button>
								</div>
							) : (
								<div className="flex gap-1">
									<button
										type="button"
										onClick={() => startEdit(r)}
										className="rounded p-1 text-discord-muted transition-colors hover:text-discord-text"
									>
										<Pencil className="size-3.5" />
									</button>
									<button
										type="button"
										onClick={() => deleteWebhook({ guildId, webhookId: r.id })}
										className="rounded p-1 text-discord-muted transition-colors hover:text-destructive"
									>
										<Trash2 className="size-3.5" />
									</button>
								</div>
							),
					},
				]}
				data={webhooks ?? []}
				keyExtractor={(r) => r.id}
				emptyMessage="No logging webhooks configured"
			/>
		</div>
	);
}

function EventSelector({
	value,
	onChange,
	compact,
}: {
	value: LoggingEvent[];
	onChange: (events: LoggingEvent[]) => void;
	compact?: boolean;
}) {
	return (
		<div className="space-y-1.5">
			{!compact && (
				<label className="text-xs font-medium uppercase tracking-wider text-discord-muted">
					Events
				</label>
			)}
			<div className="flex flex-wrap gap-1.5">
				{ALL_EVENTS.map((event) => {
					const active = value.includes(event);
					return (
						<button
							key={event}
							type="button"
							onClick={() => {
								const next = active
									? value.filter((e) => e !== event)
									: [...value, event];
								onChange(next);
							}}
							className={cn(
								"rounded-md border px-2 py-1 text-xs font-medium transition-colors",
								active
									? "border-discord-blurple bg-discord-blurple/20 text-discord-text"
									: "border-discord-divider text-discord-muted hover:text-discord-text",
							)}
						>
							{event}
						</button>
					);
				})}
			</div>
		</div>
	);
}
