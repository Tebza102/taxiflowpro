// The "How to use TaxiFlow" guide opens on each account's first sign-in to a
// workspace. Journeys that test something else register this once per page so
// the guide is skipped whenever it appears; tests/user-guide.spec.js covers the
// guide itself and does not use it.
const pagesWithHandler = new WeakSet();

export const skipUserGuideWhenShown = async (page) => {
  if (pagesWithHandler.has(page)) {
    return;
  }
  pagesWithHandler.add(page);
  await page.addLocatorHandler(
    page.getByRole("dialog", { name: "How to use TaxiFlow" }),
    async (dialog) => {
      await dialog.getByRole("button", { name: "Skip for now" }).click({ timeout: 10_000 });
    },
  );
};
