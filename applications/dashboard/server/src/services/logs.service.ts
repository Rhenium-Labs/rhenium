import { ErrorBuilder } from '../errors/builder'
import type { ContentFilterRepository } from '../repositories/content-filter.repository'

export class LogsService {
    constructor(private contentFilterRepo: ContentFilterRepository) {}

    async contentAlert(alertId: string) {
        const [alert, alertErr] = await this.contentFilterRepo.findAlert(alertId)
        if (alertErr) ErrorBuilder.internal().cause(alertErr.cause).throw()
        if (!alert) ErrorBuilder.notFound('Alert not found').throw()

        const [logs, logsErr] = await this.contentFilterRepo.findLogsByAlertId(alertId)
        if (logsErr) ErrorBuilder.internal().cause(logsErr.cause).throw()

        return { alert, logs: logs! }
    }

    async contentLog(alertId: string) {
        const [logs, err] = await this.contentFilterRepo.findLogsByAlertId(alertId)
        if (err) ErrorBuilder.internal().cause(err.cause).throw()
        return logs!
    }
}
