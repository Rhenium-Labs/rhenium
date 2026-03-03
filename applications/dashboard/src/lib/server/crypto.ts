import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	timingSafeEqual,
	scryptSync,
	createHmac
} from "crypto";
import { env } from "$lib/env";

/**
 * Encryption configuration.
 * Uses AES-256-GCM for authenticated encryption.
 */
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits for AES-256

/**
 * Derives a 256-bit encryption key from the session secret using scrypt.
 * The salt is included to derive different keys for different purposes.
 */
function deriveKey(salt: Buffer, purpose: string): Buffer {
	return scryptSync(`${env.SESSION_SECRET}:${purpose}`, salt, KEY_LENGTH);
}

/**
 * Encrypts a string using AES-256-GCM.
 * Returns a base64-encoded string containing: salt + iv + authTag + ciphertext
 *
 * @param plaintext - The string to encrypt
 * @param purpose - A purpose string for key derivation (e.g., "access_token", "refresh_token")
 * @returns Base64-encoded encrypted data
 */
export function encrypt(plaintext: string, purpose: string): string {
	const salt = randomBytes(SALT_LENGTH);
	const key = deriveKey(salt, purpose);
	const iv = randomBytes(IV_LENGTH);

	const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

	const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

	const authTag = cipher.getAuthTag();

	// Combine: salt (16) + iv (12) + authTag (16) + ciphertext
	const combined = Buffer.concat([salt, iv, authTag, encrypted]);

	return combined.toString("base64url");
}

/**
 * Decrypts a string that was encrypted with the encrypt function.
 *
 * @param ciphertext - Base64-encoded encrypted data
 * @param purpose - Must match the purpose used during encryption
 * @returns The decrypted plaintext, or null if decryption fails
 */
export function decrypt(ciphertext: string, purpose: string): string | null {
	try {
		const combined = Buffer.from(ciphertext, "base64url");

		// Validate minimum length
		const minLength = SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 1;
		if (combined.length < minLength) {
			return null;
		}

		// Extract components
		const salt = combined.subarray(0, SALT_LENGTH);
		const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
		const authTag = combined.subarray(
			SALT_LENGTH + IV_LENGTH,
			SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
		);
		const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

		const key = deriveKey(salt, purpose);

		const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
		decipher.setAuthTag(authTag);

		const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

		return decrypted.toString("utf8");
	} catch {
		// Decryption failed (invalid ciphertext, wrong key, tampered data, etc.)
		return null;
	}
}

/**
 * Performs a timing-safe string comparison.
 * Returns true if the strings are equal, false otherwise.
 * This prevents timing attacks when comparing secrets.
 */
export function safeCompare(a: string, b: string): boolean {
	// Convert to buffers
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);

	// If lengths differ, still do a comparison to prevent timing leaks
	// but use a consistent length
	if (bufA.length !== bufB.length) {
		// Compare with itself to use consistent time, then return false
		timingSafeEqual(bufA, bufA);
		return false;
	}

	return timingSafeEqual(bufA, bufB);
}

/**
 * Generates a cryptographically secure random token.
 *
 * @param bytes - Number of random bytes (default: 32)
 * @returns Hex-encoded random string
 */
export function generateSecureToken(bytes = 32): string {
	return randomBytes(bytes).toString("hex");
}

/**
 * Hashes a value with HMAC-SHA256 using the session secret.
 * Used for generating session token signatures.
 */
export function hmacSign(data: string): string {
	return createHmac("sha256", env.SESSION_SECRET).update(data).digest("hex");
}
