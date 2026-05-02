import { parentPort } from "node:worker_threads";
import sharp from "sharp";
import Tesseract from "node-tesseract-ocr";

if (!parentPort) throw new Error("ocr-worker must be run as a worker thread");

type OcrRequest = { requestId: string; type: "ocr"; base64: string; lang: string };
type ConvertRequest = { requestId: string; type: "convert"; buffer: ArrayBuffer };
type WorkerRequest = OcrRequest | ConvertRequest;

parentPort.on("message", async (req: WorkerRequest) => {
	try {
		if (req.type === "ocr") {
			const buffer = Buffer.from(req.base64, "base64");
			const text = await Tesseract.recognize(buffer, { lang: req.lang });
			parentPort!.postMessage({ requestId: req.requestId, type: "ocr-result", text });
		} else {
			const input = Buffer.from(req.buffer);
			const pngBuffer = await sharp(input)
				.png()
				.resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
				.toBuffer();
			parentPort!.postMessage({
				requestId: req.requestId,
				type: "convert-result",
				base64: pngBuffer.toString("base64")
			});
		}
	} catch (err) {
		parentPort!.postMessage({
			requestId: req.requestId,
			type: "error",
			message: err instanceof Error ? err.message : String(err)
		});
	}
});
