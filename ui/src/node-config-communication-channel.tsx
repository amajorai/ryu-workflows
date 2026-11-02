import {
	Input,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ryu/blocks/companion/controls";
import type { ChangeEvent } from "react";
import { TemplateField } from "./node-config-agent.tsx";
import type { NodeConfigValue, VariableToken } from "./node-config-model.ts";
import { type NodeFieldUpdateValue, parseNodeText } from "./schemas.ts";

const CHANNEL_PLATFORM_OPTIONS = [
	{ value: "telegram", label: "Telegram" },
	{ value: "slack", label: "Slack" },
	{ value: "discord", label: "Discord" },
	{ value: "webhook", label: "Webhook" },
];

/** Config fields for a ChannelSend node: pick the channel transport, address a
 *  recipient, and template the message. Telegram takes a bot token + chat id;
 *  Slack/Discord/webhook take an incoming-webhook URL (the URL encodes the
 *  destination, so `recipient` is hidden for those). */
export function ChannelSendFields({
	value,
	update,
	variables,
}: {
	update: (key: string, val: NodeFieldUpdateValue) => void;
	value: NodeConfigValue;
	variables: VariableToken[];
}) {
	const platform = parseNodeText(value.extra.platform) ?? "telegram";
	const isTelegram = platform === "telegram";

	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-channel-platform">Channel</Label>
				<Select
					items={CHANNEL_PLATFORM_OPTIONS}
					onValueChange={(v: string) => update("platform", v)}
					value={platform}
				>
					<SelectTrigger id="cfg-channel-platform">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{CHANNEL_PLATFORM_OPTIONS.map((opt) => (
							<SelectItem key={opt.value} value={opt.value}>
								{opt.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{isTelegram ? (
				<>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cfg-channel-token">Bot token</Label>
						<Input
							id="cfg-channel-token"
							onChange={(e: ChangeEvent<HTMLInputElement>) =>
								update("bot_token", e.target.value)
							}
							placeholder="123456:ABC-DEF…"
							type="password"
							value={parseNodeText(value.extra.bot_token) ?? ""}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cfg-channel-recipient">
							Send to (chat id / @username)
						</Label>
						<TemplateField
							className="h-10 text-xs"
							id="cfg-channel-recipient"
							onChange={(next) => update("recipient", next)}
							value={parseNodeText(value.extra.recipient) ?? ""}
							variables={variables}
						/>
					</div>
				</>
			) : (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="cfg-channel-webhook">Webhook URL</Label>
					<Input
						id="cfg-channel-webhook"
						onChange={(e: ChangeEvent<HTMLInputElement>) =>
							update("webhook_url", e.target.value)
						}
						placeholder="https://hooks.slack.com/..."
						value={parseNodeText(value.extra.webhook_url) ?? ""}
					/>
					<p className="text-muted-foreground text-xs">
						The incoming-webhook URL encodes the destination channel.
					</p>
				</div>
			)}
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="cfg-channel-text">Message</Label>
				<TemplateField
					id="cfg-channel-text"
					onChange={(next) => update("text", next)}
					value={parseNodeText(value.extra.text) ?? ""}
					variables={variables}
				/>
			</div>
		</>
	);
}
