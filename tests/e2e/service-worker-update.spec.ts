import { expect, test } from "@playwright/test";

test("offers an update action and reloads after the new worker takes control", async ({ page }) => {
  await page.addInitScript(() => {
    const loads = Number(sessionStorage.getItem("worker-test-loads") ?? "0") + 1;
    sessionStorage.setItem("worker-test-loads", String(loads));
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
      register: async () => {
        Object.assign(window, { workerRegistrationObserved: true });
        return registration;
      },
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
  // Registration is attached from a React effect. Waiting for the mock to be
  // called avoids dispatching updatefound before the registrar has subscribed.
  await expect.poll(() =>
    page.evaluate(() => Boolean((window as unknown as { workerRegistrationObserved?: boolean }).workerRegistrationObserved)),
  ).toBe(true);
  await page.evaluate(() =>
    (window as unknown as { revealWorkerUpdate(): void }).revealWorkerUpdate(),
  );
  await expect(page.getByText("An update is ready")).toBeVisible();

  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.getByRole("button", { name: "Reload to update" }).click(),
  ]);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("worker-activation-message")))
    .toBe(JSON.stringify({ type: "activate-update" }));
  await expect.poll(() => page.evaluate(() => Number(sessionStorage.getItem("worker-test-loads"))))
    .toBeGreaterThanOrEqual(2);
});
