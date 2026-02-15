/**
 * Thumbnail Generation Worker
 * Handles offscreen canvas operations for thumbnail resizing and compression.
 */

self.onmessage = async (e) => {
	const { bitmap, width, height, quality = 0.8 } = e.data;

	try {
		// Use OffscreenCanvas
		const canvas = new OffscreenCanvas(width, height);
		const ctx = canvas.getContext("2d");

		// Draw bitmap
		ctx.drawImage(bitmap, 0, 0, width, height);

		// Convert to Blob (JPEG)
		const blob = await canvas.convertToBlob({
			type: "image/jpeg",
			quality: quality,
		});

		// Release bitmap
		bitmap.close();

		// Return blob
		self.postMessage({ success: true, blob });
	} catch (err) {
		self.postMessage({ success: false, error: err.message });
	}
};
