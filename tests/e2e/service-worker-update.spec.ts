import { expect, test } from "@playwright/test";

test("offers an update action and reloads after the new worker takes control", async ({ page }) => {
  let documentLoads = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && new URL(request.url()).pathname === "/login") {
      documentLoads += 1;
    }
  });

  await page.addInitScript(() => {
    const container = new EventTarget();
    const registration = new EventTarget() as EventTarget & {
      installing: (EventTarget & { state: string }) | null;
      waiting: { postMessage: (message: unknown) => void } | null;
      active: null;
    };
    registration.installing = null;
    registration.active = null;
    const waitingWorker = {
      postMessage(message: unknown) {
        sessionStorage.setItem("worker-activation-message", JSON.stringify(message));
        setTimeout(() => container.dispatchEvent(new Event("controllerchange")), 0);
      },
    };
    registration.waiting = null;
    const addRegistrationListener = registration.addEventListener.bind(registration);
    registration.addEventListener = ((...args: Parameters<EventTarget["addEventListener"]>) => {
      addRegistrationListener(...args);
      if (args[0] === "updatefound") {
        Object.assign(window, { workerUpdateListenerAttached: true });
      }
    }) as EventTarget["addEventListener"];
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
        registration.waiting = waitingWorker;
        registration.dispatchEvent(new Event("updatefound"));
        worker.state = "installed";
        worker.dispatchEvent(new Event("statechange"));
      },
    });
  });

  await page.goto("/login");
  // Registration is attached from a React effect. Wait for updatefound's
  // listener itself, rather than merely for register(), so the event cannot be
  // lost between the promise resolving and the registrar subscribing.
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          (window as unknown as { workerUpdateListenerAttached?: boolean })
            .workerUpdateListenerAttached,
        ),
      ),
    )
    .toBe(true);
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
  expect(documentLoads).toBe(2);
});
