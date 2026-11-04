import { test, expect } from "@playwright/test";

test("recruiter can inspect evidence, update notes, and explore the pipeline", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Find the people who move you forward.",
    }),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(6);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(page.viewportSize()!.width);
  await page
    .getByRole("button", { name: "Alex Morgan alex.morgan@example.com" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Alex Morgan" }),
  ).toBeVisible();
  await expect(dialog.getByText("Matched requirements")).toBeVisible();
  await dialog.getByRole("button", { name: "Interview guide" }).click();
  await expect(dialog.getByText("Listen for").first()).toBeVisible();
  await dialog.getByRole("button", { name: "Private notes" }).click();
  await dialog
    .getByLabel("Notes for your review")
    .fill("Review reliability tradeoffs.");
  await dialog.getByRole("button", { name: "Save notes" }).click();
  await expect(
    dialog.getByRole("button", { name: "Notes saved" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Hiring pipeline" }).click();
  await expect(
    page.getByRole("heading", { name: "Move great talent forward." }),
  ).toBeVisible();
  await expect(page.locator(".pipeline-card")).toHaveCount(6);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search candidates" })
    .fill("No Such Person");
  await expect(
    page.getByRole("heading", { name: "No candidates match your filters" }),
  ).toBeVisible();
});

test("candidate can analyze a resume without persisting a profile", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/jobs")).json();
  await page.goto("/");
  await page
    .getByRole("button", { name: "Resume Lab", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Your experience. A clearer story." }),
  ).toBeVisible();
  await page.getByLabel("Resume file").setInputFiles({
    name: "resume.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Jane Doe\njane@example.com\nSkills\nPython FastAPI Docker AWS PostgreSQL\nExperience\nBuilt REST APIs with Python and deployed services on AWS. Improved reliability with unit testing and CI/CD. Documented system design decisions and database performance.",
    ),
  });
  await page
    .getByLabel("Target job description")
    .fill(
      "Build Python FastAPI REST APIs with Docker on AWS. Write unit testing and optimize PostgreSQL services.",
    );
  await page.getByRole("button", { name: "Analyze my alignment" }).click();
  await expect(page.getByText("YOUR ALIGNMENT", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Practice the conversation" }),
  ).toBeVisible();
  const after = await (await request.get("/api/jobs")).json();
  expect(
    after.map((job: { candidate_count: number }) => job.candidate_count),
  ).toEqual(
    before.map((job: { candidate_count: number }) => job.candidate_count),
  );
});

test("role creation and batch upload are functional", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open roles" }).click();
  await page.getByRole("button", { name: "Create role", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Role title")
    .fill(`Platform Engineer ${test.info().project.name}`);
  await dialog
    .getByLabel("Job description")
    .fill(
      "Build Python FastAPI services with Docker and AWS. Write automated tests for reliable REST APIs.",
    );
  await dialog
    .getByRole("button", { name: "Create role", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Add candidates" }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: `new-${test.info().project.name}.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Jamie Example\njamie@example.com\nSkills\nPython FastAPI Docker AWS\nExperience\nBuilt reliable REST APIs and deployed Docker services on AWS. Added regression tests, incident reviews, and detailed documentation.",
    ),
  });
  await page.getByRole("button", { name: /Analyze 1 resume/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Jamie Example jamie@example.com" }),
  ).toBeVisible();
});

test("compare candidates using the same requirements", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("checkbox", { name: "Compare Alex Morgan", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Compare Jordan Lee", exact: true })
    .check();
  await page.getByRole("button", { name: "Compare (2)", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Compare the evidence." });
  await expect(
    dialog.getByRole("heading", { name: "Alex Morgan" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "Jordan Lee" }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Skill coverage", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("role edits recalculate requirements and deletion is confirmed", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/jobs", {
    data: {
      title: `Editable role ${test.info().project.name}`,
      description:
        "Build Python FastAPI services with Docker and AWS. Write automated unit testing.",
      required_skills: ["Python"],
    },
  });
  const role = await created.json();
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Active role" })
    .selectOption(role.id);
  await page.getByRole("button", { name: "Edit active role" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Role title")
    .fill(`Updated role ${test.info().project.name}`);
  await dialog.getByRole("button", { name: "Save requirements" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Active role" })).toHaveValue(
    role.id,
  );
  await page.getByRole("button", { name: "Edit active role" }).click();
  await dialog.getByRole("button", { name: "Delete role…" }).click();
  await expect(
    dialog.getByRole("button", { name: "Permanently delete role" }),
  ).toBeDisabled();
  await dialog.getByLabel("Type DELETE to confirm").fill("DELETE");
  await dialog.getByRole("button", { name: "Permanently delete role" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const roles = await (await request.get("/api/jobs")).json();
  expect(roles.some((item: { id: string }) => item.id === role.id)).toBe(false);
});

test("stale notes keep the draft and offer the latest saved version", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Alex Morgan alex.morgan@example.com" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Private notes" }).click();
  const roles = await (await request.get("/api/jobs")).json();
  const candidates = await (
    await request.get(`/api/jobs/${roles[0].id}/candidates`)
  ).json();
  const alex = candidates.items.find(
    (candidate: { profile: { name: string } }) =>
      candidate.profile.name === "Alex Morgan",
  );
  const remote = `Other reviewer's saved note ${Date.now()}`;
  const patch = await request.patch(`/api/candidates/${alex.id}`, {
    data: { version: alex.version, notes: remote },
  });
  expect(patch.status()).toBe(200);
  await dialog
    .getByLabel("Notes for your review")
    .fill("My draft must survive a conflict.");
  await dialog.getByRole("button", { name: "Save notes" }).click();
  await expect(
    dialog.getByRole("heading", {
      name: "Another session saved a newer version.",
    }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Notes for your review")).toHaveValue(
    "My draft must survive a conflict.",
  );
  await dialog.getByText("Latest saved notes", { exact: true }).click();
  await expect(dialog.getByText(remote, { exact: true })).toBeVisible();
  await dialog
    .getByRole("button", { name: "Use latest version and keep my draft" })
    .click();
  await dialog.getByRole("button", { name: "Save notes" }).click();
  await expect(
    dialog.getByRole("button", { name: "Notes saved" }),
  ).toBeVisible();
});

test("expired access removes private workspace data and returns to unlock", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("tbody tr")).toHaveCount(6);
  await page.evaluate(() =>
    sessionStorage.setItem("talentos-key", "expired-test-key"),
  );
  await page.route("**/api/jobs", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Access expired." }),
    }),
  );
  await page.getByRole("button", { name: "Edit active role" }).click();
  await expect(
    page.getByRole("heading", { name: "Your workspace awaits." }),
  ).toBeVisible();
  await expect(page.getByText("alex.morgan@example.com")).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("talentos-key")),
  ).toBeNull();
});
