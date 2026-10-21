import archiver from "archiver";
import { createWriteStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const manifest = JSON.parse(
	await readFile(path.join(root, "manifest.json"), "utf8"),
);

// `node scripts/build.mjs --bump` increments the patch version in both files.
if (process.argv.includes("--bump")) {
	const parts = String(manifest.version).split(".").map(Number);
	parts[2] = (parts[2] || 0) + 1;
	const next = parts.join(".");
	manifest.version = next;
	pkg.version = next;
	await writeFile(
		path.join(root, "manifest.json"),
		`${JSON.stringify(manifest, null, "\t")}\n`,
	);
	await writeFile(
		path.join(root, "package.json"),
		`${JSON.stringify(pkg, null, "\t")}\n`,
	);
	console.log(`Bumped version to ${next}`);
}

if (manifest.version !== pkg.version) {
	console.error(
		`Version mismatch: manifest.json is ${manifest.version}, package.json is ${pkg.version}`,
	);
	process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
	console.error(`Invalid manifest version: ${manifest.version}`);
	process.exit(1);
}

const outputPath = path.resolve(
	root,
	"..",
	`v${manifest.version}.zip`,
);
const output = createWriteStream(outputPath);
const archive = archiver("zip", { zlib: { level: 9 } });

archive.on("warning", (err) => {
	if (err.code !== "ENOENT") throw err;
	console.warn(err.message);
});
archive.on("error", (err) => {
	throw err;
});

archive.pipe(output);

for (const file of ["manifest.json", "newtab.html", "userguide.html"]) {
	archive.file(path.join(root, file), { name: file });
}
for (const dir of ["assets", "css", "icons", "js"]) {
	archive.directory(path.join(root, dir), dir);
}

await archive.finalize();
await new Promise((resolve, reject) => {
	output.on("close", resolve);
	output.on("error", reject);
});

console.log(
	`Built ${outputPath} (${archive.pointer()} bytes, version ${manifest.version})`,
);
