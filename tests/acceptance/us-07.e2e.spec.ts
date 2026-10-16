// US-07 AC-07.3 (solo observable en la UI). Playwright; requiere la app local en BASE_URL
// (por defecto http://localhost:8080) con sustitutos de servicios externos.
import { test, expect } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://localhost:8080';

test('AC-07.3 primera visita muestra aviso de privacidad y registra la aceptación', async ({ page }) => {
  await page.goto(base);
  const notice = page.getByRole('dialog', { name: /privacidad/i });
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: /acept/i }).click();
  await expect(notice).toBeHidden();

  await page.reload();
  await expect(page.getByRole('dialog', { name: /privacidad/i })).toBeHidden();
});
