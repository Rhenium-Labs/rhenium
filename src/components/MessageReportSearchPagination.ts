import { type ButtonComponent, type ButtonInteraction, ComponentType } from "discord.js";

import type { ResponseData } from "@commands/Command";

import Component, { type ComponentExecutionContext } from "@components/Component";
import GuildConfig from "@config/GuildConfig";
import MessageReportUtils from "@utils/MessageReports";

export default class MessageReportSearchPagination extends Component {
	constructor() {
		super({ matches: /^report-search-(next|back|last|first)-\d{17,19}$/m });
	}

	async execute({
		interaction,
		config
	}: ComponentExecutionContext<"button">): Promise<ResponseData<"interaction"> | null> {
		const direction = interaction.customId.split("-")[2] as
			| "next"
			| "back"
			| "last"
			| "first";

		const controllerId = interaction.customId.split("-")[3];

		if (controllerId !== interaction.user.id)
			return {
				error: `Only the user who initiated the search can use these buttons.`
			};

		await interaction.deferUpdate();

		switch (direction) {
			case "next":
				return MessageReportSearchPagination._handleReportSearchPagination(
					interaction,
					config,
					{ pageOffset: 1 }
				);
			case "back":
				return MessageReportSearchPagination._handleReportSearchPagination(
					interaction,
					config,
					{ pageOffset: -1 }
				);
			case "first":
				return MessageReportSearchPagination._handleReportSearchPagination(
					interaction,
					config,
					{ page: 1 }
				);
			case "last":
				return MessageReportSearchPagination._handleReportSearchPagination(
					interaction,
					config,
					{ page: 0 }
				);
		}
	}

	/**
	 * Handle pagination for message report search results.
	 *
	 * @param interaction The button interaction.
	 * @param config The guild configuration.
	 * @param options The pagination options.
	 * @returns The response data to update the interaction with.
	 */

	private static async _handleReportSearchPagination(
		interaction: ButtonInteraction<"cached">,
		config: GuildConfig,
		options: PageOptions
	): Promise<ResponseData<"interaction">> {
		const embed = interaction.message.embeds.at(0);

		if (!embed)
			return {
				error: "Pagination failed. No embed found in the message."
			};

		// Format: "User ID: ${targetId}"
		const targetId = embed.footer?.text ? embed.footer.text.split(": ")[1] : null;
		const target = await interaction.client.users.fetch(targetId!).catch(() => null);

		let buttons: ButtonComponent[] = [];

		for (const row of interaction.message.components) {
			if ("components" in row) {
				buttons = row.components.filter(
					(c): c is ButtonComponent => c.type === ComponentType.Button
				);

				if (buttons.length > 0) break;
			}
		}

		if (buttons.length === 0)
			return {
				error: "Pagination failed. No buttons found in the message."
			};

		const pageCountButton = buttons[Math.floor(buttons.length / 2)];
		const [strCurrentPage, strTotalPages] = pageCountButton.label!.split(" / ");
		const page = MessageReportSearchPagination._parsePageOptions(
			options,
			parseInt(strCurrentPage),
			parseInt(strTotalPages)
		);

		const result = await MessageReportUtils.search({
			config,
			executor: interaction.member,
			target,
			page
		});

		if (!result.ok)
			return {
				error: result.message
			};

		return result.data;
	}

	/**
	 * Parse pagination options to determine the new page number.
	 *
	 * @param options The pagination options, either a page offset or an absolute page number.
	 * @param currentPage The current page number.
	 * @param totalPages The total number of pages available.
	 * @returns The new page number.
	 */

	private static _parsePageOptions(
		options: PageOptions,
		currentPage: number,
		totalPages: number
	): number {
		if ("pageOffset" in options) {
			return currentPage + options.pageOffset;
		} else {
			return options.page < 1 ? totalPages + options.page : options.page;
		}
	}
}

type PageOptions = Record<"pageOffset", number> | Record<"page", number>;
