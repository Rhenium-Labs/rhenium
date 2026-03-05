import { redirect, type Handle, type HandleServerError } from "@sveltejs/kit";
import { PUBLIC_BASE_URL } from "$env/static/public";

import Logger from "$utils/Logger";
import SessionManager from "$utils/server/Session";

/** Routes that require authentication. */
const PROTECTED_ROUTES = ["/servers"];

/** Routes that should redirect to /servers if already logged in. */
const GUEST_ONLY_ROUTES = ["/"];

/** Whether we're running in production (HTTPS). */
const IS_PRODUCTION = PUBLIC_BASE_URL.startsWith("https");

/**
 * Security headers applied to all responses.
 * These follow OWASP recommendations and modern security best practices.
 */
const SECURITY_HEADERS: Record<string, string> = {
	// Prevent clickjacking attacks
	"X-Frame-Options": "DENY",
	// Prevent MIME type sniffing
	"X-Content-Type-Options": "nosniff",
	// Enable XSS protection in older browsers
	"X-XSS-Protection": "1; mode=block",
	// Control referrer information
	"Referrer-Policy": "strict-origin-when-cross-origin",
	// Restrict browser features
	"Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
	// Prevent DNS prefetching for privacy
	"X-DNS-Prefetch-Control": "off"
};

/**
 * Content Security Policy directives.
 * Restricts resource loading to prevent XSS and data injection attacks.
 */
const CSP_DIRECTIVES: Record<string, string[]> = {
	"default-src": ["'self'"],
	"script-src": ["'self'", "'unsafe-inline'"], // SvelteKit requires unsafe-inline for hydration
	"style-src": ["'self'", "'unsafe-inline'"], // Tailwind and inline styles
	"img-src": ["'self'", "https://cdn.discordapp.com", "data:"],
	"font-src": ["'self'"],
	"connect-src": ["'self'"],
	"frame-ancestors": ["'none'"],
	"base-uri": ["'self'"],
	"form-action": ["'self'"],
	"object-src": ["'none'"],
	"upgrade-insecure-requests": []
};

/**
 * Builds the Content-Security-Policy header value.
 */
function buildCSP(): string {
	return Object.entries(CSP_DIRECTIVES)
		.map(([directive, values]) => {
			if (values.length === 0) return directive;
			return `${directive} ${values.join(" ")}`;
		})
		.join("; ");
}

function getRequestId(request: Request): string {
	return request.headers.get("x-request-id") ?? crypto.randomUUID();
}

export const handle: Handle = async ({ event, resolve }) => {
	const requestId = getRequestId(event.request);
	event.locals.requestId = requestId;

	// Load session for all requests
	event.locals.session = await SessionManager.get(event.cookies);

	const { pathname } = event.url;

	// Check if this is a protected route
	const isProtected = PROTECTED_ROUTES.some(
		route => pathname === route || pathname.startsWith(`${route}/`)
	);

	if (isProtected && !event.locals.session) {
		// Store the intended destination for redirect after login
		const returnTo = encodeURIComponent(pathname + event.url.search);
		redirect(302, `/?returnTo=${returnTo}`);
	}

	// Redirect logged-in users away from guest-only pages
	const isGuestOnly = GUEST_ONLY_ROUTES.includes(pathname);
	if (isGuestOnly && event.locals.session) {
		redirect(302, "/servers");
	}

	const startedAt = Date.now();

	let response: Response;
	try {
		// Resolve the request
		response = await resolve(event);
	} catch (error) {
		Logger.errorWithCause("Unhandled error during request resolution", error, {
			requestId,
			method: event.request.method,
			path: event.url.pathname,
			search: event.url.search,
			userId: event.locals.session?.userId ?? null
		});
		throw error;
	}

	response.headers.set("x-request-id", requestId);

	// Apply security headers to all responses
	for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
		response.headers.set(header, value);
	}

	// Apply Content-Security-Policy
	response.headers.set("Content-Security-Policy", buildCSP());

	// Apply Strict-Transport-Security in production
	if (IS_PRODUCTION) {
		// 1 year, include subdomains, allow preload list inclusion
		response.headers.set(
			"Strict-Transport-Security",
			"max-age=31536000; includeSubDomains; preload"
		);
	}

	if (response.status >= 500) {
		Logger.error("Server returned 5xx response", {
			requestId,
			status: response.status,
			method: event.request.method,
			path: event.url.pathname,
			durationMs: Date.now() - startedAt,
			userId: event.locals.session?.userId ?? null
		});
	}

	return response;
};

export const handleError: HandleServerError = ({ error, event, status, message }) => {
	Logger.errorWithCause("SvelteKit handleError captured server error", error, {
		requestId: event.locals.requestId,
		status,
		message,
		method: event.request.method,
		path: event.url.pathname,
		search: event.url.search,
		userId: event.locals.session?.userId ?? null
	});

	return {
		message: "Internal Server Error"
	};
};
