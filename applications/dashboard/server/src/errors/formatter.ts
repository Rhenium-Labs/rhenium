import { ERROR_CODES } from '../constants/errors'
import { HTTP_STATUS } from '../constants/http'
import { isAppErrorMeta } from './types'
import type { ErrorResponse } from './types'

export function formatTRPCError(error: { message: string; cause?: unknown }): ErrorResponse {
    if (isAppErrorMeta(error.cause)) {
        return {
            error: error.cause.errorCode,
            message: error.message,
            status: error.cause.status,
        }
    }

    return {
        error: ERROR_CODES.INTERNAL_ERROR,
        message: error.message,
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    }
}
