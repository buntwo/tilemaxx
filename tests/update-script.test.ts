import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("scheduled updates notify after deployment and skip Docker on unchanged revisions", (t) => {
  const temp = mkdtempSync(join(tmpdir(), "tilemaxx-update-test-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const source = join(temp, "source");
  const checkout = join(temp, "checkout");
  const bin = join(temp, "bin");
  const dockerLog = join(temp, "docker.log");
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    PATH: `${bin}:${process.env.PATH}`,
    TILEMAXX_TEST_DOCKER_LOG: dockerLog,
  };

  function git(cwd: string, ...args: string[]) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", env });
    assert.equal(result.status, 0, result.stderr);
  }

  function update(shouldFail = false, script = "update-if-changed-DSM.sh") {
    return spawnSync("bash", [join(checkout, script)], {
      cwd: temp,
      encoding: "utf8",
      env: { ...env, TILEMAXX_TEST_DOCKER_FAIL: shouldFail ? "1" : "0" },
    });
  }

  function dockerCalls() {
    return readFileSync(dockerLog, "utf8").trim().split("\n").filter(Boolean);
  }

  mkdirSync(source);
  mkdirSync(bin);
  writeFileSync(dockerLog, "");
  writeFileSync(
    join(bin, "docker"),
    `#!/bin/sh
if [ "$*" = 'compose version' ]; then exit 0; fi
printf '%s\n' "$*" >> "$TILEMAXX_TEST_DOCKER_LOG"
test "$TILEMAXX_TEST_DOCKER_FAIL" = 0
`,
    { mode: 0o755 },
  );
  git(source, "init", "-q", "-b", "main");
  git(source, "config", "user.name", "Tilemaxx Test");
  git(source, "config", "user.email", "tilemaxx@example.com");
  git(source, "commit", "--allow-empty", "-qm", "Initial revision");
  git(temp, "clone", "-q", source, checkout);
  for (const script of ["update.sh", "update-if-changed-DSM.sh"]) {
    copyFileSync(script, join(checkout, script));
  }
  writeFileSync(join(checkout, "compose.yaml"), "services: {}\n");

  assert.equal(update().status, 0);
  assert.deepEqual(dockerCalls(), []);

  git(source, "commit", "--allow-empty", "-qm", "New revision");
  mkdirSync(join(checkout, ".git", "tilemaxx-update.lock"));
  assert.equal(update().status, 1);
  assert.deepEqual(dockerCalls(), []);
  rmSync(join(checkout, ".git", "tilemaxx-update.lock"), { recursive: true });

  const composeUp = "compose -f compose.yaml up -d --build --remove-orphans";
  assert.equal(update(true).status, 1);
  assert.deepEqual(dockerCalls(), [composeUp]);
  const retried = update();
  assert.equal(retried.status, 10);
  assert.match(retried.stdout, /Tilemaxx updated successfully to [0-9a-f]+/);
  assert.deepEqual(dockerCalls(), [composeUp, composeUp]);
  assert.equal(update().status, 0);
  assert.deepEqual(dockerCalls(), [composeUp, composeUp]);

  git(source, "commit", "--allow-empty", "-qm", "Another revision");
  assert.equal(update().status, 10);
  assert.deepEqual(dockerCalls(), [composeUp, composeUp, composeUp]);

  assert.equal(update(false, "update.sh").status, 0);
  assert.deepEqual(dockerCalls(), [composeUp, composeUp, composeUp, composeUp]);

  git(checkout, "remote", "set-url", "origin", join(temp, "missing"));
  assert.notEqual(update().status, 0);
  assert.deepEqual(dockerCalls(), [composeUp, composeUp, composeUp, composeUp]);
});
