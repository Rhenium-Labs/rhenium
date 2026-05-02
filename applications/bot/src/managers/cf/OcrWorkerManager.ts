import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import Logger from "#utils/Logger.js";

const RECYCLE_AFTER_OPS = 500;

const WORKER_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../workers/ocr-worker.js"
);

type PendingRequest = {
	resolve: (value: string | null) => void;
	reject: (reason: Error) => void;
};

type WorkerMessage = {
	requestId: string;
	type: "ocr-result" | "convert-result" | "error";
	text?: string;
	base64?: string;
	message?: string;
};

export default class OcrWorkerManager {
	private static _worker: Worker | null = null;
	private static _pending = new Map<string, PendingRequest>();
	private static _opCount = 0;

	static runOcr(base64: string, lang = "eng"): Promise<string | null> {
		return new Promise((resolve, reject) => {
			const requestId = randomUUID();
			this._pending.set(requestId, { resolve, reject });
			this._getWorker().postMessage({ requestId, type: "ocr", base64, lang });
			this._maybeRecycle();
		});
	}

	static convertImage(rawBuffer: Uint8Array): Promise<string | null> {
		return new Promise((resolve, reject) => {
			const requestId = randomUUID();
			// Slice creates an owned copy so the original Uint8Array remains usable.
			// The copy is then transferred zero-copy into the worker.
			const transfer = rawBuffer.buffer.slice(
				rawBuffer.byteOffset,
				rawBuffer.byteOffset + rawBuffer.byteLength
			) as ArrayBuffer;
			this._pending.set(requestId, { resolve, reject });
			this._getWorker().postMessage({ requestId, type: "convert", buffer: transfer }, [transfer]);
			this._maybeRecycle();
		});
	}

	static shutdown(): void {
		this._worker?.terminate();
		this._worker = null;
		const err = new Error("OcrWorkerManager shut down");
		for (const { reject } of this._pending.values()) reject(err);
		this._pending.clear();
	}

	private static _getWorker(): Worker {
		if (!this._worker) this._worker = this._spawn();
		return this._worker;
	}

	private static _spawn(): Worker {
		const worker = new Worker(WORKER_PATH);

		worker.on("message", (msg: WorkerMessage) => {
			const pending = this._pending.get(msg.requestId);
			if (!pending) return;
			this._pending.delete(msg.requestId);

			if (msg.type === "error") {
				pending.reject(new Error(msg.message ?? "OCR worker error"));
			} else if (msg.type === "ocr-result") {
				pending.resolve(msg.text ?? null);
			} else {
				pending.resolve(msg.base64 ?? null);
			}
		});

		worker.on("error", err => {
			Logger.error("OCR worker error:", err);
			this._rejectAll(err instanceof Error ? err : new Error(String(err)));
			this._worker = null;
		});

		worker.on("exit", code => {
			if (code !== 0) {
				Logger.warn(`OCR worker exited with code ${code}`);
				this._rejectAll(new Error(`OCR worker exited with code ${code}`));
			}
			this._worker = null;
		});

		return worker;
	}

	private static _maybeRecycle(): void {
		this._opCount++;
		if (this._opCount >= RECYCLE_AFTER_OPS && this._pending.size === 0) {
			this._opCount = 0;
			this._worker?.terminate();
			this._worker = null;
		}
	}

	private static _rejectAll(err: Error): void {
		for (const { reject } of this._pending.values()) reject(err);
		this._pending.clear();
	}
}
