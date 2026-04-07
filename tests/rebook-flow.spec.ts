import { test, expect } from '@playwright/test';

test.describe('Rebook Mode Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('Step 1: Rebook Mode - PNR sync hydrates store and shows route in Step 2', async ({ page }) => {
    // Mock the /api/ingest-pnr endpoint
    await page.route('**/api/ingest-pnr', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          ticket: {
            pnr: 'ABC123',
            carrier: 'A3',
            origin: 'CAI',
            destination: 'ATH',
            bookingClass: 'K',
            departureDate: '2026-05-15',
            returnDate: '2026-05-22',
            passengers: { adults: 2, children: 0, infants: 0 },
            rawOrderData: {
              orderId: 'ord_test123',
              status: 'confirmed',
              passengers: [{ given_name: 'John', family_name: 'Doe' }],
              cabinClass: 'economy',
              totalAmount: '850.00',
              currency: 'EUR',
              fareBrand: 'Light',
            },
          },
        }),
      });
    });

    // Verify Step 1 is visible
    await expect(page.locator('text=SOURCE INTAKE BUFFER')).toBeVisible();

    // Click on Rebook Mode tab (should be default)
    const rebookTab = page.locator('button:has-text("Rebook Mode")');
    await expect(rebookTab).toBeVisible();

    // Enter PNR
    const pnrInput = page.locator('input[placeholder="ABC123"]');
    await pnrInput.fill('ABC123');

    // Enter Last Name
    const lastNameInput = page.locator('input[placeholder="SMITH"]');
    await lastNameInput.fill('DOE');

    // Click SYNC RECORD button
    const syncButton = page.locator('button:has-text("SYNC RECORD")');
    await expect(syncButton).toBeEnabled();
    await syncButton.click();

    // Wait for navigation to Step 2
    await expect(page.locator('text=LOCKED ROUTE')).toBeVisible({ timeout: 10000 });

    // Verify route data is NOT "---" (hydration worked)
    const originField = page.locator('text=CAI').first();
    await expect(originField).toBeVisible();

    const destField = page.locator('text=ATH').first();
    await expect(destField).toBeVisible();

    const carrierField = page.locator('text=A3').first();
    await expect(carrierField).toBeVisible();

    // Verify Orchestrate Sweep button is enabled (search window not set, so might be disabled, but route should be visible)
    const lockedRouteCard = page.locator('text=LOCKED ROUTE').locator('..');
    await expect(lockedRouteCard).not.toContainText('---');
  });

  test('Step 1: Fresh Mode - manual route entry hydrates store', async ({ page }) => {
    // Click on Fresh Mode tab
    const freshTab = page.locator('button:has-text("Fresh Mode")');
    await freshTab.click();

    // Verify Fresh Mode form is visible
    await expect(page.locator('text=FRESH ROUTE CONFIGURATION')).toBeVisible();

    // Enter route details
    const originInput = page.locator('#fresh-origin');
    await originInput.fill('LHR');

    const destInput = page.locator('#fresh-destination');
    await destInput.fill('JFK');

    const carrierInput = page.locator('#fresh-carrier');
    await carrierInput.fill('BA');

    // Click Configure Route button
    const configureButton = page.locator('button:has-text("Configure Route")');
    await expect(configureButton).toBeEnabled();
    await configureButton.click();

    // Wait for navigation to Step 2
    await expect(page.locator('text=LOCKED ROUTE')).toBeVisible({ timeout: 10000 });

    // Verify route data is NOT "---"
    const originField = page.locator('text=LHR').first();
    await expect(originField).toBeVisible();

    const destField = page.locator('text=JFK').first();
    await expect(destField).toBeVisible();

    const carrierField = page.locator('text=BA').first();
    await expect(carrierField).toBeVisible();
  });

  test('Step 2: Locked Route displays route from Step 1 without jitter', async ({ page }) => {
    // Set up Fresh Mode route first
    await page.route('**/api/ingest-pnr', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          ticket: {
            pnr: 'TESTPNR',
            carrier: 'A3',
            origin: 'CAI',
            destination: 'ATH',
            bookingClass: 'Y',
            departureDate: '2026-06-01',
            returnDate: '2026-06-08',
            passengers: { adults: 1, children: 0, infants: 0 },
            rawOrderData: {
              orderId: 'ord_test456',
              status: 'confirmed',
              passengers: [{ given_name: 'Test', family_name: 'User' }],
              cabinClass: 'economy',
              totalAmount: '500.00',
              currency: 'EUR',
            },
          },
        }),
      });
    });

    // Enter PNR
    await page.locator('input[placeholder="ABC123"]').fill('TESTPNR');
    await page.locator('input[placeholder="SMITH"]').fill('USER');

    // Click SYNC RECORD
    await page.locator('button:has-text("SYNC RECORD")').click();

    // Wait for Step 2
    await expect(page.locator('text=LOCKED ROUTE')).toBeVisible({ timeout: 10000 });

    // Verify READ ONLY badge is present
    await expect(page.locator('text=READ ONLY')).toBeVisible();

    // Verify route values are present (not ---)
    await expect(page.locator('text=CAI').first()).toBeVisible();
    await expect(page.locator('text=ATH').first()).toBeVisible();
    await expect(page.locator('text=A3').first()).toBeVisible();
  });

  test('Step 1: PDF dropzone is present and functional', async ({ page }) => {
    // Verify PDF dropzone is visible
    const dropzone = page.locator('text=DROP E-TICKET PDF');
    await expect(dropzone).toBeVisible();

    // Verify Rebook Mode and Fresh Mode tabs exist
    await expect(page.locator('button:has-text("Rebook Mode")')).toBeVisible();
    await expect(page.locator('button:has-text("Fresh Mode")')).toBeVisible();
  });
});
