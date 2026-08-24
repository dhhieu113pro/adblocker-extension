import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function parseReleaseTag(tag) {
  const match = /^v(\d+\.\d+\.\d+)$/.exec(tag ?? "");
  if (!match) {
    throw new Error(`Release tag must match vX.Y.Z exactly; received ${tag || "<empty>"}`);
  }
  return match[1];
}

export function validateRelease({ tag, manifestVersion, packageVersion }) {
  const version = parseReleaseTag(tag);

  if (manifestVersion !== version) {
    throw new Error(`manifest version ${manifestVersion} does not match release ${version}`);
  }
  if (packageVersion !== version) {
    throw new Error(`package version ${packageVersion} does not match release ${version}`);
  }

  return {
    version,
    artifactName: `ai-vision-ad-blocker-v${version}`,
    packageFilename: `ai-vision-ad-blocker-v${version}.zip`,
  };
}

function main() {
  const tag = process.argv[2] || process.env.GITHUB_REF_NAME;
  const manifest = JSON.parse(readFileSync("src/manifest.json", "utf8"));
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const result = validateRelease({
    tag,
    manifestVersion: manifest.version,
    packageVersion: packageJson.version,
  });

  console.log(`Release version: ${result.version}`);
  console.log(`Artifact: ${result.packageFilename}`);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${result.version}\nartifact_name=${result.artifactName}\npackage_filename=${result.packageFilename}\n`,
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
