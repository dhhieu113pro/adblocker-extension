import test from "node:test";
import assert from "node:assert/strict";

import { parseReleaseTag, validateRelease } from "../scripts/release-version.mjs";

test("release tag must be exactly vX.Y.Z", () => {
  assert.equal(parseReleaseTag("v1.0.12"), "1.0.12");
  assert.throws(() => parseReleaseTag("v1.0.12-edge"), /vX\.Y\.Z/);
  assert.throws(() => parseReleaseTag("1.0.12"), /vX\.Y\.Z/);
  assert.throws(() => parseReleaseTag("v1.0"), /vX\.Y\.Z/);
});

test("manifest and package versions must match the release tag", () => {
  assert.deepEqual(
    validateRelease({
      tag: "v1.0.12",
      manifestVersion: "1.0.12",
      packageVersion: "1.0.12",
    }),
    {
      version: "1.0.12",
      artifactName: "ai-vision-ad-blocker-v1.0.12",
      packageFilename: "ai-vision-ad-blocker-v1.0.12.zip",
    },
  );

  assert.throws(
    () => validateRelease({ tag: "v1.0.12", manifestVersion: "1.0.11", packageVersion: "1.0.12" }),
    /manifest version 1\.0\.11 does not match release 1\.0\.12/,
  );

  assert.throws(
    () => validateRelease({ tag: "v1.0.12", manifestVersion: "1.0.12", packageVersion: "1.0.11" }),
    /package version 1\.0\.11 does not match release 1\.0\.12/,
  );
});
