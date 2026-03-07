import type { ErrorCode, HttpStatus } from '../constants'

export interface AppErrorMeta {
    errorCode: ErrorCode
    status: HttpStatus
}

export interface ErrorResponse {
    error: ErrorCode
    message: string
    status: HttpStatus
}

export function isAppErrorMeta(cause: unknown): cause is AppErrorMeta {
    return (
        typeof cause === 'object' &&
        cause !== null &&
        'errorCode' in cause &&
        'status' in cause
    )
}
