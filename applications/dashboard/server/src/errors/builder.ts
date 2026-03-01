import { TRPCError } from '@trpc/server'
import { ERROR_CODES, type ErrorCode } from '../constants/errors'
import { HTTP_STATUS, type HttpStatus } from '../constants/http'
import type { AppErrorMeta, ErrorResponse } from './types'
import { err, type Result, type AppError } from '../types/result'

type TRPCCode = ConstructorParameters<typeof TRPCError>[0]['code']

const TRPC_CODE_MAP: Record<ErrorCode, TRPCCode> = {
    [ERROR_CODES.VALIDATION_ERROR]: 'BAD_REQUEST',
    [ERROR_CODES.UNAUTHORIZED]: 'UNAUTHORIZED',
    [ERROR_CODES.FORBIDDEN]: 'FORBIDDEN',
    [ERROR_CODES.NOT_FOUND]: 'NOT_FOUND',
    [ERROR_CODES.CONFLICT]: 'CONFLICT',
    [ERROR_CODES.RATE_LIMITED]: 'TOO_MANY_REQUESTS',
    [ERROR_CODES.INTERNAL_ERROR]: 'INTERNAL_SERVER_ERROR',
    [ERROR_CODES.WEBHOOK_ERROR]: 'BAD_REQUEST',
}

const STATUS_MAP: Record<ErrorCode, HttpStatus> = {
    [ERROR_CODES.VALIDATION_ERROR]: HTTP_STATUS.BAD_REQUEST,
    [ERROR_CODES.UNAUTHORIZED]: HTTP_STATUS.UNAUTHORIZED,
    [ERROR_CODES.FORBIDDEN]: HTTP_STATUS.FORBIDDEN,
    [ERROR_CODES.NOT_FOUND]: HTTP_STATUS.NOT_FOUND,
    [ERROR_CODES.CONFLICT]: HTTP_STATUS.CONFLICT,
    [ERROR_CODES.RATE_LIMITED]: HTTP_STATUS.TOO_MANY_REQUESTS,
    [ERROR_CODES.INTERNAL_ERROR]: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    [ERROR_CODES.WEBHOOK_ERROR]: HTTP_STATUS.BAD_REQUEST,
}

export class ErrorBuilder {
    private _errorCode: ErrorCode
    private _message: string
    private _originalCause?: unknown

    private constructor(errorCode: ErrorCode, message: string) {
        this._errorCode = errorCode
        this._message = message
    }

    errorCode(code: ErrorCode): this {
        this._errorCode = code
        return this
    }

    message(message: string): this {
        this._message = message
        return this
    }

    cause(cause: unknown): this {
        this._originalCause = cause
        return this
    }

    toAppError(): AppError {
        return {
            code: this._errorCode,
            message: this._message,
            cause: this._originalCause,
        }
    }

    toResult<T = never>(): Result<T> {
        return err(this.toAppError())
    }

    toResponse(): ErrorResponse {
        return {
            error: this._errorCode,
            message: this._message,
            status: STATUS_MAP[this._errorCode],
        }
    }

    build(): TRPCError {
        const meta: AppErrorMeta = {
            errorCode: this._errorCode,
            status: STATUS_MAP[this._errorCode],
        }

        return new TRPCError({
            code: TRPC_CODE_MAP[this._errorCode],
            message: this._message,
            cause: { ...meta, originalCause: this._originalCause },
        })
    }

    throw(): never {
        throw this.build()
    }

    static validation(message: string): ErrorBuilder {
        return new ErrorBuilder(ERROR_CODES.VALIDATION_ERROR, message)
    }

    static unauthorized(message = 'Missing or invalid authentication'): ErrorBuilder {
        return new ErrorBuilder(ERROR_CODES.UNAUTHORIZED, message)
    }

    static forbidden(message = 'Insufficient permissions'): ErrorBuilder {
        return new ErrorBuilder(ERROR_CODES.FORBIDDEN, message)
    }

    static notFound(message = 'Resource not found'): ErrorBuilder {
        return new ErrorBuilder(ERROR_CODES.NOT_FOUND, message)
    }

    static conflict(message: string): ErrorBuilder {
        return new ErrorBuilder(ERROR_CODES.CONFLICT, message)
    }

    static rateLimited(message = 'Too many requests'): ErrorBuilder {
        return new ErrorBuilder(ERROR_CODES.RATE_LIMITED, message)
    }

    static internal(message = 'Internal server error'): ErrorBuilder {
        return new ErrorBuilder(ERROR_CODES.INTERNAL_ERROR, message)
    }

    static webhookError(message: string): ErrorBuilder {
        return new ErrorBuilder(ERROR_CODES.WEBHOOK_ERROR, message)
    }

    static fromAppError(appError: AppError): ErrorBuilder {
        return new ErrorBuilder(appError.code, appError.message).cause(appError.cause)
    }
}
