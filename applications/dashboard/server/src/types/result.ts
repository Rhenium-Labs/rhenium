import type { ErrorCode } from '../constants/errors'

export interface AppError {
    code: ErrorCode
    message: string
    cause?: unknown
}

export type Result<T, E = AppError> = [data: T, error: null] | [data: null, error: E]

export function ok<T>(data: T): Result<T> {
    return [data, null]
}

export function err<T = never>(error: AppError): Result<T> {
    return [null, error]
}
