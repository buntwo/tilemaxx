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
    return result.stdout.trim();
  }

  function update(dockerStatus = 0, script = "update-if-changed-DSM.sh") {
    return spawnSync("bash", [join(checkout, script)], {
      cwd: temp,
      encoding: "utf8",
      env: { ...env, TILEMAXX_TEST_DOCKER_STATUS: String(dockerStatus) },
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
exit "$TILEMAXX_TEST_DOCKER_STATUS"
`,
    { mode: 0o755 },
  );
  git(source, "init", "-q", "-b", "main");
  git(source, "config", "user.name", "Tilemaxx Test");
  git(source, "config", "user.email", "tilemaxx@example.com");
  for (const script of ["update.sh", "update-if-changed-DSM.sh"]) {
    copyFileSync(script, join(source, script));
  }
  writeFileSync(join(source, ".gitignore"), "compose.yaml\n.env\ndata/\n");
  writeFileSync(join(source, "application.txt"), "initial\n");
  git(source, "add", ".");
  git(source, "commit", "-qm", "Initial revision");
  const initial = git(source, "rev-parse", "HEAD");
  git(temp, "clone", "-q", source, checkout);
  writeFileSync(join(checkout, "compose.yaml"), "services: {}\n");
  writeFileSync(join(checkout, ".env"), "TILEMAXX_PORT=4173\n");
  mkdirSync(join(checkout, "data"));
  writeFileSync(join(checkout, "data", "tilewise.sqlite"), "test game data\n");

  assert.equal(update().status, 0);
  assert.deepEqual(dockerCalls(), []);

  git(source, "commit", "--allow-empty", "-qm", "New revision");
  mkdirSync(join(checkout, ".git", "tilemaxx-update.lock"));
  assert.equal(update().status, 1);
  assert.deepEqual(dockerCalls(), []);
  rmSync(join(checkout, ".git", "tilemaxx-update.lock"), { recursive: true });

  const composeUp = "compose -f compose.yaml up -d --build --remove-orphans";
  const failed = update(10);
  assert.equal(failed.status, 1);
  assert.match(
    failed.stderr,
    /Tilemaxx update failed \(command exited with 10\)/,
  );
  assert.doesNotMatch(failed.stdout, /Tilemaxx updated successfully/);
  assert.deepEqual(dockerCalls(), [composeUp]);
  const retried = update();
  assert.equal(retried.status, 10);
  assert.match(retried.stdout, /Tilemaxx updated successfully to [0-9a-f]+/);
  assert.deepEqual(dockerCalls(), [composeUp, composeUp]);
  assert.equal(update().status, 0);
  assert.deepEqual(dockerCalls(), [composeUp, composeUp]);

  writeFileSync(join(source, "application.txt"), "original release\n");
  git(source, "commit", "-qam", "Another revision");
  assert.equal(update().status, 10);
  assert.deepEqual(dockerCalls(), [composeUp, composeUp, composeUp]);

  assert.equal(update(0, "update.sh").status, 0);
  assert.deepEqual(dockerCalls(), [composeUp, composeUp, composeUp, composeUp]);

  const originalRelease = git(checkout, "rev-parse", "HEAD");
  git(source, "reset", "--hard", initial);
  writeFileSync(join(source, "application.txt"), "rewritten release\n");
  git(source, "commit", "-qam", "Replacement release");
  const replacement = git(source, "rev-parse", "HEAD");

  const manual = update(0, "update.sh");
  assert.ok(manual.status && manual.status !== 10);
  assert.equal(git(checkout, "rev-parse", "HEAD"), originalRelease);
  assert.equal(dockerCalls().length, 4);

  const application = join(checkout, "application.txt");
  writeFileSync(application, "local tracked edit\n");
  const dirty = update();
  assert.ok(dirty.status && dirty.status !== 10);
  assert.equal(git(checkout, "rev-parse", "HEAD"), originalRelease);
  assert.equal(readFileSync(application, "utf8"), "local tracked edit\n");
  assert.equal(dockerCalls().length, 4);
  git(checkout, "restore", "application.txt");

  assert.equal(update(1).status, 1);
  assert.equal(git(checkout, "rev-parse", "HEAD"), replacement);
  const rewritten = update();
  assert.equal(rewritten.status, 10);
  assert.match(rewritten.stdout, new RegExp(`Tilemaxx updated successfully to ${replacement}`));
  assert.equal(readFileSync(application, "utf8"), "rewritten release\n");
  assert.equal(update().status, 0);
  assert.deepEqual(dockerCalls(), Array(6).fill(composeUp));

  git(source, "reset", "--hard", initial);
  assert.equal(update().status, 10);
  assert.equal(git(checkout, "rev-parse", "HEAD"), initial);
  assert.equal(readFileSync(application, "utf8"), "initial\n");
  assert.equal(readFileSync(join(checkout, "compose.yaml"), "utf8"), "services: {}\n");
  assert.equal(readFileSync(join(checkout, ".env"), "utf8"), "TILEMAXX_PORT=4173\n");
  assert.equal(readFileSync(join(checkout, "data", "tilewise.sqlite"), "utf8"), "test game data\n");

  // An old revision might track a path now reserved for local configuration.
  writeFileSync(join(source, "compose.yaml"), "unexpected tracked file\n");
  git(source, "add", "-f", "compose.yaml");
  git(source, "commit", "-qm", "Tracked deployment file");
  const collision = update();
  assert.equal(collision.status, 1);
  assert.match(collision.stderr, /Sync stopped to protect local files/);
  assert.equal(git(checkout, "rev-parse", "HEAD"), initial);
  assert.equal(readFileSync(join(checkout, "compose.yaml"), "utf8"), "services: {}\n");
  assert.equal(dockerCalls().length, 7);

  git(checkout, "remote", "set-url", "origin", join(temp, "missing"));
  const pullStatus = update().status;
  assert.ok(pullStatus && pullStatus !== 10);
  assert.deepEqual(dockerCalls(), Array(7).fill(composeUp));
});
