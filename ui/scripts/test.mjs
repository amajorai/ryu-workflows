import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(packageRoot, "src");

function discover(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== "node_modules" && entry.name !== "dist") {
				files.push(...discover(path));
			}
		} else if (/\.test\.(?:ts|tsx)$/.test(entry.name)) {
			files.push(path);
		}
	}
	return files;
}

const testFiles = discover(sourceRoot).sort((a, b) => a.localeCompare(b));
const renderedFiles = testFiles.filter((file) =>
	readFileSync(file, "utf8").includes("@happy-dom/global-registrator")
);
const sharedFiles = testFiles.filter((file) => !renderedFiles.includes(file));

if (testFiles.length === 0) {
	throw new Error("No Workflows UI source tests were found.");
}

let failed = false;
function run(files) {
	if (files.length === 0) {
		return;
	}
	const result = spawnSync("bun", ["test", ...files], {
		cwd: packageRoot,
		stdio: "inherit",
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		failed = true;
	}
}

run(sharedFiles);
// Happy DOM mutates process-wide browser globals. Keep the rendered panel suite
// in its own Bun process so it cannot alter the pure bridge/serialization tests.
for (const file of renderedFiles) {
	console.log(`\n=== ${relative(packageRoot, file)} ===`);
	run([file]);
}

process.exitCode = failed ? 1 : 0;
