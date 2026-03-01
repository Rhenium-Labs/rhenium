import { ERROR_CODES } from '../constants/errors'
import { ok, err, type Result, type AppError } from '../types/result'

export async function safeQuery<T>(query: () => Promise<T>): Promise<Result<T>> {
    try {
        return ok(await query())
    } catch (cause) {
        return err({
            code: ERROR_CODES.INTERNAL_ERROR,
            message: 'Database query failed',
            cause,
        })
    }
}

export async function safeFetch<T>(url: string, init?: RequestInit): Promise<Result<T>> {
    try {
        const res = await fetch(url, init)
        if (!res.ok) {
            return err({
                code: ERROR_CODES.INTERNAL_ERROR,
                message: `Fetch failed with status ${res.status}`,
                cause: { status: res.status, statusText: res.statusText },
            })
        }
        return ok(await res.json() as T)
    } catch (cause) {
        return err({
            code: ERROR_CODES.INTERNAL_ERROR,
            message: 'Network request failed',
            cause,
        })
    }
}

export function safeParse<T>(fn: () => T): Result<T> {
    try {
        return ok(fn())
    } catch (cause) {
        return err({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Parse failed',
            cause,
        })
    }
}

export function isErr<T>(result: Result<T>): result is [null, AppError] {
    return result[1] !== null
}

export function isOk<T>(result: Result<T>): result is [T, null] {
    return result[1] === null
}
