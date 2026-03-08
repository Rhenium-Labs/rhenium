import { authUrls } from "@/lib/api";
import { Button } from "@/components/ui/button";
import RheniumLogo from "@/assets/Rhenium.png";
import { APP_NAME } from "@/constants";
export function HomePage() {

	return (
		<div
			className="fixed inset-0 flex items-center justify-center bg-cover bg-center bg-no-repeat"
			style={{ backgroundImage: "url(/background_homepage.svg)" }}
		>
			<div className="flex w-full max-h-100 flex-row items-center justify-center gap-6 rounded-xl bg-discord-panel/95 px-10 py-8 shadow-xl backdrop-blur-sm md:h-1/2 md:w-1/2 md:max-h-none">
				<div className="flex w-2/3 flex-col items-center justify-center gap-6">
					<h2 className="text-lg font-semibold text-discord-text">
						Welcome to {APP_NAME} dashboard!
					</h2>
					<p>Press the button below to login to your account via Discord!</p>
					<Button
						variant="discordPrimary"
						onClick={() => {
							window.location.href = authUrls.discord();
						}}
					>
						Log in with Discord
					</Button>
				</div>

				<div className="flex w-1/3 items-center justify-center">
					<img
						src={RheniumLogo}
						alt="Rhenium"
						className="h-24 w-24 object-contain"
					/>
				</div>
			</div>
		</div>
	);
}
