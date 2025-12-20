/**
 * Inflects a word based on the count.
 *
 * @param count The count to base the inflection on.
 * @param singular The singular form of the word.
 * @returns The inflected word.
 */

export function inflect(count: number, singular: string, plural = `${singular}s`): string {
	return count === 1 ? singular : plural;
}

/**
 * Wait a certain amount of time before proceeding with the next step.
 *
 * @param ms The amount of time to wait in milliseconds.
 * @returns A promise that resolves after the specified time has elapsed.
 */

export async function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}
