import { expect, test } from "@playwright/test";

test("offers an update action and reloads after the new worker takes control", async ({ page }) => {
  await page.addInitScript(() => {
    const container = new EventTarget();
    const registration = new EventTarget() as EventTarget & {
      installing: (EventTarget & { state: string }) | null;
      waiting: { postMessage: (message: unknown) => void } | null;
      active: null;
    };
    registration.installing = null;
    registration.active = null;
    registration.waiting = {
      postMessage(message) {
        sessionStorage.setItem("worker-activation-message", JSON.stringify(message));
        setTimeout(() => container.dispatchEvent(new Event("controllerchange")), 0);
      },
    };
    Object.assign(container, {
      controller: {},
      register: async () => registration,
      getRegistrations: async () => [registration],
      ready: Promise.resolve(registration),
    });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: container });
    Object.assign(window, {
      revealWorkerUpdate() {
        const worker = new EventTarget() as EventTarget & { state: string };
        worker.state = "installing";
        registration.installing = worker;
        registration.dispatchEvent(new Event("updatefound"));
        worker.state = "installed";
        worker.dispatchEvent(new Event("statechange"));
      },
    });
  });

  await page.goto("/login");
  await page.evaluate(() =>
    (window as unknown as { revealWorkerUpdate(): void }).revealWorkerUpdate(),
  );
  await expect(page.getByText("An update is ready")).toBeVisible();

  await page.getByRole("button", { name: "Reload to update" }).click();
  await page.waitForLoadState("domcontentloaded");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("worker-activation-message")))
    .toBe(JSON.stringify({ type: "activate-update" }));
});
